# 10 — Nhật ký quyết định kỹ thuật (ADR)

> Cập nhật: 2026-10-14 · Phạm vi: toàn bộ bộ tài liệu `docs/01`–`09`

File này ghi lại **mọi quyết định kỹ thuật** của dự án: chọn gì, vì sao chọn, đã cân nhắc những phương án nào và hệ quả ra sao. Khi một quyết định thay đổi, hãy cập nhật ADR tương ứng trước, rồi mới sửa các tài liệu chi tiết.

## Trạng thái

| Trạng thái | Ý nghĩa |
|---|---|
| **Đã duyệt** | Người làm bài đã chọn trực tiếp trong buổi rà soát ngày 2026-10-14 |
| **Mặc định** | Phương án kỹ thuật được đề xuất, không có tranh luận đáng kể. Có thể mở lại nếu có lý do mới |
| **Chờ duyệt** | Chưa chốt. Các tài liệu khác đang dùng phương án đề xuất tạm thời |

## Bảng tổng hợp

| ID | Chủ đề | Lựa chọn | Trạng thái |
|---|---|---|---|
| [ADR-001](#adr-001-số-lần-chạy-job-và-backoff) | Số lần chạy job | `attempts = 4` (lần đầu + 3 retry), backoff 2s → 4s → 8s | Đã duyệt |
| [ADR-002](#adr-002-chống-bán-vượt-tồn-kho) | Chống bán vượt | `SELECT … FOR UPDATE` theo thứ tự `id` | Đã duyệt |
| [ADR-003](#adr-003-đẩy-job-qua-transactional-outbox) | Đẩy job khi tạo đơn | Transactional Outbox, relay chạy trong worker | Đã duyệt |
| [ADR-004](#adr-004-trạng-thái-của-đơn-hết-hạn) | Đơn hết hạn | `CANCELLED` với `cancel_reason = EXPIRED` | Đã duyệt |
| [ADR-005](#adr-005-nơi-chạy-worker) | Nơi chạy worker | Railway | Đã duyệt |
| [ADR-006](#adr-006-redis-production) | Redis production | Redis Cloud (free), `noeviction` | Đã duyệt |
| [ADR-007](#adr-007-kiểu-dữ-liệu-tiền) | Kiểu tiền | `bigint`, đơn vị VND | Đã duyệt |
| [ADR-008](#adr-008-khóa-chính) | Khóa chính | UUID (riêng `outbox_events` dùng `bigint identity`) | Đã duyệt |
| [ADR-009](#adr-009-quy-tắc-duy-nhất-của-sku) | SKU duy nhất | Partial unique trên sản phẩm chưa xóa, chuẩn hóa chữ in hoa | Đã duyệt |
| [ADR-010](#adr-010-productid-trùng-trong-một-đơn) | `productId` trùng trong đơn | Từ chối `400` | Đã duyệt |
| [ADR-011](#adr-011-định-dạng-lỗi-và-ngôn-ngữ-thông-báo) | Định dạng và ngôn ngữ lỗi | Một định dạng chung, `message` tiếng Anh | Đã duyệt |
| [ADR-012](#adr-012-thời-điểm-trừ-kho) | Thời điểm trừ kho | Khi tạo đơn, không trừ trong job | Mặc định |
| [ADR-013](#adr-013-chống-deadlock) | Chống deadlock | Khóa `products` theo `id` tăng dần ở mọi luồng | Mặc định |
| [ADR-014](#adr-014-mức-cô-lập-và-thời-gian-chờ-khóa) | Mức cô lập | `READ COMMITTED` + `lock_timeout` 5s | Mặc định |
| [ADR-015](#adr-015-chuyển-trạng-thái-bằng-cas) | Chuyển trạng thái đơn | CAS (`UPDATE … WHERE status = ANY(...)`), tác dụng phụ trong cùng transaction | Mặc định |
| [ADR-016](#adr-016-jobid-cố-định) | Định danh job | `jobId = order-{orderId}` | Mặc định |
| [ADR-017](#adr-017-bù-trừ-ở-lần-thử-cuối) | Bù trừ khi job thất bại | Thực hiện trong processor ở lần thử cuối | Mặc định |
| [ADR-018](#adr-018-lưu-thông-báo) | Thông báo | Bảng `notification_logs`, `UNIQUE(order_id, type)` | Mặc định |
| [ADR-019](#adr-019-job-hủy-đơn-quá-hạn) | Job hủy đơn quá hạn | Job scheduler 5 phút, mỗi đơn một transaction | Mặc định |
| [ADR-020](#adr-020-snapshot-sản-phẩm-trong-đơn) | Snapshot trong `order_items` | Lưu `product_sku`, `product_name`, `unit_price` | Mặc định |
| [ADR-021](#adr-021-mã-lỗi-thiếu-hàng) | Mã lỗi thiếu hàng | `409 INSUFFICIENT_STOCK`, liệt kê mọi item thiếu | Mặc định |
| [ADR-022](#adr-022-patch-stock-là-giá-trị-tuyệt-đối) | `PATCH` `stock` | Đặt giá trị tuyệt đối (hạn chế đã biết) | Mặc định |
| [ADR-023](#adr-023-tách-hai-tiến-trình-api-và-worker) | Tiến trình | API và Worker tách riêng, chung một codebase | Mặc định |
| [ADR-024](#adr-024-postgresql-production) | Postgres production | Neon, pooled URL cho API | Mặc định |
| [ADR-025](#adr-025-cách-deploy-nestjs-lên-vercel) | Deploy NestJS lên Vercel | Build bằng `tsc`, function `require` `dist/`, Swagger lấy asset từ CDN | Mặc định |
| [ADR-026](#adr-026-chính-sách-migration) | Migration | Không `synchronize`, không tự chạy khi khởi động, chạy ở pre-deploy của Railway | Mặc định |
| [ADR-027](#adr-027-thiết-kế-để-test-được) | Khả năng test | Repository nhận `EntityManager`, inject tính ngẫu nhiên và thời gian | Mặc định |
| [ADR-028](#adr-028-phạm-vi-bổ-sung) | Phạm vi bổ sung | Làm test đồng thời e2e và `/health`. `pg_trgm` và endpoint delta để ở phần cải tiến | Đã duyệt |
| [ADR-029](#adr-029-phiên-bản-thư-viện) | Phiên bản thư viện | NestJS 12, TypeORM 1.x, BullMQ 6.x (bản ổn định mới nhất lúc bắt đầu code) | Mặc định |

---

## A. Các quyết định đã duyệt

### ADR-001: Số lần chạy job và backoff

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Bối cảnh:** Đề ghi "retry tối đa 3 lần, backoff exponential; hết 3 lần mà vẫn lỗi → FAILED". Câu này có hai cách hiểu: tổng cộng 3 lần chạy, hoặc 3 lần retry **sau** lần chạy đầu.
- **Phương án:**
  1. `attempts = 3`: lần đầu và 2 retry.
  2. `attempts = 4`: lần đầu và 3 retry.
- **Quyết định:** Phương án 2. `JOB_ATTEMPTS = 4`, `backoff = { type: 'exponential', delay: 2000 }`. Các lần retry chờ lần lượt 2s, 4s, 8s.
- **Lý do:** Hiểu "retry tối đa 3 lần" theo nghĩa đen là số lần **thử lại**.
- **Hệ quả:**
  - Trường hợp xấu nhất mất khoảng `4 × 5s + (2 + 4 + 8)s ≈ 34s` (chưa tính độ trễ của relay ≤ 1s).
  - Xác suất đơn `FAILED` với tỉ lệ lỗi 30%: `0.3⁴ ≈ 0.81%`.
  - Lần thử cuối được nhận biết khi `job.attemptsMade + 1 >= 4`. Kiểm chứng bằng MT-04: với `JOB_FAILURE_RATE=1`, đơn phải `FAILED` sau đúng 4 lần chạy.
  - README phải nêu rõ cách hiểu này, vì người chấm có thể hiểu theo phương án 1. Giá trị cấu hình được qua env.
- **Tham chiếu:** [01 A-01](01-requirements.md#6-giả-định-và-cách-hiểu-đề), [05 §4](05-order-processing.md#4-retry--backoff)

### ADR-002: Chống bán vượt tồn kho

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Bối cảnh:** Nhiều request đồng thời cùng mua món cuối cùng chỉ được tạo 1 đơn. Đây là tiêu chí được chấm nặng nhất.
- **Phương án:** (A) kiểm tra ở app không khóa (sai), (B) `UPDATE … WHERE stock >= q`, (C) `SELECT … FOR UPDATE`, (D) khóa lạc quan bằng `version`, (E) `SERIALIZABLE` + retry, (F) khóa trên Redis.
- **Quyết định:** (C). Khóa mọi sản phẩm của đơn trong **một** câu `SELECT … WHERE id IN (...) AND deleted_at IS NULL ORDER BY id FOR UPDATE`. Kiểm tra ở app, gom mọi item thiếu. Trừ kho bằng `stock = stock - q`. Thêm `CHECK (stock >= 0)` làm lớp chặn cuối.
- **Lý do:** Đúng tuyệt đối ở `READ COMMITTED`. Báo lỗi chi tiết cho mọi item. Dễ giải thích khi phỏng vấn. Khóa nằm trong DB nên đúng với bất kỳ số instance nào.
- **Hệ quả:** Các request cùng sản phẩm phải xếp hàng chờ nhau (đây là hành vi mong muốn). Phải giữ thứ tự khóa cố định (ADR-013) và transaction ngắn (ADR-003, ADR-014).
- **Tham chiếu:** [06](06-concurrency.md)

### ADR-003: Đẩy job qua Transactional Outbox

- **Trạng thái:** Đã duyệt (2026-10-14). Thay cho phương án cũ "đẩy job sau commit, nếu lỗi thì trả 201 và chờ job hết hạn dọn dẹp".
- **Bối cảnh:** Việc tạo đơn (Postgres) và đẩy job (Redis) là hai hệ thống khác nhau, không có transaction chung. Đẩy job trong transaction thì worker có thể đọc đơn chưa commit. Đẩy sau commit thì có thể mất job nếu Redis lỗi.
- **Phương án:**
  1. Trả `201`, để job hết hạn hủy đơn sau 30 phút.
  2. Trả `201`, có job đối soát đẩy lại job cho các đơn `PENDING`.
  3. **Transactional Outbox.**
  4. Bù trừ (hủy đơn, hoàn kho) và trả `503`.
- **Quyết định:** Phương án 3.
  - Transaction tạo đơn insert thêm một dòng `outbox_events` (`event_type = ORDER_CREATED`, `payload = { orderId }`). Đơn và sự kiện cùng commit hoặc cùng rollback.
  - `POST /orders` **không gọi Redis**.
  - `OutboxRelayService` chạy trong worker, quét mỗi `OUTBOX_POLL_INTERVAL_MS` (1000ms): `SELECT … WHERE published_at IS NULL ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED`. Với từng sự kiện, gọi `queue.add('process-order', …, { jobId: order-{orderId} })` rồi đặt `published_at`. Nếu lỗi, tăng `publish_attempts`, ghi `last_error`, dừng lô hiện tại và giãn chu kỳ quét (tối đa `OUTBOX_MAX_BACKOFF_MS`).
- **Lý do:** Không bao giờ mất job. Tạo đơn không phụ thuộc Redis. Đây là cách xử lý lỗi chuẩn mực, đúng với tiêu chí "xử lý lỗi/retry" được chấm điểm cao.
- **Hệ quả:**
  - Có thêm bảng `outbox_events`, `OutboxRepository` và `OutboxRelayService` (worker), cùng 3 biến env.
  - Relay đảm bảo **at-least-once**: nếu crash giữa `queue.add` và `COMMIT`, sự kiện sẽ được đẩy lại. `jobId` cố định (ADR-016) làm lần đẩy trùng thành no-op.
  - Độ trễ trước khi xử lý tăng tối đa khoảng 1s, không đáng kể so với 3–5s xử lý.
  - Transaction của relay giữ khóa dòng `outbox_events` trong lúc gọi Redis. Đây là **ngoại lệ có chủ đích** của quy tắc "không I/O ngoài DB trong transaction": chỉ khóa dòng outbox, có `SKIP LOCKED`, không đụng tới `products`/`orders`.
  - Nếu worker không chạy, đơn nằm `PENDING` cho tới khi worker chạy lại (relay đẩy job, hoặc job hết hạn hủy đơn).
  - `GET /orders/:id/jobs` trả thêm `dispatch` (trạng thái outbox) để thấy được giai đoạn "đã tạo đơn nhưng chưa vào queue".
- **Tham chiếu:** [03 §2.5](03-database.md#25-outbox_events), [05 §3](05-order-processing.md#3-luồng-tạo-đơn-và-outbox)

### ADR-004: Trạng thái của đơn hết hạn

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Phương án:** `CANCELLED` + `cancel_reason = EXPIRED`, hoặc thêm trạng thái `EXPIRED` riêng.
- **Quyết định:** `CANCELLED` với `cancel_reason = EXPIRED`. Khách tự hủy thì `cancel_reason = CUSTOMER_REQUEST`.
- **Lý do:** Giữ đúng 4 trạng thái như đề. Máy trạng thái đơn giản hơn.
- **Hệ quả:** Lọc riêng đơn hết hạn cần điều kiện thêm trên `cancel_reason` (hiện API chưa hỗ trợ lọc theo cột này).

### ADR-005: Nơi chạy worker

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Bối cảnh:** Vercel là serverless nên không giữ được tiến trình BullMQ worker, và relay outbox cần chạy liên tục.
- **Phương án:** Railway, Render Background Worker (trả phí), Fly.io, cron gọi endpoint.
- **Quyết định:** Railway. Start command `node dist/worker.js`, pre-deploy `npm run migration:run:prod`, 1 replica, không mở public domain.
- **Lý do:** Deploy thẳng từ GitHub, có pre-deploy command để chạy migration ở đúng một nơi, cấu hình ít.
- **Hệ quả:** Phát sinh chi phí sau khi hết credit dùng thử (kiểm tra chính sách hiện hành). Phải theo dõi log worker trên Railway.
- **Tham chiếu:** [08 §5](08-deployment.md#5-deploy-worker)

### ADR-006: Redis production

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Phương án:** Redis Cloud free, Railway Redis, Upstash.
- **Quyết định:** Redis Cloud gói free. Bắt buộc đặt `maxmemory-policy = noeviction` và kết nối qua TLS (`rediss://`) nếu nhà cung cấp hỗ trợ.
- **Lý do:** Giao thức TCP chuẩn mà BullMQ cần. Không bị hạn mức lệnh như Upstash, trong khi worker gửi lệnh liên tục. Độc lập với nơi chạy worker.
- **Hệ quả:** Dung lượng nhỏ, nên giữ `removeOnComplete`/`removeOnFail` theo tuổi (7/14 ngày) để không đầy bộ nhớ.

### ADR-007: Kiểu dữ liệu tiền

- **Trạng thái:** Đã duyệt (2026-10-14). Thay cho `numeric(12,2)` trong bản nháp đầu.
- **Phương án:** `numeric(12,2)`, hoặc `bigint` theo đơn vị VND.
- **Quyết định:** `bigint` VND cho `products.price`, `order_items.unit_price`, `orders.total_amount`. API nhận và trả **số nguyên**.
- **Lý do:** VND không có đơn vị lẻ. Số nguyên loại bỏ hoàn toàn sai số dấu phẩy động, và việc cộng tổng chỉ là phép cộng số nguyên.
- **Hệ quả:**
  - Driver `pg` trả `int8` dưới dạng string, nên cần `BigIntTransformer` (string sang number, kiểm tra `Number.isSafeInteger`).
  - DTO: `price` dùng `@IsInt()`, giới hạn `0 … 1_000_000_000`. Với `quantity ≤ 1000` và `≤ 50` item, tổng tối đa `5 × 10¹³`, vẫn nhỏ hơn `Number.MAX_SAFE_INTEGER ≈ 9 × 10¹⁵`.
  - Hệ thống gắn với một loại tiền. Muốn đa tiền tệ thì phải đổi schema.
- **Tham chiếu:** [03 §5](03-database.md#5-xử-lý-tiền-tệ)

### ADR-008: Khóa chính

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Quyết định:** UUID (`gen_random_uuid()`) cho `products`, `orders`, `order_items`, `notification_logs`. Riêng `outbox_events` dùng `bigint GENERATED ALWAYS AS IDENTITY` để relay quét theo đúng thứ tự ghi.
- **Lý do:** Không đoán được id, không lộ số lượng đơn, sinh ở DB, `jobId` dễ ghép.
- **Hệ quả:** Validate path param bằng `ParseUUIDPipe`. `productId` trong DTO được chuẩn hóa thành chữ thường. Thao tác thủ công trên Swagger hơi bất tiện vì id dài.

### ADR-009: Quy tắc duy nhất của SKU

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Quyết định:** Partial unique index `uq_products_sku_active ON products (sku) WHERE deleted_at IS NULL`. DTO trim và chuyển SKU thành chữ in hoa trước khi lưu.
- **Lý do:** Xóa mềm xong vẫn dùng lại được SKU, và tránh trùng do khác hoa thường.
- **Hệ quả:** Trùng SKU được phát hiện bởi DB (lỗi `23505`) và trả `409 SKU_ALREADY_EXISTS`. Không dựa vào "kiểm tra rồi insert" ở app.

### ADR-010: `productId` trùng trong một đơn

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Quyết định:** Từ chối với `400 VALIDATION_ERROR` (`@ArrayUnique` sau khi chuẩn hóa chữ thường). Không tự gộp.
- **Lý do:** Minh bạch, không che giấu lỗi ở client. Mỗi sản phẩm chỉ có một dòng `order_items` (`UNIQUE(order_id, product_id)`).

### ADR-011: Định dạng lỗi và ngôn ngữ thông báo

- **Trạng thái:** Đã duyệt (2026-10-14)
- **Quyết định:** Mọi lỗi trả `{ statusCode, error, message, details?, path, timestamp }`. `error` là mã máy đọc được (danh mục ở [04 §5](04-api-spec.md#5-danh-mục-mã-lỗi)). `message` viết bằng **tiếng Anh**.
- **Lý do:** Thống nhất với thông điệp mặc định của class-validator, đúng thông lệ khi viết API.
- **Hệ quả:** Lỗi `500 INTERNAL_ERROR` chỉ trả `Internal server error`, chi tiết ghi vào log. Lỗi `503 SERVICE_UNAVAILABLE` là lỗi tạm thời mà client nên thử lại (chờ khóa quá lâu, deadlock, Redis không kết nối được), nên trả một thông điệp ngắn, cố định do code đặt, ví dụ `The database is busy, please retry`. Thông điệp này không bao giờ chứa stack, SQL hay dữ liệu của request.

---

## B. Các quyết định mặc định

### ADR-012: Thời điểm trừ kho

- **Quyết định:** Trừ kho trong transaction tạo đơn. Job chỉ xác nhận đơn và ghi thông báo.
- **Lý do:** Đề yêu cầu "trong 1 transaction: kiểm tra tồn kho, trừ kho, tạo đơn". Khách biết hết hàng ngay. Job retry không bao giờ đụng tới kho.

### ADR-013: Chống deadlock

- **Quyết định:** Mọi luồng khóa `products` theo `id` tăng dần. Tạo đơn khóa tất cả trong một câu `ORDER BY id FOR UPDATE`. Hoàn kho đọc `order_items … ORDER BY product_id` rồi `UPDATE` lần lượt, không dùng `UPDATE … FROM`. Các luồng chạm cả `orders` lẫn `products` đều khóa `orders` trước.
- **Hệ quả:** Không có chu trình chờ. Nếu vẫn gặp `40P01` thì trả `503` và log `ERROR`.

### ADR-014: Mức cô lập và thời gian chờ khóa

- **Quyết định:** Dùng `READ COMMITTED` (mặc định của Postgres). Đặt `SET LOCAL lock_timeout = DB_LOCK_TIMEOUT_MS` (5000) trong transaction tạo và hủy đơn. Quá thời gian thì lỗi `55P03`, trả `503 SERVICE_UNAVAILABLE`.
- **Lý do:** Sau khi chờ khóa, Postgres đọc lại phiên bản mới nhất nên không cần `SERIALIZABLE`. Timeout tránh treo request vô hạn.

### ADR-015: Chuyển trạng thái bằng CAS

- **Quyết định:** Mọi chuyển trạng thái đơn dùng `UPDATE orders SET status = $to … WHERE id = $id AND status = ANY($from) RETURNING …`. Hoàn kho và ghi thông báo chỉ thực hiện khi CAS trả về một dòng, và nằm trong **cùng transaction**.
- **Lý do:** Đây là nền tảng của idempotency. Mỗi đơn rời mỗi trạng thái đúng một lần, nên kho được hoàn tối đa một lần.

### ADR-016: `jobId` cố định

- **Quyết định:** `jobId = order-{orderId}` (không dùng ký tự `:`).
- **Lý do:** BullMQ bỏ qua `add` trùng id. Nhờ vậy relay outbox đẩy lại (at-least-once) mà không tạo job trùng.

### ADR-017: Bù trừ ở lần thử cuối

- **Quyết định:** Trong processor, nếu lỗi xảy ra ở lần thử cuối thì gọi `failOrder()` (CAS `PENDING → FAILED` và hoàn kho) rồi ném lại lỗi. Không dùng event `failed` của worker.
- **Lý do:** Handler của event không được `await` và chạy sau khi job đã `failed`. Nếu tiến trình chết đúng lúc đó thì bước bù trừ bị mất. Job hết hạn là lưới an toàn nếu chính `failOrder()` cũng lỗi.

### ADR-018: Lưu thông báo

- **Quyết định:** Ghi bảng `notification_logs` với `UNIQUE(order_id, type)`, dùng `INSERT … ON CONFLICT DO NOTHING` trong cùng transaction với CAS xác nhận đơn.
- **Lý do:** Truy vấn được, và DB đảm bảo không trùng thông báo. Ghi log thuần thì không chứng minh được idempotency.

### ADR-019: Job hủy đơn quá hạn

- **Quyết định:** `upsertJobScheduler('expire-pending-orders', { every: 300000 })` khi worker khởi động. Mỗi lần chạy lấy tối đa 100 đơn `PENDING` quá 30 phút. Mỗi đơn một transaction (CAS rồi hoàn kho). Không áp dụng lỗi giả lập.
- **Lý do:** Scheduler id cố định nên khởi động lại không bị nhân đôi. Lỗi ở một đơn không rollback các đơn khác.

### ADR-020: Snapshot sản phẩm trong đơn

- **Quyết định:** `order_items` lưu `product_sku`, `product_name`, `unit_price` tại thời điểm đặt. `orders.total_amount` cũng được lưu cố định.
- **Lý do:** Đơn là dữ liệu lịch sử. Sản phẩm có thể đổi giá hoặc bị xóa mềm sau đó.

### ADR-021: Mã lỗi thiếu hàng

- **Quyết định:** `409 INSUFFICIENT_STOCK`, `details` liệt kê **mọi** item thiếu (`productId`, `sku`, `requested`, `available`). Sản phẩm không tồn tại thì `404 PRODUCT_NOT_FOUND`.
- **Lý do:** Request đúng cú pháp nhưng xung đột với trạng thái tồn kho hiện tại.

### ADR-022: `PATCH` `stock` là giá trị tuyệt đối

- **Quyết định:** `PATCH /products/:id` với `stock` sẽ đặt giá trị tuyệt đối.
- **Hệ quả:** Về mặt nghĩa có thể ghi đè một lần trừ kho vừa xảy ra (hạn chế đã biết). Cách khắc phục là endpoint điều chỉnh theo delta, nằm trong ADR-028 (chờ duyệt).

### ADR-023: Tách hai tiến trình API và Worker

- **Quyết định:** Chung một codebase, hai entry point. API: `AppModule` (không import processor hay relay). Worker: `WorkerModule` chạy `OrderProcessingProcessor`, `OrderJobsScheduler` và `OutboxRelayService`.
- **Lý do:** Serverless không chạy được worker. Tách module tránh việc vô tình khởi tạo `Worker` trong function Vercel.

### ADR-024: PostgreSQL production

- **Quyết định:** Neon. API dùng **pooled** connection string với `DATABASE_POOL_MAX = 3`. Migration dùng direct connection.
- **Lý do:** Có gói free, có pooler phù hợp với serverless. Supabase là phương án thay thế tương đương.

### ADR-025: Cách deploy NestJS lên Vercel

- **Quyết định:** `nest build` (tsc) ra `dist/`. Function `api/index.js` `require('../dist/vercel')`, app được cache theo instance. `vercel.json` rewrite mọi đường dẫn về `/api`. Swagger UI lấy asset từ CDN.
- **Lý do:** DI của NestJS cần `emitDecoratorMetadata`, mà bundler dựa trên esbuild không sinh ra metadata này.
- **Hệ quả:** Cần đối chiếu với tài liệu Vercel hiện hành. Nếu Vercel hỗ trợ NestJS zero-config ổn định thì có thể đơn giản hóa.

### ADR-026: Chính sách migration

- **Quyết định:** `synchronize: false` và `migrationsRun: false` ở mọi môi trường. Production chạy migration bằng pre-deploy command của Railway (`npm run migration:run:prod`). Thứ tự deploy: migration → worker → API.
- **Lý do:** Migration chỉ chạy ở một nơi, không chạy khi Vercel cold start.

### ADR-027: Thiết kế để test được

- **Quyết định:** Truy vấn đặc thù (khóa, CAS, tăng/giảm kho, outbox) nằm trong repository nhận `EntityManager`. `FailureSimulator` và `sleeper` là provider inject được.
- **Lý do:** Unit test `OrdersService` và processor không cần DB thật, không phải mock chuỗi `createQueryBuilder()`, và ép được kết quả lỗi/thành công.

---

## C. Phạm vi và phiên bản

### ADR-028: Phạm vi bổ sung

- **Trạng thái:** Đã duyệt (2026-10-14). Người làm bài yêu cầu "bám theo kế hoạch implement" ([09](09-implementation-plan.md)). Kế hoạch đó có giai đoạn 5 (test đồng thời e2e) và commit `/health`, nhưng không có `pg_trgm` hay endpoint delta.
- **Quyết định:** Làm test đồng thời e2e (IT-01..IT-05) và `GET /health`. Index `pg_trgm` và endpoint điều chỉnh tồn kho theo delta để vào mục "hướng cải tiến" trong README.
- **Các hạng mục:**

  | Hạng mục | Chi phí ước lượng | Đề xuất |
  |---|---|---|
  | Test đồng thời e2e (IT-01..IT-05) trên Postgres/Redis thật | ~0.5 ngày | **Nên làm.** Đây là bằng chứng mạnh nhất cho tiêu chí chấm nặng nhất |
  | `GET /health` (DB và Redis) | ~30 phút | **Nên làm.** Dùng cho smoke test sau khi deploy |
  | Index `pg_trgm` cho tìm kiếm theo tên | ~30 phút | Không cần ở quy mô bài |
  | Endpoint điều chỉnh tồn kho theo delta (khắc phục ADR-022) | ~0.5 ngày | Để ở mục "hướng cải tiến" |

### ADR-029: Phiên bản thư viện

- **Trạng thái:** Mặc định (2026-10-14, lúc bắt đầu code)
- **Bối cảnh:** Bản nháp tài liệu ghi TypeORM 0.3.x và BullMQ 5.x. Khi bắt đầu code, npm đã có NestJS 12.1, `@nestjs/typeorm` 12 (peer `typeorm ^0.3 || ^1`), TypeORM 1.1, `@nestjs/bullmq` 12 (peer `bullmq ^3 … ^6`), BullMQ 6.3. Các gói này tương thích peer dependency với nhau.
- **Quyết định:** Dùng bản ổn định mới nhất: NestJS 12, TypeORM 1.x, BullMQ 6.x, Node.js 22 LTS.
- **Lý do:** Dự án mới, không có code cũ phải giữ tương thích. Bản mới nhất được hỗ trợ lâu nhất.
- **Hệ quả:** API thay đổi giữa các major (TypeORM 0.3 → 1.x, BullMQ 5 → 6) phải được kiểm tra trên type definitions và CHANGELOG của gói đã cài, không dựa vào trí nhớ. Code mẫu trong tài liệu 02–07 chỉ mang tính minh họa. Với `attemptsMade` và job scheduler, hành vi thực tế được kiểm chứng bằng test (MT-04, UT-08/09).
- **Ghi nhận khi scaffold (NestJS 12):**
  - Các gói `@nestjs/*` 12 chỉ phát hành dạng **ES module** (`"type": "module"`). Dự án vẫn biên dịch ra **CommonJS** (`module: nodenext`, `package.json` không có `"type"`), vì TypeORM CLI (`typeorm-ts-node-commonjs`), handler Vercel (`require('../dist/vercel')`) và Jest đều làm việc với CommonJS. Lúc chạy, Node ≥ 22.12 `require()` được ES module (`require(esm)`), nên `engines.node` là `>=22.13`.
  - `engines.node` chỉ nói mức tối thiểu để chạy app. Các gói dev-only của Nest CLI (`@nestjs/schematics` 12, `@angular-devkit/*` 22) khai báo `node: ^22.22.3 || ^24.15.0 || >=26.0.0`, nên `npm ci` trên Node 22.13–22.22 in cảnh báo `EBADENGINE` cho chúng. Không nâng `engines.node` theo các gói này, vì app chạy được từ 22.13 và build vẫn chạy trên 22.19. Khuyến nghị dùng Node ≥ 22.22.3 khi phát triển local ([08 §2.1](08-deployment.md#21-yêu-cầu)).
  - Jest dùng hệ module CommonJS riêng và chỉ `require()` được ES module từ Node 24.9. Để chạy test trên Node 22, `jest.config.js` cho Jest chuyển các gói `@nestjs/*` sang CommonJS bằng `test/esm-to-cjs.transformer.js` (dùng `ts.transpileModule`). Transformer thay `import.meta.url` bằng URL của file và bỏ các dòng tự khai báo lại `require`/`__filename`/`__dirname` (ví dụ `const require = createRequire(import.meta.url)` trong `@nestjs/swagger`), vì trong CommonJS các biến này đã có sẵn. Code production không đi qua transformer này.
  - Không dùng Vitest (mặc định của template ESM của NestJS 12): `npm install vitest` với npm 10.9 bị lỗi `Cannot read properties of null (reading 'edgesOut')` do chuỗi peer dependency tùy chọn của Vite 8. Lint dùng ESLint theo kế hoạch, không dùng oxlint của template.
  - TypeScript 6.0 (`~6.0`): `@nestjs/cli` 12 khóa `~6.0.2`, typescript-eslint hỗ trợ `<6.1`, ts-jest hỗ trợ `<7`. `tsconfig` bật `isolatedModules` (ts-jest yêu cầu khi dùng `nodenext`), nên kiểu chỉ dùng trong chữ ký có decorator phải `import type`.

---

## Lịch sử thay đổi

| Ngày | Thay đổi |
|---|---|
| 2026-10-14 | ADR-029: ghi nhận Nest CLI (dev-only) cần Node ≥ 22.22.3, nên `npm ci` cảnh báo `EBADENGINE` trên 22.13–22.22. `engines.node` giữ `>=22.13` cho runtime |
| 2026-10-14 | ADR-011: làm rõ hệ quả. Chỉ lỗi 500 ẩn `message`. Lỗi 503 trả thông điệp ngắn, cố định để client biết nên thử lại |
| 2026-10-14 | ADR-029: ghi nhận NestJS 12 chỉ phát hành ES module. Dự án giữ CommonJS (Node ≥ 22.13), Jest dùng transformer chuyển `@nestjs/*` sang CommonJS, TypeScript 6.0 |
| 2026-10-14 | ADR-028 chuyển sang Đã duyệt theo kế hoạch implement. Thêm ADR-029 (phiên bản thư viện) khi bắt đầu code |
| 2026-10-14 | Tạo nhật ký. Rà soát 12 điểm cần quyết định. Thay đổi so với bản nháp: retry từ 3 lên 4 lần chạy (ADR-001), đẩy job qua Outbox thay cho "201 + chờ hết hạn" (ADR-003), tiền từ `numeric(12,2)` sang `bigint` VND (ADR-007) |
