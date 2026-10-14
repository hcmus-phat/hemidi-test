import { ConfigModuleOptions, registerAs } from '@nestjs/config';
import { NodeEnv, validateEnv } from './env.validation';

/**
 * Typed configuration, split by concern. Inject one namespace with
 * `@Inject(databaseConfig.KEY) config: ConfigType<typeof databaseConfig>`.
 *
 * Each factory re-reads `process.env` through `validateEnv`, so parsing,
 * defaults and validation live in a single place (env.validation.ts).
 */

export const appConfig = registerAs('app', () => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === NodeEnv.Production,
    port: env.PORT,
  };
});

export const databaseConfig = registerAs('database', () => {
  const env = validateEnv(process.env);
  return {
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: env.DATABASE_POOL_MAX,
    logging: env.DATABASE_LOGGING,
  };
});

export const redisConfig = registerAs('redis', () => {
  const env = validateEnv(process.env);
  return {
    url: env.REDIS_URL,
  };
});

/** Options of the `process-order` job (used by the outbox relay when it enqueues). */
export const jobsConfig = registerAs('jobs', () => {
  const env = validateEnv(process.env);
  return {
    attempts: env.JOB_ATTEMPTS,
    backoffDelayMs: env.JOB_BACKOFF_DELAY_MS,
    keepCompletedSeconds: env.JOB_KEEP_COMPLETED_SECONDS,
    keepFailedSeconds: env.JOB_KEEP_FAILED_SECONDS,
  };
});

export const outboxConfig = registerAs('outbox', () => {
  const env = validateEnv(process.env);
  return {
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxBackoffMs: env.OUTBOX_MAX_BACKOFF_MS,
  };
});

/** Simulated processing of the `process-order` job. */
export const workerConfig = registerAs('worker', () => {
  const env = validateEnv(process.env);
  return {
    processingMinMs: env.JOB_PROCESSING_MIN_MS,
    processingMaxMs: env.JOB_PROCESSING_MAX_MS,
    failureRate: env.JOB_FAILURE_RATE,
    concurrency: env.WORKER_CONCURRENCY,
  };
});

export const ordersConfig = registerAs('orders', () => {
  const env = validateEnv(process.env);
  return {
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
    pendingTtlMinutes: env.ORDER_PENDING_TTL_MINUTES,
    expireEveryMs: env.EXPIRE_PENDING_EVERY_MS,
    expireBatchSize: env.EXPIRE_BATCH_SIZE,
  };
});

export const swaggerConfig = registerAs('swagger', () => {
  const env = validateEnv(process.env);
  return {
    enabled: env.SWAGGER_ENABLED,
  };
});

/**
 * Shared by the API (AppModule) and the worker (WorkerModule).
 * `validate` runs once when the module is imported and stops the process with
 * the full list of invalid variables. Values from `.env` never override real
 * environment variables.
 */
export const configModuleOptions: ConfigModuleOptions = {
  isGlobal: true,
  cache: true,
  validate: validateEnv,
  load: [
    appConfig,
    databaseConfig,
    redisConfig,
    jobsConfig,
    outboxConfig,
    workerConfig,
    ordersConfig,
    swaggerConfig,
  ],
};
