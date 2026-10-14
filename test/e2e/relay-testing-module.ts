import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  configModuleOptions,
  redisConfig,
} from '../../src/config/configuration';
import { DatabaseModule } from '../../src/database/database.module';
import { OutboxRelayService } from '../../src/outbox/outbox-relay.service';
import { OutboxModule } from '../../src/outbox/outbox.module';
import { QueueModule } from '../../src/queue/queue.module';
import {
  buildRedisConnection,
  RedisConnectionRole,
} from '../../src/queue/redis-connection';

/**
 * Key prefix of the queue of the e2e tests (BullMQ's default is `bull`): a
 * dev worker running on the same Redis never takes their jobs, and
 * obliterating the test queue never touches dev jobs.
 */
export const E2E_QUEUE_PREFIX = 'mini-oms-e2e';

/**
 * The worker side of the outbox, without its background loops: the outbox
 * relay, the order-processing queue and its producer, connected to Redis
 * like the worker (RedisConnectionRole.Worker) but with E2E_QUEUE_PREFIX.
 *
 * - compile() creates the providers but runs no lifecycle hook, so the
 *   relay's polling loop (started in onApplicationBootstrap) never starts:
 *   the tests call relayBatch() themselves.
 * - No processor is registered, so no BullMQ Worker takes the jobs.
 *
 * close() closes the queue and the database connection.
 */
export function createRelayTestingModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(configModuleOptions),
      DatabaseModule,
      BullModule.forRootAsync({
        inject: [redisConfig.KEY],
        useFactory: (redis: ConfigType<typeof redisConfig>) => ({
          connection: buildRedisConnection(
            redis.url,
            RedisConnectionRole.Worker,
          ),
          prefix: E2E_QUEUE_PREFIX,
        }),
      }),
      QueueModule,
      OutboxModule,
    ],
    providers: [OutboxRelayService],
  }).compile();
}
