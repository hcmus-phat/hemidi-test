# 09 — Kế hoạch thực hiện

## 1. Nguyên tắc ưu tiên

1. **Làm chắc phần 1–3 trước** (Products, Orders, Queue). Đề ghi rõ "nộp thiếu vẫn hơn bỏ trống".
2. **Đúng trước, đủ sau:** chống bán vượt, idempotency, retry quan trọng hơn số lượng tính năng.
3. **Luôn chạy được:** mỗi commit đều build được và không làm hỏng test.
4. **Hiểu từng dòng:** không thêm code mà mình không giải thích được khi phỏng vấn.

## 2. Lộ trình theo giai đoạn

Ước lượng thời gian chỉ để tham khảo, tổng khoảng 4 ngày làm việc (bao gồm Outbox, [ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox)).

### Giai đoạn 0: Khởi tạo nền tảng (~0.5 ngày)

- [ ] Scaffold NestJS, ESLint, Prettier, `tsconfig` có `emitDecoratorMetadata`
- [ ] `docker-compose.yml` (Postgres 16, Redis 7 với `noeviction`) và `.env.example`
- [ ] `@nestjs/config`: `configuration.ts` và validate env
- [ ] TypeORM: `typeorm.options.ts`, `data-source.ts`, script migration, `synchronize: false`
- [ ] `common/`: `ErrorCode`, `AppException`, `AllExceptionsFilter` (ánh xạ lỗi Postgres), `exceptionFactory` cho `ValidationPipe`
- [ ] `common/`: `PaginationQueryDto`, `PaginatedResponseDto`, `BigIntTransformer`
- [ ] `configure-app.ts`: pipe, filter, Swagger tại `/api/docs`

### Giai đoạn 1: Products (~0.5 ngày) → FR-P01..P06

- [ ] Migration `CreateProducts` (CHECK, partial unique SKU, index)
- [ ] Entity `Product` (`@DeleteDateColumn`, `price` kiểu `bigint` với `BigIntTransformer`)
- [ ] DTO: create (trim, chữ in hoa cho SKU, `price` dùng `@IsInt()`), update (`PartialType`), query (chuyển chuỗi số sang number bằng `toNumberIfDecimal`, chuỗi rỗng bị từ chối, kiểm tra `minPrice ≤ maxPrice`)
- [ ] `ProductsService` và `ProductsController` (CRUD, xóa mềm, `ILIKE` có escape, phân trang)
- [ ] Swagger: `@ApiProperty` kèm ví dụ, response lỗi
- [ ] Test thủ công MT-01, MT-02

### Giai đoạn 2: Orders (~1 ngày) → FR-O01..O05

- [ ] Migration `CreateOrders` (enum, `orders`, `order_items`, FK, CHECK, index)
- [ ] Entity `Order`, `OrderItem`, enum `OrderStatus`, `CancelReason`
- [ ] `ProductStockRepository`: `findActiveForUpdate`, `decrementStock`, `incrementStock`
- [ ] `OrdersRepository`: `insertWithItems`, `transitionStatus` (CAS), `findStatus`, `findItemsForRelease`, `findByIdWithItems`, phân trang
- [ ] Migration `CreateOutboxEvents`, entity `OutboxEvent`, `OutboxRepository.add`
- [ ] `OrdersService.create`: transaction, `lock_timeout`, khóa và kiểm tra, trừ kho, snapshot, tính tổng (số nguyên VND), ghi `outbox_events` **trong cùng transaction**
- [ ] `GET /orders`, `GET /orders/:id`
- [ ] `OrdersService.cancel` và `releaseStock`
- [ ] **UT-01, UT-02, UT-03** (bắt buộc), UT-04, UT-05

### Giai đoạn 3: Queue, outbox relay và worker (~1.5 ngày) → FR-Q01..Q05, FR-O06

- [ ] `QueueModule`: `BullModule.forRootAsync` (parse `REDIS_URL`, TLS), `registerQueue('order-processing')`
- [ ] `queue.constants.ts`: tên queue, `OrderJobName`, `buildOrderJobId`
- [ ] `OrderQueueProducer.enqueueProcessOrder` (`jobId`, `attempts = 4`, `backoff`, `removeOn*`) và `getOrderJobs`
- [ ] Migration `CreateNotificationLogs`, entity, `NotificationsRepository.insertIfAbsent`
- [ ] `worker.ts`, `WorkerModule` (tách khỏi `AppModule`), `enableShutdownHooks`
- [ ] `OutboxRepository`: `claimBatch` (`FOR UPDATE SKIP LOCKED`), `markPublished`, `markFailed`, `findByAggregate`
- [ ] `OutboxRelayService`: vòng lặp quét, đẩy job, giãn chu kỳ khi lỗi, dừng gọn khi shutdown. UT-11, UT-12
- [ ] `FailureSimulator`, `sleeper` dưới dạng provider
- [ ] `OrderProcessingProcessor`: guard trạng thái, sleep, lỗi giả lập, `confirmOrder`, phát hiện lần thử cuối và `failOrder`
- [ ] `OrdersService.confirmOrder`, `failOrder` (CAS cùng tác dụng phụ trong một transaction)
- [ ] `GET /orders/:id/jobs` (kèm `dispatch` từ outbox)
- [ ] UT-06..UT-09, MT-03..MT-05, MT-08, MT-11

### Giai đoạn 4: Điểm cộng, job hủy đơn quá hạn (~0.25 ngày) → FR-Q06

- [ ] `OrderJobsScheduler`: `upsertJobScheduler('expire-pending-orders', { every })`
- [ ] `OrdersService.expireStaleOrders` (theo lô, mỗi đơn một transaction)
- [ ] Script `job:expire-now`, UT-10, MT-09

### Giai đoạn 5: Kiểm thử đồng thời (~0.5 ngày) → NFR-01 *(trong phạm vi theo [ADR-028](10-technical-decisions.md#adr-028-phạm-vi-bổ-sung))*

- [ ] Hạ tầng e2e: `.env.test`, migration trong `globalSetup`, truncate trong `beforeEach`
- [ ] IT-01, IT-01b, IT-02, IT-02b, IT-03, IT-04, IT-05
- [ ] `src/scripts/race-last-item.ts` (`npm run race:last-item`), và thử bỏ khóa để thấy bán vượt (ghi kết quả vào [06 §9](06-concurrency.md#9-kiểm-chứng) và README)

### Giai đoạn 6: Deploy (~0.5 ngày) → D-02, D-03

- [ ] Neon: tạo DB, lấy pooled URL và direct URL. Chạy migration
- [ ] Redis Cloud: tạo DB, đặt `noeviction`, lấy `rediss://` URL
- [ ] `src/vercel.ts`, `api/index.js`, `vercel.json`, Swagger lấy asset từ CDN. Deploy Vercel
- [ ] Railway: deploy worker, khai báo env, pre-deploy migration
- [ ] Smoke test ([08 §7](08-deployment.md#7-smoke-test-sau-khi-deploy)), MT-10

### Giai đoạn 7: README và hoàn thiện (~0.25 ngày) → D-04

- [ ] README theo §5 bên dưới
- [ ] Rà lại lỗi, log, tên biến, xóa code thừa
- [ ] Cập nhật mục "Phần chưa làm được"

## 3. Kế hoạch commit

Quy ước: [Conventional Commits](https://www.conventionalcommits.org/), câu mệnh lệnh, tiêu đề ≤ 72 ký tự, mỗi commit một thay đổi logic, mỗi commit đều build được. Body giải thích **vì sao** nếu không hiển nhiên.

| # | Commit message |
|---|---|
| 1 | `chore: scaffold NestJS project with ESLint and Prettier` |
| 2 | `chore: add docker-compose for Postgres and Redis` |
| 3 | `feat(config): load and validate environment variables` |
| 4 | `feat(database): configure TypeORM data source and migration scripts` |
| 5 | `feat(common): add unified error response and global validation pipe` |
| 6 | `feat(common): add pagination DTOs and bigint transformer` |
| 7 | `feat(docs): set up Swagger at /api/docs` |
| 8 | `feat(products): add products migration and entity` |
| 9 | `feat(products): implement CRUD endpoints with soft delete` |
| 10 | `feat(products): support name search, price filters and pagination` |
| 11 | `feat(orders): add orders and order_items migration and entities` |
| 12 | `feat(outbox): add outbox_events table and repository` |
| 13 | `feat(orders): create order with row locking and an outbox event` |
| 14 | `feat(orders): add list and detail endpoints` |
| 15 | `feat(orders): cancel order and release stock` |
| 16 | `test(orders): cover create, insufficient stock and cancel` |
| 17 | `feat(queue): register order-processing queue and producer` |
| 18 | `feat(notifications): add notification_logs table and repository` |
| 19 | `feat(worker): add worker entry point and outbox relay` |
| 20 | `feat(worker): process orders with simulated failures and retries` |
| 21 | `feat(worker): mark order failed and release stock after last attempt` |
| 22 | `feat(orders): expose job and dispatch status at GET /orders/:id/jobs` |
| 23 | `test(worker): cover relay, idempotency and final-attempt handling` |
| 24 | `feat(worker): expire stale pending orders every 5 minutes` |
| 25 | `test(e2e): verify last-item race, concurrent cancel and outbox recovery` |
| 26 | `feat(health): add database and redis health check` |
| 27 | `chore(deploy): add Vercel serverless handler and config` |
| 28 | `docs: write README with setup, design and deployment notes` |

Commit 13 là commit quan trọng nhất. Body nên giải thích ngắn: dùng `FOR UPDATE`, `ORDER BY id`, và ghi outbox trong cùng transaction. Commit 19 nên giải thích tính at-least-once của relay, và vì sao `jobId` cố định làm cho việc đẩy lại trở nên an toàn.

## 4. Definition of Done (mỗi tính năng)

- [ ] Đáp ứng mọi tiêu chí chấp nhận trong [01](01-requirements.md)
- [ ] `npm run build`, `npm run lint`, `npm test` đều pass
- [ ] Input được validate bằng DTO. Lỗi trả đúng định dạng thống nhất với mã lỗi đúng
- [ ] Swagger mô tả request, response và các mã lỗi
- [ ] Thay đổi schema đi qua migration có `down`
- [ ] Không có I/O ngoài DB bên trong transaction (ngoại lệ duy nhất: relay outbox, [ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox))
- [ ] Quyết định mới hoặc thay đổi quyết định được ghi vào [10](10-technical-decisions.md)
- [ ] Tự giải thích được từng dòng code mới

## 5. Cấu trúc README nộp bài

README là thứ người chấm đọc đầu tiên. Nội dung nên ngắn và trỏ sang `docs/` cho phần chi tiết.

```markdown
# Mini Order Management
Link API · Link Swagger (/api/docs) · Link repo

## Tính năng chính
## Kiến trúc (sơ đồ API, Worker, Postgres, Redis)
## Chạy local                       ← bắt buộc
## Biến môi trường
## Mô tả bảng dữ liệu               ← bắt buộc
## Luồng xử lý đơn và job           ← bắt buộc (máy trạng thái, retry/backoff, idempotency, job hết hạn)
## Chống bán vượt tồn kho           ← bắt buộc (FOR UPDATE, thứ tự khóa, CHECK, kết quả test đồng thời)
## Deploy worker và lý do           ← bắt buộc (vì sao không chạy trên Vercel, vì sao chọn Railway)
## Kiểm thử (lệnh chạy, test đã có)
## Giả định và quyết định kỹ thuật  (tóm tắt, link sang docs/10-technical-decisions.md)
## Phần chưa làm được / hướng cải tiến   ← bắt buộc
```

## 6. Phần chưa làm được và hướng cải tiến

Mẫu bảng để điền khi nộp (ghi trung thực):

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Products, Orders, Queue (phần 1–3) | ✅ / ⚠️ / ❌ | |
| Job hủy đơn quá hạn (bonus) | | |
| Unit test (UT-01..03 và bổ sung) | | |
| Test đồng thời (IT-01..05) | | |
| Transactional Outbox và relay | | |
| Deploy API và worker | | |

Hướng cải tiến (ngoài phạm vi, nên nêu để thể hiện hiểu biết):

| Cải tiến | Giải quyết vấn đề |
|---|---|
| Header `Idempotency-Key` cho `POST /orders` | Client gửi lại do timeout không tạo đơn trùng |
| Endpoint điều chỉnh tồn kho theo delta hoặc khóa lạc quan | Tránh ghi đè `stock` khi quản trị viên `PATCH` (A-13, [ADR-022](10-technical-decisions.md#adr-022-patch-stock-là-giá-trị-tuyệt-đối)) |
| Dọn `outbox_events` đã đẩy | Giữ bảng outbox nhỏ (xóa các dòng đã đẩy quá N ngày) |
| `LISTEN/NOTIFY` cho relay | Giảm độ trễ và số lần quét so với polling mỗi giây |
| Bull Board | Quan sát queue trực quan |
| Xác thực và phân quyền (admin cho `/products`) | Bảo mật |
| CI (GitHub Actions có service Postgres/Redis) | Chạy unit và e2e test tự động |
| Log có cấu trúc (pino) kèm correlation id | Truy vết một đơn từ API sang worker |

## 7. Checklist nộp bài

- [ ] Repo public (hoặc đã cấp quyền), lịch sử commit nhỏ và rõ ràng
- [ ] Link API đã deploy, `/api/docs` hoạt động
- [ ] Worker đã deploy và xử lý được đơn thật trên bản deploy
- [ ] README có đủ 6 mục bắt buộc ở §5
- [ ] `.env.example` có đủ biến, không lộ secret
- [ ] `docker compose up -d`, `npm run migration:run`, `npm run start:dev` chạy được trên máy sạch
- [ ] `npm test` pass

## 8. Chuẩn bị phỏng vấn

| Câu hỏi có thể gặp | Ý trả lời chính | Tham chiếu |
|---|---|---|
| Vì sao trừ kho khi tạo đơn chứ không phải trong job? | Đề yêu cầu một transaction. Khách biết hết hàng ngay. Job retry không bao giờ đụng tới kho | [05 §1](05-order-processing.md#1-tổng-quan) |
| `SELECT … FOR UPDATE` hoạt động thế nào? Vì sao `READ COMMITTED` đủ? | Khóa dòng, bên sau phải chờ. Sau khi chờ, Postgres đọc lại phiên bản mới nhất và đánh giá lại `WHERE` | [06 §4.4](06-concurrency.md#44-vì-sao-read-committed-là-đủ) |
| Bỏ khóa thì chuyện gì xảy ra? | Trừ kho tương đối nên không mất cập nhật, nhưng nhiều request cùng qua bước kiểm tra và `CHECK (stock >= 0)` phải chặn (409 không có `details`). Bỏ cả `CHECK` thì 20 đơn cho 1 món, `stock = -19`. Đã thử bằng script | [06 §2](06-concurrency.md#2-minh-họa-race-condition-khi-không-khóa), [06 §9.2](06-concurrency.md#92-thí-nghiệm-bỏ-khóa) |
| Deadlock xảy ra khi nào, tránh thế nào? | Hai đơn khóa các sản phẩm theo thứ tự ngược nhau. Giải pháp: luôn khóa theo `id` tăng dần | [06 §5](06-concurrency.md#5-chống-deadlock) |
| Vì sao dùng Outbox mà không đẩy job thẳng? Redis chết thì sao? | Đẩy trong transaction thì worker có thể đọc đơn chưa commit. Đẩy sau commit thì có thể mất job. Outbox ghi đơn và sự kiện nguyên tử. Redis chết thì sự kiện chờ trong outbox, relay đẩy lại sau | [05 §3.3](05-order-processing.md#33-vì-sao-chọn-outbox), [ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox) |
| Relay đẩy trùng thì sao? | Relay là at-least-once. `jobId` cố định khiến BullMQ bỏ qua bản trùng, cộng thêm guard trạng thái và CAS phía sau | [05 §6](05-order-processing.md#6-idempotency) |
| Job chạy 2 lần thì sao? | 4 lớp: `jobId` cố định, guard trạng thái, CAS trong transaction, ràng buộc UNIQUE | [05 §6](05-order-processing.md#6-idempotency) |
| `attempts: 4` và backoff exponential tính thế nào? | Lần đầu và 3 retry (hiểu "retry 3 lần" theo nghĩa đen). Delay `2000 × 2^(n−1)`, tức 2s, 4s, 8s. Xác suất FAILED là 0.3⁴ ≈ 0.81% | [05 §4](05-order-processing.md#4-retry--backoff), [ADR-001](10-technical-decisions.md#adr-001-số-lần-chạy-job-và-backoff) |
| Vì sao bù trừ trong processor mà không dùng event `failed`? | Event không được `await` và chạy sau khi job đã `failed`. Crash ở giữa sẽ mất bước bù trừ | [05 §5](05-order-processing.md#5-xử-lý-job-process-order) |
| Khách hủy đúng lúc job đang xác nhận? | CAS trên dòng `orders`: chỉ một bên thắng. Cả hai thứ tự đều hợp lệ, kho chỉ hoàn một lần | [05 §8](05-order-processing.md#8-bảng-tình-huống-race) |
| Scale worker lên 3 instance có sao không? | BullMQ khóa từng job. Scheduler upsert theo id cố định. CAS bảo vệ DB | [02 §2](02-architecture.md#2-hai-tiến-trình-một-codebase) |
| Vì sao không chạy worker trên Vercel? | Function không sống lâu, không gia hạn lock được, backoff và scheduler cần tiến trình chạy liên tục | [08 §5.1](08-deployment.md#51-vì-sao-không-chạy-worker-trên-vercelnetlify) |
| Vì sao lưu tiền bằng `bigint`? | VND không có đơn vị lẻ, nên số nguyên loại bỏ sai số dấu phẩy động. Có giới hạn DTO để tổng luôn nằm trong vùng safe integer của JS | [03 §5](03-database.md#5-xử-lý-tiền-tệ), [ADR-007](10-technical-decisions.md#adr-007-kiểu-dữ-liệu-tiền) |
| Vì sao lưu snapshot tên và giá trong `order_items`? | Đơn là dữ liệu lịch sử. Giá hoặc sản phẩm có thể đổi hay bị xóa mềm sau đó | [03 §2.3](03-database.md#23-order_items) |
| Partial unique index là gì? | Index unique chỉ áp dụng cho các dòng `deleted_at IS NULL`, nên SKU dùng lại được sau khi xóa mềm | [03 §3](03-database.md#3-index) |
| Unit test có chứng minh được việc chống bán vượt không? | Không, vì khóa nằm ở DB. Phải có integration test với Postgres thật (IT-01) | [07 §1](07-testing.md#1-chiến-lược) |
