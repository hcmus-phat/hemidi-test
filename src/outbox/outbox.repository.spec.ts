import type { EntityManager } from 'typeorm';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OutboxAggregateType, OutboxEventType } from './outbox-event-type.enum';
import { OutboxRepository } from './outbox.repository';

describe('OutboxRepository', () => {
  it('add() inserts the event through the manager of the caller (same transaction)', async () => {
    const manager = { insert: jest.fn() };
    const event = {
      aggregateType: OutboxAggregateType.ORDER,
      aggregateId: '99999999-9999-4999-8999-999999999999',
      eventType: OutboxEventType.ORDER_CREATED,
      payload: { orderId: '99999999-9999-4999-8999-999999999999' },
    };

    await new OutboxRepository().add(
      manager as unknown as EntityManager,
      event,
    );

    expect(manager.insert).toHaveBeenCalledWith(OutboxEvent, event);
  });
});
