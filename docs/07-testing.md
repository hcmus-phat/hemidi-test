# 07 — Kế hoạch kiểm thử

## 1. Chiến lược

| Tầng | Mục tiêu | Công cụ | Phụ thuộc |
|---|---|---|---|
| Unit | Nghiệp vụ `OrdersService` và processor, chạy nhanh và cho kết quả ổn định | Jest, `@nestjs/testing`, mock | Không cần DB/Redis |
| Integration / đồng thời | Chứng minh **không bán vượt** và **không hoàn kho 2 lần** trên Postgres thật | Jest e2e, supertest | `docker compose up -d` |
| Thủ công | Luồng end-to-end có worker, retry, Swagger, bản deploy | Swagger UI, curl, psql | Toàn bộ hệ thống |

> Unit test **không thể** chứng minh tính đúng khi chạy đồng thời, vì khóa nằm trong Postgres. Vì vậy IT-01/IT-02 là bắt buộc trên thực tế, dù đề chỉ yêu cầu unit test.

## 2. Unit test bắt buộc cho `OrdersService`

### UT-01: Tạo đơn thành công

- **Given:** sản phẩm P1 `{ price: 100000, stock: 5 }`. `findActiveForUpdate` trả `[P1]`.
- **When:** `create({ customerName, customerEmail, items: [{ productId: P1, quantity: 2 }] })`.
- **Then:**
  - `decrementStock(manager, P1, 2)` được gọi.
  - `insertWithItems` nhận `status = PENDING`, `totalAmount = 200000`, item có `unitPrice = 100000` (snapshot) và `quantity = 2`.
  - `outboxRepo.add` được gọi **đúng một lần**, với **cùng `manager`** (tức cùng transaction), `eventType = ORDER_CREATED`, `payload = { orderId }`.
  - Không có lời gọi nào tới queue/Redis (`POST /orders` không phụ thuộc Redis).
  - Kết quả trả về có `status = PENDING`.

### UT-02: Không đủ tồn kho

- **Given:** P1 `{ sku: 'LAST-ITEM-001', stock: 1 }`.
- **When:** `create` với `quantity = 2`.
- **Then:**
  - Ném `AppException` có `code = INSUFFICIENT_STOCK`, HTTP `409`, `details = [{ productId: P1, sku: 'LAST-ITEM-001', requested: 2, available: 1 }]`.
  - `decrementStock`, `insertWithItems`, `outboxRepo.add` **không** được gọi.
  - Exception thoát ra khỏi callback của `dataSource.transaction`. Đây chính là điều kiện để TypeORM rollback. Việc DB thực sự không đổi được kiểm chứng ở IT-01.
- **Biến thể:** 2 item cùng thiếu thì `details` có đủ 2 phần tử.

### UT-03: Hủy đơn và hoàn kho

- **Given:** `transitionStatus` trả đơn (CAS thành công). `findItemsForRelease` trả `[{ P1, 2 }, { P2, 1 }]`.
- **When:** `cancel(orderId)`.
- **Then:**
  - `transitionStatus` được gọi với `from = [PENDING, CONFIRMED]`, `to = CANCELLED`, `cancelReason = CUSTOMER_REQUEST`.
  - `incrementStock(manager, P1, 2)` rồi `incrementStock(manager, P2, 1)`, theo đúng thứ tự.
  - Kết quả có `status = CANCELLED`.

## 3. Cách mock

Thiết kế ở [02 §8](02-architecture.md#8-quy-ước-code) đặt mọi truy vấn đặc thù vào repository nhận `EntityManager`. Nhờ đó service test được mà không phải mock chuỗi `createQueryBuilder()`.

```ts
// src/orders/orders.service.spec.ts
describe('OrdersService', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const ORDER_ID = '99999999-9999-4999-8999-999999999999';

  const manager = { query: jest.fn() } as unknown as EntityManager;   // query: SET LOCAL lock_timeout
  let committed: boolean;
  const dataSource = {
    transaction: jest.fn(async (cb: (m: EntityManager) => unknown) => {
      const result = await cb(manager);
      committed = true;                                              // chỉ đặt true khi callback không ném lỗi
      return result;
    }),
  };
  const stockRepo = { findActiveForUpdate: jest.fn(), decrementStock: jest.fn(), incrementStock: jest.fn() };
  const ordersRepo = {
    insertWithItems: jest.fn(), transitionStatus: jest.fn(), findStatus: jest.fn(),
    findItemsForRelease: jest.fn(), findByIdWithItems: jest.fn(), findPendingIdsCreatedBefore: jest.fn(),
  };
  const notificationsRepo = { insertIfAbsent: jest.fn() };
  const outboxRepo = { add: jest.fn(), findByAggregate: jest.fn() };
  const orderQueue = { enqueueProcessOrder: jest.fn(), getOrderJobs: jest.fn() }; // API chỉ dùng getOrderJobs

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
        { provide: NotificationsRepository, useValue: notificationsRepo },
        { provide: OutboxRepository, useValue: outboxRepo },
        { provide: OrderQueueProducer, useValue: orderQueue },
        { provide: ordersConfig.KEY, useValue: { lockTimeoutMs: 5000, pendingTtlMinutes: 30, expireBatchSize: 100 } },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  it('UT-01 creates a PENDING order, deducts stock, snapshots unit price, writes outbox in the same transaction', async () => {
    stockRepo.findActiveForUpdate.mockResolvedValue([{ id: P1, sku: 'TSHIRT-01', name: 'T-shirt', price: 100000, stock: 5 }]);
    ordersRepo.insertWithItems.mockImplementation(async (_m, data) => ({ id: ORDER_ID, ...data }));

    const result = await service.create({
      customerName: 'Nguyen Van A', customerEmail: 'a@example.com', items: [{ productId: P1, quantity: 2 }],
    });

    expect(stockRepo.decrementStock).toHaveBeenCalledWith(manager, P1, 2);
    expect(ordersRepo.insertWithItems).toHaveBeenCalledWith(manager, expect.objectContaining({
      status: OrderStatus.PENDING,
      totalAmount: 200000,
      items: [expect.objectContaining({ productId: P1, unitPrice: 100000, quantity: 2 })],
    }));
    expect(outboxRepo.add).toHaveBeenCalledTimes(1);
    expect(outboxRepo.add).toHaveBeenCalledWith(manager, expect.objectContaining({   // cùng manager = cùng transaction
      aggregateId: ORDER_ID, eventType: OutboxEventType.ORDER_CREATED, payload: { orderId: ORDER_ID },
    }));
    expect(orderQueue.enqueueProcessOrder).not.toHaveBeenCalled();                    // API không đụng tới Redis
    expect(committed).toBe(true);
    expect(result.status).toBe(OrderStatus.PENDING);
  });

  it('UT-02 rejects with INSUFFICIENT_STOCK and performs no writes', async () => {
    stockRepo.findActiveForUpdate.mockResolvedValue([{ id: P1, sku: 'LAST-ITEM-001', name: 'Last', price: 100000, stock: 1 }]);

    await expect(service.create({
      customerName: 'B', customerEmail: 'b@example.com', items: [{ productId: P1, quantity: 2 }],
    })).rejects.toMatchObject({
      code: ErrorCode.INSUFFICIENT_STOCK,
      details: [{ productId: P1, sku: 'LAST-ITEM-001', requested: 2, available: 1 }],
    });

    expect(stockRepo.decrementStock).not.toHaveBeenCalled();
    expect(ordersRepo.insertWithItems).not.toHaveBeenCalled();
    expect(outboxRepo.add).not.toHaveBeenCalled();
    expect(committed).toBe(false);
  });

  it('UT-03 cancels the order and releases stock for every item', async () => {
    ordersRepo.transitionStatus.mockResolvedValue({ id: ORDER_ID, status: OrderStatus.CANCELLED });
    ordersRepo.findItemsForRelease.mockResolvedValue([{ productId: P1, quantity: 2 }, { productId: P2, quantity: 1 }]);
    ordersRepo.findByIdWithItems.mockResolvedValue({ id: ORDER_ID, status: OrderStatus.CANCELLED, items: [] });

    const result = await service.cancel(ORDER_ID);

    expect(ordersRepo.transitionStatus).toHaveBeenCalledWith(
      manager, ORDER_ID, [OrderStatus.PENDING, OrderStatus.CONFIRMED], OrderStatus.CANCELLED,
      expect.objectContaining({ cancelReason: CancelReason.CUSTOMER_REQUEST }),
    );
    expect(stockRepo.incrementStock).toHaveBeenNthCalledWith(1, manager, P1, 2);
    expect(stockRepo.incrementStock).toHaveBeenNthCalledWith(2, manager, P2, 1);
    expect(result.status).toBe(OrderStatus.CANCELLED);
  });
});
```

> Tên provider cấu hình (`ordersConfig.KEY`) và chữ ký các hàm repository chỉ mang tính minh họa. Khi code thật, hãy giữ test khớp với chữ ký thực tế.
>
> Code thật: `src/orders/orders.service.spec.ts` (UT-01..UT-05, cùng `findAll`/`findOne`) và `src/orders/dto/create-order.dto.spec.ts` (validate `CreateOrderDto` qua `createValidationPipe()`: `productId` trùng kể cả khác hoa thường, `items` rỗng, giới hạn `quantity`, chuẩn hóa email). Từ giai đoạn 3, `OrdersService` nhận `OrderQueueProducer` (chỉ dùng `getOrderJobs` cho `GET /orders/:id/jobs`), nên UT-01 kiểm tra `enqueueProcessOrder` và `getOrderJobs` đều **không** được gọi khi tạo đơn. `getOrderJobs` của service có test riêng: `404` mà không đọc Redis, và lỗi Redis thành `503` với thông điệp cố định.

## 4. Unit test bổ sung (nên có)

| Mã | Đối tượng | Kịch bản | Kỳ vọng |
|---|---|---|---|
| UT-04 | `OrdersService.cancel` | CAS trả `null`, `findStatus` trả `FAILED` | `409 INVALID_ORDER_STATUS`, `incrementStock` không được gọi. Nếu `findStatus` trả `null` thì `404 ORDER_NOT_FOUND` |
| UT-05 | `OrdersService.create` | `findActiveForUpdate` trả thiếu một id | `404 PRODUCT_NOT_FOUND`, `details` chứa id thiếu, không có thao tác ghi |
| UT-06 | `confirmOrder` / `failOrder` | CAS trả `null` | `confirmOrder`: không gọi `insertIfAbsent`, trả `false`. `failOrder`: không gọi `incrementStock`, trả `false`. Khi CAS thành công: `insertIfAbsent` được gọi đúng 1 lần (type `ORDER_CONFIRMED`) / `incrementStock` cho từng item |
| UT-07 | Processor | `getStatus` trả `CONFIRMED` | Trả `{ skipped: true }`, **không** sleep, không gọi `confirmOrder` |
| UT-08 | Processor | `attemptsMade = 3`, `opts.attempts = 4` (lần chạy thứ 4, cuối), `FailureSimulator` ném lỗi | `failOrder(orderId, message)` được gọi, lỗi được ném lại |
| UT-09 | Processor | `attemptsMade = 0` và `attemptsMade = 2`, `opts.attempts = 4`, `FailureSimulator` ném lỗi | `failOrder` **không** được gọi, lỗi được ném lại (để BullMQ retry) |
| UT-10 | `expireStaleOrders` | 2 id quá hạn, CAS lần lượt trả đơn và `null` | Trả `{ expired: 1 }`, chỉ hoàn kho cho đơn đầu tiên, mỗi đơn chạy trong một transaction riêng |
| UT-11 | `OutboxRelayService.relayBatch` | `claimBatch` trả 2 sự kiện, `enqueueProcessOrder` thành công | `enqueueProcessOrder` được gọi với từng `orderId`, `markPublished` được gọi 2 lần, trả `{ published: 2, failed: false }` |
| UT-12 | `OutboxRelayService.relayBatch` | Sự kiện 1 đẩy thành công, sự kiện 2 bị `enqueueProcessOrder` ném lỗi | Sự kiện 1 `markPublished`. Sự kiện 2 `markFailed(id, message)`, **không** `markPublished`. Dừng lô, trả `{ published: 1, failed: true }` |

Processor được test bằng cách inject `FailureSimulator` và `sleeper` giả: `{ maybeFail: jest.fn() }`, `{ sleep: jest.fn().mockResolvedValue(undefined) }`. Job giả lập là một object `{ name, data: { orderId }, attemptsMade, opts: { attempts: 4 } }`. Relay được test bằng mock `outboxRepo` (`claimBatch`, `markPublished`, `markFailed`), mock `orderQueue.enqueueProcessOrder` và `dataSource.transaction` như ở §3.

## 5. Integration test và test đồng thời

**Môi trường:** Postgres và Redis từ `docker-compose`. Dùng DB riêng `mini_oms_test` (`DATABASE_URL` trong `.env.test`). `globalSetup` chạy migration. `beforeEach` chạy `TRUNCATE order_items, notification_logs, orders, products RESTART IDENTITY CASCADE`.
App được bootstrap bằng `AppModule` (không có worker) và gọi qua `supertest(app.getHttpServer())`. Mỗi request lấy một connection riêng từ pool, nên các transaction thực sự chạy song song trên Postgres.

| Mã | Kịch bản | Kỳ vọng |
|---|---|---|
| IT-01 | Tạo sản phẩm `stock = 1`. `Promise.all` 20 × `POST /orders` (`quantity = 1`) | Đúng 1 request `201`, 19 request `409 INSUFFICIENT_STOCK`. `stock = 0`. `SELECT count(*) FROM orders = 1` |
| IT-02 | `stock = 10`, 30 request với `quantity` ngẫu nhiên 1–3 | `Σ quantity (201) ≤ 10`, `stock_cuối = 10 − Σ`, không có `5xx` |
| IT-02b | P1, P2 đều `stock = 100`. 20 request `[P1, P2]` và 20 request `[P2, P1]` chạy xen kẽ | Tất cả đều `201`, không có `503`/deadlock, mỗi `stock` giảm 40 |
| IT-03 | Một đơn `PENDING` với `quantity = 3`. 5 × `PATCH /orders/:id/cancel` đồng thời | 1 request `200`, 4 request `409`. `stock` được cộng đúng 3 |
| IT-01b | Sau IT-01: đếm `outbox_events` | Đúng 1 sự kiện `ORDER_CREATED`, khớp với đơn được tạo. Các request `409` không để lại sự kiện nào |
| IT-04 | Gọi `enqueueProcessOrder(orderId)` 3 lần (mô phỏng relay đẩy lại) | `queue.getJobCounts()` cho thấy 1 job. `getJob('order-<id>')` tồn tại |
| IT-05 | Tạo đơn khi `OrderQueueProducer` bị override để ném lỗi (mô phỏng Redis chết), rồi gọi `relayBatch()`. Sau đó gỡ lỗi và gọi `relayBatch()` lần nữa | `POST /orders` vẫn `201`. Lần relay đầu: sự kiện còn `published_at IS NULL`, `publish_attempts = 1`, có `last_error`. Lần relay sau: sự kiện được đánh dấu `published_at` |

IT-01..03 không cần Redis, vì `POST /orders` và hủy đơn không gọi Redis. IT-04 dùng Redis thật với `prefix` riêng cho test, và `queue.obliterate({ force: true })` sau mỗi test.

## 6. Kịch bản test thủ công

Chạy API và worker local ([08 §2](08-deployment.md#2-chạy-local)), thao tác qua Swagger tại `/api/docs`. Kiểm tra DB bằng `psql` hoặc DBeaver.

| Mã | Bước | Kỳ vọng |
|---|---|---|
| MT-01 | Tạo sản phẩm. Tạo lại cùng SKU (khác hoa thường). `PATCH`. `DELETE`. `GET` sản phẩm đã xóa. Tạo lại SKU vừa xóa | `201` → `409` → `200` → `204` → `404` → `201` |
| MT-02 | `GET /products` với `search`, `minPrice`, `maxPrice`, `page`, `limit`. Thử `minPrice > maxPrice`, `limit = 101` | Lọc đúng, `meta` đúng. Hai trường hợp lỗi trả `400 VALIDATION_ERROR` cùng `details` |
| MT-03 | `POST /orders` hợp lệ. Gọi `GET /orders/:id` ngay, rồi gọi lại sau khoảng 6s | `PENDING` → `CONFIRMED`. `notification_logs` có đúng 1 dòng `ORDER_CONFIRMED`. `stock` đã giảm |
| MT-04 | Khởi động worker với `JOB_FAILURE_RATE=1`. Tạo đơn, chờ khoảng 40s | Đơn `FAILED`, có `failureReason`, `stock` đã được hoàn. `GET /orders/:id/jobs`: `state = failed`, `attemptsMade = 4`, `maxAttempts = 4`, có `failedReason`, `dispatch.status = PUBLISHED` |
| MT-05 | `JOB_FAILURE_RATE=0.3`. Tạo khoảng 10 đơn, theo dõi `/jobs` và log worker | Có đơn bị retry (`state = delayed`, `failedReason` có giá trị) nhưng cuối cùng vẫn `CONFIRMED`. Khoảng cách giữa các lần retry khoảng 2s, 4s, 8s. Với `JOB_FAILURE_RATE=0` thì mọi đơn đều `CONFIRMED` ngay lần đầu |
| MT-06 | Hủy một đơn `PENDING` và một đơn `CONFIRMED`. Hủy lại lần nữa | `200` và kho được hoàn trong cả hai trường hợp. Lần hủy thứ 2 trả `409 INVALID_ORDER_STATUS` |
| MT-07 | Hủy đơn `FAILED`. `GET /orders/<uuid-không-tồn-tại>`. `GET /orders/abc` | `409`, `404 ORDER_NOT_FOUND`, `400 VALIDATION_ERROR` |
| MT-08 | Với một đơn đã `CONFIRMED`: xóa job cũ và đẩy lại job `order-<id>` bằng script dev (hoặc qua Redis CLI / Bull Board) | Job `completed` với `returnValue.skipped = true`. Số dòng `notification_logs` của đơn vẫn là 1 |
| MT-09 | Tắt worker. Tạo đơn (sự kiện outbox chưa được đẩy). Chạy `UPDATE orders SET created_at = now() - interval '31 minutes' WHERE id = '<id>'`. Chạy `npm run job:expire-now`. Bật worker lại | Đơn `CANCELLED`, `cancelReason = EXPIRED`, kho đã hoàn. Khi worker bật lại, relay đẩy job, và job `process-order` của đơn này bị bỏ qua (`skipped`) |
| MT-10 | Trên bản deploy: mở `/api/docs`, gọi vài endpoint, gọi `/health`, tạo đơn và chờ `CONFIRMED` | Swagger hiển thị đủ. Lỗi trả đúng định dạng. Worker trên Railway đẩy và xử lý được job của đơn tạo qua API trên Vercel |
| MT-11 | `docker compose stop redis`. Tạo đơn. Kiểm tra `outbox_events`. `docker compose start redis`, chờ vài giây | `POST /orders` vẫn `201`. Sự kiện có `published_at IS NULL`, `publish_attempts` tăng dần, có `last_error`. Log worker cho thấy chu kỳ quét giãn dần. Sau khi Redis chạy lại: sự kiện được đẩy, đơn chuyển `CONFIRMED` |

Truy vấn kiểm tra nhanh:

```sql
SELECT id, status, cancel_reason, failure_reason, created_at FROM orders ORDER BY created_at DESC LIMIT 10;
SELECT order_id, type, count(*) FROM notification_logs GROUP BY order_id, type HAVING count(*) > 1;  -- phải rỗng
SELECT id, sku, stock FROM products WHERE stock < 0;                                                   -- phải rỗng
SELECT id, aggregate_id, publish_attempts, last_error, created_at FROM outbox_events WHERE published_at IS NULL; -- tồn đọng
```

## 7. Lệnh chạy và tiêu chí đạt

| Lệnh | Mô tả |
|---|---|
| `npm test` | Unit test |
| `npm run test:cov` | Unit test kèm coverage |
| `npm run test:e2e` | Integration/đồng thời (cần `docker compose up -d`) |

**Tiêu chí đạt:** UT-01..03 bắt buộc pass. Việc đưa test e2e (IT) vào phạm vi bắt buộc đang chờ duyệt ([ADR-028](10-technical-decisions.md#adr-028-phạm-vi-bổ-sung)). Toàn bộ test hiện có pass. IT-01 pass. Mục tiêu coverage `orders.service.ts` ≥ 80% line (không bắt buộc). README liệt kê test nào đã có và test nào chưa làm.
