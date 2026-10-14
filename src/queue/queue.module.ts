import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { redisConfig } from '../config/configuration';
import { OrderQueueProducer } from './order-queue.producer';
import { ORDER_PROCESSING_QUEUE } from './queue.constants';
import { buildRedisConnection, RedisConnectionRole } from './redis-connection';

/**
 * The order-processing queue and its producer.
 *
 * Imported by OrdersModule (the API reads job states) and by the worker (the
 * relay publishes jobs). It registers no processor: the BullMQ Worker is
 * declared in WorkerModule only, so importing this module never starts one
 * (docs/02 §2).
 *
 * The Redis connection is not set here but by `QueueModule.forRoot(role)`,
 * imported once by the root module of each process.
 */
@Module({
  imports: [BullModule.registerQueue({ name: ORDER_PROCESSING_QUEUE })],
  providers: [OrderQueueProducer],
  // BullModule: lets the worker inject the Queue itself (job scheduler).
  exports: [OrderQueueProducer, BullModule],
})
export class QueueModule {
  /**
   * Global BullMQ configuration of a process: the connection built from
   * REDIS_URL with the options of its role (API or worker). Creating it does
   * not wait for Redis, so a process starts even when Redis is down.
   */
  static forRoot(role: RedisConnectionRole): DynamicModule {
    return BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (redis: ConfigType<typeof redisConfig>) => ({
        connection: buildRedisConnection(redis.url, role),
      }),
    });
  }
}
