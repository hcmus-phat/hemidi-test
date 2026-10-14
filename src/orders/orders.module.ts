import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ProductsModule } from '../products/products.module';
import { QueueModule } from '../queue/queue.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * Orders: placing, reading, cancelling and (from the worker) confirming
 * orders. Uses ProductStockRepository to lock and update stock,
 * OutboxRepository to record the ORDER_CREATED event in the same
 * transaction, NotificationsRepository when an order is confirmed, and the
 * order-processing queue to read job states (docs/02 §5). Placing an order
 * never touches the queue (ADR-003).
 *
 * Exports OrdersService for the worker, whose processor calls it.
 */
@Module({
  imports: [ProductsModule, OutboxModule, NotificationsModule, QueueModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService],
})
export class OrdersModule {}
