import { Logger } from '@nestjs/common';

/** Longest graceful shutdown before the process exits anyway. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Exits with code 1 if the graceful shutdown started by SIGTERM or SIGINT
 * does not finish within SHUTDOWN_TIMEOUT_MS. Call it after
 * `enableShutdownHooks()`.
 *
 * Closing a Redis connection can hang while Redis is unreachable:
 * - worker: ioredis keeps the QUIT command waiting behind the commands
 *   queued during the outage;
 * - API: QUIT fails at once (no offline queue), BullMQ gives up, and the
 *   ioredis client keeps trying to reconnect, which keeps the process alive.
 *
 * The timer is unref'd, so it never keeps the process alive by itself.
 */
export function exitIfShutdownHangs(context: string): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      setTimeout(() => {
        Logger.error(
          `Graceful shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms, exiting`,
          undefined,
          context,
        );
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();
    });
  }
}
