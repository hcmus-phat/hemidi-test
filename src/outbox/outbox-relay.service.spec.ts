import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderQueueProducer } from '../queue/order-queue.producer';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OutboxRelayService, RelayBatchResult } from './outbox-relay.service';
import { OutboxRepository } from './outbox.repository';

/**
 * Unit tests of the outbox relay (docs/07 §4, UT-11 and UT-12). The
 * repository, the queue producer and the transaction are fakes.
 */
describe('OutboxRelayService', () => {
  const ORDER_1 = '11111111-1111-4111-8111-111111111111';
  const ORDER_2 = '22222222-2222-4222-8222-222222222222';
  const ORDER_3 = '33333333-3333-4333-8333-333333333333';

  const manager = {} as EntityManager;
  const dataSource = {
    transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const outboxRepo = {
    claimBatch: jest.fn(),
    markPublished: jest.fn(),
    markFailed: jest.fn(),
  };
  const orderQueue = { enqueueProcessOrder: jest.fn() };
  const config = { pollIntervalMs: 1000, batchSize: 2, maxBackoffMs: 5000 };

  let relay: OutboxRelayService;

  /** An ORDER_CREATED event as written by OrdersService.create. */
  function event(id: string, orderId: string): OutboxEvent {
    return {
      id,
      aggregateType: 'ORDER',
      aggregateId: orderId,
      eventType: 'ORDER_CREATED',
      payload: { orderId },
    } as OutboxEvent;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    dataSource.transaction.mockImplementation(
      (work: (m: EntityManager) => Promise<unknown>) => work(manager),
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    relay = new OutboxRelayService(
      dataSource as unknown as DataSource,
      outboxRepo as unknown as OutboxRepository,
      orderQueue as unknown as OrderQueueProducer,
      config,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('relayBatch', () => {
    it('UT-11 publishes every claimed event and marks each one published, in one transaction', async () => {
      outboxRepo.claimBatch.mockResolvedValue([
        event('1', ORDER_1),
        event('2', ORDER_2),
      ]);

      const result = await relay.relayBatch();

      expect(result).toEqual({ published: 2, failed: false });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(outboxRepo.claimBatch).toHaveBeenCalledWith(manager, 2);
      expect(orderQueue.enqueueProcessOrder).toHaveBeenNthCalledWith(
        1,
        ORDER_1,
      );
      expect(orderQueue.enqueueProcessOrder).toHaveBeenNthCalledWith(
        2,
        ORDER_2,
      );
      expect(outboxRepo.markPublished).toHaveBeenCalledTimes(2);
      expect(outboxRepo.markPublished).toHaveBeenNthCalledWith(1, manager, '1');
      expect(outboxRepo.markPublished).toHaveBeenNthCalledWith(2, manager, '2');
      expect(outboxRepo.markFailed).not.toHaveBeenCalled();
    });

    it('marks an event published only after its job was added', async () => {
      outboxRepo.claimBatch.mockResolvedValue([event('1', ORDER_1)]);

      await relay.relayBatch();

      expect(
        orderQueue.enqueueProcessOrder.mock.invocationCallOrder[0],
      ).toBeLessThan(outboxRepo.markPublished.mock.invocationCallOrder[0]);
    });

    it('UT-12 stops the batch at the first event Redis rejects, and records the error on it', async () => {
      outboxRepo.claimBatch.mockResolvedValue([
        event('1', ORDER_1),
        event('2', ORDER_2),
        event('3', ORDER_3),
      ]);
      orderQueue.enqueueProcessOrder
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new Error('connect ECONNREFUSED 127.0.0.1:6379'),
        );

      const result = await relay.relayBatch();

      expect(result).toEqual({ published: 1, failed: true });
      expect(outboxRepo.markPublished).toHaveBeenCalledTimes(1);
      expect(outboxRepo.markPublished).toHaveBeenCalledWith(manager, '1');
      expect(outboxRepo.markFailed).toHaveBeenCalledTimes(1);
      expect(outboxRepo.markFailed).toHaveBeenCalledWith(
        manager,
        '2',
        'connect ECONNREFUSED 127.0.0.1:6379',
      );
      // Event 3 is left for a later batch.
      expect(orderQueue.enqueueProcessOrder).toHaveBeenCalledTimes(2);
      // The transaction still commits: event 1 stays published.
      await expect(
        dataSource.transaction.mock.results[0].value,
      ).resolves.toEqual(result);
    });

    it.each([
      ['no orderId', {}],
      ['an orderId that is not a UUID', { orderId: 'abc' }],
      ['no payload at all', null],
    ])(
      'takes the order id from aggregate_id, so an event with %s in its payload is still published',
      async (_case, payload) => {
        outboxRepo.claimBatch.mockResolvedValue([
          { ...event('1', ORDER_1), payload } as OutboxEvent,
          event('2', ORDER_2),
        ]);

        const result = await relay.relayBatch();

        // A full batch, nothing left behind to block the next one.
        expect(result).toEqual({ published: 2, failed: false });
        expect(orderQueue.enqueueProcessOrder).toHaveBeenNthCalledWith(
          1,
          ORDER_1,
        );
        expect(outboxRepo.markPublished).toHaveBeenCalledWith(manager, '1');
        expect(outboxRepo.markPublished).toHaveBeenCalledWith(manager, '2');
        expect(outboxRepo.markFailed).not.toHaveBeenCalled();
      },
    );

    it('publishes nothing when there is no event', async () => {
      outboxRepo.claimBatch.mockResolvedValue([]);

      await expect(relay.relayBatch()).resolves.toEqual({
        published: 0,
        failed: false,
      });
      expect(orderQueue.enqueueProcessOrder).not.toHaveBeenCalled();
    });
  });

  describe('polling', () => {
    let relayBatch: jest.SpiedFunction<() => Promise<RelayBatchResult>>;

    const ok = (published = 0): RelayBatchResult => ({
      published,
      failed: false,
    });
    const failed: RelayBatchResult = { published: 0, failed: true };

    /** Moves the fake clock by `ms` and returns how many batches ran meanwhile. */
    async function batchesWithin(ms: number): Promise<number> {
      const before = relayBatch.mock.calls.length;
      await jest.advanceTimersByTimeAsync(ms);
      return relayBatch.mock.calls.length - before;
    }

    beforeEach(() => {
      jest.useFakeTimers();
      relayBatch = jest.spyOn(relay, 'relayBatch').mockResolvedValue(ok());
    });

    afterEach(async () => {
      await relay.onModuleDestroy();
      jest.useRealTimers();
    });

    it('polls once at startup, then every OUTBOX_POLL_INTERVAL_MS', async () => {
      relay.onApplicationBootstrap();

      expect(await batchesWithin(0)).toBe(1);
      expect(await batchesWithin(999)).toBe(0);
      expect(await batchesWithin(1)).toBe(1);
      expect(await batchesWithin(1000)).toBe(1);
    });

    it('doubles the wait after each failure, up to OUTBOX_MAX_BACKOFF_MS, and resets it after a success', async () => {
      relayBatch.mockResolvedValue(failed);
      relay.onApplicationBootstrap();
      expect(await batchesWithin(0)).toBe(1);

      // 1000 -> 2000 -> 4000 -> 5000 (capped) -> 5000
      for (const wait of [2000, 4000, 5000, 5000]) {
        expect(await batchesWithin(wait - 1)).toBe(0);
        expect(await batchesWithin(1)).toBe(1);
      }

      relayBatch.mockResolvedValue(ok());
      expect(await batchesWithin(5000)).toBe(1);
      // Back to the normal interval.
      expect(await batchesWithin(999)).toBe(0);
      expect(await batchesWithin(1)).toBe(1);
    });

    it('treats a batch that throws (e.g. the database is down) as a failure', async () => {
      relayBatch.mockRejectedValue(new Error('connection refused'));
      relay.onApplicationBootstrap();
      expect(await batchesWithin(0)).toBe(1);

      expect(await batchesWithin(1999)).toBe(0);
      expect(await batchesWithin(1)).toBe(1);
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('polls again at once when the batch was full, as more events may be waiting', async () => {
      relayBatch
        .mockResolvedValueOnce(ok(config.batchSize))
        .mockResolvedValueOnce(ok(config.batchSize))
        .mockResolvedValue(ok(1));
      relay.onApplicationBootstrap();

      // A 0 ms timeout set from a timer fires 1 ms later (Node and fake timers).
      expect(await batchesWithin(0)).toBe(1); // full
      expect(await batchesWithin(1)).toBe(1); // full again, polled at once
      expect(await batchesWithin(1)).toBe(1); // not full: normal interval next
      expect(await batchesWithin(999)).toBe(0);
      expect(await batchesWithin(1)).toBe(1);
    });

    it('stops polling when the module is destroyed', async () => {
      relay.onApplicationBootstrap();
      expect(await batchesWithin(0)).toBe(1);

      await relay.onModuleDestroy();

      expect(await batchesWithin(60_000)).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits for the batch in progress before it reports stopped, and schedules nothing after it', async () => {
      let finishBatch!: (result: RelayBatchResult) => void;
      relayBatch.mockReturnValueOnce(
        new Promise((resolve) => (finishBatch = resolve)),
      );
      relay.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);

      let stopped = false;
      const stopping = relay.onModuleDestroy().then(() => (stopped = true));
      await jest.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);

      finishBatch(ok(config.batchSize));
      await stopping;

      expect(stopped).toBe(true);
      // A full batch would poll again at once, but the relay is stopped.
      expect(await batchesWithin(60_000)).toBe(0);
    });
  });
});
