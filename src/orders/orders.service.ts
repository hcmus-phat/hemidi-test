import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  AppException,
  InsufficientStockDetail,
} from '../common/errors/app.exception';
import { ordersConfig } from '../config/configuration';
import {
  OutboxAggregateType,
  OutboxEventType,
} from '../outbox/outbox-event-type.enum';
import { OutboxRepository } from '../outbox/outbox.repository';
import { Product } from '../products/entities/product.entity';
import { ProductStockRepository } from '../products/product-stock.repository';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';
import { Order } from './entities/order.entity';
import { calculateOrderTotal } from './order-amounts';
import { OrderStatus } from './order-status.enum';
import { NewOrderItem, OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ordersRepo: OrdersRepository,
    private readonly stockRepo: ProductStockRepository,
    private readonly outboxRepo: OutboxRepository,
    @Inject(ordersConfig.KEY)
    private readonly config: ConfigType<typeof ordersConfig>,
  ) {}

  /**
   * Places an order in ONE transaction (docs/05 §3.1, docs/06 §4):
   *
   * 1. Lock every product of the order with one SELECT ... ORDER BY id FOR UPDATE.
   * 2. Check that they all exist (404) and have enough stock (409).
   * 3. Take the stock: stock = stock - quantity.
   * 4. Insert the PENDING order and its items, with the price snapshot.
   * 5. Insert the ORDER_CREATED outbox event.
   *
   * Any error rolls everything back, so there is never stock taken without an
   * order, nor an order without its event. Redis is not called: the worker's
   * relay turns the event into a job after the commit (ADR-003).
   * The transaction runs at READ COMMITTED, the Postgres default (ADR-014).
   */
  create(dto: CreateOrderDto): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      await this.setLockTimeout(manager);

      const products = await this.stockRepo.findActiveForUpdate(
        manager,
        dto.items.map((item) => item.productId),
      );
      const lines = this.toOrderLines(dto.items, products);

      for (const line of lines) {
        await this.stockRepo.decrementStock(
          manager,
          line.productId,
          line.quantity,
        );
      }

      const order = await this.ordersRepo.insertWithItems(manager, {
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        status: OrderStatus.PENDING,
        totalAmount: calculateOrderTotal(lines),
        items: lines,
      });

      await this.outboxRepo.add(manager, {
        aggregateType: OutboxAggregateType.ORDER,
        aggregateId: order.id,
        eventType: OutboxEventType.ORDER_CREATED,
        payload: { orderId: order.id },
      });
      return order;
    });
  }

  /**
   * Checks the locked products against the requested items and returns one
   * line per product, with the SKU, name and price read under the lock.
   * Lines keep the lock order (ascending product id), so stock updates and
   * order items follow it too.
   *
   * @throws 404 PRODUCT_NOT_FOUND listing every id that does not exist or is deleted
   * @throws 409 INSUFFICIENT_STOCK listing every product that is short
   */
  private toOrderLines(
    items: OrderItemDto[],
    products: Product[],
  ): NewOrderItem[] {
    const lockedIds = new Set(products.map((product) => product.id));
    const missingIds = items
      .map((item) => item.productId)
      .filter((productId) => !lockedIds.has(productId));
    if (missingIds.length > 0) {
      throw AppException.productNotFound(missingIds);
    }

    const requested = new Map(
      items.map((item) => [item.productId, item.quantity]),
    );
    const lines: NewOrderItem[] = [];
    const shortages: InsufficientStockDetail[] = [];
    for (const product of products) {
      // Every locked product was requested: the lock query only asked for these ids.
      const quantity = requested.get(product.id)!;
      if (product.stock < quantity) {
        shortages.push({
          productId: product.id,
          sku: product.sku,
          requested: quantity,
          available: product.stock,
        });
      }
      lines.push({
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        unitPrice: product.price,
        quantity,
      });
    }
    if (shortages.length > 0) {
      throw AppException.insufficientStock(shortages);
    }
    return lines;
  }

  /**
   * `SET LOCAL lock_timeout` for the current transaction (ADR-014): waiting
   * longer than DB_LOCK_TIMEOUT_MS for a row lock fails with 55P03, which the
   * API returns as 503 instead of hanging. SET does not accept bind
   * parameters; set_config(name, value, is_local = true) is its
   * parameterised equivalent.
   */
  private async setLockTimeout(manager: EntityManager): Promise<void> {
    await manager.query(`SELECT set_config('lock_timeout', $1, true)`, [
      `${this.config.lockTimeoutMs}ms`,
    ]);
  }
}
