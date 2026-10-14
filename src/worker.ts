import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { exitIfShutdownHangs } from './bootstrap/shutdown-watchdog';
import { errorMessage } from './common/utils/error-message';
import { WorkerModule } from './worker.module';

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
  // shutdown hooks: the relay finishes its batch, the BullMQ Worker its
  // jobs, then Redis and the database connections close.
  app.enableShutdownHooks();
  exitIfShutdownHangs('Worker');
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
