import { AppException } from '../../common/errors/app.exception';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { CreateOrderDto, OrderItemDto } from './create-order.dto';

const pipe = createValidationPipe();

const P1 = '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10';
const P2 = 'c4d2a7b1-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

async function validate(body: unknown): Promise<unknown> {
  return pipe
    .transform(body, { type: 'body', metatype: CreateOrderDto })
    .catch((error: unknown) => error);
}

/** Field paths reported in the 400 VALIDATION_ERROR details. */
function invalidFields(result: unknown): string[] {
  expect(result).toBeInstanceOf(AppException);
  return ((result as AppException).details ?? []).map((d) => d.field as string);
}

function messagesOf(result: unknown, field: string): string[] {
  const detail = (result as AppException).details?.find(
    (d) => d.field === field,
  );
  return (detail?.messages as string[] | undefined) ?? [];
}

describe('CreateOrderDto', () => {
  const valid = {
    customerName: 'Nguyen Van A',
    customerEmail: 'a.nguyen@example.com',
    items: [
      { productId: P1, quantity: 2 },
      { productId: P2, quantity: 1 },
    ],
  };

  it('normalises the name, the email and the product ids', async () => {
    const dto = await validate({
      customerName: '  Nguyen Van A  ',
      customerEmail: ' A.Nguyen@Example.COM ',
      items: [{ productId: P1.toUpperCase(), quantity: 2 }],
    });

    expect(dto).toBeInstanceOf(CreateOrderDto);
    expect(dto).toEqual({
      customerName: 'Nguyen Van A',
      customerEmail: 'a.nguyen@example.com',
      items: [{ productId: P1, quantity: 2 }],
    });
    expect((dto as CreateOrderDto).items[0]).toBeInstanceOf(OrderItemDto);
  });

  describe('duplicate products (ADR-010)', () => {
    const message = 'items must not contain the same productId more than once';

    it('rejects the same productId twice', async () => {
      const result = await validate({
        ...valid,
        items: [
          { productId: P1, quantity: 1 },
          { productId: P1, quantity: 2 },
        ],
      });

      expect(invalidFields(result)).toEqual(['items']);
      expect(messagesOf(result, 'items')).toEqual([message]);
    });

    it('rejects ids that differ only in letter case', async () => {
      const result = await validate({
        ...valid,
        items: [
          { productId: P1, quantity: 1 },
          { productId: P1.toUpperCase(), quantity: 1 },
        ],
      });

      expect(invalidFields(result)).toEqual(['items']);
      expect(messagesOf(result, 'items')).toEqual([message]);
    });

    it('does not report items without a productId as duplicates', async () => {
      const result = await validate({
        ...valid,
        items: [{ quantity: 1 }, { quantity: 2 }],
      });

      expect(invalidFields(result)).toEqual([
        'items.0.productId',
        'items.1.productId',
      ]);
    });
  });

  describe('items', () => {
    it.each([
      ['an empty array', [], 'items must contain at least 1 elements'],
      ['a missing array', undefined, 'items must be an array'],
      ['not an array', 'P1', 'items must be an array'],
      [
        'more than 50 items',
        Array.from({ length: 51 }, (_, i) => ({
          productId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          quantity: 1,
        })),
        'items must contain no more than 50 elements',
      ],
    ])('rejects %s', async (_case, items, message) => {
      const result = await validate({ ...valid, items });

      expect(invalidFields(result)).toEqual(['items']);
      expect(messagesOf(result, 'items')).toContain(message);
    });

    // Without @IsObject, an array inside `items` passed validation, and the
    // service answered 404 "Product undefined not found".
    it.each([
      ['an empty array', [[]]],
      ['an array holding a valid item', [[{ productId: P1, quantity: 1 }]]],
      ['null', [null]],
      ['a string', [P1]],
    ])('rejects an item that is %s', async (_case, items) => {
      const result = await validate({ ...valid, items });

      expect(invalidFields(result)).toContain('items');
      expect(messagesOf(result, 'items')).toEqual([
        'each value in items must be an object',
      ]);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['a string', 'P1'],
      ['an object', { productId: P1, quantity: 1 }],
    ])('does not check each item when items is %s', async (_case, items) => {
      const result = await validate({ ...valid, items });

      expect(messagesOf(result, 'items')).toContain('items must be an array');
      expect(messagesOf(result, 'items')).not.toContain(
        'each value in items must be an object',
      );
    });

    it('accepts 50 items', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        productId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        quantity: 1,
      }));

      expect(await validate({ ...valid, items })).toBeInstanceOf(
        CreateOrderDto,
      );
    });

    it.each([
      [0, 'quantity must not be less than 1'],
      [-1, 'quantity must not be less than 1'],
      [1001, 'quantity must not be greater than 1000'],
      [1.5, 'quantity must be an integer number'],
      ['2', 'quantity must be an integer number'],
      [null, 'quantity must be an integer number'],
    ])('rejects quantity=%j', async (quantity, message) => {
      const result = await validate({
        ...valid,
        items: [{ productId: P1, quantity }],
      });

      expect(invalidFields(result)).toEqual(['items.0.quantity']);
      expect(messagesOf(result, 'items.0.quantity')).toContain(message);
    });

    it.each([1, 1000])('accepts quantity=%d', async (quantity) => {
      expect(
        await validate({ ...valid, items: [{ productId: P1, quantity }] }),
      ).toBeInstanceOf(CreateOrderDto);
    });

    it.each([
      ['not a UUID', 'abc'],
      ['a UUID v1', '8c1f6a2e-3b7d-1c55-9a0e-2f6d1b7c9e10'],
      ['a number', 123],
    ])('rejects a productId that is %s', async (_case, productId) => {
      const result = await validate({
        ...valid,
        items: [{ productId, quantity: 1 }],
      });

      expect(invalidFields(result)).toEqual(['items.0.productId']);
      expect(messagesOf(result, 'items.0.productId')).toEqual([
        'productId must be a UUID',
      ]);
    });

    it('rejects an unknown field inside an item', async () => {
      const result = await validate({
        ...valid,
        items: [{ productId: P1, quantity: 1, price: 1 }],
      });

      expect(invalidFields(result)).toEqual(['items.0.price']);
    });
  });

  describe('customer', () => {
    it.each([
      ['customerEmail', 'not-an-email'],
      ['customerEmail', `${'a'.repeat(250)}@example.com`],
      ['customerEmail', 42],
      ['customerName', '   '],
      ['customerName', 'x'.repeat(256)],
      ['customerName', 42],
    ])('rejects %s=%j', async (field, value) => {
      const result = await validate({ ...valid, [field]: value });

      expect(invalidFields(result)).toEqual([field]);
    });

    it('accepts a 255-character name', async () => {
      expect(
        await validate({ ...valid, customerName: 'x'.repeat(255) }),
      ).toBeInstanceOf(CreateOrderDto);
    });
  });

  it('requires every field', async () => {
    expect(invalidFields(await validate({})).sort()).toEqual([
      'customerEmail',
      'customerName',
      'items',
    ]);
  });

  it('rejects unknown fields', async () => {
    const result = await validate({ ...valid, status: 'CONFIRMED' });

    expect(invalidFields(result)).toEqual(['status']);
  });
});
