import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error-message';
import { OrdersService } from '../orders/orders.service';

/**
 * Runs the expiry of stale PENDING orders once, without waiting for the
 * 5-minute job scheduler (MT-09, docs/07 §6):
 *
 *   npm run job:expire-now
 *
 * Uses AppModule: the API's modules, without the worker or the relay. Only
 * the database is needed.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const { expired } = await app.get(OrdersService).expireStaleOrders();
    // The app logs warnings and errors only, so the outcome goes to stdout.
    console.log(`Expired ${expired} stale PENDING order(s)`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(errorMessage(error), undefined, 'ExpireNow');
  process.exitCode = 1;
});
