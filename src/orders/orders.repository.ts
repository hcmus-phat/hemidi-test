import { Injectable } from '@nestjs/common';
import { EntityManager, type QueryDeepPartialEntity } from 'typeorm';
import { BigIntTransformer } from '../common/transformers/bigint.transformer';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CancelReason, OrderStatus } from './order-status.enum';

/** A line of a new order, with the product snapshot taken under the row lock. */
export type NewOrderItem = Pick<
  OrderItem,
  'productId' | 'productSku' | 'productName' | 'unitPrice' | 'quantity'
>;

export interface NewOrder {
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalAmount: number;
  items: NewOrderItem[];
}

/** Extra columns written together with a status change. */
export interface StatusTransitionPatch {
  cancelReason?: CancelReason;
  failureReason?: string;
}

/** What a successful status change returns (the columns its side effects need). */
export type TransitionedOrder = Pick<
  Order,
  'id' | 'status' | 'customerEmail' | 'totalAmount'
>;

/** What releasing the stock of an order needs from each item. */
export type ReleasableItem = Pick<OrderItem, 'productId' | 'quantity'>;

export interface OrderPageQuery {
  offset: number;
  limit: number;
  status?: OrderStatus;
}

/** Row returned by `UPDATE ... RETURNING`: raw column names, bigint as a string. */
interface TransitionedOrderRow {
  id: string;
  status: OrderStatus;
  customer_email: string;
  total_amount: string;
}

/**
 * The timestamp column a status records, set with the database clock (the
 * same clock as created_at). PENDING is never entered again, so it has none.
 */
function statusTimestamp(status: OrderStatus): QueryDeepPartialEntity<Order> {
  const now = (): string => 'now()';
  switch (status) {
    case OrderStatus.CONFIRMED:
      return { confirmedAt: now };
    case OrderStatus.FAILED:
      return { failedAt: now };
    case OrderStatus.CANCELLED:
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * Queries on orders and order_items. Every method takes an EntityManager:
 * the caller's transaction, or `dataSource.manager` for a plain read
 * (docs/02 §8).
 */
@Injectable()
export class OrdersRepository {
  /**
   * Inserts the order, then all its items in one multi-row INSERT. Returns
   * the order with its items, as they were written.
   */
  async insertWithItems(
    manager: EntityManager,
    newOrder: NewOrder,
  ): Promise<Order> {
    const { items, ...columns } = newOrder;
    const order = manager.create(Order, {
      ...columns,
      // A new order has no outcome yet.
      failureReason: null,
      cancelReason: null,
      confirmedAt: null,
      cancelledAt: null,
      failedAt: null,
    });
    // INSERT ... RETURNING copies the generated id and timestamps onto `order`.
    await manager.insert(Order, order);

    order.items = items.map((item) =>
      manager.create(OrderItem, { ...item, orderId: order.id }),
    );
    await manager.insert(OrderItem, order.items);
    return order;
  }

  /**
   * Compare-and-set on the order status (ADR-015, docs/05 §2.1):
   *
   *   UPDATE orders SET status = :to, <to>_at = now(), ...patch, updated_at = now()
   *    WHERE id = :orderId AND status = ANY(:from)
   *   RETURNING id, status, customer_email, total_amount
   *
   * Returns null when no row matched: the order does not exist or is no
   * longer in one of the `from` statuses. The UPDATE locks the order row, so
   * of two concurrent transitions only the first one matches; the second
   * re-reads the row after the first commits and sees the new status.
   *
   * Side effects (stock, notifications) must only run when this returns a
   * row, in the same transaction.
   */
  async transitionStatus(
    manager: EntityManager,
    orderId: string,
    from: OrderStatus[],
    to: OrderStatus,
    patch: StatusTransitionPatch = {},
  ): Promise<TransitionedOrder | null> {
    const result = await manager
      .createQueryBuilder()
      .update(Order)
      .set({ ...patch, ...statusTimestamp(to), status: to })
      .where('id = :orderId', { orderId })
      .andWhere('status = ANY(:from)', { from })
      .returning(['id', 'status', 'customerEmail', 'totalAmount'])
      .execute();

    const [row] = result.raw as TransitionedOrderRow[];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      customerEmail: row.customer_email,
      totalAmount: BigIntTransformer.from(row.total_amount) as number,
    };
  }

  /** Current status of an order, or null when it does not exist. */
  async findStatus(
    manager: EntityManager,
    orderId: string,
  ): Promise<OrderStatus | null> {
    const order = await manager.findOne(Order, {
      select: { id: true, status: true },
      where: { id: orderId },
    });
    return order?.status ?? null;
  }

  /**
   * Ids of the orders still PENDING more than `olderThanMinutes` after they
   * were created, oldest first, at most `limit` of them:
   *
   *   SELECT id FROM orders
   *    WHERE status = 'PENDING'
   *      AND created_at < now() - make_interval(mins => :olderThanMinutes)
   *    ORDER BY created_at
   *    LIMIT :limit
   *
   * The cutoff uses the database clock, the one that wrote created_at: the
   * clock of the worker's machine may differ. Served by
   * idx_orders_status_created_at.
   */
  async findStalePendingIds(
    manager: EntityManager,
    olderThanMinutes: number,
    limit: number,
  ): Promise<string[]> {
    const rows = await manager
      .createQueryBuilder(Order, 'order')
      .select('order.id', 'id')
      .where('order.status = :status', { status: OrderStatus.PENDING })
      .andWhere(
        'order.createdAt < now() - make_interval(mins => :olderThanMinutes)',
        { olderThanMinutes },
      )
      .orderBy('order.createdAt', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  /**
   * Items whose stock goes back when the order ends, by ascending product id:
   * the order in which products are locked everywhere (docs/06 §5).
   */
  findItemsForRelease(
    manager: EntityManager,
    orderId: string,
  ): Promise<ReleasableItem[]> {
    return manager.find(OrderItem, {
      select: { productId: true, quantity: true },
      where: { orderId },
      order: { productId: 'ASC' },
    });
  }

  /**
   * The order and its items (by ascending product id), or null. One query
   * with a join (`findOne` with relations would add a second, DISTINCT query
   * to apply its LIMIT 1).
   */
  findByIdWithItems(
    manager: EntityManager,
    orderId: string,
  ): Promise<Order | null> {
    return manager
      .createQueryBuilder(Order, 'order')
      .leftJoinAndSelect('order.items', 'item')
      .where('order.id = :orderId', { orderId })
      .orderBy('item.productId', 'ASC')
      .getOne();
  }

  /**
   * One page of orders without their items, newest first with id as a
   * tie-breaker so pages are stable (idx_orders_created_at, or
   * idx_orders_status_created_at when filtering on status).
   */
  findPage(
    manager: EntityManager,
    { offset, limit, status }: OrderPageQuery,
  ): Promise<[Order[], number]> {
    return manager.findAndCount(Order, {
      where: status ? { status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: offset,
      take: limit,
    });
  }
}
