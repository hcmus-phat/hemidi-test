/** Kind of entity an outbox event is about (`outbox_events.aggregate_type`). */
export enum OutboxAggregateType {
  ORDER = 'ORDER',
}

/** What happened (`outbox_events.event_type`). */
export enum OutboxEventType {
  /** Written with every new order; the relay turns it into a `process-order` job. */
  ORDER_CREATED = 'ORDER_CREATED',
}

/** Payload of an ORDER_CREATED event: only the id, the worker reads the rest from the DB. */
export interface OrderCreatedPayload {
  orderId: string;
}
