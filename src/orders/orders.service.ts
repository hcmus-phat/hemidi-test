import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { paginate, Paginated } from '../common/dto/paginated-response.dto';
import { getPaginationOffset } from '../common/dto/pagination-query.dto';
import { errorMessage } from '../common/utils/error-message';
import { truncate } from '../common/utils/truncate';
import {
  AppException,
  InsufficientStockDetail,
} from '../common/errors/app.exception';
import { ordersConfig } from '../config/configuration';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import {
  OutboxAggregateType,
  OutboxEventType,
} from '../outbox/outbox-event-type.enum';
import { OutboxRepository } from '../outbox/outbox.repository';
import { Product } from '../products/entities/product.entity';
import { ProductStockRepository } from '../products/product-stock.repository';
import {
  OrderJobSnapshot,
  OrderQueueProducer,
} from '../queue/order-queue.producer';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { Order } from './entities/order.entity';
import { calculateOrderTotal } from './order-amounts';
import { CancelReason, OrderStatus } from './order-status.enum';
import { NewOrderItem, OrdersRepository } from './orders.repository';

/** Statuses a customer can cancel from (FR-O05). FAILED and CANCELLED are final. */
const CANCELLABLE_STATUSES = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

/** Longest failure reason kept in orders.failure_reason (a text column). */
export const MAX_FAILURE_REASON_LENGTH = 1000;

/** Where an order is in its background processing (GET /orders/:id/jobs). */
export interface OrderJobs {
  orderId: string;
  orderStatus: OrderStatus;
  /** The ORDER_CREATED outbox event, null if there is none. */
  event: OutboxEvent | null;
  jobs: OrderJobSnapshot[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ordersRepo: OrdersRepository,
    private readonly stockRepo: ProductStockRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly notificationsRepo: NotificationsRepository,
    private readonly orderQueue: OrderQueueProducer,
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
   * Newest first, without items (A-10). A page beyond the last one returns
   * no rows.
   */
  async findAll(query: QueryOrdersDto): Promise<Paginated<Order>> {
    const [orders, total] = await this.ordersRepo.findPage(
      this.dataSource.manager,
      {
        offset: getPaginationOffset(query),
        limit: query.limit,
        status: query.status,
      },
    );
    return paginate(orders, total, query);
  }

  /** The order with its items. */
  async findOne(orderId: string): Promise<Order> {
    const order = await this.ordersRepo.findByIdWithItems(
      this.dataSource.manager,
      orderId,
    );
    if (!order) {
      throw AppException.orderNotFound(orderId);
    }
    return order;
  }

  /**
   * Cancels an order at the customer's request and gives its stock back, in
   * one transaction (docs/05 §7):
   *
   * - CAS PENDING | CONFIRMED -> CANCELLED. Of two concurrent cancels only one
   *   matches, so the stock is released once (docs/05 §8).
   * - When the CAS matches nothing, one more query tells 404 (no such order)
   *   from 409 (FAILED or CANCELLED). The success path needs no extra query.
   * - The stock is released after the CAS, in the same transaction: if that
   *   fails, the cancellation is rolled back too.
   */
  async cancel(orderId: string): Promise<Order> {
    await this.dataSource.transaction(async (manager) => {
      await this.setLockTimeout(manager);

      const cancelled = await this.ordersRepo.transitionStatus(
        manager,
        orderId,
        CANCELLABLE_STATUSES,
        OrderStatus.CANCELLED,
        { cancelReason: CancelReason.CUSTOMER_REQUEST },
      );
      if (!cancelled) {
        const status = await this.ordersRepo.findStatus(manager, orderId);
        if (status === null) {
          throw AppException.orderNotFound(orderId);
        }
        throw AppException.invalidOrderStatus(status, 'cancelled');
      }

      await this.releaseStock(manager, orderId);
    });
    // CANCELLED is final, so reading after the commit returns what was committed.
    return this.findOne(orderId);
  }

  /**
   * The outbox event and the BullMQ job of an order (docs/05 §10):
   *
   * - 404 ORDER_NOT_FOUND when the order does not exist (Redis is not read).
   * - The outbox event tells whether the relay has published the order yet.
   * - The job comes from Redis. Any Redis error, including no answer within
   *   3s, is a 503: the client should retry. Only this endpoint and /health
   *   depend on Redis in the API.
   */
  async getOrderJobs(orderId: string): Promise<OrderJobs> {
    const manager = this.dataSource.manager;
    const orderStatus = await this.ordersRepo.findStatus(manager, orderId);
    if (orderStatus === null) {
      throw AppException.orderNotFound(orderId);
    }

    const event = await this.outboxRepo.findByAggregate(
      manager,
      orderId,
      OutboxEventType.ORDER_CREATED,
    );
    const jobs = await this.orderQueue
      .getOrderJobs(orderId)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not read the jobs of order ${orderId}: ${errorMessage(error)}`,
        );
        throw AppException.serviceUnavailable(
          'The job queue is unavailable, please retry',
        );
      });
    return { orderId, orderStatus, event, jobs };
  }

  /** Current status of an order, or null when it does not exist (read by the worker). */
  getStatus(orderId: string): Promise<OrderStatus | null> {
    return this.ordersRepo.findStatus(this.dataSource.manager, orderId);
  }

  /**
   * Confirms an order for the worker, in one transaction (docs/05 §5):
   *
   * - CAS PENDING -> CONFIRMED (confirmed_at = now()).
   * - Only if the CAS matched: record the ORDER_CONFIRMED notification. The
   *   unique (order_id, type) constraint makes a second one impossible.
   *
   * Returns false when the order is no longer PENDING (cancelled, expired or
   * already confirmed by another run of the job): nothing is written then.
   * Running it twice is therefore harmless (FR-Q05).
   */
  confirmOrder(orderId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.ordersRepo.transitionStatus(
        manager,
        orderId,
        [OrderStatus.PENDING],
        OrderStatus.CONFIRMED,
      );
      if (!order) {
        return false;
      }

      await this.notificationsRepo.insertIfAbsent(manager, {
        orderId,
        type: NotificationType.ORDER_CONFIRMED,
        recipient: order.customerEmail,
        subject: `Order ${orderId} confirmed`,
        payload: { orderId, totalAmount: order.totalAmount },
      });
      return true;
    });
  }

  /**
   * Marks an order FAILED after the last attempt of its job failed, and gives
   * its stock back, in one transaction (docs/05 §5, FR-Q04):
   *
   * - CAS PENDING -> FAILED (failed_at = now(), failure_reason = the error,
   *   cut to MAX_FAILURE_REASON_LENGTH characters).
   * - Only if the CAS matched: release the stock.
   *
   * Returns false when the order is no longer PENDING (e.g. the customer
   * cancelled it meanwhile, which already gave the stock back): the stock is
   * then left alone, so it is never released twice (docs/05 §6.2 #6, #8).
   */
  failOrder(orderId: string, reason: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.ordersRepo.transitionStatus(
        manager,
        orderId,
        [OrderStatus.PENDING],
        OrderStatus.FAILED,
        { failureReason: truncate(reason, MAX_FAILURE_REASON_LENGTH) },
      );
      if (!order) {
        return false;
      }

      await this.releaseStock(manager, orderId);
      return true;
    });
  }

  /**
   * Gives back the stock of every item of an order: one UPDATE per item, by
   * ascending product id, the order in which products are always locked
   * (docs/05 §2.2, docs/06 §5). A single UPDATE ... FROM order_items would
   * lock rows in an undefined order and could deadlock with an order being
   * placed.
   *
   * Only call it in the transaction of a successful CAS into a final status
   * (ADR-015): an order leaves PENDING/CONFIRMED once, so its stock is given
   * back at most once. Used by cancel and failOrder, and by the worker's
   * expiry job through this service.
   */
  private async releaseStock(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    const items = await this.ordersRepo.findItemsForRelease(manager, orderId);
    for (const item of items) {
      await this.stockRepo.incrementStock(
        manager,
        item.productId,
        item.quantity,
      );
    }
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
