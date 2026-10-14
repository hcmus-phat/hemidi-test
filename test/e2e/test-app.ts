import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response, type Test as HttpRequest } from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { databaseConfig } from '../../src/config/configuration';
import { assertTestDatabase } from './test-env';

/** The fields of a product or an order that the tests read. */
export interface ProductBody {
  id: string;
  sku: string;
  price: number;
  stock: number;
}

export interface OrderBody {
  id: string;
  status: string;
  cancelReason: string | null;
  items: { productId: string; quantity: number }[];
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

/**
 * The HTTP API as in production: AppModule (no worker, no outbox relay)
 * with the pipe, filter and Swagger of configureApp(). Tests call it with
 * supertest(app.getHttpServer()). Each request takes its own connection from
 * the pool (DATABASE_POOL_MAX in .env.test), so concurrent requests run
 * concurrent transactions on Postgres.
 *
 * The server listens on a random local port for the whole test file. When
 * it does not listen yet, supertest starts and stops it around every batch
 * of requests instead.
 */
export async function createTestApp(): Promise<INestApplication> {
  assertTestDatabase(databaseConfig().url);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Empties every table, run before each test. RESTART IDENTITY resets the outbox id. */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE outbox_events, notification_logs, order_items, orders, products RESTART IDENTITY CASCADE',
  );
}

let productCount = 0;

/** POST /products with a unique SKU. */
export async function createProduct(
  app: INestApplication,
  stock: number,
  price = 100_000,
): Promise<ProductBody> {
  productCount++;
  const response = await request(app.getHttpServer())
    .post('/products')
    .send({ sku: `E2E-${productCount}`, name: 'E2E product', price, stock })
    .expect(201);
  return response.body as ProductBody;
}

/** POST /orders for customer number `customer`. Resolves with the response, whatever its status. */
export function placeOrder(
  app: INestApplication,
  items: OrderItemInput[],
  customer = 0,
): HttpRequest {
  return request(app.getHttpServer())
    .post('/orders')
    .send({
      customerName: `Customer ${customer}`,
      customerEmail: `customer${customer}@example.com`,
      items,
    });
}

/** PATCH /orders/:id/cancel. Resolves with the response, whatever its status. */
export function cancelOrder(
  app: INestApplication,
  orderId: string,
): HttpRequest {
  return request(app.getHttpServer()).patch(`/orders/${orderId}/cancel`);
}

/** How many responses have each status code, e.g. `{ 201: 1, 409: 19 }`. */
export function countStatuses(responses: Response[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const { status } of responses) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/** The stock of a product, read from the database. */
export async function stockOf(
  dataSource: DataSource,
  productId: string,
): Promise<number> {
  const [row] = await dataSource.query<{ stock: number }[]>(
    'SELECT stock FROM products WHERE id = $1',
    [productId],
  );
  return row.stock;
}

/** Number of rows of a table. */
export async function countRows(
  dataSource: DataSource,
  table: 'orders' | 'order_items' | 'outbox_events' | 'notification_logs',
): Promise<number> {
  const [row] = await dataSource.query<{ count: number }[]>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return row.count;
}
