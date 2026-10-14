import { NodeEnv, validateEnv } from './env.validation';

describe('validateEnv', () => {
  const required = {
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/mini_oms',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('applies the documented defaults when only the required URLs are set', () => {
    const env = validateEnv({ ...required });

    expect(env).toMatchObject({
      NODE_ENV: NodeEnv.Development,
      PORT: 3000,
      DATABASE_SSL: false,
      DATABASE_POOL_MAX: 10,
      DATABASE_LOGGING: false,
      DB_LOCK_TIMEOUT_MS: 5000,
      JOB_ATTEMPTS: 4,
      JOB_BACKOFF_DELAY_MS: 2000,
      JOB_KEEP_COMPLETED_SECONDS: 604800,
      JOB_KEEP_FAILED_SECONDS: 1209600,
      OUTBOX_POLL_INTERVAL_MS: 1000,
      OUTBOX_BATCH_SIZE: 50,
      OUTBOX_MAX_BACKOFF_MS: 30000,
      JOB_PROCESSING_MIN_MS: 3000,
      JOB_PROCESSING_MAX_MS: 5000,
      JOB_FAILURE_RATE: 0.3,
      WORKER_CONCURRENCY: 5,
      ORDER_PENDING_TTL_MINUTES: 30,
      EXPIRE_PENDING_EVERY_MS: 300000,
      EXPIRE_BATCH_SIZE: 100,
      SWAGGER_ENABLED: true,
    });
  });

  it('converts string values from the environment to numbers and booleans', () => {
    const env = validateEnv({
      ...required,
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_SSL: 'true',
      DATABASE_POOL_MAX: '3',
      JOB_FAILURE_RATE: '0',
      SWAGGER_ENABLED: 'false',
    });

    expect(env.NODE_ENV).toBe(NodeEnv.Production);
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_SSL).toBe(true);
    expect(env.DATABASE_POOL_MAX).toBe(3);
    expect(env.JOB_FAILURE_RATE).toBe(0);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('accepts TLS Redis and pooled Postgres URLs used in production', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL:
          'postgresql://user:secret@ep-small-1234-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require',
        REDIS_URL:
          'rediss://default:secret@redis-12345.cloud.redislabs.com:12345',
      }),
    ).not.toThrow();
  });

  it.each([
    ['DATABASE_URL', { REDIS_URL: required.REDIS_URL }],
    ['REDIS_URL', { DATABASE_URL: required.DATABASE_URL }],
  ])('fails when %s is missing', (name, config) => {
    expect(() => validateEnv(config)).toThrow(name);
  });

  it.each([
    ['DATABASE_URL', 'http://localhost:5432/mini_oms'],
    ['DATABASE_URL', 'localhost:5432'],
    ['REDIS_URL', 'not a url'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => validateEnv({ ...required, [name]: value })).toThrow(name);
  });

  it.each([
    ['JOB_ATTEMPTS', '0'],
    ['JOB_ATTEMPTS', '1.5'],
    ['JOB_ATTEMPTS', 'abc'],
    ['PORT', ''],
    ['WORKER_CONCURRENCY', '-1'],
    ['JOB_FAILURE_RATE', '1.5'],
    ['JOB_FAILURE_RATE', '-0.1'],
    ['JOB_FAILURE_RATE', ''],
    ['DATABASE_SSL', 'yes'],
    ['NODE_ENV', 'staging'],
  ])('rejects %s=%j', (name, value) => {
    expect(() => validateEnv({ ...required, [name]: value })).toThrow(name);
  });

  it('accepts the bounds of JOB_FAILURE_RATE', () => {
    expect(
      validateEnv({ ...required, JOB_FAILURE_RATE: '1' }).JOB_FAILURE_RATE,
    ).toBe(1);
    expect(
      validateEnv({ ...required, JOB_FAILURE_RATE: '0' }).JOB_FAILURE_RATE,
    ).toBe(0);
  });

  it('requires JOB_PROCESSING_MIN_MS <= JOB_PROCESSING_MAX_MS', () => {
    expect(() =>
      validateEnv({
        ...required,
        JOB_PROCESSING_MIN_MS: '6000',
        JOB_PROCESSING_MAX_MS: '5000',
      }),
    ).toThrow(
      'JOB_PROCESSING_MAX_MS must be greater than or equal to JOB_PROCESSING_MIN_MS',
    );

    const env = validateEnv({
      ...required,
      JOB_PROCESSING_MIN_MS: '4000',
      JOB_PROCESSING_MAX_MS: '4000',
    });
    expect(env.JOB_PROCESSING_MAX_MS).toBe(4000);
  });

  it('reports a non-numeric MIN only on the MIN variable', () => {
    let message = '';
    try {
      validateEnv({ ...required, JOB_PROCESSING_MIN_MS: 'abc' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('JOB_PROCESSING_MIN_MS');
    expect(message).not.toContain('JOB_PROCESSING_MAX_MS');
  });

  it('requires OUTBOX_MAX_BACKOFF_MS >= OUTBOX_POLL_INTERVAL_MS', () => {
    expect(() =>
      validateEnv({
        ...required,
        OUTBOX_POLL_INTERVAL_MS: '5000',
        OUTBOX_MAX_BACKOFF_MS: '1000',
      }),
    ).toThrow('OUTBOX_MAX_BACKOFF_MS');
  });

  it('reports every invalid variable in a single error', () => {
    let message = '';
    try {
      validateEnv({ PORT: 'abc', JOB_FAILURE_RATE: '2' });
    } catch (error) {
      message = (error as Error).message;
    }

    for (const name of [
      'DATABASE_URL',
      'REDIS_URL',
      'PORT',
      'JOB_FAILURE_RATE',
    ]) {
      expect(message).toContain(name);
    }
  });
});
