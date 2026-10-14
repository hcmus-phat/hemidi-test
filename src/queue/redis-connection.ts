import type { RedisOptions } from 'bullmq';

const DEFAULT_REDIS_PORT = 6379;

/** The process a Redis connection is for. Each one needs different options (docs/02 §7). */
export enum RedisConnectionRole {
  /** The HTTP API: only reads the state of jobs (GET /orders/:id/jobs). */
  Api = 'api',
  /** The worker: publishes jobs (outbox relay) and processes them (BullMQ Worker). */
  Worker = 'worker',
}

/** Where and how to connect, as given by REDIS_URL. */
export interface RedisUrlOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  /** Set for `rediss://`: connect over TLS with Node's default certificate checks. */
  tls?: Record<string, never>;
}

/**
 * Splits REDIS_URL (`redis[s]://[[username]:password@]host[:port][/db]`) into
 * ioredis connection options. The format itself was already checked when the
 * environment was validated.
 *
 * @throws when the database number in the path is not an integer
 */
export function parseRedisUrl(redisUrl: string): RedisUrlOptions {
  const url = new URL(redisUrl);
  const options: RedisUrlOptions = {
    // An IPv6 host comes back as "[::1]"; ioredis expects it without brackets.
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port ? Number(url.port) : DEFAULT_REDIS_PORT,
  };

  // Credentials may contain percent-encoded characters such as %40 for '@'.
  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }

  const db = url.pathname.slice(1);
  if (db) {
    if (!/^\d+$/.test(db)) {
      throw new Error(
        `REDIS_URL database must be a non-negative integer, got "${db}"`,
      );
    }
    options.db = Number(db);
  }

  if (url.protocol === 'rediss:') {
    options.tls = {};
  }
  return options;
}

/**
 * Connection options shared by every BullMQ object of one process.
 *
 * - API: `enableOfflineQueue: false`. While Redis is disconnected, a command
 *   fails at once instead of waiting in ioredis' offline queue until Redis
 *   comes back, so GET /orders/:id/jobs answers 503 quickly. POST /orders
 *   never uses Redis (ADR-003).
 * - Worker: `maxRetriesPerRequest: null`, which BullMQ requires for the
 *   blocking connections of a Worker. Commands wait while Redis is down and
 *   run when it comes back, so the Worker resumes by itself. The offline
 *   queue must stay enabled here: when a command fails at once, the Worker's
 *   fetch loop retries immediately and spins.
 *
 * Whatever the role, our own calls to Redis are bounded by a timeout (see
 * OrderQueueProducer), so a Redis that is unreachable at startup, when
 * BullMQ waits for the first connection, cannot block them either.
 */
export function buildRedisConnection(
  redisUrl: string,
  role: RedisConnectionRole,
): RedisOptions {
  const options = parseRedisUrl(redisUrl);
  return role === RedisConnectionRole.Api
    ? { ...options, enableOfflineQueue: false }
    : { ...options, maxRetriesPerRequest: null };
}
