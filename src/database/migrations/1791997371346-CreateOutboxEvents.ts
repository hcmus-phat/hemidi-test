import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * outbox_events table: the Transactional Outbox (ADR-003, docs/03 §2.5).
 *
 * The transaction that creates an order also inserts an ORDER_CREATED event
 * here, so the order and its event are committed (or rolled back) together.
 * The relay in the worker later publishes unpublished events to BullMQ.
 *
 * - `id` is an identity column, so the relay reads events in insert order.
 * - `aggregate_id` has no FK: the outbox does not depend on the life cycle of
 *   the order it describes.
 * - UNIQUE (aggregate_id, event_type): at most one ORDER_CREATED per order.
 * - idx_outbox_events_unpublished only holds the backlog (published_at IS
 *   NULL), so the relay's scan stays small however many events were published.
 */
export class CreateOutboxEvents1791997371346 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id                bigint        GENERATED ALWAYS AS IDENTITY,
        aggregate_type    varchar(32)   NOT NULL,
        aggregate_id      uuid          NOT NULL,
        event_type        varchar(64)   NOT NULL,
        payload           jsonb         NOT NULL,
        created_at        timestamptz   NOT NULL DEFAULT now(),
        published_at      timestamptz   NULL,
        publish_attempts  integer       NOT NULL DEFAULT 0,
        last_error        text          NULL,
        CONSTRAINT pk_outbox_events PRIMARY KEY (id),
        CONSTRAINT uq_outbox_events_aggregate_event UNIQUE (aggregate_id, event_type)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_outbox_events_unpublished
        ON outbox_events (id)
        WHERE published_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_outbox_events_unpublished`);
    await queryRunner.query(`DROP TABLE outbox_events`);
  }
}
