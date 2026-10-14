import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * notification_logs table (docs/03 §2.4, §4): one row per notification "sent"
 * to a customer, instead of a real email (A-09).
 *
 * - UNIQUE (order_id, type): an order can never get two ORDER_CONFIRMED
 *   notifications. The worker inserts with ON CONFLICT DO NOTHING in the
 *   transaction that confirms the order, so the database itself guarantees
 *   the idempotency of the notification (ADR-018).
 * - The unique constraint also serves lookups by order (order_id comes
 *   first), so no other index is needed.
 * - Deleting an order deletes its notifications (ON DELETE CASCADE).
 */
export class CreateNotificationLogs1792002007329 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_logs (
        id          uuid          NOT NULL DEFAULT gen_random_uuid(),
        order_id    uuid          NOT NULL,
        type        varchar(32)   NOT NULL,
        channel     varchar(16)   NOT NULL DEFAULT 'EMAIL',
        recipient   varchar(255)  NOT NULL,
        subject     varchar(255)  NOT NULL,
        payload     jsonb         NOT NULL DEFAULT '{}'::jsonb,
        created_at  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT pk_notification_logs PRIMARY KEY (id),
        CONSTRAINT fk_notification_logs_order FOREIGN KEY (order_id)
          REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT uq_notification_logs_order_type UNIQUE (order_id, type)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notification_logs`);
  }
}
