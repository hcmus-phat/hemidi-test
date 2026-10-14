import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * products table (docs/03 §2.1 and §4).
 *
 * - CHECK (stock >= 0) is the last line of defence against overselling.
 * - SKU is unique only among products that are not soft-deleted, so a deleted
 *   SKU can be reused (partial unique index, ADR-009).
 * - The list and price-filter indexes are partial too: queries never read
 *   soft-deleted rows.
 */
export class CreateProducts1791994096385 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE products (
        id          uuid          NOT NULL DEFAULT gen_random_uuid(),
        sku         varchar(64)   NOT NULL,
        name        varchar(255)  NOT NULL,
        price       bigint        NOT NULL,
        stock       integer       NOT NULL DEFAULT 0,
        created_at  timestamptz   NOT NULL DEFAULT now(),
        updated_at  timestamptz   NOT NULL DEFAULT now(),
        deleted_at  timestamptz   NULL,
        CONSTRAINT pk_products PRIMARY KEY (id),
        CONSTRAINT chk_products_price_non_negative CHECK (price >= 0),
        CONSTRAINT chk_products_stock_non_negative CHECK (stock >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_products_sku_active
        ON products (sku)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_products_created_at
        ON products (created_at DESC, id DESC)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_products_price
        ON products (price)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_products_price`);
    await queryRunner.query(`DROP INDEX idx_products_created_at`);
    await queryRunner.query(`DROP INDEX uq_products_sku_active`);
    await queryRunner.query(`DROP TABLE products`);
  }
}
