import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { OrderStatus } from '../orders/order-status.enum';
import { OrdersService } from '../orders/orders.service';
import { FailureSimulator, SimulatedFailureError } from './failure-simulator';
import {
  isFinalAttempt,
  OrderProcessingProcessor,
} from './order-processing.processor';

/**
 * Unit tests of the processor (docs/07 §4). OrdersService, the failure
 * simulator, the sleeper and the random source are fakes, so each test
 * chooses whether an attempt succeeds or fails, without waiting.
 */
describe('OrderProcessingProcessor', () => {
  const ORDER_ID = '99999999-9999-4999-8999-999999999999';
  const config = {
    processingMinMs: 3000,
    processingMaxMs: 5000,
    failureRate: 0.3,
    concurrency: 5,
  };

  const ordersService = {
    getStatus: jest.fn(),
    confirmOrder: jest.fn(),
    failOrder: jest.fn(),
  };
  const failureSimulator = { maybeFail: jest.fn() };
  const sleeper = { sleep: jest.fn() };
  let randomValue: number;
  let processor: OrderProcessingProcessor;

  /** A job as BullMQ passes it to `process`, during attempt `attemptsMade + 1`. */
  function processOrderJob(attemptsMade = 0, attempts = 4): Job {
    return {
      id: `order-${ORDER_ID}`,
      name: 'process-order',
      data: { orderId: ORDER_ID },
      attemptsMade,
      opts: { attempts },
    } as unknown as Job;
  }

  const simulatedFailure = new SimulatedFailureError(
    'Simulated random processing failure',
  );

  beforeEach(() => {
    // Also resets implementations, e.g. a maybeFail that throws.
    jest.resetAllMocks();
    // Keep the test output readable: the processor logs every attempt.
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    randomValue = 0.5;
    sleeper.sleep.mockResolvedValue(undefined);
    ordersService.getStatus.mockResolvedValue(OrderStatus.PENDING);
    ordersService.confirmOrder.mockResolvedValue(true);
    ordersService.failOrder.mockResolvedValue(true);
    processor = new OrderProcessingProcessor(
      ordersService as unknown as OrdersService,
      failureSimulator as unknown as FailureSimulator,
      sleeper,
      () => randomValue,
      config,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a process-order job', () => {
    it('sleeps, may fail, then confirms a PENDING order', async () => {
      const result = await processor.process(processOrderJob());

      expect(result).toEqual({ result: 'CONFIRMED' });
      expect(ordersService.getStatus).toHaveBeenCalledWith(ORDER_ID);
      expect(sleeper.sleep).toHaveBeenCalledTimes(1);
      expect(failureSimulator.maybeFail).toHaveBeenCalledTimes(1);
      expect(ordersService.confirmOrder).toHaveBeenCalledWith(ORDER_ID);
      // The simulated failure happens before the confirming transaction.
      expect(
        failureSimulator.maybeFail.mock.invocationCallOrder[0],
      ).toBeLessThan(ordersService.confirmOrder.mock.invocationCallOrder[0]);
      expect(ordersService.failOrder).not.toHaveBeenCalled();
    });

    it.each([
      [0, 3000],
      [0.5, 4000],
      [0.9999, 5000],
    ])(
      'with random() = %d, simulates %d ms of work (JOB_PROCESSING_MIN_MS..MAX_MS)',
      async (random, expectedMs) => {
        randomValue = random;

        await processor.process(processOrderJob());

        expect(sleeper.sleep).toHaveBeenCalledWith(expectedMs);
      },
    );

    it.each([OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.FAILED])(
      'UT-07 skips an order that is %s, without sleeping or confirming',
      async (status) => {
        ordersService.getStatus.mockResolvedValue(status);

        const result = await processor.process(processOrderJob());

        expect(result).toEqual({ skipped: true, reason: `Order is ${status}` });
        expect(sleeper.sleep).not.toHaveBeenCalled();
        expect(failureSimulator.maybeFail).not.toHaveBeenCalled();
        expect(ordersService.confirmOrder).not.toHaveBeenCalled();
      },
    );

    it('is skipped when the order stopped being PENDING while it slept (CAS lost)', async () => {
      ordersService.confirmOrder.mockResolvedValue(false);

      const result = await processor.process(processOrderJob());

      expect(result).toEqual({
        skipped: true,
        reason: 'Order is no longer PENDING',
      });
    });

    it('fails without retry (UnrecoverableError) when the order does not exist', async () => {
      ordersService.getStatus.mockResolvedValue(null);

      const error = await processor
        .process(processOrderJob())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toMatchObject({ message: `Order ${ORDER_ID} not found` });
      expect(sleeper.sleep).not.toHaveBeenCalled();
      expect(ordersService.failOrder).not.toHaveBeenCalled();
    });

    it('UT-08 on the last attempt (attemptsMade 3 of 4), marks the order FAILED and rethrows', async () => {
      failureSimulator.maybeFail.mockImplementation(() => {
        throw simulatedFailure;
      });

      await expect(processor.process(processOrderJob(3, 4))).rejects.toBe(
        simulatedFailure,
      );

      expect(ordersService.failOrder).toHaveBeenCalledTimes(1);
      expect(ordersService.failOrder).toHaveBeenCalledWith(
        ORDER_ID,
        'Simulated random processing failure',
      );
      expect(ordersService.confirmOrder).not.toHaveBeenCalled();
    });

    it.each([0, 2])(
      'UT-09 on an earlier attempt (attemptsMade %d of 4), rethrows for BullMQ to retry, without failOrder',
      async (attemptsMade) => {
        failureSimulator.maybeFail.mockImplementation(() => {
          throw simulatedFailure;
        });

        await expect(
          processor.process(processOrderJob(attemptsMade, 4)),
        ).rejects.toBe(simulatedFailure);

        expect(ordersService.failOrder).not.toHaveBeenCalled();
      },
    );

    it('on the last attempt, a database error while confirming also marks the order FAILED', async () => {
      const dbError = new Error('Connection terminated unexpectedly');
      ordersService.confirmOrder.mockRejectedValue(dbError);

      await expect(processor.process(processOrderJob(3, 4))).rejects.toBe(
        dbError,
      );

      expect(ordersService.failOrder).toHaveBeenCalledWith(
        ORDER_ID,
        'Connection terminated unexpectedly',
      );
    });

    it('keeps the error of the attempt when failOrder itself fails', async () => {
      failureSimulator.maybeFail.mockImplementation(() => {
        throw simulatedFailure;
      });
      ordersService.failOrder.mockRejectedValue(new Error('database down'));

      await expect(processor.process(processOrderJob(3, 4))).rejects.toBe(
        simulatedFailure,
      );
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('database down'),
        expect.any(String),
      );
    });

    it('does not compensate twice: failOrder is only called on the last attempt', async () => {
      failureSimulator.maybeFail.mockImplementation(() => {
        throw simulatedFailure;
      });

      for (const attemptsMade of [0, 1, 2, 3]) {
        await processor
          .process(processOrderJob(attemptsMade, 4))
          .catch(() => undefined);
      }

      expect(ordersService.failOrder).toHaveBeenCalledTimes(1);
    });
  });

  it('fails without retry for a job name it does not know', async () => {
    const job = { ...processOrderJob(), name: 'send-invoice' } as Job;

    await expect(processor.process(job)).rejects.toThrow(UnrecoverableError);
  });

  describe('worker lifecycle', () => {
    const worker = { concurrency: 1, close: jest.fn() };

    beforeEach(() => {
      worker.concurrency = 1;
      // @nestjs/bullmq sets the Worker after creating it; do the same here.
      Object.defineProperty(processor, 'worker', {
        value: worker,
      });
    });

    it('applies WORKER_CONCURRENCY to the Worker on init', () => {
      processor.onModuleInit();

      expect(worker.concurrency).toBe(5);
    });

    it('closes the Worker, waiting for the jobs in progress, when the module is destroyed', async () => {
      worker.close.mockResolvedValue(undefined);

      await processor.onModuleDestroy();

      expect(worker.close).toHaveBeenCalledTimes(1);
    });
  });
});

describe('isFinalAttempt', () => {
  function job(attemptsMade: number, attempts?: number) {
    return { attemptsMade, opts: { attempts } };
  }

  it.each([
    [0, 4, false],
    [1, 4, false],
    [2, 4, false],
    [3, 4, true],
    // A job without retries: its only attempt is the last one.
    [0, 1, true],
    [0, undefined, true],
  ])(
    'attemptsMade %d of %s attempts -> %s',
    (attemptsMade, attempts, expected) => {
      expect(isFinalAttempt(job(attemptsMade, attempts))).toBe(expected);
    },
  );
});
