import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BigIntTransformer } from '../../common/transformers/bigint.transformer';
import { CancelReason, OrderStatus } from '../order-status.enum';
import { OrderItem } from './order-item.entity';

/**
 * An order. The schema is created by the CreateOrders migration; the
 * decorators below mirror it (same constraint and index names) so that
 * `migration:generate` does not see differences.
 */
@Entity({ name: 'orders' })
@Check('chk_orders_total_non_negative', '"total_amount" >= 0')
@Index('idx_orders_status_created_at', ['status', 'createdAt'])
// @Index cannot describe the DESC column order of this index, so TypeORM is
// told to leave it alone (the migration owns it).
@Index('idx_orders_created_at', { synchronize: false })
export class Order {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_orders' })
  id: string;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  /** Stored in lower case (normalised by the DTO). */
  @Column({ name: 'customer_email', type: 'varchar', length: 255 })
  customerEmail: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  /** Σ unitPrice × quantity in VND, fixed when the order is created. */
  @Column({
    name: 'total_amount',
    type: 'bigint',
    transformer: BigIntTransformer,
  })
  totalAmount: number;

  /** Last processing error, set when the order becomes FAILED. */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  /** Set when the order becomes CANCELLED. */
  @Column({
    name: 'cancel_reason',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  cancelReason: CancelReason | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Loaded only when asked for (order detail). */
  @OneToMany(() => OrderItem, (item) => item.order)
  items?: OrderItem[];
}
