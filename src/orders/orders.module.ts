import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { ProductsModule } from '../products/products.module';
import { QueueModule } from '../queue/queue.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * Orders: placing and reading orders. Uses ProductStockRepository to lock and
 * update stock, OutboxRepository to record the ORDER_CREATED event in the
 * same transaction, and the order-processing queue to read job states
 * (docs/02 §5). Placing an order never touches the queue (ADR-003).
 */
@Module({
  imports: [ProductsModule, OutboxModule, QueueModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
