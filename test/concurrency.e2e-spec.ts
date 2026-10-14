import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { DataSource } from 'typeorm';
import {
  cancelOrder,
  countRows,
  countStatuses,
  createProduct,
  createTestApp,
  OrderBody,
  placeOrder,
  ProductBody,
  resetDatabase,
  stockOf,
} from './e2e/test-app';

/**
 * Concurrent requests on a real Postgres (docs/07 §5, docs/06 §9). Only the
 * database is needed: placing and cancelling orders never call Redis.
 *
 * Requests are sent together with Promise.all. Each one runs its own
 * transaction on its own connection, so they really compete for the row
 * locks of the products and orders.
 */
describe('Concurrency (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  /** 20 customers order the only item of a product at the same time. */
  async function raceForLastItem(): Promise<{
    product: ProductBody;
    responses: Response[];
  }> {
    const product = await createProduct(app, 1);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, customer) =>
        placeOrder(app, [{ productId: product.id, quantity: 1 }], customer),
      ),
    );
    return { product, responses };
  }

  /** Responses that are neither `expected` statuses, with their body, for a readable failure. */
  function unexpected(responses: Response[], expected: number[]): unknown[] {
    return responses
      .filter(({ status }) => !expected.includes(status))
      .map(({ status, body }) => ({ status, body: body as unknown }));
  }

  it('IT-01 sells the last item to exactly one of 20 concurrent orders', async () => {
    const { product, responses } = await raceForLastItem();

    expect(countStatuses(responses)).toEqual({ 201: 1, 409: 19 });
    // Every refusal comes from the stock check made under the row lock: it
    // saw the stock already taken (available 0). A refusal by the CHECK
    // constraint, the last line of defence, would have no details.
    for (const refused of responses.filter(({ status }) => status === 409)) {
      expect(refused.body).toMatchObject({
        error: 'INSUFFICIENT_STOCK',
        details: [{ productId: product.id, requested: 1, available: 0 }],
      });
    }
    expect(await stockOf(dataSource, product.id)).toBe(0);
    expect(await countRows(dataSource, 'orders')).toBe(1);
    expect(await countRows(dataSource, 'order_items')).toBe(1);
  });

  it('IT-01b leaves exactly one ORDER_CREATED outbox event, for the order that was created', async () => {
    const { responses } = await raceForLastItem();
    const created = responses.find(({ status }) => status === 201)!
      .body as OrderBody;

    // The 19 refused orders rolled back their transaction: no event.
    const events: unknown[] = await dataSource.query(
      'SELECT aggregate_type, aggregate_id, event_type, payload, published_at FROM outbox_events',
    );
    expect(events).toEqual([
      {
        aggregate_type: 'ORDER',
        aggregate_id: created.id,
        event_type: 'ORDER_CREATED',
        payload: { orderId: created.id },
        // No relay runs in the API: the worker publishes it later.
        published_at: null,
      },
    ]);
  });

  it('IT-02 never sells more than the stock to 30 concurrent orders of 1 to 3 items', async () => {
    const initialStock = 10;
    const product = await createProduct(app, initialStock);
    const quantities = Array.from(
      { length: 30 },
      () => 1 + Math.floor(Math.random() * 3),
    );

    const responses = await Promise.all(
      quantities.map((quantity, customer) =>
        placeOrder(app, [{ productId: product.id, quantity }], customer),
      ),
    );

    expect(unexpected(responses, [201, 409])).toEqual([]);
    const accepted = quantities.filter((_, i) => responses[i].status === 201);
    const refused = quantities.filter((_, i) => responses[i].status === 409);
    const sold = accepted.reduce((sum, quantity) => sum + quantity, 0);
    const finalStock = await stockOf(dataSource, product.id);

    expect(sold).toBeLessThanOrEqual(initialStock);
    expect(finalStock).toBe(initialStock - sold);
    expect(await countRows(dataSource, 'orders')).toBe(accepted.length);
    // The 30 orders ask for at least 30 items, so some are refused. Stock
    // only goes down, so each refused order asked for more than what is
    // left now: no order was refused while it could have been served.
    expect(refused.length).toBeGreaterThan(0);
    for (const quantity of refused) {
      expect(quantity).toBeGreaterThan(finalStock);
    }
  });

  it('IT-02b never deadlocks when orders list the same two products in opposite orders', async () => {
    const p1 = await createProduct(app, 100);
    const p2 = await createProduct(app, 100);

    // Even customers order [P1, P2], odd customers [P2, P1], all at once.
    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, customer) => {
        const products = customer % 2 === 0 ? [p1, p2] : [p2, p1];
        const items = products.map(({ id }) => ({
          productId: id,
          quantity: 1,
        }));
        return placeOrder(app, items, customer);
      }),
    );

    // A deadlock (40P01) or a lock timeout (55P03) would be a 503. Products
    // are always locked by ascending id, so there is none.
    expect(unexpected(responses, [201])).toEqual([]);
    expect(countStatuses(responses)).toEqual({ 201: 40 });
    expect(await stockOf(dataSource, p1.id)).toBe(60);
    expect(await stockOf(dataSource, p2.id)).toBe(60);
  });

  it('IT-03 cancels an order once and gives its stock back once when 5 cancels arrive together', async () => {
    const product = await createProduct(app, 5);
    const order = (
      await placeOrder(app, [{ productId: product.id, quantity: 3 }]).expect(
        201,
      )
    ).body as OrderBody;
    expect(await stockOf(dataSource, product.id)).toBe(2);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => cancelOrder(app, order.id)),
    );

    expect(countStatuses(responses)).toEqual({ 200: 1, 409: 4 });
    for (const refused of responses.filter(({ status }) => status === 409)) {
      expect(refused.body).toMatchObject({
        error: 'INVALID_ORDER_STATUS',
        message: 'Order cannot be cancelled in status CANCELLED',
      });
    }
    // Given back exactly once: 2 + 3.
    expect(await stockOf(dataSource, product.id)).toBe(5);
    const rows: unknown[] = await dataSource.query(
      'SELECT status, cancel_reason FROM orders WHERE id = $1',
      [order.id],
    );
    expect(rows).toEqual([
      { status: 'CANCELLED', cancel_reason: 'CUSTOMER_REQUEST' },
    ]);
  });
});
