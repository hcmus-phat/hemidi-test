/** The BullMQ queue that processes orders (docs/05 §4.1). */
export const ORDER_PROCESSING_QUEUE = 'order-processing';

/** Names of the jobs of the order-processing queue. */
export enum OrderJobName {
  /** Confirms one order. Added by the outbox relay for every new order. */
  ProcessOrder = 'process-order',
  /** Cancels the orders that stayed PENDING too long. Created by the job scheduler. */
  ExpirePendingOrders = 'expire-pending-orders',
}

/**
 * Data of a `process-order` job: only the order id. The worker always reads
 * the current state of the order from the database.
 */
export interface ProcessOrderJobData {
  orderId: string;
}

/**
 * Fixed id of the job of an order: `order-{orderId}` (ADR-016). BullMQ
 * ignores an `add` whose job id already exists, so the outbox relay can
 * publish the same event twice and still create a single job. The id has no
 * `:`, which BullMQ uses to build its Redis keys.
 */
export function buildOrderJobId(orderId: string): string {
  return `order-${orderId}`;
}
