/**
 * Order amounts are integers in VND (ADR-007), so they are computed with
 * plain integer arithmetic. The DTO limits (price <= 1e9, quantity <= 1000,
 * at most 50 items) keep every total far below Number.MAX_SAFE_INTEGER
 * (docs/03 §5). The checks below make a broken assumption fail loudly
 * instead of silently returning a rounded number.
 */

/** unitPrice × quantity. */
export function calculateLineTotal(
  unitPrice: number,
  quantity: number,
): number {
  return assertSafeAmount(unitPrice * quantity);
}

/** Σ unitPrice × quantity over every line of an order. */
export function calculateOrderTotal(
  lines: { unitPrice: number; quantity: number }[],
): number {
  return assertSafeAmount(
    lines.reduce(
      (total, line) =>
        total + calculateLineTotal(line.unitPrice, line.quantity),
      0,
    ),
  );
}

function assertSafeAmount(amount: number): number {
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`Amount is not a safe integer: ${amount}`);
  }
  return amount;
}
