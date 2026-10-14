import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller';
import { HEALTH_CHECK_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  const dataSource = { query: jest.fn() };
  const redisClient = { ping: jest.fn() };
  /** Resolves with the Redis client once the connection is ready. */
  let clientReady: Promise<typeof redisClient>;
  const queue = {
    getBackend: () => ({
      get client() {
        return clientReady;
      },
    }),
  };
  let service: HealthService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    clientReady = Promise.resolve(redisClient);
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockResolvedValue('PONG');
    service = new HealthService(
      dataSource as unknown as DataSource,
      queue as unknown as Queue,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is ok when the database answers SELECT 1 and Redis answers PING', async () => {
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    expect(redisClient.ping).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('reports the database down, and logs why, when the query fails', async () => {
    dataSource.query.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.check()).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Health check: database is down: connect ECONNREFUSED',
    );
  });

  it('reports Redis down when PING fails', async () => {
    redisClient.ping.mockRejectedValue(
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
    );

    await expect(service.check()).resolves.toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('reports both down after the timeout when neither answers', async () => {
    jest.useFakeTimers();
    dataSource.query.mockReturnValue(new Promise(() => undefined));
    // BullMQ waits for the first connection before handing out the client.
    clientReady = new Promise(() => undefined);

    const report = service.check();
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);

    await expect(report).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'down' },
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      `Health check: redis is down: no answer within ${HEALTH_CHECK_TIMEOUT_MS} ms`,
    );
  });

  it('runs both checks at the same time, so a hanging one does not delay the other', async () => {
    jest.useFakeTimers();
    dataSource.query.mockReturnValue(new Promise(() => undefined));

    const report = service.check();
    await jest.advanceTimersByTimeAsync(0);

    // Redis was pinged before the database check timed out.
    expect(redisClient.ping).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
    await expect(report).resolves.toMatchObject({
      checks: { database: 'down', redis: 'up' },
    });
  });
});

describe('HealthController', () => {
  const healthService = { check: jest.fn() };
  const response = { status: jest.fn() };
  const controller = new HealthController(
    healthService as unknown as HealthService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('answers 200 (the default status) with the report when everything is up', async () => {
    const report = { status: 'ok', checks: { database: 'up', redis: 'up' } };
    healthService.check.mockResolvedValue(report);

    await expect(controller.check(response as never)).resolves.toBe(report);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('answers 503 with the same body shape when a check is down', async () => {
    const report = {
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    };
    healthService.check.mockResolvedValue(report);

    await expect(controller.check(response as never)).resolves.toBe(report);
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
