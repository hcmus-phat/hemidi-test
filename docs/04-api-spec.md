# 04 — Đặc tả API

## 1. Quy ước chung

| Mục | Quy ước |
|---|---|
| Base URL | Local: `http://localhost:3000`. Production: `https://<project>.vercel.app` |
| Swagger | `GET /api/docs` (UI), `GET /api/docs-json` (OpenAPI JSON) |
| Định dạng | `Content-Type: application/json; charset=utf-8` |
| ID | UUID v4. Sai định dạng thì trả `400 VALIDATION_ERROR` (dùng `ParseUUIDPipe`) |
| Thời gian | ISO 8601, UTC, ví dụ `2026-10-14T03:15:00.000Z` |
| Tiền | Số nguyên (`integer`), đơn vị VND ([ADR-007](10-technical-decisions.md#adr-007-kiểu-dữ-liệu-tiền)) |
| Phân trang | Query `page` (1–1 000 000, mặc định 1) và `limit` (1–100, mặc định 10). Cận trên của `page` chỉ để `OFFSET` luôn hợp lệ, trang vượt quá số trang vẫn trả `data: []` |
| Response danh sách | `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }` |
| Response đơn lẻ | Trả thẳng object, không bọc thêm |
| Thông điệp lỗi | Tiếng Anh, ngắn gọn, nêu rõ nguyên nhân. `error` là mã máy đọc được ([ADR-011](10-technical-decisions.md#adr-011-định-dạng-lỗi-và-ngôn-ngữ-thông-báo)) |

### Tổng hợp endpoint

| Method | Path | Mô tả | Thành công |
|---|---|---|---|
| POST | `/products` | Tạo sản phẩm | 201 |
| GET | `/products` | Danh sách sản phẩm (phân trang, tìm kiếm, lọc giá) | 200 |
| GET | `/products/:id` | Chi tiết sản phẩm | 200 |
| PATCH | `/products/:id` | Cập nhật một phần | 200 |
| DELETE | `/products/:id` | Xóa mềm | 204 |
| POST | `/orders` | Tạo đơn hàng | 201 |
| GET | `/orders` | Danh sách đơn (phân trang, lọc `status`) | 200 |
| GET | `/orders/:id` | Chi tiết đơn kèm items | 200 |
| PATCH | `/orders/:id/cancel` | Hủy đơn và hoàn kho | 200 |
| GET | `/orders/:id/jobs` | Trạng thái job xử lý đơn | 200 |
| GET | `/health` | Kiểm tra DB và Redis *(SHOULD)* | 200 / 503 |

---

## 2. Định dạng lỗi thống nhất

Mọi lỗi (validate, nghiệp vụ, DB, không xác định) đều trả về cùng một cấu trúc:

```json
{
  "statusCode": 409,
  "error": "INSUFFICIENT_STOCK",
  "message": "Insufficient stock for 1 product(s)",
  "details": [
    { "productId": "8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10", "sku": "LAST-ITEM-001", "requested": 2, "available": 1 }
  ],
  "path": "/orders",
  "timestamp": "2026-10-14T03:15:00.000Z"
}
```

| Trường | Kiểu | Mô tả |
|---|---|---|
| `statusCode` | number | HTTP status |
| `error` | string | Mã lỗi (xem §5) |
| `message` | string | Mô tả cho người đọc |
| `details` | array \| undefined | Thông tin bổ sung: lỗi theo field, sản phẩm thiếu hàng… |
| `path` | string | Đường dẫn request |
| `timestamp` | string | Thời điểm xảy ra lỗi |

Ví dụ lỗi validate (`details` đã được làm phẳng, kể cả với field lồng nhau):

```json
{
  "statusCode": 400,
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": [
    { "field": "customerEmail", "messages": ["customerEmail must be an email"] },
    { "field": "items.0.quantity", "messages": ["quantity must not be less than 1"] }
  ],
  "path": "/orders",
  "timestamp": "2026-10-14T03:15:00.000Z"
}
```

Lỗi 5xx chỉ trả `message: "Internal server error"`. Stack trace và câu SQL chỉ được ghi vào log.

---

## 3. Products

### 3.1 Schema `Product` (response)

```json
{
  "id": "8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10",
  "sku": "TSHIRT-WHITE-M",
  "name": "Áo thun trắng size M",
  "price": 199000,
  "stock": 50,
  "createdAt": "2026-10-14T03:00:00.000Z",
  "updatedAt": "2026-10-14T03:00:00.000Z"
}
```

`deletedAt` không được trả ra ngoài.

### 3.2 `POST /products`

**Body (`CreateProductDto`)**

| Field | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `sku` | string | ✓ | Trim và chuyển thành chữ in hoa. Dài 1–64. Khớp `^[A-Z0-9_-]+$` |
| `name` | string | ✓ | Trim, dài 1–255 |
| `price` | integer | ✓ | VND, `@IsInt()`, `0 … 1000000000` |
| `stock` | integer | ✓ | `≥ 0`, `≤ 1000000` |

```json
{ "sku": "tshirt-white-m", "name": "Áo thun trắng size M", "price": 199000, "stock": 50 }
```

| Status | Khi nào |
|---|---|
| 201 | Tạo thành công, trả `Product` (`sku` = `TSHIRT-WHITE-M`) |
| 400 `VALIDATION_ERROR` | Body sai quy tắc hoặc có field lạ |
| 409 `SKU_ALREADY_EXISTS` | SKU đã tồn tại trong các sản phẩm chưa xóa |

### 3.3 `GET /products`

**Query (`QueryProductsDto`)**

| Param | Kiểu | Mặc định | Quy tắc |
|---|---|---|---|
| `page` | integer | 1 | `≥ 1` |
| `limit` | integer | 10 | 1–100 |
| `search` | string | | Trim, tối đa 100 ký tự. `name ILIKE '%search%'` (escape `%`, `_`, `\`) |
| `minPrice` | integer | | `≥ 0` (VND) |
| `maxPrice` | integer | | `≥ 0` (VND). Nếu có cả hai thì `minPrice ≤ maxPrice` |

Query param nhận vào là string, cần `@Type(() => Number)` để chuyển kiểu. Sắp xếp `createdAt DESC, id DESC`.

```http
GET /products?page=1&limit=2&search=áo&minPrice=100000&maxPrice=300000
```

```json
{
  "data": [
    { "id": "8c1f…", "sku": "TSHIRT-WHITE-M", "name": "Áo thun trắng size M", "price": 199000, "stock": 50, "createdAt": "…", "updatedAt": "…" },
    { "id": "1a9b…", "sku": "SHIRT-BLUE-L", "name": "Áo sơ mi xanh size L", "price": 289000, "stock": 12, "createdAt": "…", "updatedAt": "…" }
  ],
  "meta": { "page": 1, "limit": 2, "total": 7, "totalPages": 4 }
}
```

| Status | Khi nào |
|---|---|
| 200 | Thành công. Trang vượt quá số trang thì trả `data: []` |
| 400 `VALIDATION_ERROR` | Query sai, hoặc `minPrice > maxPrice` |

### 3.4 `GET /products/:id`

| Status | Khi nào |
|---|---|
| 200 | Trả `Product` |
| 400 `VALIDATION_ERROR` | `id` không phải UUID |
| 404 `PRODUCT_NOT_FOUND` | Không tồn tại hoặc đã xóa mềm |

### 3.5 `PATCH /products/:id`

Body `UpdateProductDto = PartialType(CreateProductDto)`: mọi field đều tùy chọn, quy tắc giống khi tạo. Body rỗng là hợp lệ và trả về sản phẩm không đổi.

| Status | Khi nào |
|---|---|
| 200 | Trả `Product` sau khi cập nhật |
| 400 `VALIDATION_ERROR` | Body hoặc `id` sai |
| 404 `PRODUCT_NOT_FOUND` | Không tồn tại hoặc đã xóa mềm |
| 409 `SKU_ALREADY_EXISTS` | Đổi sang SKU đã có |

> `stock` trong PATCH là **giá trị tuyệt đối**. Đổi `price` không ảnh hưởng các đơn đã tạo (đơn dùng snapshot `unitPrice`).

### 3.6 `DELETE /products/:id`

| Status | Khi nào |
|---|---|
| 204 | Đã xóa mềm, không có body |
| 400 `VALIDATION_ERROR` | `id` không phải UUID |
| 404 `PRODUCT_NOT_FOUND` | Không tồn tại hoặc đã xóa trước đó |

---

## 4. Orders

### 4.1 Schema

**`OrderSummary`** (dùng trong danh sách):

```json
{
  "id": "0b7d4e2a-6f1c-4d8e-9b3a-5c2e1f0a9d77",
  "customerName": "Nguyen Van A",
  "customerEmail": "a.nguyen@example.com",
  "status": "PENDING",
  "totalAmount": 548000,
  "cancelReason": null,
  "failureReason": null,
  "createdAt": "2026-10-14T03:15:00.000Z",
  "updatedAt": "2026-10-14T03:15:00.000Z"
}
```

**`OrderDetail`** = `OrderSummary` cộng thêm:

```json
{
  "confirmedAt": null,
  "cancelledAt": null,
  "failedAt": null,
  "items": [
    {
      "id": "5d0c…",
      "productId": "8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10",
      "productSku": "TSHIRT-WHITE-M",
      "productName": "Áo thun trắng size M",
      "unitPrice": 199000,
      "quantity": 2,
      "lineTotal": 398000
    },
    {
      "id": "7e2a…",
      "productId": "c4d2…",
      "productSku": "CAP-BLACK",
      "productName": "Mũ lưỡi trai đen",
      "unitPrice": 150000,
      "quantity": 1,
      "lineTotal": 150000
    }
  ]
}
```

`status ∈ { PENDING, CONFIRMED, FAILED, CANCELLED }`, `cancelReason ∈ { CUSTOMER_REQUEST, EXPIRED, null }`.

### 4.2 `POST /orders`

**Body (`CreateOrderDto`)**

| Field | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `customerName` | string | ✓ | Trim, dài 1–255 |
| `customerEmail` | string | ✓ | `@IsEmail()`, tối đa 255 ký tự, chuyển về chữ thường |
| `items` | array | ✓ | 1–50 phần tử, `@ValidateNested({ each: true })`, `@Type(() => OrderItemDto)`, `@ArrayUnique(i => i.productId)` |
| `items[].productId` | string | ✓ | `@IsUUID()`, chuyển về chữ thường (`@Transform`) trước khi kiểm tra trùng và tra cứu |
| `items[].quantity` | integer | ✓ | `@IsInt()`, 1–1000 |

```json
{
  "customerName": "Nguyen Van A",
  "customerEmail": "A.Nguyen@Example.com",
  "items": [
    { "productId": "8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10", "quantity": 2 },
    { "productId": "c4d2…", "quantity": 1 }
  ]
}
```

| Status | Khi nào | `details` |
|---|---|---|
| 201 | Tạo đơn `PENDING`, đã trừ kho, đã ghi sự kiện outbox (relay đẩy job trong khoảng 1s). Trả `OrderDetail`. Endpoint này không gọi Redis | |
| 400 `VALIDATION_ERROR` | Body sai, `items` rỗng, `productId` lặp lại | Lỗi theo field |
| 404 `PRODUCT_NOT_FOUND` | Có `productId` không tồn tại hoặc đã xóa | `[{ "productId": "…" }]` |
| 409 `INSUFFICIENT_STOCK` | Ít nhất một sản phẩm không đủ hàng. Không có gì bị thay đổi | `[{ productId, sku, requested, available }]` cho **mọi** item thiếu |
| 503 `SERVICE_UNAVAILABLE` | Chờ khóa quá `DB_LOCK_TIMEOUT_MS` (tải quá cao) | |

Ví dụ thiếu hàng:

```json
{
  "statusCode": 409,
  "error": "INSUFFICIENT_STOCK",
  "message": "Insufficient stock for 1 product(s)",
  "details": [
    { "productId": "8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10", "sku": "TSHIRT-WHITE-M", "requested": 2, "available": 1 }
  ],
  "path": "/orders",
  "timestamp": "2026-10-14T03:15:00.000Z"
}
```

### 4.3 `GET /orders`

| Param | Kiểu | Mặc định | Quy tắc |
|---|---|---|---|
| `page` | integer | 1 | `≥ 1` |
| `limit` | integer | 10 | 1–100 |
| `status` | enum | | `PENDING \| CONFIRMED \| FAILED \| CANCELLED` |

Trả `{ data: OrderSummary[], meta }`, sắp xếp `createdAt DESC, id DESC`. Danh sách không kèm items.

### 4.4 `GET /orders/:id`

| Status | Khi nào |
|---|---|
| 200 | Trả `OrderDetail` |
| 400 `VALIDATION_ERROR` | `id` không phải UUID |
| 404 `ORDER_NOT_FOUND` | Không tồn tại |

### 4.5 `PATCH /orders/:id/cancel`

Không có body. Chuyển `PENDING | CONFIRMED → CANCELLED` (`cancelReason = CUSTOMER_REQUEST`) và hoàn kho trong một transaction.

| Status | Khi nào |
|---|---|
| 200 | Trả `OrderDetail` với `status = CANCELLED` |
| 400 `VALIDATION_ERROR` | `id` không phải UUID |
| 404 `ORDER_NOT_FOUND` | Không tồn tại |
| 409 `INVALID_ORDER_STATUS` | Đơn đang `FAILED` hoặc `CANCELLED`. `message`: `Order cannot be cancelled in status FAILED` |

### 4.6 `GET /orders/:id/jobs`

```json
{
  "orderId": "0b7d4e2a-6f1c-4d8e-9b3a-5c2e1f0a9d77",
  "orderStatus": "FAILED",
  "dispatch": {
    "status": "PUBLISHED",
    "publishedAt": "2026-10-14T03:15:00.910Z",
    "publishAttempts": 1,
    "lastError": null
  },
  "jobs": [
    {
      "jobId": "order-0b7d4e2a-6f1c-4d8e-9b3a-5c2e1f0a9d77",
      "name": "process-order",
      "state": "failed",
      "attemptsMade": 4,
      "maxAttempts": 4,
      "failedReason": "Simulated random processing failure",
      "returnValue": null,
      "createdAt": "2026-10-14T03:15:00.900Z",
      "processedAt": "2026-10-14T03:15:29.300Z",
      "finishedAt": "2026-10-14T03:15:33.800Z"
    }
  ]
}
```

**`dispatch`** lấy từ bảng `outbox_events` ([05 §3.2](05-order-processing.md#32-relay-worker)):

| Field | Ghi chú |
|---|---|
| `status` | `PENDING` (chưa đẩy sang queue) hoặc `PUBLISHED` |
| `publishedAt` | Thời điểm relay đẩy thành công. `null` nếu chưa đẩy |
| `publishAttempts` | Số lần relay đã thử đẩy |
| `lastError` | Lỗi gần nhất khi đẩy, ví dụ Redis không truy cập được |

**`jobs[]`** lấy từ BullMQ:

| Field | Nguồn trong BullMQ | Ghi chú |
|---|---|---|
| `jobId` | `job.id` | `order-{orderId}` |
| `name` | `job.name` | `process-order` |
| `state` | `await job.getState()` | `waiting`, `delayed` (đang chờ retry), `active`, `completed`, `failed`, `unknown` |
| `attemptsMade` | `job.attemptsMade` | Số lần thử đã thực hiện |
| `maxAttempts` | `job.opts.attempts` | |
| `failedReason` | `job.failedReason` | Lý do lỗi gần nhất. Có giá trị cả khi job đang `delayed` chờ retry |
| `returnValue` | `job.returnvalue` | `{ "result": "CONFIRMED" }` hoặc `{ "skipped": true, "reason": "…" }` |
| `createdAt` / `processedAt` / `finishedAt` | `job.timestamp` / `job.processedOn` / `job.finishedOn` | Epoch ms chuyển sang ISO |

| Status | Khi nào |
|---|---|
| 200 | Thành công. `jobs: []` nếu relay chưa đẩy (`dispatch.status = PENDING`) hoặc job đã bị dọn khỏi Redis (quá `JOB_KEEP_*_SECONDS`) |
| 404 `ORDER_NOT_FOUND` | Đơn không tồn tại |
| 503 `SERVICE_UNAVAILABLE` | Không kết nối được Redis |

### 4.7 `GET /health` *(SHOULD, xem [ADR-028](10-technical-decisions.md#adr-028-phạm-vi-bổ-sung))*

```json
{ "status": "ok", "checks": { "database": "up", "redis": "up" } }
```

Trả `503` cùng `status: "error"` nếu một trong hai bị down.

---

## 5. Danh mục mã lỗi

| HTTP | `error` | Khi nào | Nguồn |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | DTO/query sai, UUID sai, `minPrice > maxPrice`, `productId` lặp, body không phải JSON hợp lệ | `ValidationPipe`, `ParseUUIDPipe`, body-parser, Postgres `22P02` |
| 404 | `NOT_FOUND` | Route không tồn tại | `NotFoundException` của Nest |
| 404 | `PRODUCT_NOT_FOUND` | Sản phẩm không tồn tại hoặc đã xóa mềm | Service |
| 404 | `ORDER_NOT_FOUND` | Đơn không tồn tại | Service |
| 409 | `SKU_ALREADY_EXISTS` | Trùng SKU | Postgres `23505` trên `uq_products_sku_active` |
| 409 | `INSUFFICIENT_STOCK` | Không đủ tồn kho | Service. Postgres `23514` trên `chk_products_stock_non_negative` (lớp chặn cuối) |
| 409 | `INVALID_ORDER_STATUS` | Hủy đơn ở trạng thái không cho phép | Service |
| 409 | `CONFLICT` | Vi phạm ràng buộc khác (`23505`, `23503`, `23514`) chưa có mã riêng | Filter |
| 503 | `SERVICE_UNAVAILABLE` | Hết thời gian chờ khóa (`55P03`), deadlock (`40P01`), Redis không kết nối được (chỉ ở `GET /orders/:id/jobs` và `/health`) | Filter |
| 4xx khác | Tên HTTP status, ví dụ `PAYLOAD_TOO_LARGE` | Lỗi do Nest/Express sinh ra mà không có mã riêng, ví dụ body lớn hơn 100 KB (413) | Filter (`HttpException`, lỗi `http-errors` của body-parser) |
| 500 | `INTERNAL_ERROR` | Lỗi không mong đợi | Filter |

`AllExceptionsFilter` ánh xạ `QueryFailedError` dựa trên `driverError.code` và `driverError.constraint`. Đây là lý do tên constraint phải được đặt rõ ràng ([03 §4](03-database.md#4-ddl-tham-chiếu)).

---

## 6. Yêu cầu với Swagger

- `@ApiTags('products' | 'orders' | 'health')`, `@ApiOperation({ summary })` cho mọi endpoint.
- Mọi DTO có `@ApiProperty` hoặc `@ApiPropertyOptional` kèm `example`, `minimum`, `maximum`, `enum`.
- Khai báo response lỗi bằng `@ApiResponse({ status, type: ErrorResponseDto })` cho các mã ở bảng trên, qua decorator `@ApiErrorResponse(HttpStatus.NOT_FOUND, ErrorCode.PRODUCT_NOT_FOUND, 'Product does not exist or was deleted')` (`src/common/decorators/api-error-response.decorator.ts`). Mỗi decorator ứng với một status và ghi rõ mã lỗi trong mô tả.
- Response phân trang có schema rõ ràng (`PaginatedProductsDto`, `PaginatedOrdersDto`).
- Truy cập được tại `/api/docs` trên bản deploy. Asset UI tải từ CDN ([08 §4.3](08-deployment.md#43-lưu-ý-khi-chạy-nestjs-trên-vercel)).
