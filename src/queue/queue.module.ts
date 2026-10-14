import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
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
 *
 * The queue is built only once the database is connected. A Queue opens its
 * Redis connection as soon as it is built, and only `app.close()` closes it.
 * When the database is down, `NestFactory.create()` rejects without
 * returning an app to close, so a Queue built earlier would keep its
 * connection for the life of the process. The Vercel handler retries a
 * failed start in the same process (src/vercel.ts): each attempt would leak
 * one more connection. Injecting the DataSource into the options of the
 * queue makes Nest build the queue after it, and not at all when it fails.
 * Injecting it in forRoot() instead would not work: @nestjs/bullmq reads that
 * shared configuration through an @Optional dependency, which Nest resolves
 * to undefined when it fails, and the queue would be built anyway.
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: ORDER_PROCESSING_QUEUE,
      inject: [DataSource],
      useFactory: () => ({}),
    }),
  ],
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
