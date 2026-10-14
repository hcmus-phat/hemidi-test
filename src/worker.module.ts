import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configModuleOptions } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { OutboxModule } from './outbox/outbox.module';
import { QueueModule } from './queue/queue.module';
import { RedisConnectionRole } from './queue/redis-connection';

/**
 * Root module of the worker process (src/worker.ts), separate from AppModule
 * (docs/02 §2, ADR-023). It runs the background parts that need a long-lived
 * process: the outbox relay, which turns ORDER_CREATED events into jobs.
 */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    DatabaseModule,
    QueueModule.forRoot(RedisConnectionRole.Worker),
    QueueModule,
    OutboxModule,
  ],
  providers: [OutboxRelayService],
})
export class WorkerModule {}
