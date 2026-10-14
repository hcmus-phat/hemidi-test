import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { errorMessage } from '../common/utils/error-message';
import { outboxConfig } from '../config/configuration';
import { OrderQueueProducer } from '../queue/order-queue.producer';
import { OutboxRepository } from './outbox.repository';

/** Outcome of one batch. `failed` means Redis (or the database) failed. */
export interface RelayBatchResult {
  published: number;
  failed: boolean;
}

/**
 * Publishes ORDER_CREATED outbox events as `process-order` jobs (ADR-003,
 * docs/05 §3.2). Runs in the worker only: WorkerModule provides it, the API
 * never does (docs/02 §2).
 *
 * Every OUTBOX_POLL_INTERVAL_MS it claims a batch of unpublished events,
 * adds one job per event and marks the event published, all in one
 * transaction. Delivery is at-least-once: if the process dies after
 * `queue.add` but before the COMMIT, the event is published again later.
 * That is harmless because the job id is fixed (`order-{orderId}`) and
 * BullMQ ignores an add whose id already exists (ADR-016).
 *
 * The order id of an event is its aggregate_id, which the database keeps a
 * valid UUID, so every claimed event can become a job: no event can be stuck
 * at the head of the queue and block the ones behind it. Publishing fails
 * only when Redis does, which affects every event alike: the batch stops at
 * the failing event, which records the error, and the next poll waits twice
 * as long (up to OUTBOX_MAX_BACKOFF_MS). A full batch means more events are
 * waiting: the next poll starts at once.
 */
@Injectable()
export class OutboxRelayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  /** The batch being processed, so that shutdown can wait for it. */
  private running?: Promise<void>;
  private stopped = false;
  /** Wait before the next poll; doubles after each failure. */
  private delayMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly outboxRepo: OutboxRepository,
    private readonly orderQueue: OrderQueueProducer,
    @Inject(outboxConfig.KEY)
    private readonly config: ConfigType<typeof outboxConfig>,
  ) {
    this.delayMs = config.pollIntervalMs;
  }

  onApplicationBootstrap(): void {
    this.logger.log(
      `Outbox relay started (poll every ${this.config.pollIntervalMs} ms, batch of ${this.config.batchSize})`,
    );
    this.schedule(0);
  }

  /**
   * Runs before the database and Redis connections close (they close in
   * onApplicationShutdown): no new batch starts, and a batch in progress
   * finishes and commits.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    this.logger.log('Outbox relay stopped');
  }

  /**
   * Publishes one batch in one transaction. Public so tests can call it
   * directly.
   */
  relayBatch(): Promise<RelayBatchResult> {
    return this.dataSource.transaction(async (manager) => {
      const events = await this.outboxRepo.claimBatch(
        manager,
        this.config.batchSize,
      );
      let published = 0;
      for (const event of events) {
        // aggregate_id is `uuid NOT NULL`, so Postgres guarantees a valid
        // order id. The jsonb payload is not checked by the database: an event
        // with a bad payload could never be published and would come back at
        // the head of every batch.
        const orderId = event.aggregateId;
        try {
          await this.orderQueue.enqueueProcessOrder(orderId);
        } catch (error) {
          // Redis is unavailable: record the error and stop the batch. The
          // events published so far are committed with it.
          await this.outboxRepo.markFailed(
            manager,
            event.id,
            errorMessage(error),
          );
          this.logger.warn(
            `Outbox event ${event.id} (order ${orderId}) not published: ${errorMessage(error)}`,
          );
          return { published, failed: true };
        }
        await this.outboxRepo.markPublished(manager, event.id);
        published++;
      }
      return { published, failed: false };
    });
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, delayMs);
  }

  /** One poll, then schedules the next one. Never rejects. */
  private async tick(): Promise<void> {
    const result = await this.relayBatch().catch(
      (error: unknown): RelayBatchResult => {
        this.logger.error(
          `Outbox relay batch failed: ${errorMessage(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        return { published: 0, failed: true };
      },
    );

    if (result.published > 0) {
      this.logger.log(`Published ${result.published} outbox event(s)`);
    }
    if (result.failed) {
      this.delayMs = Math.min(this.delayMs * 2, this.config.maxBackoffMs);
      this.logger.warn(`Outbox relay: next poll in ${this.delayMs} ms`);
      this.schedule(this.delayMs);
      return;
    }

    this.delayMs = this.config.pollIntervalMs;
    const batchWasFull = result.published === this.config.batchSize;
    this.schedule(batchWasFull ? 0 : this.delayMs);
  }
}
