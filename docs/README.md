# Mini Order Management — Bộ tài liệu đặc tả

> Phiên bản: 1.0 · Cập nhật: 2026-10-14

Đây là backend quản lý **sản phẩm**, **tồn kho** và **đơn hàng** cho một cửa hàng online nhỏ.
Khi khách đặt hàng, hệ thống trừ kho và tạo đơn ngay trong **một transaction** (đồng bộ).
Phần xử lý đơn (xác nhận đơn, ghi thông báo, thử lại khi lỗi, hoàn kho khi thất bại) chạy **nền** bằng BullMQ, khách không phải chờ.

**Stack bắt buộc:** NestJS · PostgreSQL + TypeORM (dùng migration, không dùng `synchronize`) · BullMQ + Redis · Swagger.

---

## Mục lục

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 01 | [Yêu cầu (SRS)](01-requirements.md) | Yêu cầu chức năng và phi chức năng có mã, tiêu chí chấp nhận, giả định, phần ngoài phạm vi |
| 02 | [Kiến trúc](02-architecture.md) | Các thành phần, tiến trình API/Worker, cấu trúc module, biến môi trường, quy ước code |
| 03 | [Thiết kế dữ liệu](03-database.md) | ERD, đặc tả bảng/cột/ràng buộc/index, xóa mềm, xử lý tiền, kế hoạch migration |
| 04 | [Đặc tả API](04-api-spec.md) | Endpoint, quy tắc validate DTO, response mẫu, định dạng lỗi và danh mục mã lỗi |
| 05 | [Luồng xử lý đơn & job](05-order-processing.md) | Máy trạng thái, BullMQ, retry/backoff, idempotency, job định kỳ, các tình huống race |
| 06 | [Chống bán vượt tồn kho](06-concurrency.md) | Phân tích race condition, giải pháp khóa dòng, chống deadlock, cách kiểm chứng |
| 07 | [Kế hoạch kiểm thử](07-testing.md) | 3 unit test bắt buộc, test bổ sung, test đồng thời, kịch bản test thủ công |
| 08 | [Triển khai](08-deployment.md) | Chạy local, docker-compose, deploy API (Vercel) và worker (Railway), migration production |
| 09 | [Kế hoạch thực hiện](09-implementation-plan.md) | Thứ tự làm, kế hoạch commit, Definition of Done, checklist nộp bài, chuẩn bị phỏng vấn |
| 10 | [Nhật ký quyết định kỹ thuật (ADR)](10-technical-decisions.md) | 28 quyết định: lựa chọn, lý do, phương án đã cân nhắc, trạng thái duyệt |

**Thứ tự nên đọc:** 10 (bảng tổng hợp) → 01 → 03 → 06 → 05 → 04 → 02 → 07 → 08 → 09.
Bên chấm bài đánh giá cao **tính đúng khi có nhiều request đồng thời**, **xử lý lỗi/retry**, **thiết kế dữ liệu** và **code dễ đọc**. Các tài liệu 03, 05, 06 là phần lõi.

---

## Các quyết định thiết kế chính

Danh sách đầy đủ, lý do và trạng thái duyệt nằm trong [10 — Nhật ký quyết định kỹ thuật](10-technical-decisions.md).

| Chủ đề | Quyết định | Lý do ngắn gọn | ADR |
|---|---|---|---|
| Chống bán vượt | Khóa dòng sản phẩm bằng `SELECT … FOR UPDATE` (theo thứ tự `id` tăng dần) trong transaction tạo đơn, kèm `CHECK (stock >= 0)` làm lớp bảo vệ cuối | Đúng tuyệt đối ở mức READ COMMITTED, báo lỗi chi tiết cho từng sản phẩm, thứ tự khóa cố định nên không deadlock | [002](10-technical-decisions.md#adr-002-chống-bán-vượt-tồn-kho) |
| Thời điểm trừ kho | Trừ ngay khi tạo đơn (ở API), **không** trừ trong job | Job retry không bao giờ trừ kho thêm lần nữa, khách biết hết hàng ngay lập tức | [012](10-technical-decisions.md#adr-012-thời-điểm-trừ-kho) |
| Đẩy job | **Transactional Outbox**: transaction tạo đơn ghi `outbox_events`, relay trong worker đẩy sang BullMQ | Không bao giờ mất job. `POST /orders` không phụ thuộc Redis | [003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox) |
| Idempotency | Chuyển trạng thái bằng CAS (`UPDATE … WHERE status IN (…)`). Chỉ hoàn kho/ghi thông báo khi CAS thành công. `UNIQUE(order_id, type)` cho thông báo, `jobId` cố định `order-{orderId}` | Nhiều lớp bảo vệ: queue, processor, DB, constraint | [015](10-technical-decisions.md#adr-015-chuyển-trạng-thái-bằng-cas), [016](10-technical-decisions.md#adr-016-jobid-cố-định) |
| Retry | `attempts = 4` (lần đầu và 3 retry), backoff exponential 2s → 4s → 8s, cấu hình được qua env | Hiểu "retry tối đa 3 lần" theo nghĩa đen | [001](10-technical-decisions.md#adr-001-số-lần-chạy-job-và-backoff) |
| Thông báo | Ghi vào bảng `notification_logs`, không chỉ ghi log | Kiểm chứng được, có ràng buộc UNIQUE để chặn bản ghi trùng | [018](10-technical-decisions.md#adr-018-lưu-thông-báo) |
| Deploy | API trên Vercel. Worker (relay + BullMQ) trên Railway. Redis Cloud. Neon | Serverless không giữ được tiến trình chạy lâu mà relay và worker cần | [005](10-technical-decisions.md#adr-005-nơi-chạy-worker), [006](10-technical-decisions.md#adr-006-redis-production) |
| Khóa chính | UUID (`gen_random_uuid()`). Riêng outbox dùng `bigint identity` | Không đoán được id, không lộ số lượng đơn | [008](10-technical-decisions.md#adr-008-khóa-chính) |
| Tiền | `bigint`, đơn vị VND | VND không có đơn vị lẻ, số nguyên loại bỏ sai số | [007](10-technical-decisions.md#adr-007-kiểu-dữ-liệu-tiền) |
| SKU | Duy nhất trong các sản phẩm **chưa xóa** (partial unique index), chuẩn hóa chữ in hoa | Xóa mềm xong vẫn dùng lại được SKU | [009](10-technical-decisions.md#adr-009-quy-tắc-duy-nhất-của-sku) |

---

## Quy ước trong tài liệu

- **Mã yêu cầu:** `FR-P..` (Products), `FR-O..` (Orders), `FR-Q..` (Queue), `FR-G..` (yêu cầu chung), `NFR-..` (phi chức năng).
- **Mã test:** `UT-..` (unit test), `IT-..` (integration/đồng thời), `MT-..` (test thủ công).
- **Mức ưu tiên:** `MUST` (bắt buộc theo đề), `SHOULD` (nên có), `BONUS` (điểm cộng).

## Thuật ngữ

| Thuật ngữ | Ý nghĩa |
|---|---|
| Tồn kho (stock) | Số lượng còn có thể bán của một sản phẩm |
| Trừ kho / giữ hàng (reserve) | Giảm `stock` khi đơn được tạo |
| Hoàn kho (release / restock) | Cộng lại `stock` khi đơn bị hủy, thất bại hoặc hết hạn |
| Snapshot giá | Lưu `unitPrice` (và tên, SKU) của sản phẩm tại thời điểm đặt vào `order_items` |
| Xóa mềm (soft delete) | Đặt `deleted_at`, không xóa dòng khỏi DB |
| Job / Attempt | Một đơn vị công việc trong BullMQ / một lần chạy job đó |
| Idempotent | Chạy lại nhiều lần cho cùng kết quả như chạy một lần, không lặp lại tác dụng phụ |
| CAS (compare-and-set) | Câu `UPDATE` có điều kiện trên trạng thái hiện tại. Chỉ một tiến trình thắng |
| Outbox / Relay | Bảng `outbox_events` lưu sự kiện cần đẩy, ghi cùng transaction với đơn / tiến trình trong worker đọc outbox và đẩy thành job |
| Producer / Worker | Bên đẩy job vào queue (relay outbox) / bên lấy job ra xử lý (tiến trình worker) |
