import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './e2e/test-app';

/** GET /health on the real Postgres and Redis of docker-compose (docs/04 §4.7). */
describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers 200 when the database and Redis answer', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('answers 503 with the health body, not the unified error body, when the database fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest
      .spyOn(app.get(DataSource), 'query')
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body).toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });
});
