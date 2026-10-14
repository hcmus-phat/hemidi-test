import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Inject,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { errorMessage } from '../common/utils/error-message';
import {
  RANDOM_SOURCE,
  type RandomSource,
} from '../common/utils/random-source';
import { Sleeper } from '../common/utils/sleep';
import { workerConfig } from '../config/configuration';
import { OrderStatus } from '../orders/order-status.enum';
import { OrdersService } from '../orders/orders.service';
import { FailureSimulator } from './failure-simulator';
import {
  ORDER_PROCESSING_QUEUE,
  OrderJobName,
  ProcessOrderJobData,
} from './queue.constants';
import { createRedisErrorLogger } from './redis-error-logger';

/** What a `process-order` job returns; BullMQ stores it as the job's return value. */
export type ProcessOrderResult =
  { result: 'CONFIRMED' } | { skipped: true; reason: string };

/**
 * Whether the attempt in progress is the last one of its job (ADR-017).
 *
 * While a job runs, `attemptsMade` counts the attempts that already ended:
 * BullMQ increments it after an attempt fails or completes (moveToFailed,
 * moveToCompleted), so it is 0 during the first attempt. BullMQ retries when
 * `attemptsMade + 1 < attempts`; this is the opposite condition. With
 * attempts = 4, the 4th run (attemptsMade = 3) is the last.
 */
export function isFinalAttempt(
  job: Pick<Job, 'attemptsMade' | 'opts'>,
): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/**
 * Consumes the order-processing queue (docs/05 §5). Provided by WorkerModule
 * only: `@nestjs/bullmq` starts a BullMQ Worker for every @Processor it
 * finds, which must never happen in the API (docs/02 §2).
 *
 * It only orchestrates: simulated processing time and failures, attempt
 * bookkeeping and logs. The database work, guarded by CAS, is done by
 * OrdersService.
 */
@Processor(ORDER_PROCESSING_QUEUE)
export class OrderProcessingProcessor
  extends WorkerHost
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderProcessingProcessor.name);
  private readonly logRedisError = createRedisErrorLogger(
    this.logger,
    `Worker ${ORDER_PROCESSING_QUEUE}`,
  );

  constructor(
    private readonly ordersService: OrdersService,
    private readonly failureSimulator: FailureSimulator,
    private readonly sleeper: Sleeper,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
    @Inject(workerConfig.KEY)
    private readonly config: ConfigType<typeof workerConfig>,
  ) {
    super();
  }

  /**
   * The options of @Processor are fixed when the class is defined, before
   * the configuration is loaded, so WORKER_CONCURRENCY is applied here, right
   * after @nestjs/bullmq created the Worker. BullMQ reads it before fetching
   * each job.
   */
  onModuleInit(): void {
    this.worker.concurrency = this.config.concurrency;
  }

  onApplicationBootstrap(): void {
    this.logger.log(
      `Worker started on queue ${ORDER_PROCESSING_QUEUE} (concurrency ${this.worker.concurrency})`,
    );
  }

  /**
   * Stops taking jobs and waits for the jobs in progress. It must happen
   * here: @nestjs/bullmq would close the Worker in onApplicationShutdown,
   * after TypeORM closed the database the jobs still need.
   */
  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    this.logger.log(`Worker on queue ${ORDER_PROCESSING_QUEUE} closed`);
  }

  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.logRedisError(error);
  }

  async process(job: Job): Promise<unknown> {
    // Any name that is not an OrderJobName ends in the default branch.
    switch (job.name as OrderJobName) {
      case OrderJobName.ProcessOrder:
        return this.processOrder(job as Job<ProcessOrderJobData>);
      case OrderJobName.ExpirePendingOrders:
        return this.expirePendingOrders();
      default:
        // Retrying cannot help with a job this worker does not know.
        throw new UnrecoverableError(`Unknown job name: ${job.name}`);
    }
  }

  /**
   * Runs one attempt (see `attemptToConfirm`) and decides what to do when it
   * throws. Every error of the attempt comes here, wherever it happened:
   * reading the status, the simulated failure, or confirming.
   *
   * - Order not found (UnrecoverableError): BullMQ fails the job at once,
   *   without retry. There is no order, so nothing to compensate.
   * - Any other error before the last attempt: rethrown, and BullMQ retries
   *   the job after the backoff delay.
   * - Any other error on the last attempt: the order is marked FAILED and
   *   its stock released, then the error goes back to BullMQ, which moves the
   *   job to `failed` (ADR-017). failOrder is guarded by CAS, so it changes
   *   nothing when the order is no longer PENDING.
   */
  private async processOrder(
    job: Job<ProcessOrderJobData>,
  ): Promise<ProcessOrderResult> {
    const { orderId } = job.data;
    const attempt = this.describeAttempt(job);

    try {
      // `return await`: without it, a rejection would skip this catch.
      return await this.attemptToConfirm(orderId, attempt);
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        this.logger.warn(
          `Order ${orderId} failed without retry (${attempt}): ${error.message}`,
        );
        throw error;
      }

      if (!isFinalAttempt(job)) {
        this.logger.warn(
          `Order ${orderId} failed (${attempt}), BullMQ will retry it: ${errorMessage(error)}`,
        );
        throw error;
      }

      this.logger.warn(
        `Order ${orderId} failed on its last attempt (${attempt}): ${errorMessage(error)}`,
      );
      await this.failOrder(orderId, error);
      // BullMQ records the error as the job's failedReason and moves it to failed.
      throw error;
    }
  }

  /**
   * One attempt at confirming an order:
   *
   * 1. Read the status first. Not found: fail without retry. No longer
   *    PENDING (cancelled, expired, already confirmed): done, nothing to do.
   * 2. Simulate the work (JOB_PROCESSING_MIN_MS..MAX_MS) and a random failure
   *    (JOB_FAILURE_RATE).
   * 3. Confirm the order and record its notification in one transaction.
   *    The CAS inside makes this safe even when the status changed after
   *    step 1 (docs/05 §6).
   *
   * Errors are thrown to `processOrder`.
   */
  private async attemptToConfirm(
    orderId: string,
    attempt: string,
  ): Promise<ProcessOrderResult> {
    const status = await this.ordersService.getStatus(orderId);
    if (status === null) {
      throw new UnrecoverableError(`Order ${orderId} not found`);
    }
    if (status !== OrderStatus.PENDING) {
      this.logger.log(`Order ${orderId} skipped (${attempt}): it is ${status}`);
      return { skipped: true, reason: `Order is ${status}` };
    }

    this.logger.log(`Processing order ${orderId} (${attempt})`);
    await this.sleeper.sleep(this.processingTimeMs());
    this.failureSimulator.maybeFail();

    const confirmed = await this.ordersService.confirmOrder(orderId);
    if (!confirmed) {
      this.logger.log(
        `Order ${orderId} skipped (${attempt}): no longer PENDING`,
      );
      return { skipped: true, reason: 'Order is no longer PENDING' };
    }
    this.logger.log(`Order ${orderId} confirmed (${attempt})`);
    return { result: 'CONFIRMED' };
  }

  /**
   * The repeatable job of the scheduler: cancels the orders that stayed
   * PENDING too long (docs/05 §9). No simulated failure here.
   */
  private async expirePendingOrders(): Promise<{ expired: number }> {
    const result = await this.ordersService.expireStaleOrders();
    this.logger.log(`Expired ${result.expired} stale PENDING order(s)`);
    return result;
  }

  /**
   * Marks the order FAILED and releases its stock. An error here is logged
   * and swallowed, so the job still fails with its own error. The order then
   * stays PENDING and the expiry job cancels it later, releasing the stock
   * (docs/05 §9).
   */
  private async failOrder(orderId: string, cause: unknown): Promise<void> {
    try {
      const failed = await this.ordersService.failOrder(
        orderId,
        errorMessage(cause),
      );
      this.logger.log(
        failed
          ? `Order ${orderId} marked FAILED, stock released`
          : `Order ${orderId} not marked FAILED: it is no longer PENDING`,
      );
    } catch (error) {
      this.logger.error(
        `Could not mark order ${orderId} FAILED, the expiry job will cancel it: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** A random duration in [JOB_PROCESSING_MIN_MS, JOB_PROCESSING_MAX_MS]. */
  private processingTimeMs(): number {
    const { processingMinMs, processingMaxMs } = this.config;
    return (
      processingMinMs +
      Math.floor(this.random() * (processingMaxMs - processingMinMs + 1))
    );
  }

  /**
   * "attempt 2/4". While a job runs, `attemptsMade` counts the attempts that
   * already ended, so the current one is attemptsMade + 1.
   */
  private describeAttempt(job: Job): string {
    return `attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}, job ${job.id}`;
  }
}
