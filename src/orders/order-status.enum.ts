/**
 * Life cycle of an order (docs/05 §2):
 *
 *   PENDING -> CONFIRMED | FAILED | CANCELLED
 *   CONFIRMED -> CANCELLED
 *
 * FAILED and CANCELLED are final. Stored as the Postgres enum `order_status`.
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Why an order is CANCELLED (ADR-004): the customer asked, or it stayed PENDING too long. */
export enum CancelReason {
  CUSTOMER_REQUEST = 'CUSTOMER_REQUEST',
  EXPIRED = 'EXPIRED',
}
