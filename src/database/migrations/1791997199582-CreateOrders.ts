import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * orders and order_items tables (docs/03 §2.2, §2.3 and §4).
 *
 * - `status` is a Postgres enum, so a typo can never be stored.
 * - order_items keeps a snapshot of the product (SKU, name, unit price) taken
 *   when the order was placed: later product changes do not alter old orders.
 * - A product appears at most once per order (uq_order_items_order_product),
 *   and products are only soft-deleted, so fk_order_items_product (RESTRICT)
 *   always holds.
 */
export class CreateOrders1791997199582 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE order_status AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TABLE orders (
        id              uuid          NOT NULL DEFAULT gen_random_uuid(),
        customer_name   varchar(255)  NOT NULL,
        customer_email  varchar(255)  NOT NULL,
        status          order_status  NOT NULL DEFAULT 'PENDING',
        total_amount    bigint        NOT NULL,
        failure_reason  text          NULL,
        cancel_reason   varchar(32)   NULL,
        confirmed_at    timestamptz   NULL,
        cancelled_at    timestamptz   NULL,
        failed_at       timestamptz   NULL,
        created_at      timestamptz   NOT NULL DEFAULT now(),
        updated_at      timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT pk_orders PRIMARY KEY (id),
        CONSTRAINT chk_orders_total_non_negative CHECK (total_amount >= 0)
      )
    `);
    // GET /orders?status= and the job that expires stale PENDING orders.
    await queryRunner.query(`
      CREATE INDEX idx_orders_status_created_at
        ON orders (status, created_at)
    `);
    // GET /orders without a filter: newest first, id as a tie-breaker.
    await queryRunner.query(`
      CREATE INDEX idx_orders_created_at
        ON orders (created_at DESC, id DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE order_items (
        id            uuid          NOT NULL DEFAULT gen_random_uuid(),
        order_id      uuid          NOT NULL,
        product_id    uuid          NOT NULL,
        product_sku   varchar(64)   NOT NULL,
        product_name  varchar(255)  NOT NULL,
        unit_price    bigint        NOT NULL,
        quantity      integer       NOT NULL,
        created_at    timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT pk_order_items PRIMARY KEY (id),
        CONSTRAINT fk_order_items_order
          FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
        CONSTRAINT fk_order_items_product
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
        CONSTRAINT uq_order_items_order_product UNIQUE (order_id, product_id),
        CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0),
        CONSTRAINT chk_order_items_unit_price_non_negative CHECK (unit_price >= 0)
      )
    `);
    // The unique constraint above already indexes order_id (its first column).
    await queryRunner.query(`
      CREATE INDEX idx_order_items_product_id
        ON order_items (product_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_order_items_product_id`);
    await queryRunner.query(`DROP TABLE order_items`);
    await queryRunner.query(`DROP INDEX idx_orders_created_at`);
    await queryRunner.query(`DROP INDEX idx_orders_status_created_at`);
    await queryRunner.query(`DROP TABLE orders`);
    await queryRunner.query(`DROP TYPE order_status`);
  }
}
