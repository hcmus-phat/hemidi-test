import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { NotificationLog } from './entities/notification-log.entity';

/** What a writer provides; id, channel (EMAIL) and created_at have defaults. */
export type NewNotification = Pick<
  NotificationLog,
  'orderId' | 'type' | 'recipient' | 'subject' | 'payload'
>;

/**
 * Queries on notification_logs. Every method takes the EntityManager of the
 * caller's transaction (docs/02 §8).
 */
@Injectable()
export class NotificationsRepository {
  /**
   * Records a notification unless the order already has one of this type:
   *
   *   INSERT INTO notification_logs (...) VALUES (...)
   *   ON CONFLICT ON CONSTRAINT uq_notification_logs_order_type DO NOTHING
   *   RETURNING id
   *
   * The unique constraint makes it idempotent whatever the caller does
   * (ADR-018): a second insert for the same order and type changes nothing.
   * Returns true when a row was inserted, false when it already existed.
   */
  async insertIfAbsent(
    manager: EntityManager,
    notification: NewNotification,
  ): Promise<boolean> {
    const { orderId, type, recipient, subject, payload } = notification;
    const inserted: { id: string }[] = await manager.query(
      `INSERT INTO notification_logs (order_id, type, recipient, subject, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT uq_notification_logs_order_type DO NOTHING
       RETURNING id`,
      [orderId, type, recipient, subject, JSON.stringify(payload)],
    );
    return inserted.length > 0;
  }
}
