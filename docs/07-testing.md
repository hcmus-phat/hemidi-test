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

Code thật:

| File | Nội dung |
|---|---|
| `src/orders/orders.service.spec.ts` | UT-01..UT-06, UT-10. Thêm: `expireStaleOrders` đi tiếp khi một đơn lỗi và không làm gì khi không có đơn quá hạn, `confirmOrder` ghi thông báo sau CAS và trong cùng transaction, `failOrder` cắt `failure_reason` dài, `getOrderJobs` (`404` không đọc Redis, lỗi Redis thành `503`) |
| `src/queue/order-processing.processor.spec.ts` | UT-07 (với `CONFIRMED`, `CANCELLED`, `FAILED`), UT-08, UT-09. Thêm: thời gian xử lý nằm trong `[MIN, MAX]`, CAS thua sau khi sleep thì `skipped`, đơn không tồn tại thì `UnrecoverableError` (không sleep, không `failOrder`, kể cả ở lần cuối), tên job lạ thì `UnrecoverableError`, lỗi DB ở lần cuối cũng gọi `failOrder` (khi xác nhận và khi đọc trạng thái; lỗi đọc trạng thái trước lần cuối chỉ được ném lại), `failOrder` lỗi thì vẫn ném lỗi gốc, 4 lần thử chỉ bù trừ 1 lần, `concurrency` lấy từ config, `worker.close()` khi module bị hủy, bảng `isFinalAttempt` |
| `src/outbox/outbox-relay.service.spec.ts` | UT-11, UT-12. Thêm: id đơn lấy từ `aggregateId` nên sự kiện có payload sai (thiếu `orderId`, `orderId` không phải UUID, payload `null`) vẫn được đẩy và không bị `markFailed`, chu kỳ quét (Jest fake timers): quét ngay khi khởi động rồi mỗi `OUTBOX_POLL_INTERVAL_MS`, giãn 2s → 4s → 5s (trần) khi lỗi và quay về chu kỳ thường sau khi thành công, lô đầy thì quét lại sau 1ms (`setTimeout(0)` gọi từ một timer chạy sau 1ms), dừng thì không quét nữa, `onModuleDestroy` chờ lô đang chạy |
| `src/queue/order-jobs.scheduler.spec.ts` | `upsertJobScheduler('expire-pending-orders', { every }, …)` đúng tham số, không chặn khởi động khi Redis không trả lời, lỗi chỉ ghi log |
| `src/queue/order-queue.producer.spec.ts`, `redis-connection.spec.ts`, `failure-simulator.spec.ts` | Option của job (`jobId`, `attempts`, `backoff`, `removeOn*`), timeout Redis, parse `REDIS_URL`, option kết nối theo vai trò, xác suất lỗi giả lập |

Các processor và relay được tạo trực tiếp bằng `new` với các dependency giả. `Logger` của Nest được `jest.spyOn(...).mockImplementation()` để output test gọn.

## 5. Integration test và test đồng thời

**Môi trường:** Postgres và Redis từ `docker-compose`. Dùng DB riêng `mini_oms_test` (`DATABASE_URL` trong `.env.test`). `globalSetup` chạy migration. `beforeEach` chạy `TRUNCATE outbox_events, notification_logs, order_items, orders, products RESTART IDENTITY CASCADE`.
App được bootstrap bằng `AppModule` (không có worker) và gọi qua `supertest(app.getHttpServer())`. Mỗi request lấy một connection riêng từ pool, nên các transaction thực sự chạy song song trên Postgres.

Hiện thực (`npm run test:e2e` = `jest --config test/jest-e2e.config.js --runInBand`):

| File | Nội dung |
|---|---|
| `.env.test` | Được commit vì chỉ chứa giá trị mặc định của docker-compose, không có secret. Liệt kê **mọi** biến để giá trị trong `.env` của người dev không lọt vào test (biến môi trường thật vẫn được ưu tiên, giống app). `DATABASE_POOL_MAX=40`: mỗi request đồng thời (IT-02b gửi 40) có connection riêng. `DB_LOCK_TIMEOUT_MS=60000`: test kiểm tra thứ tự khóa chứ không kiểm tra timeout. Postgres vẫn phát hiện deadlock sau `deadlock_timeout` (1s) bất kể giá trị này, còn timeout ngắn có thể bị kích hoạt sai khi đồng hồ máy ảo Docker nhảy (đã gặp, khoảng 14s) |
| `test/jest-e2e.config.js` | Dùng lại `transform` và `transformIgnorePatterns` của `jest.config.js` (các gói `@nestjs/*` 12 chỉ có ES module). `globalSetup`, `setupFiles` (nạp `.env.test` trước mỗi file test), `testTimeout` 30s |
| `test/e2e/global-setup.ts` | Kiểm tra tên DB kết thúc bằng `_test` (test xóa sạch dữ liệu nên không bao giờ chạy trên DB dev). Tạo DB nếu chưa có (volume tạo trước khi có `docker/postgres/init`), rồi chạy migration với cùng option như CLI |
| `test/e2e/test-app.ts` | `createTestApp()`: `AppModule` cùng `configureApp()`, lắng nghe một cổng ngẫu nhiên trong suốt file test (nếu không, supertest bật/tắt server quanh mỗi lô request). `resetDatabase()`, các hàm gọi API và đọc DB |
| `test/e2e/relay-testing-module.ts` | Phía worker của outbox, không có vòng lặp nền: `OutboxRelayService`, queue và producer, kết nối Redis như worker nhưng với prefix `mini-oms-e2e`. Module chỉ `compile()` (không `init()`), nên hook `onApplicationBootstrap` không chạy và vòng quét của relay không khởi động. Không có processor nên không có BullMQ `Worker` |
| `test/concurrency.e2e-spec.ts` | IT-01, IT-01b, IT-02, IT-02b, IT-03 (chỉ cần Postgres) |
| `test/outbox-relay.e2e-spec.ts` | IT-04, IT-05 (Postgres và Redis) |

Mỗi file đóng app, `DataSource` và kết nối Redis trong `afterAll`, nên Jest tự thoát mà không cần `--forceExit`.

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

Kiểm tra cụ thể trong code:

- **IT-01:** số lượng status phải đúng `{ 201: 1, 409: 19 }` (không có status nào khác). Mọi `409` đều có `details: [{ productId, requested: 1, available: 0 }]`, tức là bị từ chối bởi bước kiểm tra tồn kho của `OrdersService` (dưới khóa dòng), không phải bởi `CHECK` của DB (lỗi đó không có `details`). `stock = 0`, `orders` và `order_items` mỗi bảng 1 dòng.
- **IT-01b:** chạy lại kịch bản IT-01 (vì `beforeEach` xóa dữ liệu), `outbox_events` có đúng 1 dòng: `ORDER`, `aggregate_id` là id đơn `201`, `payload = { orderId }`, `published_at = null` (API không chạy relay).
- **IT-02:** `quantity` ngẫu nhiên. Chỉ có `201`/`409`. Ngoài `Σ ≤ 10` và `stock_cuối = 10 − Σ`, số đơn trong DB bằng số `201`, và mọi đơn bị từ chối đều xin nhiều hơn `stock_cuối` (tồn kho chỉ giảm, nên không có đơn nào bị từ chối oan).
- **IT-02b:** 40 request xen kẽ `[P1, P2]` / `[P2, P1]`, đúng `{ 201: 40 }`, mỗi `stock` còn 60.
- **IT-03:** `{ 200: 1, 409: 4 }`, các `409` là `INVALID_ORDER_STATUS` (`Order cannot be cancelled in status CANCELLED`), `stock` về đúng giá trị trước khi đặt, đơn `CANCELLED` / `CUSTOMER_REQUEST`.
- **IT-04:** gọi `enqueueProcessOrder` 3 lần cho cùng một id. `getJobCounts()` chỉ có `waiting: 1`. Job `order-<id>` có `name = process-order`, `data = { orderId }`, `opts.attempts = 4`.
- **IT-05:** `jest.spyOn(producer, 'enqueueProcessOrder').mockRejectedValue(...)` mô phỏng Redis chết. `POST /orders` vẫn `201` và kho đã trừ. `relayBatch()` lần đầu trả `{ published: 0, failed: true }`, sự kiện có `published_at = null`, `publish_attempts = 1`, `last_error` là lỗi Redis, chưa có job. Gỡ spy (`mockRestore`), `relayBatch()` trả `{ published: 1, failed: false }`, `published_at` có giá trị, `publish_attempts = 2`, `last_error` được giữ lại, job `order-<id>` có trong queue.

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
| MT-08 | Với một đơn đã `CONFIRMED` (worker đang chạy): `npm run job:requeue -- <orderId>` (xóa job `order-<id>` rồi đẩy lại), rồi `GET /orders/:id/jobs` | Job `completed` với `returnValue = { skipped: true, reason: 'Order is CONFIRMED' }`. Số dòng `notification_logs` của đơn vẫn là 1 |
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
| `npm run test:e2e` | Integration/đồng thời (cần `docker compose up -d`): `jest --config test/jest-e2e.config.js --runInBand` |
| `npm run race:last-item -- [baseUrl] [N]` | Script thủ công [06 §9](06-concurrency.md#9-kiểm-chứng): N đơn đồng thời cho sản phẩm `stock = 1` trên một API đang chạy |

**Tiêu chí đạt:** UT-01..03 bắt buộc pass. Test e2e IT-01..IT-05 nằm trong phạm vi ([ADR-028](10-technical-decisions.md#adr-028-phạm-vi-bổ-sung), đã duyệt) và phải pass với `docker compose up -d`. Toàn bộ test hiện có pass. Mục tiêu coverage `orders.service.ts` ≥ 80% line (không bắt buộc). README liệt kê test nào đã có và test nào chưa làm.
