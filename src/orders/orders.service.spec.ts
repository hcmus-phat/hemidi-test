import { Test } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ordersConfig } from '../config/configuration';
import { NotificationsRepository } from '../notifications/notifications.repository';
import {
  OutboxAggregateType,
  OutboxEventType,
} from '../outbox/outbox-event-type.enum';
import { OutboxRepository } from '../outbox/outbox.repository';
import { ProductStockRepository } from '../products/product-stock.repository';
import { OrderQueueProducer } from '../queue/order-queue.producer';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { CancelReason, OrderStatus } from './order-status.enum';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * Unit tests of the order business rules (docs/07 §2–§4). Repositories are
 * mocked, so these tests check WHAT the service asks the database to do and
 * in which transaction. Whether the locks really prevent overselling can
 * only be shown against Postgres (IT-01).
 */
describe('OrdersService', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const ORDER_ID = '99999999-9999-4999-8999-999999999999';

  // The manager of the (fake) transaction. `query` runs set_config('lock_timeout').
  const manager = { query: jest.fn() } as unknown as EntityManager;
  // Reads outside a transaction use the DataSource's own manager.
  const defaultManager = {} as EntityManager;
  let committed: boolean;
  const dataSource = {
    manager: defaultManager,
    transaction: jest.fn(
      async (work: (m: EntityManager) => Promise<unknown>) => {
        const result = await work(manager);
        // Only reached when the callback did not throw: TypeORM would COMMIT.
        committed = true;
        return result;
      },
    ),
  };
  const stockRepo = {
    findActiveForUpdate: jest.fn(),
    decrementStock: jest.fn(),
    incrementStock: jest.fn(),
  };
  const ordersRepo = {
    insertWithItems: jest.fn(),
    transitionStatus: jest.fn(),
    findStatus: jest.fn(),
    findItemsForRelease: jest.fn(),
    findByIdWithItems: jest.fn(),
    findPage: jest.fn(),
  };
  const outboxRepo = { add: jest.fn(), findByAggregate: jest.fn() };
  const notificationsRepo = { insertIfAbsent: jest.fn() };
  // The API only reads job states; placing an order must never enqueue.
  const orderQueue = {
    enqueueProcessOrder: jest.fn(),
    getOrderJobs: jest.fn(),
  };

  let service: OrdersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    committed = false;
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: DataSource, useValue: dataSource },
        { provide: ProductStockRepository, useValue: stockRepo },
        { provide: OrdersRepository, useValue: ordersRepo },
        { provide: OutboxRepository, useValue: outboxRepo },
        { provide: NotificationsRepository, useValue: notificationsRepo },
        { provide: OrderQueueProducer, useValue: orderQueue },
        { provide: ordersConfig.KEY, useValue: { lockTimeoutMs: 5000 } },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  function product(
    id: string,
    values: { sku?: string; price?: number; stock: number },
  ) {
    return {
      id,
      sku: values.sku ?? `SKU-${id.slice(0, 4)}`,
      name: `Product ${id.slice(0, 4)}`,
      price: values.price ?? 100000,
      stock: values.stock,
    };
  }

  function orderDto(items: { productId: string; quantity: number }[]) {
    return Object.assign(new CreateOrderDto(), {
      customerName: 'Nguyen Van A',
      customerEmail: 'a@example.com',
      items,
    });
  }

  async function rejection(promise: Promise<unknown>): Promise<AppException> {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  }

  function expectNoWrites() {
    expect(stockRepo.decrementStock).not.toHaveBeenCalled();
    expect(ordersRepo.insertWithItems).not.toHaveBeenCalled();
    expect(outboxRepo.add).not.toHaveBeenCalled();
    // The exception left the transaction callback, so TypeORM rolls back.
    expect(committed).toBe(false);
  }

  describe('create', () => {
    beforeEach(() => {
      ordersRepo.insertWithItems.mockImplementation(
        (_manager: EntityManager, data: object) =>
          Promise.resolve({ id: ORDER_ID, ...data }),
      );
    });

    it('UT-01 creates a PENDING order, takes the stock, snapshots the price and writes the outbox event in the same transaction', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { sku: 'TSHIRT-01', price: 100000, stock: 5 }),
      ]);

      const order = await service.create(
        orderDto([{ productId: P1, quantity: 2 }]),
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("set_config('lock_timeout'"),
        ['5000ms'],
      );
      expect(stockRepo.findActiveForUpdate).toHaveBeenCalledWith(manager, [P1]);
      expect(stockRepo.decrementStock).toHaveBeenCalledWith(manager, P1, 2);
      expect(ordersRepo.insertWithItems).toHaveBeenCalledWith(manager, {
        customerName: 'Nguyen Van A',
        customerEmail: 'a@example.com',
        status: OrderStatus.PENDING,
        totalAmount: 200000,
        items: [
          {
            productId: P1,
            productSku: 'TSHIRT-01',
            productName: 'Product 1111',
            unitPrice: 100000,
            quantity: 2,
          },
        ],
      });
      expect(outboxRepo.add).toHaveBeenCalledTimes(1);
      // Same manager as the stock and order writes = same transaction.
      expect(outboxRepo.add).toHaveBeenCalledWith(manager, {
        aggregateType: OutboxAggregateType.ORDER,
        aggregateId: ORDER_ID,
        eventType: OutboxEventType.ORDER_CREATED,
        payload: { orderId: ORDER_ID },
      });
      // POST /orders does not depend on Redis: the relay publishes the event (ADR-003).
      expect(orderQueue.enqueueProcessOrder).not.toHaveBeenCalled();
      expect(orderQueue.getOrderJobs).not.toHaveBeenCalled();
      expect(committed).toBe(true);
      expect(order.id).toBe(ORDER_ID);
      expect(order.status).toBe(OrderStatus.PENDING);
    });

    it('sets the lock timeout, then locks, then writes', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { stock: 5 }),
      ]);

      await service.create(orderDto([{ productId: P1, quantity: 1 }]));

      const callOrder = [
        (manager.query as jest.Mock).mock.invocationCallOrder[0],
        stockRepo.findActiveForUpdate.mock.invocationCallOrder[0],
        stockRepo.decrementStock.mock.invocationCallOrder[0],
        ordersRepo.insertWithItems.mock.invocationCallOrder[0],
        outboxRepo.add.mock.invocationCallOrder[0],
      ];
      expect(callOrder).toEqual([...callOrder].sort((a, b) => a - b));
    });

    it('follows the lock order (product id) and sums every line, whatever the request order', async () => {
      // findActiveForUpdate returns rows ORDER BY id.
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { price: 199000, stock: 5 }),
        product(P2, { price: 150000, stock: 5 }),
      ]);

      await service.create(
        orderDto([
          { productId: P2, quantity: 1 },
          { productId: P1, quantity: 2 },
        ]),
      );

      expect(stockRepo.findActiveForUpdate).toHaveBeenCalledWith(manager, [
        P2,
        P1,
      ]);
      expect(stockRepo.decrementStock).toHaveBeenNthCalledWith(
        1,
        manager,
        P1,
        2,
      );
      expect(stockRepo.decrementStock).toHaveBeenNthCalledWith(
        2,
        manager,
        P2,
        1,
      );
      expect(ordersRepo.insertWithItems).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          totalAmount: 548000,
          items: [
            expect.objectContaining({ productId: P1, quantity: 2 }),
            expect.objectContaining({ productId: P2, quantity: 1 }),
          ],
        }),
      );
    });

    it('UT-02 rejects with 409 INSUFFICIENT_STOCK and performs no writes', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { sku: 'LAST-ITEM-001', stock: 1 }),
      ]);

      const error = await rejection(
        service.create(orderDto([{ productId: P1, quantity: 2 }])),
      );

      expect(error.code).toBe(ErrorCode.INSUFFICIENT_STOCK);
      expect(error.getStatus()).toBe(409);
      expect(error.details).toEqual([
        { productId: P1, sku: 'LAST-ITEM-001', requested: 2, available: 1 },
      ]);
      expectNoWrites();
    });

    it('UT-02 lists every product that is short, and takes no stock from the others', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { sku: 'A', stock: 0 }),
        product(P2, { sku: 'B', stock: 3 }),
      ]);

      const twoShort = await rejection(
        service.create(
          orderDto([
            { productId: P1, quantity: 1 },
            { productId: P2, quantity: 4 },
          ]),
        ),
      );
      expect(twoShort.message).toBe('Insufficient stock for 2 product(s)');
      expect(twoShort.details).toEqual([
        { productId: P1, sku: 'A', requested: 1, available: 0 },
        { productId: P2, sku: 'B', requested: 4, available: 3 },
      ]);

      const oneShort = await rejection(
        service.create(
          orderDto([
            { productId: P1, quantity: 1 },
            { productId: P2, quantity: 3 },
          ]),
        ),
      );
      expect(oneShort.details).toEqual([
        { productId: P1, sku: 'A', requested: 1, available: 0 },
      ]);
      expectNoWrites();
    });

    it('accepts an order that takes the last units', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { stock: 2 }),
      ]);

      await service.create(orderDto([{ productId: P1, quantity: 2 }]));

      expect(stockRepo.decrementStock).toHaveBeenCalledWith(manager, P1, 2);
      expect(committed).toBe(true);
    });

    it('UT-05 rejects with 404 PRODUCT_NOT_FOUND listing every missing id, and performs no writes', async () => {
      const P3 = '33333333-3333-4333-8333-333333333333';
      // P2 and P3 do not exist or are deleted: the lock query does not return them.
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { stock: 5 }),
      ]);

      const error = await rejection(
        service.create(
          orderDto([
            { productId: P2, quantity: 1 },
            { productId: P1, quantity: 1 },
            { productId: P3, quantity: 1 },
          ]),
        ),
      );

      expect(error.code).toBe(ErrorCode.PRODUCT_NOT_FOUND);
      expect(error.getStatus()).toBe(404);
      expect(error.details).toEqual([{ productId: P2 }, { productId: P3 }]);
      expectNoWrites();
    });

    it('UT-05 reports a missing product before a stock shortage', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { stock: 0 }),
      ]);

      const error = await rejection(
        service.create(
          orderDto([
            { productId: P1, quantity: 1 },
            { productId: P2, quantity: 1 },
          ]),
        ),
      );

      expect(error.code).toBe(ErrorCode.PRODUCT_NOT_FOUND);
      expect(error.details).toEqual([{ productId: P2 }]);
      expectNoWrites();
    });

    it('rolls back when a write fails after the stock was taken', async () => {
      stockRepo.findActiveForUpdate.mockResolvedValue([
        product(P1, { stock: 5 }),
      ]);
      const dbError = new Error('connection lost');
      outboxRepo.add.mockRejectedValueOnce(dbError);

      await expect(
        service.create(orderDto([{ productId: P1, quantity: 1 }])),
      ).rejects.toBe(dbError);
      expect(committed).toBe(false);
    });
  });

  describe('cancel', () => {
    const cancelledOrder = {
      id: ORDER_ID,
      status: OrderStatus.CANCELLED,
      items: [],
    };

    it('UT-03 cancels the order and releases the stock of every item, in product id order', async () => {
      ordersRepo.transitionStatus.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
        customerEmail: 'a@example.com',
        totalAmount: 548000,
      });
      ordersRepo.findItemsForRelease.mockResolvedValue([
        { productId: P1, quantity: 2 },
        { productId: P2, quantity: 1 },
      ]);
      ordersRepo.findByIdWithItems.mockResolvedValue(cancelledOrder);

      const order = await service.cancel(ORDER_ID);

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("set_config('lock_timeout'"),
        ['5000ms'],
      );
      expect(ordersRepo.transitionStatus).toHaveBeenCalledWith(
        manager,
        ORDER_ID,
        [OrderStatus.PENDING, OrderStatus.CONFIRMED],
        OrderStatus.CANCELLED,
        { cancelReason: CancelReason.CUSTOMER_REQUEST },
      );
      expect(ordersRepo.findItemsForRelease).toHaveBeenCalledWith(
        manager,
        ORDER_ID,
      );
      expect(stockRepo.incrementStock).toHaveBeenCalledTimes(2);
      expect(stockRepo.incrementStock).toHaveBeenNthCalledWith(
        1,
        manager,
        P1,
        2,
      );
      expect(stockRepo.incrementStock).toHaveBeenNthCalledWith(
        2,
        manager,
        P2,
        1,
      );
      // The success path needs no extra status query.
      expect(ordersRepo.findStatus).not.toHaveBeenCalled();
      expect(committed).toBe(true);
      // The response is read after the commit, outside the transaction.
      expect(ordersRepo.findByIdWithItems).toHaveBeenCalledWith(
        defaultManager,
        ORDER_ID,
      );
      expect(order.status).toBe(OrderStatus.CANCELLED);
    });

    it('releases the stock only after the status changed', async () => {
      ordersRepo.transitionStatus.mockResolvedValue({ id: ORDER_ID });
      ordersRepo.findItemsForRelease.mockResolvedValue([
        { productId: P1, quantity: 1 },
      ]);
      ordersRepo.findByIdWithItems.mockResolvedValue(cancelledOrder);

      await service.cancel(ORDER_ID);

      expect(
        ordersRepo.transitionStatus.mock.invocationCallOrder[0],
      ).toBeLessThan(stockRepo.incrementStock.mock.invocationCallOrder[0]);
    });

    it.each([OrderStatus.FAILED, OrderStatus.CANCELLED])(
      'UT-04 rejects with 409 INVALID_ORDER_STATUS when the order is %s, and releases no stock',
      async (status) => {
        ordersRepo.transitionStatus.mockResolvedValue(null);
        ordersRepo.findStatus.mockResolvedValue(status);

        const error = await rejection(service.cancel(ORDER_ID));

        expect(error.code).toBe(ErrorCode.INVALID_ORDER_STATUS);
        expect(error.getStatus()).toBe(409);
        expect(error.message).toBe(
          `Order cannot be cancelled in status ${status}`,
        );
        expect(ordersRepo.findStatus).toHaveBeenCalledWith(manager, ORDER_ID);
        expect(ordersRepo.findItemsForRelease).not.toHaveBeenCalled();
        expect(stockRepo.incrementStock).not.toHaveBeenCalled();
        expect(committed).toBe(false);
      },
    );

    it('UT-04 rejects with 404 ORDER_NOT_FOUND when the order does not exist', async () => {
      ordersRepo.transitionStatus.mockResolvedValue(null);
      ordersRepo.findStatus.mockResolvedValue(null);

      const error = await rejection(service.cancel(ORDER_ID));

      expect(error.code).toBe(ErrorCode.ORDER_NOT_FOUND);
      expect(error.getStatus()).toBe(404);
      expect(stockRepo.incrementStock).not.toHaveBeenCalled();
      expect(committed).toBe(false);
    });
  });

  describe('getOrderJobs', () => {
    const job = {
      jobId: `order-${ORDER_ID}`,
      name: 'process-order',
      state: 'completed',
      attemptsMade: 1,
      maxAttempts: 4,
      failedReason: null,
      returnValue: { result: 'CONFIRMED' },
      createdAt: '2026-10-14T03:15:00.900Z',
      processedAt: '2026-10-14T03:15:01.000Z',
      finishedAt: '2026-10-14T03:15:05.000Z',
    };

    it('returns the status, the outbox event and the jobs, read outside a transaction', async () => {
      const event = { id: '7', publishedAt: new Date(), publishAttempts: 1 };
      ordersRepo.findStatus.mockResolvedValue(OrderStatus.CONFIRMED);
      outboxRepo.findByAggregate.mockResolvedValue(event);
      orderQueue.getOrderJobs.mockResolvedValue([job]);

      const result = await service.getOrderJobs(ORDER_ID);

      expect(result).toEqual({
        orderId: ORDER_ID,
        orderStatus: OrderStatus.CONFIRMED,
        event,
        jobs: [job],
      });
      expect(ordersRepo.findStatus).toHaveBeenCalledWith(
        defaultManager,
        ORDER_ID,
      );
      expect(outboxRepo.findByAggregate).toHaveBeenCalledWith(
        defaultManager,
        ORDER_ID,
        OutboxEventType.ORDER_CREATED,
      );
      expect(orderQueue.getOrderJobs).toHaveBeenCalledWith(ORDER_ID);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws 404 ORDER_NOT_FOUND without reading Redis when the order does not exist', async () => {
      ordersRepo.findStatus.mockResolvedValue(null);

      const error = await rejection(service.getOrderJobs(ORDER_ID));

      expect(error.code).toBe(ErrorCode.ORDER_NOT_FOUND);
      expect(error.getStatus()).toBe(404);
      expect(orderQueue.getOrderJobs).not.toHaveBeenCalled();
    });

    it('throws 503 SERVICE_UNAVAILABLE when Redis fails or does not answer', async () => {
      ordersRepo.findStatus.mockResolvedValue(OrderStatus.PENDING);
      outboxRepo.findByAggregate.mockResolvedValue(null);
      orderQueue.getOrderJobs.mockRejectedValue(
        new Error('Redis did not answer within 3000 ms'),
      );

      const error = await rejection(service.getOrderJobs(ORDER_ID));

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.getStatus()).toBe(503);
      // A fixed message telling the client to retry (ADR-011), not the Redis error.
      expect(error.message).toBe('The job queue is unavailable, please retry');
    });
  });

  describe('findAll', () => {
    it('reads one page, filtered by status, outside a transaction', async () => {
      const rows = [{ id: ORDER_ID }];
      ordersRepo.findPage.mockResolvedValue([rows, 21]);
      const query = Object.assign(new QueryOrdersDto(), {
        page: 3,
        limit: 10,
        status: OrderStatus.PENDING,
      });

      const result = await service.findAll(query);

      expect(ordersRepo.findPage).toHaveBeenCalledWith(defaultManager, {
        offset: 20,
        limit: 10,
        status: OrderStatus.PENDING,
      });
      expect(result).toEqual({
        data: rows,
        meta: { page: 3, limit: 10, total: 21, totalPages: 3 },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the order with its items', async () => {
      const order = { id: ORDER_ID, items: [] };
      ordersRepo.findByIdWithItems.mockResolvedValue(order);

      await expect(service.findOne(ORDER_ID)).resolves.toBe(order);
      expect(ordersRepo.findByIdWithItems).toHaveBeenCalledWith(
        defaultManager,
        ORDER_ID,
      );
    });

    it('throws 404 ORDER_NOT_FOUND when the order does not exist', async () => {
      ordersRepo.findByIdWithItems.mockResolvedValue(null);

      const error = await rejection(service.findOne(ORDER_ID));

      expect(error.code).toBe(ErrorCode.ORDER_NOT_FOUND);
      expect(error.getStatus()).toBe(404);
    });
  });
});
