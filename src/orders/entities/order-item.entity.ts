import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BigIntTransformer } from '../../common/transformers/bigint.transformer';
import { Product } from '../../products/entities/product.entity';
import { Order } from './order.entity';

/**
 * One product of an order, with a snapshot of the product taken when the
 * order was placed (ADR-020). Old orders keep showing the SKU, name and price
 * they were placed with, even after the product changes or is deleted.
 *
 * The schema is created by the CreateOrders migration; the decorators mirror
 * it so that `migration:generate` does not see differences.
 */
@Entity({ name: 'order_items' })
@Unique('uq_order_items_order_product', ['orderId', 'productId'])
@Check('chk_order_items_quantity_positive', '"quantity" > 0')
@Check('chk_order_items_unit_price_non_negative', '"unit_price" >= 0')
@Index('idx_order_items_product_id', ['productId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_order_items',
  })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'fk_order_items_order',
  })
  order?: Order;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Products are only soft-deleted, so the row this points to always exists. */
  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'fk_order_items_product',
  })
  product?: Product;

  @Column({ name: 'product_sku', type: 'varchar', length: 64 })
  productSku: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName: string;

  /** Price in VND when the order was placed. */
  @Column({
    name: 'unit_price',
    type: 'bigint',
    transformer: BigIntTransformer,
  })
  unitPrice: number;

  @Column({ name: 'quantity', type: 'integer' })
  quantity: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
