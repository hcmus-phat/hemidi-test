import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * GET /health (docs/04 §4.7). Imports QueueModule for the order-processing
 * queue, whose Redis connection it pings. The DataSource is global.
 */
@Module({
  imports: [QueueModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
