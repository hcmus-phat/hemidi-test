import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { OrderQueueProducer } from '../src/queue/order-queue.producer';
import { ORDER_PROCESSING_QUEUE } from '../src/queue/queue.constants';
import { createRelayTestingModule } from './e2e/relay-testing-module';
import {
  createProduct,
  createTestApp,
  OrderBody,
  placeOrder,
  resetDatabase,
  stockOf,
} from './e2e/test-app';

interface OutboxEventRow {
  published_at: Date | null;
  publish_attempts: number;
  last_error: string | null;
}

/**
 * The outbox relay and the queue on a real Postgres and Redis (docs/07 §5,
 * docs/05 §3): publishing the same order twice creates one job (IT-04), and
 * an order placed while Redis is down keeps its event until Redis is back
 * (IT-05).
 *
 * The API (POST /orders) and the relay are two Nest applications, like the
 * API and the worker in production. The queue uses a key prefix of its own
 * and is emptied after each test.
 */
describe('Outbox relay and queue (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let relayModule: TestingModule;
  let relay: OutboxRelayService;
  let producer: OrderQueueProducer;
  let queue: Queue;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    relayModule = await createRelayTestingModule();
    relay = relayModule.get(OutboxRelayService);
    producer = relayModule.get(OrderQueueProducer);
    queue = relayModule.get<Queue>(getQueueToken(ORDER_PROCESSING_QUEUE));
    // Jobs left by an interrupted run would skew the counts.
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await relayModule?.close();
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await queue.obliterate({ force: true });
  });

  async function outboxEventOf(orderId: string): Promise<OutboxEventRow> {
    const [row] = await dataSource.query<OutboxEventRow[]>(
      'SELECT published_at, publish_attempts, last_error FROM outbox_events WHERE aggregate_id = $1',
      [orderId],
    );
    return row;
  }

  it('IT-04 keeps a single job when the same order is published three times', async () => {
    const orderId = randomUUID();

    // What the relay does when it publishes an event again (at-least-once).
    for (let i = 0; i < 3; i++) {
      await producer.enqueueProcessOrder(orderId);
    }

    expect(await queue.getJobCounts()).toEqual({
      active: 0,
      completed: 0,
      delayed: 0,
      failed: 0,
      prioritized: 0,
      waiting: 1,
      'waiting-children': 0,
    });
    const job = await queue.getJob(`order-${orderId}`);
    expect(job?.name).toBe('process-order');
    expect(job?.data).toEqual({ orderId });
    expect(job?.opts.attempts).toBe(4);
  });

  it('IT-05 keeps the event of an order placed while Redis is down and publishes it once Redis is back', async () => {
    const redisError = 'connect ECONNREFUSED 127.0.0.1:6379';
    const outage = jest
      .spyOn(producer, 'enqueueProcessOrder')
      .mockRejectedValue(new Error(redisError));

    // Placing an order does not use Redis at all.
    const product = await createProduct(app, 5);
    const order = (
      await placeOrder(app, [{ productId: product.id, quantity: 2 }]).expect(
        201,
      )
    ).body as OrderBody;
    expect(order.status).toBe('PENDING');
    expect(await stockOf(dataSource, product.id)).toBe(3);

    // Redis is down: the event stays in the outbox with the error.
    await expect(relay.relayBatch()).resolves.toEqual({
      published: 0,
      failed: true,
    });
    expect(await outboxEventOf(order.id)).toEqual({
      published_at: null,
      publish_attempts: 1,
      last_error: redisError,
    });
    expect(await queue.getJob(`order-${order.id}`)).toBeUndefined();

    // Redis is back: the next batch publishes it.
    outage.mockRestore();
    await expect(relay.relayBatch()).resolves.toEqual({
      published: 1,
      failed: false,
    });
    const event = await outboxEventOf(order.id);
    expect(event.published_at).toBeInstanceOf(Date);
    expect(event.publish_attempts).toBe(2);
    // Kept after the publication: it tells why the event was late.
    expect(event.last_error).toBe(redisError);
    const job = await queue.getJob(`order-${order.id}`);
    expect(job?.data).toEqual({ orderId: order.id });
  });
});
