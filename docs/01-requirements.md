# 01 — Đặc tả yêu cầu (SRS)

## 1. Mục tiêu và phạm vi

Xây dựng REST API backend cho một cửa hàng online nhỏ, gồm:

1. Quản lý **sản phẩm** và **tồn kho** (CRUD, xóa mềm, tìm kiếm, phân trang).
2. Quản lý **đơn hàng**: tạo đơn trong một transaction, không bao giờ bán vượt tồn kho, hủy đơn và hoàn kho.
3. **Xử lý nền** đơn hàng bằng BullMQ: giả lập xử lý, lỗi ngẫu nhiên, retry kèm backoff, đánh dấu thất bại và hoàn kho, đảm bảo idempotent.
4. Deploy API kèm Swagger. Worker chạy trên một nền tảng hỗ trợ tiến trình chạy lâu dài.

Hệ thống **không có** frontend, đăng nhập hay thanh toán.

## 2. Tác nhân

| Tác nhân | Mô tả | Tương tác |
|---|---|---|
| Khách hàng | Người đặt hàng (qua một client bất kỳ) | `POST /orders`, `GET /orders/:id`, `PATCH /orders/:id/cancel` |
| Quản trị viên | Người quản lý danh mục và tồn kho | `/products/*`, `GET /orders` |
| Worker | Tiến trình nền tiêu thụ queue `order-processing` | Đọc và ghi DB, cập nhật trạng thái đơn |
| Bộ lập lịch | Job lặp lại mỗi 5 phút (điểm cộng) | Tự hủy các đơn PENDING quá hạn |

> Vì không có đăng nhập, mọi endpoint đều công khai. Việc phân quyền nằm ngoài phạm vi (xem §7).

---

## 3. Yêu cầu chức năng

### 3.1 Products

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-P01 | `POST /products` tạo sản phẩm với `sku` (duy nhất), `name`, `price`, `stock` | MUST |
| FR-P02 | `GET /products` có phân trang (`page`, `limit`), tìm theo tên (`search`), lọc giá (`minPrice`, `maxPrice`) | MUST |
| FR-P03 | `GET /products/:id` lấy chi tiết sản phẩm | MUST |
| FR-P04 | `PATCH /products/:id` cập nhật một phần các trường | MUST |
| FR-P05 | `DELETE /products/:id` xóa **mềm** | MUST |
| FR-P06 | Validate mọi input bằng DTO (class-validator) | MUST |

**Tiêu chí chấp nhận**

- **FR-P01**
  - Body hợp lệ thì trả `201` cùng sản phẩm vừa tạo (`id`, `sku`, `name`, `price`, `stock`, `createdAt`, `updatedAt`).
  - `sku` trùng với một sản phẩm **chưa xóa** thì trả `409 SKU_ALREADY_EXISTS`.
  - `sku` được trim và chuyển thành chữ in hoa trước khi lưu (`tshirt-01` và `TSHIRT-01` là cùng một SKU).
- **FR-P02**
  - Mặc định `page=1`, `limit=10`, giới hạn `limit ≤ 100`.
  - `search` so khớp một phần, không phân biệt hoa thường, trên `name` (`ILIKE`). Các ký tự `%` và `_` trong từ khóa được escape.
  - `minPrice`/`maxPrice` là khoảng **bao gồm hai đầu**. Nếu `minPrice > maxPrice` thì trả `400 VALIDATION_ERROR`.
  - Sản phẩm đã xóa mềm không xuất hiện trong kết quả.
  - Sắp xếp `createdAt DESC, id DESC` (thứ tự ổn định giữa các trang).
  - Response có dạng `{ data: [...], meta: { page, limit, total, totalPages } }`.
- **FR-P03**: `id` không phải UUID thì trả `400`. Không tồn tại hoặc đã xóa mềm thì trả `404 PRODUCT_NOT_FOUND`.
- **FR-P04**: Mọi trường đều tùy chọn và dùng cùng quy tắc validate với FR-P01. Đổi `sku` sang giá trị đã tồn tại thì trả `409`. Sửa `price` **không** ảnh hưởng đến các đơn đã tạo.
- **FR-P05**: Thành công trả `204`. Sau khi xóa, `GET` trả `404`, sản phẩm biến mất khỏi danh sách và không đặt hàng được nữa. Các đơn cũ vẫn hiển thị đúng thông tin sản phẩm (nhờ snapshot). Xóa lần 2 trả `404`.
- **FR-P06**: Trường lạ trong body bị từ chối (`forbidNonWhitelisted`). Lỗi trả theo định dạng thống nhất, có danh sách lỗi theo từng field.

### 3.2 Orders

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-O01 | `POST /orders` trong **một transaction**: kiểm tra tồn kho, trừ kho, tạo đơn `PENDING`, lưu `unitPrice` tại thời điểm mua | MUST |
| FR-O02 | Không bán vượt tồn kho kể cả khi nhiều request đến đồng thời | MUST |
| FR-O03 | `GET /orders` có phân trang, lọc theo `status` | MUST |
| FR-O04 | `GET /orders/:id` trả đơn kèm danh sách sản phẩm | MUST |
| FR-O05 | `PATCH /orders/:id/cancel` chỉ hủy được khi đơn đang `PENDING` hoặc `CONFIRMED`, và hoàn kho | MUST |
| FR-O06 | `GET /orders/:id/jobs` trả trạng thái job (state, số lần thử, lý do lỗi) | MUST |

**Tiêu chí chấp nhận**

- **FR-O01**
  - Hợp lệ và đủ hàng thì trả `201`, đơn ở trạng thái `PENDING`. Mỗi item có `unitPrice` bằng `price` của sản phẩm tại thời điểm đặt. `totalAmount = Σ unitPrice × quantity`. `stock` của từng sản phẩm giảm đúng bằng `quantity`.
  - Sau khi giá sản phẩm đổi, `unitPrice` và `totalAmount` của các đơn cũ giữ nguyên.
  - Chỉ cần **một** item thiếu hàng là trả `409 INSUFFICIENT_STOCK`. `details` liệt kê **tất cả** item thiếu (`productId`, `sku`, `requested`, `available`). DB không có thay đổi nào (rollback toàn bộ).
  - Có `productId` không tồn tại hoặc đã xóa mềm thì trả `404 PRODUCT_NOT_FOUND`, `details` liệt kê các id thiếu. DB không có thay đổi nào.
  - `items` rỗng, `quantity ≤ 0` hoặc không phải số nguyên, email sai định dạng, `productId` lặp lại trong cùng một đơn thì trả `400 VALIDATION_ERROR`.
  - Trong cùng transaction, ghi một dòng `outbox_events` (`ORDER_CREATED`). `POST /orders` không gọi Redis. Đơn thất bại (rollback) thì không có sự kiện nào, cũng không có job nào ([ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox)).
- **FR-O02**
  - Sản phẩm có `stock = 1`, N request đồng thời mỗi request `quantity = 1`: đúng **1** request trả `201`, N−1 request trả `409`. `stock` cuối cùng bằng `0`.
  - Với mọi kịch bản: tổng số lượng đã bán ≤ tồn kho ban đầu, `stock` không bao giờ âm.
  - Không xảy ra deadlock khi hai đơn chứa cùng các sản phẩm nhưng liệt kê theo thứ tự khác nhau.
- **FR-O03**: `status ∈ {PENDING, CONFIRMED, FAILED, CANCELLED}`, giá trị khác trả `400`. Sắp xếp `createdAt DESC, id DESC`. Cùng định dạng phân trang với FR-P02.
- **FR-O04**: Trả thông tin đơn và `items[]` (`productId`, `productSku`, `productName`, `unitPrice`, `quantity`, `lineTotal`). Không tồn tại thì trả `404 ORDER_NOT_FOUND`.
- **FR-O05**
  - `PENDING` hoặc `CONFIRMED` chuyển sang `CANCELLED`, `cancelReason = CUSTOMER_REQUEST`. Kho được hoàn đúng số lượng của từng item, trong cùng transaction với việc đổi trạng thái.
  - `FAILED` hoặc `CANCELLED` thì trả `409 INVALID_ORDER_STATUS`. Không tồn tại thì trả `404`.
  - Hai request hủy đồng thời: chỉ một request thành công, kho chỉ được hoàn **một lần**.
  - Hủy trong lúc job đang xử lý: job không được xác nhận lại đơn đã hủy (xem [05 §8](05-order-processing.md#8-bảng-tình-huống-race)).
- **FR-O06**: Trả `{ orderId, orderStatus, dispatch, jobs: [...] }`. `dispatch` cho biết sự kiện outbox đã được đẩy sang queue chưa (`PENDING`/`PUBLISHED`, số lần thử, lỗi gần nhất). Mỗi job gồm `jobId`, `name`, `state` (`waiting|delayed|active|completed|failed|unknown`), `attemptsMade`, `maxAttempts`, `failedReason`, `returnValue`, các mốc thời gian. Đơn không tồn tại thì trả `404`. Job chưa được relay đẩy hoặc đã bị dọn khỏi Redis thì `jobs: []`.

### 3.3 Xử lý nền (queue `order-processing`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-Q01 | Sau khi tạo đơn, đẩy 1 job `process-order` vào queue `order-processing` qua Transactional Outbox (relay chạy trong worker) | MUST |
| FR-Q02 | Job giả lập xử lý 3–5 giây, chuyển `PENDING → CONFIRMED` và ghi 1 bản ghi `notification_logs` | MUST |
| FR-Q03 | Giả lập lỗi ngẫu nhiên khoảng 30%. Retry tối đa 3 lần, backoff exponential | MUST |
| FR-Q04 | Hết số lần thử mà vẫn lỗi thì đơn chuyển `FAILED` và hoàn kho | MUST |
| FR-Q05 | Idempotent: job chạy lại (retry/trùng) không trừ/hoàn kho và không tạo thông báo lần hai | MUST |
| FR-Q06 | Repeatable job mỗi 5 phút tự hủy các đơn `PENDING` quá 30 phút và hoàn kho | BONUS |

**Tiêu chí chấp nhận**

- **FR-Q01**: `jobId = order-{orderId}`. Đẩy trùng cùng một đơn chỉ tạo ra **một** job. Relay đẩy job trong khoảng `OUTBOX_POLL_INTERVAL_MS` (mặc định 1s) sau khi commit. Redis lỗi lúc tạo đơn **không làm mất job**: sự kiện nằm lại trong outbox và được đẩy khi Redis hoạt động trở lại.
- **FR-Q02**: Thời gian xử lý ngẫu nhiên trong `[JOB_PROCESSING_MIN_MS, JOB_PROCESSING_MAX_MS]` (mặc định 3000–5000). Việc đổi trạng thái và ghi thông báo `ORDER_CONFIRMED` nằm trong **cùng một transaction**.
- **FR-Q03**: Tỉ lệ lỗi lấy từ `JOB_FAILURE_RATE` (mặc định `0.3`). `attempts = JOB_ATTEMPTS` (mặc định 4: lần đầu và 3 retry). `backoff = { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS }` (mặc định 2000, tức chờ 2s, 4s, 8s).
- **FR-Q04**: Ở lần thử cuối mà vẫn lỗi: `PENDING → FAILED`, ghi `failureReason`, hoàn kho, tất cả trong một transaction. Job kết thúc ở state `failed`, `failedReason` là thông điệp lỗi. Với `JOB_FAILURE_RATE=1`, đơn phải `FAILED` sau đúng 4 lần chạy.
- **FR-Q05**
  - Job `process-order` gặp đơn không còn `PENDING` thì kết thúc `completed` với `returnValue = { skipped: true, reason }`, không ghi gì thêm.
  - Mỗi đơn có tối đa 1 thông báo cho mỗi loại (`UNIQUE(order_id, type)`).
  - Thao tác hoàn kho chỉ diễn ra khi việc đổi trạng thái (CAS) thành công.
- **FR-Q06**: Job scheduler `expire-pending-orders` chạy mỗi `EXPIRE_PENDING_EVERY_MS` (mặc định 300000). Đơn `PENDING` có `createdAt < now − ORDER_PENDING_TTL_MINUTES` (mặc định 30) chuyển sang `CANCELLED` với `cancelReason = EXPIRED` và được hoàn kho. Khởi động lại worker không làm nhân đôi scheduler.

### 3.4 Yêu cầu chung

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-G01 | Tổ chức module rõ ràng: `products`, `orders`, `queue` (thêm `common`, `config`, `database`, `notifications`, `outbox`) | MUST |
| FR-G02 | Cấu hình bằng biến môi trường, có `.env.example`, validate env khi khởi động | MUST |
| FR-G03 | `docker-compose.yml` cho Postgres và Redis | MUST |
| FR-G04 | Định dạng lỗi thống nhất cho mọi endpoint ([04 §2](04-api-spec.md#2-định-dạng-lỗi-thống-nhất)) | MUST |
| FR-G05 | Swagger tại `/api/docs`, mô tả đủ DTO, response và mã lỗi | MUST |
| FR-G06 | Schema quản lý bằng migration TypeORM, `synchronize: false` ở mọi môi trường | MUST |
| FR-G07 | `GET /health` kiểm tra kết nối DB và Redis | SHOULD |

---

## 4. Yêu cầu phi chức năng

| Mã | Hạng mục | Yêu cầu | Cách kiểm chứng |
|---|---|---|---|
| NFR-01 | Đúng khi đồng thời | Không bán vượt, không hoàn kho 2 lần, không xác nhận đơn đã hủy, kể cả khi có nhiều instance API và worker | IT-01, IT-02, IT-03 ([07](07-testing.md)) |
| NFR-02 | Tin cậy | Job lỗi được retry. Lỗi cuối cùng được bù trừ (FAILED + hoàn kho). Không mất job khi Redis lỗi (Outbox). Đơn bị kẹt quá 30 phút được job dọn dẹp xử lý | UT-08, UT-12, MT-04, MT-09, MT-11 |
| NFR-03 | Toàn vẹn dữ liệu | Có ràng buộc ở DB: `CHECK stock >= 0`, `CHECK quantity > 0`, khóa ngoại, unique SKU, unique thông báo | Migration, IT-01 |
| NFR-04 | Dễ đọc | Controller mỏng. Nghiệp vụ nằm trong service. Truy cập dữ liệu khóa/CAS nằm trong repository. Hằng số đặt tên rõ ràng, không có magic string | Code review |
| NFR-05 | Kiểm thử | Tối thiểu 3 unit test cho `OrdersService` (UT-01..03). Nên có thêm test processor và test đồng thời | `npm test` |
| NFR-06 | Quan sát | Log có ngữ cảnh (`orderId`, `jobId`, `attempt`). Lỗi 5xx được log kèm stack, nhưng response không trả stack | Đọc log |
| NFR-07 | Hiệu năng | Có phân trang bắt buộc (`limit ≤ 100`), index cho các truy vấn lọc/sắp xếp. Transaction tạo đơn ngắn, không gọi I/O ngoài DB bên trong | Xem [03 §3](03-database.md#3-index) |
| NFR-08 | Bảo mật cơ bản | Whitelist DTO, không lộ stack trace hay câu SQL, không commit `.env`, query tham số hóa (không nối chuỗi SQL) | Code review |
| NFR-09 | Triển khai được | API chạy được trên serverless (Vercel), worker chạy tách riêng, migration chạy độc lập với lúc khởi động app | [08](08-deployment.md) |
| NFR-10 | Lịch sử commit | Commit nhỏ, message rõ ràng (Conventional Commits) | `git log` |

---

## 5. Ràng buộc kỹ thuật

- NestJS (TypeScript), PostgreSQL ≥ 14, TypeORM 0.3.x, BullMQ 5.x (`@nestjs/bullmq`), Redis ≥ 6.2 với `maxmemory-policy noeviction`, `@nestjs/swagger`.
- Không dùng `synchronize: true`, kể cả ở môi trường dev.
- API deploy trên Vercel hoặc Netlify. Worker deploy trên nền tảng hỗ trợ tiến trình chạy lâu dài (Render/Railway/Fly.io) hoặc dùng cron. Lý do lựa chọn phải ghi trong README.

---

## 6. Giả định và cách hiểu đề

Những chỗ đề bài chưa nói rõ được chốt như sau. README cần ghi lại các điểm này. Lý do và các phương án đã cân nhắc nằm trong [10 — Nhật ký quyết định](10-technical-decisions.md).

| Mã | Điểm chưa rõ | Cách hiểu được chọn | Lý do |
|---|---|---|---|
| A-01 | "Retry tối đa 3 lần" | `attempts = 4`: 1 lần đầu và **3 lần retry**. Backoff 2s, 4s, 8s. Cấu hình được qua `JOB_ATTEMPTS` | Hiểu "retry" theo nghĩa đen là số lần thử lại ([ADR-001](10-technical-decisions.md#adr-001-số-lần-chạy-job-và-backoff)) |
| A-02 | Trừ kho lúc nào | Trừ khi tạo đơn (giữ hàng). Job chỉ xác nhận | Đề yêu cầu "trong 1 transaction: kiểm tra tồn kho, trừ kho, tạo đơn" |
| A-03 | Hủy đơn `CONFIRMED` | Được hủy và hoàn kho | Đề cho phép hủy `PENDING` hoặc `CONFIRMED` |
| A-04 | Đơn hết hạn | Chuyển `CANCELLED` với `cancelReason = EXPIRED` (không thêm trạng thái mới) | Giữ máy trạng thái đúng 4 trạng thái như đề |
| A-05 | SKU duy nhất | Duy nhất trong các sản phẩm chưa xóa mềm, không phân biệt hoa thường (chuẩn hóa thành chữ in hoa) | Cho phép dùng lại SKU sau khi xóa, tránh trùng do khác hoa thường |
| A-06 | `productId` lặp lại trong `items` | Từ chối bằng `400`, không tự gộp | Đơn giản, minh bạch, client phải gửi dữ liệu chuẩn |
| A-07 | Sản phẩm đã xóa mềm | Không đặt được (`404`). Đơn cũ vẫn hiển thị nhờ snapshot `productName`/`productSku`. Khi hủy đơn cũ vẫn hoàn kho vào sản phẩm đã xóa | Giữ dữ liệu lịch sử và tồn kho nhất quán |
| A-08 | Mã lỗi thiếu hàng | `409 Conflict` | Request hợp lệ về cú pháp nhưng xung đột với trạng thái tồn kho hiện tại |
| A-09 | Hình thức thông báo | Bảng `notification_logs` (thay vì chỉ ghi log) | Truy vấn được, có ràng buộc UNIQUE để chứng minh idempotency |
| A-10 | `GET /orders` có trả items không | Không. Chỉ `GET /orders/:id` trả items | Danh sách gọn, tránh N+1 |
| A-11 | Redis lỗi khi tạo đơn | Dùng Transactional Outbox: tạo đơn không gọi Redis, relay đẩy job khi Redis hoạt động lại | Không bao giờ mất job ([ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox)) |
| A-12 | Tiền tệ | Chỉ VND, lưu `bigint`, API nhận/trả số nguyên | VND không có đơn vị lẻ, loại bỏ sai số ([ADR-007](10-technical-decisions.md#adr-007-kiểu-dữ-liệu-tiền)) |
| A-13 | `PATCH /products/:id` với `stock` | Đặt giá trị tuyệt đối | Đơn giản. Rủi ro ghi đè được nêu trong [06 §6](06-concurrency.md#6-các-điểm-đồng-thời-khác) |

---

## 7. Ngoài phạm vi

- Frontend, đăng nhập/phân quyền, thanh toán, gửi email thật.
- Đa tiền tệ, thuế, mã giảm giá, phí vận chuyển.
- Sổ cái tồn kho (inventory ledger), lịch sử thay đổi giá.
- Header `Idempotency-Key` cho `POST /orders` (chống client gửi lại). Đây là hướng cải tiến.
- Dashboard queue (Bull Board), rate limit. Đây là hướng cải tiến.

## 8. Sản phẩm bàn giao

| Mã | Sản phẩm | Ghi chú |
|---|---|---|
| D-01 | Link GitHub repo | Commit nhỏ, message rõ ràng |
| D-02 | Link API đã deploy, Swagger tại `/api/docs` | Vercel |
| D-03 | Worker đã deploy | Railway (hoặc tương đương) |
| D-04 | README | Cách chạy local, mô tả bảng dữ liệu, luồng xử lý đơn + job, cách chống bán vượt, cách deploy worker và lý do, **phần chưa làm được** |

## 9. Ma trận truy vết

| Yêu cầu | Thiết kế | Kiểm thử |
|---|---|---|
| FR-P01..P06 | [03 §2.1](03-database.md#21-products), [04 §3](04-api-spec.md#3-products) | MT-01, MT-02 |
| FR-O01 | [05 §3](05-order-processing.md#3-luồng-tạo-đơn-và-outbox), [06 §4](06-concurrency.md#4-giải-pháp-được-chọn) | UT-01, UT-02, UT-05 |
| FR-O02 | [06](06-concurrency.md) | IT-01, IT-02 |
| FR-O03, O04 | [04 §4](04-api-spec.md#4-orders) | MT-03 |
| FR-O05 | [05 §7](05-order-processing.md#7-hủy-đơn), [06 §6](06-concurrency.md#6-các-điểm-đồng-thời-khác) | UT-03, UT-04, IT-03, MT-06, MT-07 |
| FR-O06 | [05 §10](05-order-processing.md#10-get-ordersidjobs) | MT-04 |
| FR-Q01..Q05 | [05 §3–6](05-order-processing.md#3-luồng-tạo-đơn-và-outbox) | UT-06..UT-09, UT-11, UT-12, IT-04, IT-05, MT-03..MT-05, MT-08, MT-11 |
| FR-Q06 | [05 §9](05-order-processing.md#9-job-định-kỳ-hủy-đơn-quá-hạn-bonus) | UT-10, MT-09 |
| FR-G01..G07 | [02](02-architecture.md), [08](08-deployment.md) | MT-10 |
