import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { truncate } from '../common/utils/truncate';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OutboxEventType } from './outbox-event-type.enum';

/** The columns a writer provides; id, timestamps and publish state have defaults. */
export type NewOutboxEvent = Pick<
  OutboxEvent,
  'aggregateType' | 'aggregateId' | 'eventType' | 'payload'
>;

/** Longest publish error kept in `last_error`. */
export const MAX_LAST_ERROR_LENGTH = 1000;

/**
 * Queries on outbox_events. Every method takes an EntityManager: the
 * caller's transaction, or `dataSource.manager` for a plain read
 * (docs/02 §8).
 */
@Injectable()
export class OutboxRepository {
  /**
   * Inserts an event in the caller's transaction, so it is committed or
   * rolled back together with the change it describes (ADR-003).
   */
  async add(manager: EntityManager, event: NewOutboxEvent): Promise<void> {
    await manager.insert(OutboxEvent, event);
  }

  /**
   * Locks the oldest events that are not published yet (docs/03 §2.5):
   *
   *   SELECT ... FROM outbox_events
   *    WHERE published_at IS NULL
   *    ORDER BY id
   *    LIMIT :limit
   *      FOR UPDATE SKIP LOCKED
   *
   * The rows stay locked until the relay's transaction ends. SKIP LOCKED
   * makes another relay instance take the next events instead of waiting,
   * so each event is handled by one instance at a time (docs/05 §6.2 #9).
   * Must run inside a transaction.
   */
  claimBatch(manager: EntityManager, limit: number): Promise<OutboxEvent[]> {
    return manager
      .createQueryBuilder(OutboxEvent, 'event')
      .where('event.publishedAt IS NULL')
      .orderBy('event.id', 'ASC')
      .limit(limit)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
  }

  /**
   * The event reached the queue: `published_at = now()` (database clock)
   * and one more attempt. `last_error` is kept: it tells why an event was
   * published late.
   */
  async markPublished(manager: EntityManager, eventId: string): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        publishedAt: () => 'now()',
        publishAttempts: () => 'publish_attempts + 1',
      })
      .where('id = :eventId', { eventId })
      .execute();
  }

  /**
   * Publishing failed: one more attempt and the error, cut to
   * MAX_LAST_ERROR_LENGTH characters. The event stays unpublished, so a
   * later batch retries it.
   */
  async markFailed(
    manager: EntityManager,
    eventId: string,
    error: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        publishAttempts: () => 'publish_attempts + 1',
        lastError: truncate(error, MAX_LAST_ERROR_LENGTH),
      })
      .where('id = :eventId', { eventId })
      .execute();
  }

  /**
   * The event of one kind for one aggregate, or null. There is at most one
   * (uq_outbox_events_aggregate_event), which this lookup also uses.
   */
  findByAggregate(
    manager: EntityManager,
    aggregateId: string,
    eventType: OutboxEventType,
  ): Promise<OutboxEvent | null> {
    return manager.findOne(OutboxEvent, {
      where: { aggregateId, eventType },
    });
  }
}
