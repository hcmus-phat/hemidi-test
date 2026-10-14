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

/** Sends one order and describes its outcome in a few words. */
async function placeOrder(
  baseUrl: string,
  productId: string,
  customer: number,
): Promise<string> {
  const response = await fetch(
    `${baseUrl}/orders`,
    jsonPost({
      customerName: `Race customer ${customer}`,
      customerEmail: `race${customer}@example.com`,
      items: [{ productId, quantity: 1 }],
    }),
  );
  if (response.status === 201) {
    return '201 order created';
  }
  const body = (await response.json()) as ErrorBody;
  if (response.status === 409 && body.error === 'INSUFFICIENT_STOCK') {
    return body.details
      ? '409 INSUFFICIENT_STOCK from the stock check of OrdersService'
      : '409 INSUFFICIENT_STOCK from CHECK (stock >= 0) in Postgres';
  }
  return `${response.status} ${body.error ?? ''}`.trim();
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
  const created = counts.get('201 order created') ?? 0;
  console.log(`Orders created: ${created}, final stock: ${stock}`);
  if (created > 1 || stock < 0) {
    console.log('OVERSOLD: more orders than items in stock');
    process.exitCode = 1;
  } else {
    console.log('OK: the last item was sold once');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
