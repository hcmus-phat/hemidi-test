import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import {
  NotificationChannel,
  NotificationType,
} from '../notification-type.enum';

/**
 * A notification "sent" to a customer: a row stands in for a real email
 * (A-09). The schema is created by the CreateNotificationLogs migration; the
 * decorators mirror it so that `migration:generate` does not see differences.
 */
@Entity({ name: 'notification_logs' })
@Unique('uq_notification_logs_order_type', ['orderId', 'type'])
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_notification_logs',
  })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'fk_notification_logs_order',
  })
  order?: Order;

  @Column({ name: 'type', type: 'varchar', length: 32 })
  type: NotificationType;

  @Column({
    name: 'channel',
    type: 'varchar',
    length: 16,
    default: NotificationChannel.EMAIL,
  })
  channel: NotificationChannel;

  /** Email address of the customer. */
  @Column({ name: 'recipient', type: 'varchar', length: 255 })
  recipient: string;

  @Column({ name: 'subject', type: 'varchar', length: 255 })
  subject: string;

  /** What the message is about, e.g. `{ orderId, totalAmount }`. */
  @Column({
    name: 'payload',
    type: 'jsonb',
    // Postgres reports the default '{}'::jsonb as '{}', which TypeORM compares with.
    default: () => `'{}'`,
  })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
