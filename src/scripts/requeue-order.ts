import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error-message';
import { OrderQueueProducer } from '../queue/order-queue.producer';
import { buildOrderJobId } from '../queue/queue.constants';

/**
 * Dev tool for MT-08 (docs/07 §6): removes the job of an order and adds it
 * again, as if the outbox relay published its event a second time after
 * BullMQ removed the finished job. With a running worker, the new job of a
 * CONFIRMED order completes with `{ skipped: true }` and no second
 * notification is written.
 *
 *   npm run job:requeue -- <orderId>
 *
 * Uses AppModule: the API's modules, without the worker or the relay.
 */
async function main(): Promise<void> {
  const orderId = process.argv[2];
  if (!isUUID(orderId)) {
    throw new Error('Usage: npm run job:requeue -- <orderId>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const producer = app.get(OrderQueueProducer);
    const jobId = buildOrderJobId(orderId);
    if (!(await producer.removeOrderJob(orderId))) {
      throw new Error(`Job ${jobId} is being processed, try again later`);
    }
    await producer.enqueueProcessOrder(orderId);
    // The app logs warnings and errors only, so the outcome goes to stdout.
    console.log(`Job ${jobId} removed and added again`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(errorMessage(error), undefined, 'RequeueOrder');
  process.exitCode = 1;
});
