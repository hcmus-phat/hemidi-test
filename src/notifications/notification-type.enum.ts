/** What a notification is about (`notification_logs.type`). One of each per order at most. */
export enum NotificationType {
  /** Sent when the worker confirms an order. */
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
}

/** How a notification is delivered (`notification_logs.channel`). */
export enum NotificationChannel {
  EMAIL = 'EMAIL',
}
