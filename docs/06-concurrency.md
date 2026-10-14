# 06 — Chống bán vượt tồn kho

> Yêu cầu FR-O02: *"Nếu 2 khách cùng đặt món cuối cùng ở cùng một lúc, chỉ 1 đơn được tạo."* Quyết định: [ADR-002](10-technical-decisions.md#adr-002-chống-bán-vượt-tồn-kho), [ADR-013](10-technical-decisions.md#adr-013-chống-deadlock), [ADR-014](10-technical-decisions.md#adr-014-mức-cô-lập-và-thời-gian-chờ-khóa).
> Đây là tiêu chí được đánh giá cao nhất. Tài liệu này giải thích vấn đề, các phương án, phương án được chọn và cách chứng minh nó đúng.

## 1. Vấn đề

Việc tạo đơn gồm ba bước **đọc, kiểm tra, ghi**: đọc `stock`, so với `quantity`, rồi ghi `stock` mới. Nếu hai transaction cùng đọc trước khi bên nào kịp ghi, cả hai đều thấy "đủ hàng". Đây là race condition kiểu *check-then-act*.

Mutex trong bộ nhớ Node.js **không giải quyết được**: API chạy nhiều instance (Vercel có thể khởi động N instance song song), mỗi instance có bộ nhớ riêng. Điểm đồng bộ duy nhất mà mọi instance dùng chung là **database**.

## 2. Minh họa race condition khi không khóa

Sản phẩm P có `stock = 1`. Khách A và khách B cùng đặt 1 cái.

| Thời điểm | Transaction A | Transaction B | `stock` trong DB |
|---|---|---|---|
| t1 | `SELECT stock` → 1 (đủ) | | 1 |
| t2 | | `SELECT stock` → 1 (đủ) | 1 |
| t3 | `UPDATE … SET stock = 0` | | 0 |
| t4 | `INSERT order A`, `COMMIT` | | 0 |
| t5 | | `UPDATE … SET stock = 0` *(giá trị tính từ lần đọc ở t2)* | 0 |
| t6 | | `INSERT order B`, `COMMIT` | 0 |

Kết quả: **2 đơn cho 1 sản phẩm**, và `stock` vẫn là 0 nên không ai phát hiện (lost update).
Nếu ghi bằng `stock = stock - 1` thay vì giá trị tính sẵn, B sẽ đưa `stock` về `-1`. Ràng buộc `CHECK (stock >= 0)` chặn được trường hợp này, nhưng lỗi lúc đó là lỗi DB thô chứ không phải một quyết định nghiệp vụ rõ ràng.

## 3. Các phương án

| Phương án | Cách làm | Đúng? | Ưu điểm | Nhược điểm |
|---|---|---|---|---|
| A. Kiểm tra ở app, không khóa | `SELECT` rồi `if` rồi `UPDATE` | ✗ | Đơn giản | Race như §2 |
| B. `UPDATE` có điều kiện | `UPDATE products SET stock = stock - $q WHERE id = $id AND stock >= $q AND deleted_at IS NULL RETURNING …`. Không có dòng nào thì báo lỗi | ✓ | Một câu cho mỗi sản phẩm, không cần khóa tường minh | Không phân biệt được "không tồn tại" với "thiếu hàng" nếu không truy vấn thêm. Khó báo lỗi cho **tất cả** item thiếu. Vẫn phải sắp xếp để chống deadlock |
| **C. Khóa bi quan `SELECT … FOR UPDATE`** | Khóa các dòng sản phẩm, kiểm tra ở app, rồi `UPDATE` | ✓ | Đọc giá và tồn kho trên dữ liệu đã khóa. Báo lỗi chi tiết cho mọi item. Dễ giải thích, dễ test | Các request cùng sản phẩm chạy tuần tự. Đây chính là hành vi mong muốn, và khóa chỉ giữ vài ms |
| D. Khóa lạc quan (cột `version`) | `UPDATE … WHERE version = $v`. Xung đột thì retry | ✓ | Không giữ khóa | Với hàng "hot" (món cuối), số lần retry tăng vọt. Phải viết thêm vòng retry |
| E. Mức cô lập `SERIALIZABLE` | Để Postgres phát hiện xung đột | ✓ | Không phải tự lo khóa | Phải retry khi gặp lỗi `40001`. Khó dự đoán, tốn tài nguyên hơn |
| F. Khóa hoặc đếm trên Redis | `SETNX` lock, hoặc `DECR` tồn kho trong Redis | ~ | Nhanh | Có hai nguồn sự thật (Redis và DB) phải đồng bộ. Quá phức tạp so với quy mô bài |

## 4. Giải pháp được chọn

**Phương án C**, kết hợp:

1. Khóa **tất cả** sản phẩm của đơn trong **một** câu `SELECT … FOR UPDATE`, với `ORDER BY id` để có thứ tự khóa cố định.
2. Kiểm tra tồn kho ở tầng app, gom **mọi** item thiếu để báo lỗi `409` một lần.
3. Trừ kho bằng `stock = stock - $q` (không ghi giá trị tính sẵn).
4. `CHECK (stock >= 0)` ở DB làm lớp chặn cuối cùng.
5. Toàn bộ nằm trong **một transaction** ở mức `READ COMMITTED` (mặc định của Postgres).

### 4.1 SQL thực tế

```sql
BEGIN;
SELECT set_config('lock_timeout', '5000ms', true);  -- = SET LOCAL lock_timeout, nhưng nhận được tham số (§8)

SELECT id, sku, name, price, stock
  FROM products
 WHERE id IN ($1, $2)
   AND deleted_at IS NULL
 ORDER BY id
   FOR UPDATE;
-- app: kiểm tra tồn tại và tồn kho. Có lỗi thì ROLLBACK và trả 404/409

-- theo thứ tự id mà câu khóa trả về; TypeORM sinh stock = stock + $delta với $delta = -q
UPDATE products SET stock = stock - $q1, updated_at = now() WHERE id = $1;
UPDATE products SET stock = stock - $q2, updated_at = now() WHERE id = $2;
INSERT INTO orders (...) VALUES (...) RETURNING id, status, created_at, updated_at;
INSERT INTO order_items (...) VALUES (...), (...);
INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('ORDER', $orderId, 'ORDER_CREATED', $payload);
COMMIT;
-- relay trong worker sẽ đẩy job process-order (ADR-003), không có I/O Redis ở đây
```

### 4.2 TypeORM

```ts
// products/product-stock.repository.ts (rút gọn)
@Injectable()
export class ProductStockRepository {
  /** Khóa các sản phẩm còn hoạt động theo thứ tự id tăng dần (SELECT … FOR UPDATE). */
  findActiveForUpdate(manager: EntityManager, productIds: string[]): Promise<Product[]> {
    return manager
      .createQueryBuilder(Product, 'product')
      .where('product.id IN (:...productIds)', { productIds })
      .orderBy('product.id', 'ASC')          // thứ tự khóa cố định, chống deadlock
      .setLock('pessimistic_write')          // Postgres: FOR UPDATE
      .getMany();                            // TypeORM tự thêm "product.deleted_at IS NULL"
  }

  decrementStock(manager: EntityManager, productId: string, quantity: number) {
    return this.addToStock(manager, productId, -quantity);   // stock = stock - quantity
  }

  /** Hoàn kho, không lọc deleted_at (A-07). */
  incrementStock(manager: EntityManager, productId: string, quantity: number) {
    return this.addToStock(manager, productId, quantity);
  }

  private async addToStock(manager: EntityManager, productId: string, delta: number) {
    await manager
      .createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock + :delta' }) // TypeORM tự thêm updated_at = CURRENT_TIMESTAMP
      .where('id = :productId')
      .setParameters({ productId, delta })
      .execute();
  }
}
```

Với TypeORM 1.1 (đã kiểm tra bằng log SQL): câu khóa là **một** câu `SELECT … WHERE (id IN ($1, $2)) AND (deleted_at IS NULL) ORDER BY id ASC FOR UPDATE` (không có join hay `LIMIT` nên không bị tách thành hai câu), và `UPDATE` không tự thêm điều kiện `deleted_at`. Không dùng `manager.decrement()`/`increment()`, vì hai hàm này ghép thẳng giá trị vào chuỗi SQL thay vì truyền tham số.

> Không `JOIN` trong câu khóa: Postgres không cho `FOR UPDATE` trên phía nullable của `LEFT JOIN`, và join sẽ khóa thừa các dòng khác.

### 4.3 Diễn biến khi hai khách cùng mua món cuối

```mermaid
sequenceDiagram
  participant A as Request A
  participant DB as PostgreSQL (P.stock = 1)
  participant B as Request B

  A->>DB: BEGIN, SELECT P FOR UPDATE
  DB-->>A: stock = 1, A giữ khóa dòng P
  B->>DB: BEGIN, SELECT P FOR UPDATE
  Note over B,DB: B bị chặn, chờ A nhả khóa
  A->>DB: UPDATE P SET stock = stock - 1 (còn 0)
  A->>DB: INSERT order A, COMMIT (nhả khóa)
  DB-->>B: stock = 0 (phiên bản mới nhất sau khi A commit)
  B->>DB: ROLLBACK
  Note over B: trả 409 INSUFFICIENT_STOCK
```

### 4.4 Vì sao `READ COMMITTED` là đủ

- Khi `SELECT … FOR UPDATE` gặp một dòng đang bị transaction khác khóa, nó **chờ**. Sau khi bên kia commit, Postgres **đọc lại phiên bản mới nhất** của dòng và **đánh giá lại `WHERE`**. Vì vậy B thấy `stock = 0`, không phải giá trị cũ. Nếu dòng vừa bị xóa mềm thì nó không còn khớp `deleted_at IS NULL`, và B nhận `404`.
- Ở `REPEATABLE READ` hoặc `SERIALIZABLE`, B sẽ gặp lỗi `40001 could not serialize access` và phải retry. Như vậy phức tạp hơn mà không đúng hơn.

### 4.5 Tối ưu tùy chọn

`UPDATE` cột không phải khóa chỉ cần `FOR NO KEY UPDATE` (TypeORM: `setLock('for_no_key_update')`). Khóa này không xung đột với `FOR KEY SHARE` mà kiểm tra khóa ngoại sử dụng. Với bài này `FOR UPDATE` là đủ và dễ giải thích hơn.

## 5. Chống deadlock

**Kịch bản:** đơn A gồm `[P1, P2]`, đơn B gồm `[P2, P1]`. Nếu không sắp xếp: A khóa P1, B khóa P2, A chờ P2, B chờ P1. Kết quả là deadlock. Postgres phát hiện sau `deadlock_timeout` (1s) và hủy một bên với lỗi `40P01`.

**Giải pháp: mọi transaction khóa các dòng `products` theo cùng một thứ tự (`id` tăng dần).**

| Thao tác | Cách đảm bảo thứ tự |
|---|---|
| Tạo đơn | `SELECT … ORDER BY id FOR UPDATE` khóa tất cả trong một câu, theo thứ tự của Postgres |
| Hoàn kho (hủy / thất bại / hết hạn) | `SELECT product_id, quantity FROM order_items … ORDER BY product_id`, rồi `UPDATE` lần lượt theo đúng thứ tự đó. Không dùng `UPDATE … FROM` vì thứ tự khóa không xác định |
| Thứ tự giữa các bảng | Những transaction chạm cả `orders` và `products` (hủy, thất bại, hết hạn) đều khóa dòng `orders` trước (CAS) rồi mới khóa `products`. Transaction tạo đơn chỉ khóa `products` và insert một đơn **mới**, không khóa đơn nào đang tồn tại. Không có chu trình chờ |

> Thứ tự sắp xếp do **Postgres** quyết định (`ORDER BY` trong SQL). Code TypeScript không tự sắp xếp chuỗi UUID để quyết định thứ tự khóa. `productId` trong DTO được chuẩn hóa thành chữ thường để khớp với giá trị Postgres trả về khi tra `Map`.

Nếu vẫn gặp `40P01` (không mong đợi), filter ánh xạ sang `503 SERVICE_UNAVAILABLE` để client thử lại, và log `ERROR` để điều tra.

## 6. Các điểm đồng thời khác

| Tình huống | Cơ chế | Kết quả |
|---|---|---|
| Chuyển trạng thái đơn (hủy / xác nhận / thất bại / hết hạn) | CAS `UPDATE … WHERE status = ANY($from)` ([05 §2.1](05-order-processing.md#21-thao-tác-cas-dùng-chung)) | Mỗi đơn rời một trạng thái đúng một lần, kho chỉ hoàn một lần |
| Hai `POST /products` cùng SKU | Partial unique index `uq_products_sku_active` | Một request `201`, một request `409`. **Không** dựa vào "kiểm tra rồi insert" ở app |
| `PATCH` giá trong lúc có người đặt hàng | `UPDATE` phải chờ khóa dòng | Đơn dùng giá tại thời điểm nó giữ khóa. Nhất quán |
| `DELETE` sản phẩm trong lúc có người đặt hàng | Như trên, cộng với việc đánh giá lại `deleted_at IS NULL` | Hoặc đơn được tạo trước khi xóa, hoặc đơn nhận `404` |
| `PATCH` `stock` (đặt giá trị tuyệt đối) | `UPDATE` là nguyên tử, nhưng **về mặt nghĩa** có thể ghi đè: quản trị viên thấy 10 và muốn "+5" nên đặt 15, trong khi một đơn vừa trừ còn 9 | **Hạn chế đã biết** (A-13). Cải tiến: endpoint điều chỉnh theo delta (`stock = stock + $delta`) hoặc khóa lạc quan với `If-Match`/`version` |

## 7. Phòng thủ nhiều lớp

| Lớp | Cơ chế | Vai trò |
|---|---|---|
| 1 | `SELECT … FOR UPDATE` và kiểm tra trong app | Quyết định nghiệp vụ, thông báo lỗi rõ ràng |
| 2 | `stock = stock - $q` (tương đối, không ghi giá trị tính sẵn) | Không mất cập nhật kể cả khi lớp 1 có lỗi |
| 3 | `CHECK (stock >= 0)` | DB từ chối mọi trạng thái âm. Lỗi `23514` được ánh xạ sang `409 INSUFFICIENT_STOCK` |
| 4 | Transaction | Tất cả hoặc không có gì: không thể trừ kho mà không có đơn, hoặc ngược lại |

## 8. Vận hành và giới hạn

- **Transaction ngắn:** không có I/O mạng nào khác trong transaction (job được relay outbox đẩy sau, ở worker), nên khóa chỉ giữ vài ms.
- **`lock_timeout`:** tương đương `SET LOCAL lock_timeout = '5s'` (`DB_LOCK_TIMEOUT_MS`). Quá thời gian thì lỗi `55P03`, ánh xạ sang `503`, thay vì treo request vô thời hạn. Lệnh `SET` không nhận tham số (`$1`), nên code chạy `SELECT set_config('lock_timeout', $1, true)`: tham số thứ ba `true` nghĩa là chỉ áp dụng cho transaction hiện tại, giống `SET LOCAL`.
- **Connection pool:** mỗi transaction đang chờ khóa giữ một connection. Với một sản phẩm cực "hot", request sẽ xếp hàng ở pool. Ở quy mô bài này điều đó chấp nhận được. Trên Vercel nên dùng pooled connection của Neon và `DATABASE_POOL_MAX` nhỏ.
- **Nhiều instance:** khóa nằm trong DB nên vẫn đúng với bất kỳ số instance API hay worker nào.

## 9. Kiểm chứng

| Mã | Kịch bản | Kỳ vọng |
|---|---|---|
| IT-01 | `stock = 1`, 20 request đồng thời `quantity = 1` | Đúng 1 request `201`, 19 request `409`, `stock = 0`, có đúng 1 đơn trong DB |
| IT-02 | `stock = 10`, 30 request đồng thời, `quantity` ngẫu nhiên 1–3 | `Σ quantity` của các đơn thành công `≤ 10` và `stock_cuối = 10 − Σ`. Không có `500` |
| IT-02b | 2 sản phẩm, một nửa request đặt `[P1, P2]`, nửa còn lại đặt `[P2, P1]` | Không có lỗi `40P01`/`503` |
| IT-03 | 5 request hủy đồng thời cùng một đơn | 1 request `200`, 4 request `409`. Kho chỉ được hoàn một lần |

Các test trên nằm trong `test/concurrency.e2e-spec.ts` (`npm run test:e2e`, chi tiết ở [07 §5](07-testing.md#5-integration-test-và-test-đồng-thời)). IT-01 còn kiểm tra mọi `409` đều có `details` với `available: 0`: chúng bị từ chối bởi bước kiểm tra tồn kho dưới khóa, không phải bởi `CHECK`.

> Về IT-02b: câu khóa là **một** câu `WHERE id IN (...) FOR UPDATE`, nên Postgres khóa các dòng theo thứ tự của kế hoạch thực thi (index scan trên khóa chính trả về theo `id`), giống nhau cho mọi transaction, bất kể thứ tự client gửi. Đã thử tạm bỏ `ORDER BY id`: IT-02b vẫn pass. `ORDER BY id` giữ thứ tự đó một cách tường minh thay vì phụ thuộc vào kế hoạch thực thi. Deadlock sẽ xảy ra nếu code khóa từng sản phẩm bằng các câu riêng theo thứ tự client gửi.

### 9.1 Script thủ công

`src/scripts/race-last-item.ts` tạo một sản phẩm `stock = 1`, gửi N đơn `quantity = 1` cùng lúc tới một API đang chạy (local hoặc bản deploy), rồi in kết quả theo từng loại response và tồn kho cuối:

```bash
npm run race:last-item                                        # http://localhost:3000, 20 đơn
npm run race:last-item -- https://<project>.vercel.app 50     # API khác, 50 đơn
```

Script phân biệt hai loại `409 INSUFFICIENT_STOCK`: có `details` là do bước kiểm tra của `OrdersService`, không có `details` là do `CHECK (stock >= 0)` của Postgres (lỗi `23514`, `AllExceptionsFilter` ánh xạ sang `409` không kèm `details`). Script trả exit code 1 nếu có hơn một đơn được tạo hoặc tồn kho âm.

### 9.2 Thí nghiệm bỏ khóa

Chạy ngày 2026-10-15 trên máy local (API `node dist/main.js` với `DATABASE_POOL_MAX=20`, DB tạm `mini_oms_race`). Thay đổi code chỉ là tạm thời, **không commit**:

| # | Cấu hình | Kết quả (20 đơn đồng thời, `stock = 1`) |
|---|---|---|
| 1 | Code hiện tại (có `FOR UPDATE` và `CHECK`) | 1 × `201`, 19 × `409` từ `OrdersService`, `stock = 0`. Với 50 đơn: 1 × `201`, 49 × `409` |
| 2 | Tạm xóa dòng `.setLock('pessimistic_write')` trong `ProductStockRepository.findActiveForUpdate` | Vẫn 1 × `201`, `stock = 0`, nhưng 10–19 trong số các `409` là do `CHECK`: nhiều request cùng đọc `stock = 1`, cùng qua bước kiểm tra, rồi `UPDATE … stock = stock - 1` của chúng chờ nhau trên khóa dòng mà `UPDATE` tự lấy, và bị `CHECK` từ chối khi kết quả là `-1` |
| 3 | Như #2, và thêm `ALTER TABLE products DROP CONSTRAINT chk_products_stock_non_negative` trên DB tạm | **Bán vượt:** 20 × `201`, `stock = -19`. Với 50 đơn: 20 × `201` (đúng bằng số connection của pool, các transaction đọc tồn kho cùng lúc), 30 × `409`, `stock = -19` |

Cách tự làm lại:

1. Tạo DB tạm và chạy migration: `docker exec mini-oms-postgres createdb -U postgres mini_oms_race`, rồi chạy `npm run migration:run` với `DATABASE_URL=postgres://postgres:postgres@localhost:5432/mini_oms_race` (bash: đặt biến ngay trước lệnh, PowerShell: `$env:DATABASE_URL = "…"` rồi chạy lệnh).
2. Xóa dòng `.setLock('pessimistic_write')`, `npm run build`, chạy API (`node dist/main.js`) với `DATABASE_URL` trỏ vào DB tạm, rồi `npm run race:last-item`.
3. Bỏ `CHECK` trên DB tạm: `docker exec mini-oms-postgres psql -U postgres -d mini_oms_race -c "ALTER TABLE products DROP CONSTRAINT chk_products_stock_non_negative"`, chạy lại script.
4. Khôi phục: `git checkout -- src/products/product-stock.repository.ts`, `npm run build`, `docker exec mini-oms-postgres dropdb -U postgres mini_oms_race`.

Kết luận: `FOR UPDATE` là thứ quyết định nghiệp vụ (mọi request bị từ chối đều nhận lỗi chi tiết). Trừ kho tương đối cùng `CHECK` là lớp phòng thủ khiến việc bỏ khóa không làm âm kho, nhưng client nhận lỗi DB không có `details`. Bỏ cả hai thì bán vượt thật.

## 10. Ý chính khi trình bày

1. DB là điểm đồng bộ duy nhất giữa các instance, nên khóa phải nằm trong DB.
2. `SELECT … FOR UPDATE` tuần tự hóa các transaction trên **cùng** sản phẩm. Các sản phẩm khác nhau vẫn chạy song song.
3. Ở `READ COMMITTED`, sau khi chờ khóa, Postgres đọc lại phiên bản mới nhất, nên bên đến sau thấy tồn kho đã bị trừ.
4. Thứ tự khóa cố định theo `id` loại bỏ deadlock.
5. `CHECK (stock >= 0)` là lưới an toàn cuối cùng. Job đi qua outbox, nên transaction giữ khóa không chứa I/O Redis.
6. Đã chứng minh bằng test đồng thời (IT-01/02) chứ không chỉ bằng lập luận.
