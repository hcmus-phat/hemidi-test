import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BigIntTransformer } from '../../common/transformers/bigint.transformer';

/**
 * A product and its stock. The schema itself is created by the CreateProducts
 * migration; the decorators below mirror it (same constraint and index names)
 * so that `migration:generate` does not see differences.
 */
@Entity({ name: 'products' })
@Check('chk_products_price_non_negative', '"price" >= 0')
@Check('chk_products_stock_non_negative', '"stock" >= 0')
@Index('uq_products_sku_active', ['sku'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('idx_products_price', ['price'], { where: '"deleted_at" IS NULL' })
// @Index cannot describe the DESC column order of this index, so TypeORM is
// told to leave it alone (the migration owns it).
@Index('idx_products_created_at', { synchronize: false })
export class Product {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_products' })
  id: string;

  /** Stored trimmed and upper-cased (normalised by the DTO). */
  @Column({ name: 'sku', type: 'varchar', length: 64 })
  sku: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  /** Price in VND. `bigint` in the database, a safe integer in JavaScript. */
  @Column({ name: 'price', type: 'bigint', transformer: BigIntTransformer })
  price: number;

  @Column({ name: 'stock', type: 'integer', default: 0 })
  stock: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Set by soft delete. TypeORM excludes rows where it is not NULL from find queries. */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
