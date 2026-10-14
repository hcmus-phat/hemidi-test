import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { JobState, Queue } from 'bullmq';
import { withTimeout } from '../common/utils/with-timeout';
import { jobsConfig } from '../config/configuration';
import {
  buildOrderJobId,
  ORDER_PROCESSING_QUEUE,
  OrderJobName,
  ProcessOrderJobData,
} from './queue.constants';
import { createRedisErrorLogger } from './redis-error-logger';

/**
 * Longest wait for Redis in a call of this class. A request or a relay batch
 * gets an error instead of hanging when Redis is unreachable.
 */
export const REDIS_OPERATION_TIMEOUT_MS = 3000;

/** The state of the job of an order, as stored by BullMQ (docs/04 §4.6). */
export interface OrderJobSnapshot {
  jobId: string;
  name: string;
  state: JobState | 'unknown';
  /** Attempts that have ended (failed or completed). */
  attemptsMade: number;
  maxAttempts: number;
  /** Error of the last failed attempt, also set while the job waits for a retry. */
  failedReason: string | null;
  returnValue: unknown;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
}

/** Epoch milliseconds (BullMQ) to an ISO 8601 string. */
function toIsoString(epochMs: number | undefined): string | null {
  return epochMs ? new Date(epochMs).toISOString() : null;
}

/**
 * The only class that talks to the order-processing queue for orders.
 *
 * - `enqueueProcessOrder`: called by the outbox relay in the worker, never
 *   by the API (POST /orders writes an outbox event instead, ADR-003).
 * - `getOrderJobs`: called by the API for GET /orders/:id/jobs.
 */
@Injectable()
export class OrderQueueProducer {
  private readonly logger = new Logger(OrderQueueProducer.name);

  constructor(
    @InjectQueue(ORDER_PROCESSING_QUEUE) private readonly queue: Queue,
    @Inject(jobsConfig.KEY)
    private readonly config: ConfigType<typeof jobsConfig>,
  ) {
    queue.on(
      'error',
      createRedisErrorLogger(this.logger, `Queue ${ORDER_PROCESSING_QUEUE}`),
    );
  }

  /**
   * Adds the `process-order` job of an order (docs/05 §4.1):
   *
   * - jobId `order-{orderId}`: adding it again is a no-op (ADR-016).
   * - JOB_ATTEMPTS runs in total (4 = the first one and 3 retries, ADR-001),
   *   with an exponential backoff of JOB_BACKOFF_DELAY_MS × 2^(n-1) between
   *   them: 2s, 4s, 8s.
   * - Finished jobs are kept for a while so GET /orders/:id/jobs can show them.
   *
   * @throws when Redis fails or does not answer within REDIS_OPERATION_TIMEOUT_MS
   */
  async enqueueProcessOrder(orderId: string): Promise<void> {
    const data: ProcessOrderJobData = { orderId };
    await withTimeout(
      this.queue.add(OrderJobName.ProcessOrder, data, {
        jobId: buildOrderJobId(orderId),
        attempts: this.config.attempts,
        backoff: { type: 'exponential', delay: this.config.backoffDelayMs },
        removeOnComplete: { age: this.config.keepCompletedSeconds },
        removeOnFail: { age: this.config.keepFailedSeconds },
      }),
      REDIS_OPERATION_TIMEOUT_MS,
      `Redis did not answer within ${REDIS_OPERATION_TIMEOUT_MS} ms`,
    );
  }

  /**
   * Removes the job of an order from Redis (dev tooling, MT-08). Returns
   * false when BullMQ could not remove it because a worker is processing it.
   *
   * @throws when Redis fails or does not answer within REDIS_OPERATION_TIMEOUT_MS
   */
  async removeOrderJob(orderId: string): Promise<boolean> {
    const removed = await withTimeout(
      this.queue.remove(buildOrderJobId(orderId)),
      REDIS_OPERATION_TIMEOUT_MS,
      `Redis did not answer within ${REDIS_OPERATION_TIMEOUT_MS} ms`,
    );
    return removed === 1;
  }

  /**
   * The jobs of an order: an array (at most one job today) so that other
   * kinds of jobs can be added later without changing the API. Empty when
   * the relay has not published the order yet, or when BullMQ already removed
   * the finished job (JOB_KEEP_*_SECONDS).
   *
   * @throws when Redis fails or does not answer within REDIS_OPERATION_TIMEOUT_MS
   */
  getOrderJobs(orderId: string): Promise<OrderJobSnapshot[]> {
    return withTimeout(
      this.readOrderJobs(orderId),
      REDIS_OPERATION_TIMEOUT_MS,
      `Redis did not answer within ${REDIS_OPERATION_TIMEOUT_MS} ms`,
    );
  }

  private async readOrderJobs(orderId: string): Promise<OrderJobSnapshot[]> {
    const jobId = buildOrderJobId(orderId);
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return [];
    }
    return [
      {
        jobId: job.id ?? jobId,
        name: job.name,
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
        failedReason: job.failedReason ?? null,
        returnValue: (job.returnvalue as unknown) ?? null,
        createdAt: toIsoString(job.timestamp),
        processedAt: toIsoString(job.processedOn),
        finishedAt: toIsoString(job.finishedOn),
      },
    ];
  }
}
