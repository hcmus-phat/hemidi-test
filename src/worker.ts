import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { errorMessage } from './common/utils/error-message';
import { WorkerModule } from './worker.module';

/**
 * Longest graceful shutdown. A job in progress takes a few seconds, but
 * closing a Redis connection can hang while Redis is unreachable: ioredis
 * keeps the QUIT command waiting behind commands queued during the outage.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Exits with code 1 if the graceful shutdown started by a signal does not
 * finish in time. The timer is unref'd, so it never keeps the process alive.
 */
function exitIfShutdownHangs(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      setTimeout(() => {
        Logger.error(
          `Graceful shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms, exiting`,
          undefined,
          'Worker',
        );
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();
    });
  }
}

/**
 * Entry point of the worker: a Nest application context without HTTP
 * (docs/02 §2). Run with `npm run start:worker:prod` (node dist/worker.js).
 */
async function bootstrap(): Promise<void> {
  // abortOnError: false lets a startup error reach the catch below.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
  });
  // On SIGTERM (deploy, docker stop) or SIGINT (Ctrl+C), Nest runs the
  // shutdown hooks: the relay finishes its batch, then Redis and the
  // database connections close.
  app.enableShutdownHooks();
  exitIfShutdownHangs();
  Logger.log('Worker started', 'Worker');
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    `Worker failed to start: ${errorMessage(error)}`,
    error instanceof Error ? error.stack : undefined,
    'Worker',
  );
  process.exit(1);
});
