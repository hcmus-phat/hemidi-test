/**
 * Manual check of the anti-overselling lock against a running API
 * (docs/06 §9): creates a product with stock = 1, sends N orders for it at
 * the same time, then prints what happened.
 *
 *   npm run race:last-item                                         # http://localhost:3000, 20 orders
 *   npm run race:last-item -- https://<project>.vercel.app 50
 *
 * Expected: one order created, N - 1 refused with 409 INSUFFICIENT_STOCK by
 * the stock check of OrdersService (made under the row lock), final stock 0.
 * The script prints OK and exits with 0 only then. Otherwise it exits with 1
 * and says why: OVERSOLD, NOTHING SOLD (e.g. every request got a 503 or a
 * 504) or UNEXPECTED (other statuses, listed above the verdict).
 *
 * A refusal without `details` comes from the CHECK (stock >= 0) constraint,
 * the last line of defence (AllExceptionsFilter maps it to a 409 without
 * details). It only shows up when the lock is missing: the service then
 * checks a stock that other requests are taking at the same time. Results
 * of that experiment are in docs/06 §9.
 */

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_ORDERS = 20;

interface ProductBody {
  id: string;
  sku: string;
  stock: number;
}

interface ErrorBody {
  error?: string;
  details?: unknown[];
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} -> ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** Options of a POST request with a JSON body. */
function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const CREATED = '201 order created';
const REFUSED_BY_SERVICE =
  '409 INSUFFICIENT_STOCK from the stock check of OrdersService';
const REFUSED_BY_CHECK =
  '409 INSUFFICIENT_STOCK from CHECK (stock >= 0) in Postgres';

/**
 * The error body of a response, or undefined when it is not JSON (e.g. the
 * HTML or text page of a 502/504 from the hosting platform).
 */
function parseErrorBody(text: string): ErrorBody | undefined {
  try {
    return JSON.parse(text) as ErrorBody;
  } catch {
    return undefined;
  }
}

/**
 * Sends one order and describes its outcome in a few words. Never rejects:
 * one odd response must not hide the outcome of the others.
 */
async function placeOrder(
  baseUrl: string,
  productId: string,
  customer: number,
): Promise<string> {
  try {
    const response = await fetch(
      `${baseUrl}/orders`,
      jsonPost({
        customerName: `Race customer ${customer}`,
        customerEmail: `race${customer}@example.com`,
        items: [{ productId, quantity: 1 }],
      }),
    );
    if (response.status === 201) {
      return CREATED;
    }
    const body = parseErrorBody(await response.text());
    if (!body) {
      return `${response.status} (non-JSON body)`;
    }
    if (response.status === 409 && body.error === 'INSUFFICIENT_STOCK') {
      return body.details ? REFUSED_BY_SERVICE : REFUSED_BY_CHECK;
    }
    return `${response.status} ${body.error ?? ''}`.trim();
  } catch (error) {
    return `request failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * What the run shows. Only the expected outcome is OK: one order created,
 * every other request refused for lack of stock, final stock 0. Anything
 * else (nothing sold, unexpected statuses) proves nothing about the lock.
 */
function verdict(
  counts: Map<string, number>,
  orders: number,
  stock: number,
): { ok: boolean; message: string } {
  const created = counts.get(CREATED) ?? 0;
  const byService = counts.get(REFUSED_BY_SERVICE) ?? 0;
  const byCheck = counts.get(REFUSED_BY_CHECK) ?? 0;
  if (created > 1 || stock < 0) {
    return {
      ok: false,
      message: 'OVERSOLD: more orders than items in stock',
    };
  }
  if (created === 0) {
    return {
      ok: false,
      message:
        'NOTHING SOLD: no order was created, so the run proves nothing (see the statuses above)',
    };
  }
  if (stock !== 0) {
    return {
      ok: false,
      message: `UNEXPECTED: one order was created but the final stock is ${stock}, not 0`,
    };
  }
  const others = orders - created - byService - byCheck;
  if (others > 0) {
    return {
      ok: false,
      message: `UNEXPECTED: sold once, but ${others} request(s) failed for another reason than the stock (see the statuses above)`,
    };
  }
  return {
    ok: true,
    message:
      byCheck > 0
        ? `OK: the last item was sold once, but ${byCheck} refusal(s) came from the CHECK constraint, not from the stock check under the row lock`
        : 'OK: the last item was sold once',
  };
}

async function main(): Promise<void> {
  const baseUrl = (process.argv[2] ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const orders = Number(process.argv[3] ?? DEFAULT_ORDERS);
  if (!Number.isInteger(orders) || orders < 2) {
    throw new Error('Usage: npm run race:last-item -- [baseUrl] [orders >= 2]');
  }

  const product = await requestJson<ProductBody>(
    `${baseUrl}/products`,
    jsonPost({
      sku: `RACE-${Date.now()}`,
      name: 'Last item',
      price: 100_000,
      stock: 1,
    }),
  );
  console.log(
    `Product ${product.sku} (${product.id}) has stock 1. Sending ${orders} orders at once to ${baseUrl}...`,
  );

  const outcomes = await Promise.all(
    Array.from({ length: orders }, (_, customer) =>
      placeOrder(baseUrl, product.id, customer),
    ),
  );

  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  for (const [outcome, count] of [...counts].sort()) {
    console.log(`  ${count} x ${outcome}`);
  }

  const { stock } = await requestJson<ProductBody>(
    `${baseUrl}/products/${product.id}`,
  );
  console.log(
    `Orders created: ${counts.get(CREATED) ?? 0}, final stock: ${stock}`,
  );
  const { ok, message } = verdict(counts, orders, stock);
  console.log(message);
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
