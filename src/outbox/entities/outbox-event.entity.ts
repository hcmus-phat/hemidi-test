import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { OrderCreatedPayload } from '../outbox-event-type.enum';
import {
  OutboxAggregateType,
  OutboxEventType,
} from '../outbox-event-type.enum';

/**
 * An event waiting to be published to the queue, or already published
 * (ADR-003). The schema is created by the CreateOutboxEvents migration; the
 * decorators mirror it so that `migration:generate` does not see differences.
 */
@Entity({ name: 'outbox_events' })
@Unique('uq_outbox_events_aggregate_event', ['aggregateId', 'eventType'])
@Index('idx_outbox_events_unpublished', ['id'], {
  where: '"published_at" IS NULL',
})
export class OutboxEvent {
  /**
   * Identity column, increasing in insert order. node-postgres returns
   * `bigint` as a string; the id is only passed back to the database, so it
   * stays a string.
   */
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'pk_outbox_events',
  })
  id: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 32 })
  aggregateType: OutboxAggregateType;

  /**
   * Id of the order. No FK on purpose (docs/03 §2.5). The relay reads the
   * order id from here, not from `payload`: the column type makes Postgres
   * reject anything that is not a UUID.
   */
  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: OutboxEventType;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: OrderCreatedPayload;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** NULL until the relay has published the event to the queue. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /** How many times the relay tried to publish the event. */
  @Column({ name: 'publish_attempts', type: 'integer', default: 0 })
  publishAttempts: number;

  /** Last publish error, e.g. Redis unreachable. */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
