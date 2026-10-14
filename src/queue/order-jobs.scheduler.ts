import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { errorMessage } from '../common/utils/error-message';
import { ordersConfig } from '../config/configuration';
import { ORDER_PROCESSING_QUEUE, OrderJobName } from './queue.constants';

/**
 * Registers the repeatable `expire-pending-orders` job when the worker
 * starts (FR-Q06, docs/05 §9). Provided by WorkerModule only.
 */
@Injectable()
export class OrderJobsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderJobsScheduler.name);

  constructor(
    @InjectQueue(ORDER_PROCESSING_QUEUE) private readonly queue: Queue,
    @Inject(ordersConfig.KEY)
    private readonly config: ConfigType<typeof ordersConfig>,
  ) {}

  /**
   * Creates or updates the job scheduler. Its id is fixed, so restarting the
   * worker, or running several workers, keeps a single scheduler.
   *
   * Not awaited: while Redis is down, BullMQ waits for it, and the worker
   * must still start. The scheduler is created as soon as Redis answers.
   */
  onApplicationBootstrap(): void {
    void this.upsertExpireScheduler();
  }

  /** Never rejects: an error is logged. Public so tests can await it. */
  async upsertExpireScheduler(): Promise<void> {
    const everyMs = this.config.expireEveryMs;
    try {
      await this.queue.upsertJobScheduler(
        OrderJobName.ExpirePendingOrders,
        { every: everyMs },
        {
          name: OrderJobName.ExpirePendingOrders,
          data: {},
          opts: { removeOnComplete: 50, removeOnFail: 50 },
        },
      );
      this.logger.log(
        `Job scheduler ${OrderJobName.ExpirePendingOrders} upserted (every ${everyMs} ms)`,
      );
    } catch (error) {
      this.logger.error(
        `Could not upsert the job scheduler ${OrderJobName.ExpirePendingOrders}: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
