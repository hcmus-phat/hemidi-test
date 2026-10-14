import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { OrderJobsScheduler } from './order-jobs.scheduler';

describe('OrderJobsScheduler', () => {
  const queue = { upsertJobScheduler: jest.fn() };
  const config = {
    lockTimeoutMs: 5000,
    pendingTtlMinutes: 30,
    expireEveryMs: 300000,
    expireBatchSize: 100,
  };
  let scheduler: OrderJobsScheduler;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    scheduler = new OrderJobsScheduler(queue as unknown as Queue, config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('upserts the expire-pending-orders scheduler with its fixed id, every EXPIRE_PENDING_EVERY_MS', async () => {
    queue.upsertJobScheduler.mockResolvedValue({});

    await scheduler.upsertExpireScheduler();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'expire-pending-orders',
      { every: 300000 },
      {
        name: 'expire-pending-orders',
        data: {},
        opts: { removeOnComplete: 50, removeOnFail: 50 },
      },
    );
  });

  it('does not hold up the start of the worker while Redis is unreachable', () => {
    queue.upsertJobScheduler.mockReturnValue(new Promise(() => undefined));

    expect(scheduler.onApplicationBootstrap()).toBeUndefined();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('logs an error instead of rejecting when Redis refuses the scheduler', async () => {
    queue.upsertJobScheduler.mockRejectedValue(new Error('OOM'));

    await expect(scheduler.upsertExpireScheduler()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('OOM'),
      expect.any(String),
    );
  });
});
