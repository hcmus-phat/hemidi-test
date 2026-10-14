import { AppException } from '../../common/errors/app.exception';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { QueryProductsDto } from './query-products.dto';

const pipe = createValidationPipe();

async function parse(query: Record<string, unknown>): Promise<unknown> {
  return pipe
    .transform(query, { type: 'query', metatype: QueryProductsDto })
    .catch((error: unknown) => error);
}

describe('QueryProductsDto', () => {
  it('converts query strings and keeps the pagination defaults', async () => {
    const query = await parse({
      search: '  áo  ',
      minPrice: '100000',
      maxPrice: '300000',
    });

    expect(query).toBeInstanceOf(QueryProductsDto);
    expect(query).toEqual({
      page: 1,
      limit: 10,
      search: 'áo',
      minPrice: 100000,
      maxPrice: 300000,
    });
  });

  it('leaves every filter optional', async () => {
    expect(await parse({ page: '2', limit: '5' })).toEqual({
      page: 2,
      limit: 5,
    });
  });

  it('rejects minPrice > maxPrice with a VALIDATION_ERROR on maxPrice', async () => {
    const error = await parse({ minPrice: '300000', maxPrice: '100000' });

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details).toEqual([
      {
        field: 'maxPrice',
        messages: ['maxPrice must be greater than or equal to minPrice'],
      },
    ]);
  });

  it('rejects an empty maxPrice instead of filtering on price <= 0', async () => {
    const error = await parse({ minPrice: '100', maxPrice: '' });

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details).toEqual([
      {
        field: 'maxPrice',
        messages: expect.arrayContaining([
          'maxPrice must be an integer number',
        ]),
      },
    ]);
    expect(JSON.stringify((error as AppException).details)).not.toContain(
      'greater than or equal to minPrice',
    );
  });

  it('reports an invalid minPrice only on minPrice', async () => {
    const error = await parse({ minPrice: 'abc', maxPrice: '5' });

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details?.map((d) => d.field)).toEqual([
      'minPrice',
    ]);
  });

  it.each([
    [{ minPrice: '100000', maxPrice: '100000' }],
    [{ minPrice: '100000' }],
    [{ maxPrice: '0' }],
  ])('accepts the inclusive range %j', async (input) => {
    expect(await parse(input)).toBeInstanceOf(QueryProductsDto);
  });

  it.each([
    ['minPrice', '-1'],
    ['minPrice', '1.5'],
    ['minPrice', 'abc'],
    ['minPrice', ''],
    ['minPrice', '  '],
    ['maxPrice', ''],
    ['maxPrice', '0x10'],
    ['maxPrice', '1e3'],
    ['maxPrice', '9007199254740992'],
    ['search', 'x'.repeat(101)],
    ['search', ['a', 'b']],
    ['sort', 'price'],
  ])('rejects %s=%j', async (field, value) => {
    const error = await parse({ [field]: value });

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details?.map((d) => d.field)).toEqual([
      field,
    ]);
  });
});
