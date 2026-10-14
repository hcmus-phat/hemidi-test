import type { EntityManager } from 'typeorm';
import { NotificationType } from './notification-type.enum';
import { NotificationsRepository } from './notifications.repository';

describe('NotificationsRepository', () => {
  const ORDER_ID = '99999999-9999-4999-8999-999999999999';
  const notification = {
    orderId: ORDER_ID,
    type: NotificationType.ORDER_CONFIRMED,
    recipient: 'a@example.com',
    subject: `Order ${ORDER_ID} confirmed`,
    payload: { orderId: ORDER_ID, totalAmount: 548000 },
  };

  const manager = { query: jest.fn() };
  const repository = new NotificationsRepository();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts through the manager of the caller, skipping a duplicate (order, type)', async () => {
    manager.query.mockResolvedValue([{ id: 'new-id' }]);

    await repository.insertIfAbsent(
      manager as unknown as EntityManager,
      notification,
    );

    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO notification_logs');
    expect(sql).toContain(
      'ON CONFLICT ON CONSTRAINT uq_notification_logs_order_type DO NOTHING',
    );
    expect(params).toEqual([
      ORDER_ID,
      'ORDER_CONFIRMED',
      'a@example.com',
      `Order ${ORDER_ID} confirmed`,
      JSON.stringify({ orderId: ORDER_ID, totalAmount: 548000 }),
    ]);
  });

  it('returns true when the row was inserted', async () => {
    manager.query.mockResolvedValue([{ id: 'new-id' }]);

    await expect(
      repository.insertIfAbsent(
        manager as unknown as EntityManager,
        notification,
      ),
    ).resolves.toBe(true);
  });

  it('returns false when the order already had this notification', async () => {
    // ON CONFLICT DO NOTHING: no row inserted, so RETURNING returns nothing.
    manager.query.mockResolvedValue([]);

    await expect(
      repository.insertIfAbsent(
        manager as unknown as EntityManager,
        notification,
      ),
    ).resolves.toBe(false);
  });
});
