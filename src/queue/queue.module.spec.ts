import type { DynamicModule } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { jobsConfig, redisConfig } from '../config/configuration';
import { ORDER_PROCESSING_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';
import { RedisConnectionRole } from './redis-connection';

// A real Queue connects to Redis as soon as it is built. The fake one only
// records that it was built.
jest.mock('bullmq', () => ({
  ...jest.requireActual<object>('bullmq'),
  Queue: jest.fn(() => ({ on: jest.fn(), close: jest.fn() })),
}));

/** What the root module of a process provides: the DataSource and the config. */
function infrastructure(
  connectDatabase: () => Promise<unknown>,
): DynamicModule {
  return {
    module: class InfrastructureModule {},
    global: true,
    providers: [
      { provide: DataSource, useFactory: connectDatabase },
      { provide: redisConfig.KEY, useValue: { url: 'redis://cache:6379' } },
      { provide: jobsConfig.KEY, useValue: {} },
    ],
    exports: [DataSource, redisConfig.KEY, jobsConfig.KEY],
  };
}

function compileApiModules(
  connectDatabase: () => Promise<unknown>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      infrastructure(connectDatabase),
      QueueModule.forRoot(RedisConnectionRole.Api),
      QueueModule,
    ],
  }).compile();
}

/** Like a DataSource that cannot reach Postgres: fails after a while. */
function failAfter(ms: number, error: Error): () => Promise<never> {
  return () =>
    new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('QueueModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the queue with the Redis connection of its role once the database is connected', async () => {
    const moduleRef = await compileApiModules(() => Promise.resolve({}));

    expect(Queue).toHaveBeenCalledTimes(1);
    expect(Queue).toHaveBeenCalledWith(
      ORDER_PROCESSING_QUEUE,
      expect.objectContaining({
        connection: { host: 'cache', port: 6379, enableOfflineQueue: false },
      }),
    );
    await moduleRef.close();
  });

  it('builds no queue, so opens no Redis connection, when the database cannot connect', async () => {
    // While the database is still being tried, the rest of the module graph
    // has all the time it needs to build whatever does not wait for it.
    await expect(
      compileApiModules(failAfter(50, new Error('connect ECONNREFUSED'))),
    ).rejects.toThrow('connect ECONNREFUSED');
    // Nest keeps resolving the other providers after create() has rejected:
    // a provider that depends on the DataSource only through an @Optional
    // dependency would still be built now, with default options.
    await wait(50);

    expect(Queue).not.toHaveBeenCalled();
  });
});
