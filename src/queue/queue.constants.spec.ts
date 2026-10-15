import { buildOrderJobId } from './queue.constants';

describe('buildOrderJobId', () => {
  it('is order-{orderId}', () => {
    expect(buildOrderJobId('8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10')).toBe(
      'order-8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10',
    );
  });

  // Redis keys are case-sensitive: an upper-case id must not find, remove
  // or add a different job than the one the relay created.
  it('uses the lower-case form of the id', () => {
    expect(buildOrderJobId('8C1F6A2E-3B7D-4C55-9A0E-2F6D1B7C9E10')).toBe(
      'order-8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10',
    );
  });
});
