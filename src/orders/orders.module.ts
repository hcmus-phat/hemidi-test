import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { ProductsModule } from '../products/products.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * Orders: placing and reading orders. Uses ProductStockRepository to lock and
 * update stock, and OutboxRepository to record the ORDER_CREATED event in the
 * same transaction (docs/02 §5).
 */
@Module({
  imports: [ProductsModule, OutboxModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
