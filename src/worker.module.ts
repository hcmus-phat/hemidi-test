import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RANDOM_SOURCE } from './common/utils/random-source';
import { Sleeper } from './common/utils/sleep';
import { configModuleOptions } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { OrdersModule } from './orders/orders.module';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { OutboxModule } from './outbox/outbox.module';
import { FailureSimulator } from './queue/failure-simulator';
import { OrderProcessingProcessor } from './queue/order-processing.processor';
import { QueueModule } from './queue/queue.module';
import { RedisConnectionRole } from './queue/redis-connection';

/**
 * Root module of the worker process (src/worker.ts), separate from AppModule
 * (docs/02 §2, ADR-023). It runs the background parts that need a long-lived
 * process:
 *
 * - OutboxRelayService turns ORDER_CREATED events into jobs.
 * - OrderProcessingProcessor runs a BullMQ Worker that processes them.
 */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    DatabaseModule,
    QueueModule.forRoot(RedisConnectionRole.Worker),
    QueueModule,
    OutboxModule,
    OrdersModule,
  ],
  providers: [
    OutboxRelayService,
    OrderProcessingProcessor,
    FailureSimulator,
    Sleeper,
    { provide: RANDOM_SOURCE, useValue: Math.random },
  ],
})
export class WorkerModule {}
