import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxEvent } from './entities/outbox-event.entity';

/** The columns a writer provides; id, timestamps and publish state have defaults. */
export type NewOutboxEvent = Pick<
  OutboxEvent,
  'aggregateType' | 'aggregateId' | 'eventType' | 'payload'
>;

/**
 * Queries on outbox_events. Every method takes the EntityManager of the
 * caller's transaction (docs/02 §8).
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
}
