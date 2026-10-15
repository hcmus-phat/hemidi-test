# 02 — Kiến trúc hệ thống

## 1. Tổng quan

```mermaid
flowchart LR
  C["Client / Swagger UI"] -->|"HTTPS REST"| API

  subgraph VERCEL["Vercel (serverless)"]
    API["API — NestJS<br/>Products · Orders"]
  end

  subgraph RAILWAY["Railway (tiến trình chạy lâu dài)"]
    W["Worker — NestJS application context<br/>Outbox relay · OrderProcessingProcessor · Job scheduler"]
  end

  API -->|"SQL (transaction, ghi outbox_events)"| PG[("PostgreSQL<br/>Neon")]
  API -.->|"chỉ đọc trạng thái job"| R[("Redis Cloud<br/>queue: order-processing")]
  W -->|"relay: Queue.add(), worker: lấy job"| R
  W -->|"SQL (transaction, đọc outbox)"| PG
```

- **API** xử lý HTTP và mọi nghiệp vụ đồng bộ (CRUD, tạo/hủy đơn). API **không đẩy job trực tiếp**: transaction tạo đơn ghi sự kiện vào bảng `outbox_events` ([ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox)). API chỉ dùng Redis để đọc trạng thái job (`GET /orders/:id/jobs`).
- **Worker** là một tiến trình riêng, không mở cổng HTTP. Nó chạy **relay outbox** (đẩy sự kiện thành job), tiêu thụ queue `order-processing`, và đăng ký job scheduler `expire-pending-orders`.
- **PostgreSQL** là nguồn sự thật duy nhất cho tồn kho và trạng thái đơn.
- **Redis** chỉ chứa queue (job, retry, lịch). Mất dữ liệu Redis không làm sai tồn kho, chỉ làm chậm việc xử lý đơn (xem [05 §11](05-order-processing.md#11-các-chế-độ-lỗi-hạ-tầng)).

## 2. Hai tiến trình, một codebase

| | API | Worker |
|---|---|---|
| Entry point | `src/main.ts` (local/Docker), `api/index.js` → `dist/vercel.js` (Vercel, từ `src/vercel.ts`) | `src/worker.ts` |
| Bootstrap | `NestFactory.create(AppModule)` | `NestFactory.createApplicationContext(WorkerModule)` |
| Module gốc | `AppModule` | `WorkerModule` |
| BullMQ | `Queue`: chỉ `getJob` (đọc trạng thái) | `Queue.add` (relay outbox), `Worker` (`@Processor`), `upsertJobScheduler` |
| Outbox | Ghi `outbox_events` trong transaction tạo đơn | `OutboxRelayService` quét và đẩy sự kiện |
| Chạy ở | Vercel | Railway (hoặc Render/Fly.io) |
| Số instance | Tùy Vercel (0..N) | 1 (có thể scale ngang, BullMQ đảm bảo mỗi job chỉ một worker xử lý) |

> **Quan trọng:** `AppModule` **không được** import các class `@Processor` hay `OutboxRelayService`. Nếu import, `@nestjs/bullmq` sẽ khởi tạo `Worker` (và relay sẽ chạy vòng lặp) ngay trong function serverless. Function đó bị đóng băng sau mỗi response, dẫn đến job bị kẹt hoặc bị đánh dấu stalled.

## 3. Công nghệ

| Hạng mục | Lựa chọn | Ghi chú |
|---|---|---|
| Runtime | Node.js 22 LTS (`engines.node`: `^22.13`) | Giới hạn ở major 22 để Vercel và Railway deploy cùng major đã test ([08 §4.1](08-deployment.md#41-handler-serverless)). TypeORM 1.x yêu cầu `^20.19 \|\| ^22.13 \|\| >=24.11`. NestJS 12 chỉ phát hành dạng ES module, còn dự án biên dịch ra CommonJS và dựa vào `require(esm)` có sẵn từ Node 22.12 ([ADR-029](10-technical-decisions.md#adr-029-phiên-bản-thư-viện)). Nest CLI (dev-only) khai báo Node ≥ 22.22.3, trên bản cũ hơn `npm ci` chỉ in cảnh báo `EBADENGINE` ([08 §2.1](08-deployment.md#21-yêu-cầu)) |
| Framework | NestJS 12 | `@nestjs/config`, `@nestjs/typeorm`, `@nestjs/bullmq`, `@nestjs/swagger` ([ADR-029](10-technical-decisions.md#adr-029-phiên-bản-thư-viện)) |
| ORM | TypeORM 1.x | `synchronize: false`, migration bằng TypeORM CLI |
| DB | PostgreSQL 16 (local), Neon (production) | `gen_random_uuid()` có sẵn từ PG13 |
| Queue | BullMQ 6.x, `@nestjs/bullmq` 12, ioredis 5.x | Job scheduler dùng `upsertJobScheduler`. BullMQ 6 coi `ioredis` là peer dependency tùy chọn nên dự án tự khai báo nó ([ADR-029](10-technical-decisions.md#adr-029-phiên-bản-thư-viện)) |
| Redis | Redis 7 (local), Redis Cloud (production) | Bắt buộc `maxmemory-policy noeviction` ([ADR-006](10-technical-decisions.md#adr-006-redis-production)) |
| Validate | class-validator, class-transformer | `ValidationPipe` toàn cục |
| Test | Jest (`@nestjs/testing`), ts-jest | Unit test có mock. Integration test dùng Postgres/Redis của docker-compose. Jest trên Node 22 không `require()` được ES module, nên các gói `@nestjs/*` được chuyển sang CommonJS khi test bằng `test/esm-to-cjs.transformer.js` ([ADR-029](10-technical-decisions.md#adr-029-phiên-bản-thư-viện)) |
| Lint/format | ESLint (flat config, typescript-eslint type-checked), Prettier | Kết thúc dòng LF (`.gitattributes`) |

## 4. Cấu trúc thư mục

```text
.
├── api/
│   └── index.js                      # Function của Vercel: export handler của dist/vercel.js
├── public/
│   └── .gitkeep                      # Thư mục output rỗng mà Vercel (preset Other) yêu cầu
├── src/
│   ├── main.ts                       # Bootstrap HTTP (local)
│   ├── vercel.ts                     # Handler serverless: tạo Nest app một lần mỗi instance, không listen(), lỗi khởi động không bị cache
│   ├── worker.ts                     # Bootstrap worker (không HTTP), shutdown hooks + exitIfShutdownHangs
│   ├── app.module.ts                 # Module gốc của API
│   ├── worker.module.ts              # Module gốc của worker (chứa processor + scheduler)
│   ├── bootstrap/
│   │   ├── configure-app.ts          # ValidationPipe, exception filter, Swagger (dùng chung main.ts, vercel.ts và test e2e)
│   │   ├── swagger.ts                # DocumentBuilder, /api/docs, asset Swagger UI từ CDN
│   │   └── shutdown-watchdog.ts      # exitIfShutdownHangs(): sau SIGTERM/SIGINT, quá 10s chưa tắt xong thì exit(1) (API và worker)
│   ├── config/
│   │   ├── configuration.ts          # Đọc env, trả về object cấu hình có kiểu
│   │   └── env.validation.ts         # Validate env lúc khởi động (sai thì dừng ngay)
│   ├── database/
│   │   ├── database.module.ts        # TypeOrmModule.forRootAsync, dùng chung AppModule và WorkerModule. Khởi động: thử kết nối 3 lần, cách nhau 2s
│   │   ├── typeorm.options.ts        # Options dùng chung cho app và CLI (pool, SSL, connectTimeoutMS 5s)
│   │   ├── data-source.ts            # DataSource cho TypeORM CLI (migration)
│   │   └── migrations/               # Migration viết tay hoặc generate rồi review lại
│   ├── common/
│   │   ├── errors/
│   │   │   ├── error-codes.ts        # enum ErrorCode
│   │   │   ├── app.exception.ts      # AppException(code, message, details, httpStatus) và các factory
│   │   │   ├── pg-error-codes.ts     # Mã SQLSTATE và tên constraint mà filter nhận biết
│   │   │   └── validation-exception.factory.ts  # exceptionFactory của ValidationPipe (làm phẳng lỗi lồng nhau)
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts   # Gom mọi lỗi về một định dạng
│   │   ├── decorators/
│   │   │   └── api-error-response.decorator.ts  # @ApiErrorResponse(status, code, mô tả) cho Swagger
│   │   ├── dto/
│   │   │   ├── pagination-query.dto.ts
│   │   │   ├── paginated-response.dto.ts
│   │   │   ├── error-response.dto.ts      # Định dạng lỗi thống nhất (Swagger và kiểu của filter)
│   │   │   └── string-transforms.ts       # @Transform: trim, chữ hoa, chữ thường, chuỗi số → number (toNumberIfDecimal)
│   │   ├── pipes/
│   │   │   ├── validation.pipe.ts         # createValidationPipe(): ValidationPipe toàn cục, dùng chung với unit test DTO
│   │   │   └── uuid-param.pipe.ts         # uuidParam('id'): ParseUUIDPipe trả lỗi VALIDATION_ERROR có details
│   │   ├── validators/
│   │   │   └── is-greater-than-or-equal-to.decorator.ts  # So sánh hai field (maxPrice ≥ minPrice, env MAX ≥ MIN)
│   │   ├── transformers/
│   │   │   └── bigint.transformer.ts      # bigint (string từ pg) <-> number, kiểm tra safe integer
│   │   └── utils/
│   │       ├── sleep.ts                   # Sleeper: provider sleep(ms), test thay được
│   │       ├── random-source.ts           # RANDOM_SOURCE: token inject Math.random
│   │       ├── with-timeout.ts            # withTimeout(promise, ms): giới hạn thời gian chờ Redis
│   │       ├── error-message.ts           # errorMessage(): thông điệp đọc được của mọi lỗi (kể cả AggregateError); withReadableMessage() cho failedReason của job
│   │       └── truncate.ts                # Cắt thông điệp lỗi trước khi lưu DB (last_error, failure_reason)
│   ├── products/
│   │   ├── products.module.ts
│   │   ├── products.controller.ts
│   │   ├── products.service.ts
│   │   ├── product-stock.repository.ts    # Khóa dòng, tăng/giảm tồn kho (nhận EntityManager)
│   │   ├── entities/product.entity.ts
│   │   └── dto/ (create, update, query, response)
│   ├── orders/
│   │   ├── orders.module.ts
│   │   ├── orders.controller.ts
│   │   ├── orders.service.ts              # Nghiệp vụ: create, cancel, confirm, fail, expire
│   │   ├── orders.service.spec.ts         # Unit test bắt buộc
│   │   ├── orders.repository.ts           # Insert đơn + items, CAS trạng thái, truy vấn
│   │   ├── order-status.enum.ts           # enum OrderStatus và CancelReason
│   │   ├── order-amounts.ts               # Tính lineTotal/totalAmount (số nguyên VND, kiểm tra safe integer)
│   │   ├── entities/order.entity.ts, order-item.entity.ts
│   │   └── dto/ (create, query, response, order-jobs-response)
│   ├── notifications/
│   │   ├── notifications.module.ts
│   │   ├── notifications.repository.ts    # insertIfAbsent (ON CONFLICT ON CONSTRAINT … DO NOTHING RETURNING id)
│   │   ├── notification-type.enum.ts      # NotificationType (ORDER_CONFIRMED), NotificationChannel (EMAIL)
│   │   └── entities/notification-log.entity.ts
│   ├── outbox/
│   │   ├── outbox.module.ts
│   │   ├── outbox.repository.ts           # add, claimBatch (SKIP LOCKED), markPublished, markFailed, findByAggregate
│   │   ├── outbox-relay.service.ts        # Vòng lặp relay, chỉ có trong WorkerModule
│   │   ├── outbox-event-type.enum.ts      # OutboxEventType, OutboxAggregateType, payload ORDER_CREATED
│   │   └── entities/outbox-event.entity.ts
│   ├── queue/
│   │   ├── queue.module.ts                # registerQueueAsync (Queue chỉ được tạo sau DataSource) + producer; QueueModule.forRoot(role) = BullModule.forRootAsync
│   │   ├── queue.constants.ts             # ORDER_PROCESSING_QUEUE, OrderJobName, buildOrderJobId()
│   │   ├── redis-connection.ts            # parseRedisUrl(), buildRedisConnection(url, role): option khác nhau cho API và worker
│   │   ├── redis-error-logger.ts          # Listener 'error' cho Queue/Worker, không lặp log khi Redis tắt
│   │   ├── order-queue.producer.ts        # enqueueProcessOrder() (relay gọi), getOrderJobs() (API gọi)
│   │   ├── order-processing.processor.ts  # WorkerHost, chỉ có trong WorkerModule; đặt concurrency, đóng Worker ở onModuleDestroy
│   │   ├── order-jobs.scheduler.ts        # upsertJobScheduler khi worker khởi động (không await, không chặn khởi động khi Redis tắt)
│   │   └── failure-simulator.ts           # maybeFail(): ném SimulatedFailureError với xác suất JOB_FAILURE_RATE (RANDOM_SOURCE)
│   ├── scripts/                           # Lệnh dev chạy bằng ts-node. expire-now và requeue-order dùng AppModule (không có worker/relay)
│   │   ├── expire-now.ts                  # npm run job:expire-now: chạy expireStaleOrders() một lần (MT-09)
│   │   ├── requeue-order.ts               # npm run job:requeue -- <orderId>: xóa rồi đẩy lại job order-<id> (MT-08)
│   │   └── race-last-item.ts              # npm run race:last-item -- [baseUrl] [N]: N đơn đồng thời cho món cuối (06 §9), chỉ dùng HTTP
│   └── health/
│       ├── health.module.ts               # Import QueueModule để dùng kết nối Redis của queue
│       ├── health.controller.ts           # GET /health: 200 hoặc 503, body { status, checks } (04 §4.7)
│       ├── health.service.ts              # SELECT 1 và PING song song, mỗi check timeout 2s
│       └── dto/health-response.dto.ts
├── test/
│   ├── esm-to-cjs.transformer.js          # Jest: chuyển các gói @nestjs/* (ES module) sang CommonJS
│   ├── jest-e2e.config.js                 # Cấu hình e2e (npm run test:e2e), dùng lại transform của jest.config.js
│   ├── concurrency.e2e-spec.ts            # IT-01, IT-01b, IT-02, IT-02b, IT-03 (Postgres)
│   ├── outbox-relay.e2e-spec.ts           # IT-04, IT-05 (Postgres và Redis)
│   ├── health.e2e-spec.ts                 # GET /health: 200 khi Postgres và Redis chạy, 503 khi một check lỗi
│   └── e2e/                               # globalSetup (tạo DB test, migration), nạp .env.test, test app, module relay không có vòng lặp
├── .env.test                              # Env của test e2e: giá trị mặc định của docker-compose, không có secret
├── docker-compose.yml
├── .env.example
├── vercel.json                       # buildCommand, function api/index.js (includeFiles dist/**), rewrite mọi path về /api
└── README.md
```

## 5. Quan hệ giữa các module

```mermaid
flowchart TD
  AppModule --> ConfigModule
  AppModule --> DatabaseModule["TypeOrmModule (forRootAsync)"]
  AppModule --> ProductsModule
  AppModule --> OrdersModule
  AppModule --> HealthModule
  HealthModule --> QueueModule
  AppModule --> QueueRootApi["QueueModule.forRoot(Api)<br/>enableOfflineQueue: false"]

  WorkerModule --> ConfigModule
  WorkerModule --> DatabaseModule
  WorkerModule --> QueueRootWorker["QueueModule.forRoot(Worker)<br/>maxRetriesPerRequest: null"]
  WorkerModule --> OrdersModule
  WorkerModule --> QueueModule
  WorkerModule --> OutboxModule
  WorkerModule -.->|"providers"| Processor["OrderProcessingProcessor<br/>OrderJobsScheduler<br/>OutboxRelayService<br/>FailureSimulator · Sleeper · RANDOM_SOURCE"]

  OrdersModule --> ProductsModule
  OrdersModule --> NotificationsModule
  OrdersModule --> OutboxModule
  OrdersModule --> QueueModule
  QueueModule -.->|"exports"| Producer["OrderQueueProducer"]
  ProductsModule -.->|"exports"| Stock["ProductStockRepository"]
  NotificationsModule -.->|"exports"| NotiRepo["NotificationsRepository"]
  OutboxModule -.->|"exports"| OutboxRepo["OutboxRepository"]
```

- `OrdersModule` dùng `ProductStockRepository` (khóa/trừ/hoàn kho), `NotificationsRepository` (ghi thông báo), `OutboxRepository` (ghi sự kiện trong transaction tạo đơn) và `OrderQueueProducer` (chỉ để đọc trạng thái job).
- `OutboxRelayService` (chỉ có ở worker) dùng `OutboxRepository` và `OrderQueueProducer.enqueueProcessOrder`.
- `OrderProcessingProcessor` chỉ điều phối (giả lập thời gian, giả lập lỗi, xác định lần thử cuối) rồi gọi `OrdersService.confirmOrder / failOrder / expireStaleOrders`. Processor **không** chứa SQL.
- Không có phụ thuộc vòng: `QueueModule` không import `OrdersModule`, processor nằm ở `WorkerModule`.

## 6. Luồng xử lý một HTTP request

```mermaid
flowchart LR
  Req[Request] --> VP["ValidationPipe<br/>whitelist · forbidNonWhitelisted · transform"]
  VP --> Ctrl[Controller]
  Ctrl --> Svc["Service<br/>(nghiệp vụ + transaction)"]
  Svc --> Repo["Repository / EntityManager"]
  Repo --> DB[(PostgreSQL)]
  Svc -. "ném AppException" .-> F["AllExceptionsFilter"]
  VP -. "lỗi validate" .-> F
  Repo -. "QueryFailedError" .-> F
  F --> Res["Response lỗi thống nhất"]
```

Các thành phần dùng chung (khai báo trong `configure-app.ts` để `main.ts`, `vercel.ts` và test e2e giống hệt nhau):

- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory })`. `exceptionFactory` làm phẳng lỗi lồng nhau thành `details: [{ field: 'items.0.quantity', messages: [...] }]`. Pipe được tạo bởi `createValidationPipe()` (`common/pipes/validation.pipe.ts`). Unit test của DTO cũng gọi hàm này, nên luôn test đúng cấu hình production.
- `AllExceptionsFilter`: chuyển `AppException`, `HttpException`, `QueryFailedError` (theo mã lỗi Postgres) và lỗi không xác định về [định dạng lỗi thống nhất](04-api-spec.md#2-định-dạng-lỗi-thống-nhất).
- Swagger: `DocumentBuilder` cùng `SwaggerModule.setup('api/docs', …)`. Asset của Swagger UI tải từ CDN để chạy được trên Vercel (xem [08 §4.3](08-deployment.md#43-lưu-ý-khi-chạy-nestjs-trên-vercel)).
- `app.enableShutdownHooks()` để đóng kết nối DB/Redis và `worker.close()` gọn gàng khi nhận SIGTERM.

## 7. Cấu hình (biến môi trường)

Mọi cấu hình đi qua `@nestjs/config`. Env được validate lúc khởi động: thiếu hoặc sai kiểu thì app **dừng ngay** và báo rõ biến nào sai.

| Biến | Mặc định (dev) | Dùng ở | Mô tả |
|---|---|---|---|
| `NODE_ENV` | `development` | API, Worker | `development` / `test` / `production` |
| `PORT` | `3000` | API | Cổng HTTP khi chạy local |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/mini_oms` | API, Worker, CLI | Chuỗi kết nối Postgres |
| `DATABASE_SSL` | `false` | API, Worker, CLI | `true` với Neon/Supabase |
| `DATABASE_POOL_MAX` | `10` | API, Worker | Kích thước pool. Trên Vercel nên để 2–3 |
| `DATABASE_LOGGING` | `false` | API, Worker | Log câu SQL (chỉ bật khi debug) |
| `DB_LOCK_TIMEOUT_MS` | `5000` | API | `SET LOCAL lock_timeout` trong transaction tạo/hủy đơn |
| `REDIS_URL` | `redis://localhost:6379` | API (đọc trạng thái job), Worker | Dùng `rediss://` khi có TLS |
| `JOB_ATTEMPTS` | `4` | Worker (relay) | Tổng số lần chạy một job `process-order`: lần đầu và 3 retry ([ADR-001](10-technical-decisions.md#adr-001-số-lần-chạy-job-và-backoff)) |
| `JOB_BACKOFF_DELAY_MS` | `2000` | Worker (relay) | Delay gốc của backoff exponential (2s, 4s, 8s) |
| `JOB_KEEP_COMPLETED_SECONDS` | `604800` | Worker (relay) | `removeOnComplete.age` (7 ngày) |
| `JOB_KEEP_FAILED_SECONDS` | `1209600` | Worker (relay) | `removeOnFail.age` (14 ngày) |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | Worker | Chu kỳ quét outbox khi bình thường |
| `OUTBOX_BATCH_SIZE` | `50` | Worker | Số sự kiện tối đa mỗi lần quét |
| `OUTBOX_MAX_BACKOFF_MS` | `30000` | Worker | Chu kỳ quét tối đa khi Redis lỗi (giãn gấp đôi mỗi lần) |
| `JOB_PROCESSING_MIN_MS` | `3000` | Worker | Thời gian giả lập xử lý tối thiểu |
| `JOB_PROCESSING_MAX_MS` | `5000` | Worker | Thời gian giả lập xử lý tối đa |
| `JOB_FAILURE_RATE` | `0.3` | Worker | Xác suất lỗi giả lập (0..1) |
| `WORKER_CONCURRENCY` | `5` | Worker | Số job xử lý song song |
| `ORDER_PENDING_TTL_MINUTES` | `30` | Worker | Đơn PENDING quá thời gian này sẽ bị hủy |
| `EXPIRE_PENDING_EVERY_MS` | `300000` | Worker | Chu kỳ chạy job hủy đơn quá hạn (5 phút) |
| `EXPIRE_BATCH_SIZE` | `100` | Worker | Số đơn tối đa xử lý mỗi lần chạy |
| `SWAGGER_ENABLED` | `true` | API | Bật/tắt `/api/docs` |

Mẫu `.env.example`:

```dotenv
NODE_ENV=development
PORT=3000

# PostgreSQL
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mini_oms
DATABASE_SSL=false
DATABASE_POOL_MAX=10
DATABASE_LOGGING=false
DB_LOCK_TIMEOUT_MS=5000

# Redis / BullMQ
REDIS_URL=redis://localhost:6379
JOB_ATTEMPTS=4
JOB_BACKOFF_DELAY_MS=2000
JOB_KEEP_COMPLETED_SECONDS=604800
JOB_KEEP_FAILED_SECONDS=1209600

# Outbox relay (worker)
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=50
OUTBOX_MAX_BACKOFF_MS=30000

# Worker
JOB_PROCESSING_MIN_MS=3000
JOB_PROCESSING_MAX_MS=5000
JOB_FAILURE_RATE=0.3
WORKER_CONCURRENCY=5
ORDER_PENDING_TTL_MINUTES=30
EXPIRE_PENDING_EVERY_MS=300000
EXPIRE_BATCH_SIZE=100

# API docs
SWAGGER_ENABLED=true
```

Quy tắc validate env: `JOB_FAILURE_RATE ∈ [0, 1]`, `JOB_ATTEMPTS ≥ 1`, `JOB_PROCESSING_MIN_MS ≤ JOB_PROCESSING_MAX_MS`, `OUTBOX_POLL_INTERVAL_MS ≤ OUTBOX_MAX_BACKOFF_MS`, các giá trị số là số nguyên dương, `DATABASE_URL` (`postgres://`/`postgresql://`) và `REDIS_URL` (`redis://`/`rediss://`) là URL hợp lệ.

Cách hiện thực (`src/config/`):

- `env.validation.ts`: class `EnvironmentVariables` (class-validator) và hàm `validateEnv()`. Giá trị env luôn là chuỗi: chuỗi số được đổi sang số, chỉ chấp nhận `true`/`false` cho kiểu boolean, chuỗi rỗng bị coi là sai. Lỗi liệt kê **mọi** biến sai trong một thông báo.
- `DATABASE_URL` và `REDIS_URL` **bắt buộc**, không có giá trị mặc định: thiếu thì dừng ngay, tránh việc bản deploy âm thầm kết nối tới `localhost`. Các biến còn lại nếu không khai báo sẽ lấy giá trị ở cột "Mặc định (dev)".
- `configuration.ts`: các namespace có kiểu (`registerAs`): `app`, `database`, `redis`, `jobs`, `outbox`, `worker`, `orders`, `swagger`. Inject bằng `@Inject(databaseConfig.KEY) config: ConfigType<typeof databaseConfig>`. `ConfigModule.forRoot` dùng chung một bộ option cho API và worker, biến môi trường thật luôn được ưu tiên hơn file `.env`.

**Kết nối Redis** (`src/queue/redis-connection.ts`, `QueueModule.forRoot(role)`):

- BullMQ 6 không tự cài `ioredis` nữa (peer dependency tùy chọn), nên dự án khai báo `ioredis` 5.x trong `dependencies` ([ADR-029](10-technical-decisions.md#adr-029-phiên-bản-thư-viện)).
- `parseRedisUrl()` tạo connection options từ `REDIS_URL`: host (bỏ ngoặc của IPv6), port (mặc định 6379), username, password (giải mã `%xx`), số DB ở path (`/2`, phải là số nguyên không âm), và `tls: {}` khi URL là `rediss://`.
- Mỗi tiến trình import `QueueModule.forRoot(role)` đúng một lần ở module gốc. Đây là cấu hình BullMQ toàn cục của tiến trình đó, `QueueModule` (đăng ký queue và producer) dùng lại nó. Tạo kết nối không chờ Redis, nên API và worker vẫn khởi động được khi Redis đang tắt.
- Queue mở kết nối Redis ngay khi được tạo, và chỉ `app.close()` mới đóng nó. `QueueModule` đăng ký queue bằng `registerQueueAsync` có inject `DataSource`, nên Nest chỉ tạo Queue sau khi DB đã kết nối, và không tạo khi DB lỗi. Lý do: DB lỗi thì `NestFactory.create()` reject mà không trả về app để `close()`. Handler Vercel thử khởi động lại trong cùng tiến trình, nên một Queue tạo trước đó sẽ để lại một kết nối Redis sau mỗi lần lỗi ([08 §4.3](08-deployment.md#43-lưu-ý-khi-chạy-nestjs-trên-vercel)). Phụ thuộc này phải là phụ thuộc bắt buộc của queue: đặt nó ở `QueueModule.forRoot` không có tác dụng, vì `@nestjs/bullmq` inject cấu hình chung bằng `@Optional()` và Nest đổi một phụ thuộc tùy chọn bị lỗi thành `undefined`, rồi vẫn tạo Queue với kết nối mặc định.
- **API** (`RedisConnectionRole.Api`): `enableOfflineQueue: false`. Khi mất kết nối, lệnh Redis bị từ chối ngay thay vì nằm chờ trong offline queue của ioredis, nên `GET /orders/:id/jobs` trả `503` ngay.
- **Worker** (`RedisConnectionRole.Worker`): `maxRetriesPerRequest: null` (BullMQ yêu cầu với kết nối blocking của `Worker`). Offline queue **phải** để bật: với `enableOfflineQueue: false`, lệnh lấy job của `Worker` bị lỗi ngay và vòng lặp của BullMQ thử lại liên tục không nghỉ. Khi Redis chạy lại, lệnh đang chờ được gửi đi và `Worker` tự chạy tiếp.
- Ngoài ra, mọi lời gọi Redis từ code của dự án (`OrderQueueProducer.enqueueProcessOrder` và `getOrderJobs`) đều có timeout `REDIS_OPERATION_TIMEOUT_MS` = 3000ms (`withTimeout`). Timeout này cần cả với API: khi tiến trình khởi động lúc Redis đang tắt, BullMQ chờ kết nối đầu tiên và mọi lệnh chờ theo, `enableOfflineQueue` không giúp được. Lệnh bị bỏ dở có thể vẫn chạy sau đó, nên chỉ dùng cho thao tác lặp lại được (đọc, hoặc `add` với `jobId` cố định).
- `Queue` và `Worker` phát sự kiện `error` mỗi lần ioredis thử kết nối lại thất bại. Không có listener thì BullMQ in từng lỗi kèm stack. `createRedisErrorLogger` ghi một dòng `WARN` cho mỗi thông điệp lỗi khác nhau, lặp lại tối đa một lần mỗi phút. `errorMessage()` lấy thông điệp của các lỗi con khi lỗi là `AggregateError` không có thông điệp (kết nối tới `localhost` thử cả `::1` lẫn `127.0.0.1`).

## 8. Quy ước code

1. **Controller mỏng:** chỉ ánh xạ HTTP sang service, kèm decorator Swagger (`@ApiTags`, `@ApiOperation`, `@ApiResponse`). Dùng `ParseUUIDPipe` cho `:id`.
2. **Service giữ nghiệp vụ:** mở transaction bằng `dataSource.transaction(async (manager) => …)` và ném `AppException(ErrorCode.X, message, details)` thay vì các exception chung chung.
3. **Repository giữ truy vấn đặc thù:** khóa dòng, CAS trạng thái, tăng/giảm kho. Repository **nhận `EntityManager`** để chạy trong transaction của nơi gọi. Cách này giúp service test được bằng mock (xem [07 §3](07-testing.md#3-cách-mock)).
4. **Không có I/O ngoài DB trong transaction:** không `queue.add`, không `sleep`, không gọi HTTP. Transaction càng ngắn thì khóa càng được nhả sớm. Ngoại lệ có chủ đích duy nhất: relay outbox gọi `queue.add` trong transaction của nó, nhưng transaction đó chỉ khóa dòng `outbox_events` ([ADR-003](10-technical-decisions.md#adr-003-đẩy-job-qua-transactional-outbox)).
5. **Thứ tự khóa cố định:** mọi thao tác chạm nhiều sản phẩm đều sắp xếp theo `productId` tăng dần (chống deadlock, xem [06 §5](06-concurrency.md#5-chống-deadlock)).
6. **Không magic string:** tên queue, tên job, tiền tố jobId, mã lỗi đều là hằng số hoặc enum.
7. **Tính ngẫu nhiên và thời gian inject được:** `FailureSimulator` và `sleep` là provider, để test có thể ép kết quả lỗi/thành công.
8. **Đặt tên:** TypeScript dùng `camelCase`, DB dùng `snake_case` (khai báo `name` rõ ràng trong `@Column`/`@JoinColumn`). Tên ràng buộc và index có tiền tố `pk_`, `fk_`, `uq_`, `idx_`, `chk_` để `AllExceptionsFilter` ánh xạ được lỗi.
9. **Log có ngữ cảnh:** `Logger` của Nest kèm `orderId`, `jobId`, `attempt`. Không log toàn bộ body chứa email ở mức `info`.
