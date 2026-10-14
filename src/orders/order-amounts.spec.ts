import { calculateLineTotal, calculateOrderTotal } from './order-amounts';

describe('order amounts', () => {
  it('multiplies the unit price by the quantity', () => {
    expect(calculateLineTotal(199000, 2)).toBe(398000);
  });

  it('sums every line of an order', () => {
    expect(
      calculateOrderTotal([
        { unitPrice: 199000, quantity: 2 },
        { unitPrice: 150000, quantity: 1 },
      ]),
    ).toBe(548000);
  });

  it('stays exact at the largest total the DTO limits allow', () => {
    const lines = Array.from({ length: 50 }, () => ({
      unitPrice: 1_000_000_000,
      quantity: 1000,
    }));

    expect(calculateOrderTotal(lines)).toBe(50_000_000_000_000);
  });

  it('throws instead of returning a rounded amount', () => {
    expect(() => calculateLineTotal(Number.MAX_SAFE_INTEGER, 2)).toThrow(
      'Amount is not a safe integer',
    );
    expect(() =>
      calculateOrderTotal([
        { unitPrice: Number.MAX_SAFE_INTEGER, quantity: 1 },
        { unitPrice: 1, quantity: 1 },
      ]),
    ).toThrow('Amount is not a safe integer');
  });
});
