import { Logger } from '@nestjs/common';
import { errorMessage } from '../common/utils/error-message';

/** How long the same error stays quiet after it was logged. */
const REPEAT_AFTER_MS = 60_000;

/**
 * Returns an 'error' listener for a BullMQ Queue or Worker.
 *
 * While Redis is down, ioredis retries the connection every few seconds and
 * every failed attempt is an 'error' event. Without a listener BullMQ prints
 * each one with its stack. This listener logs one line per distinct message,
 * and repeats a message at most once a minute while the outage lasts.
 */
export function createRedisErrorLogger(
  logger: Logger,
  source: string,
): (error: Error) => void {
  const lastLoggedAt = new Map<string, number>();
  return (error: Error) => {
    const message = errorMessage(error);
    const now = Date.now();
    const previous = lastLoggedAt.get(message);
    if (previous !== undefined && now - previous < REPEAT_AFTER_MS) {
      return;
    }
    lastLoggedAt.set(message, now);
    logger.warn(`${source}: Redis error: ${message}`);
  };
}
