import { AppException } from '../errors/app.exception';
import { createValidationPipe } from '../pipes/validation.pipe';
import { paginate } from './paginated-response.dto';
import {
  getPaginationOffset,
  PaginationQueryDto,
} from './pagination-query.dto';

describe('PaginationQueryDto', () => {
  const pipe = createValidationPipe();

  async function parse(query: Record<string, string>): Promise<unknown> {
    return pipe
      .transform(query, { type: 'query', metatype: PaginationQueryDto })
      .catch((error: unknown) => error);
  }

  it('defaults to page 1 and limit 10', async () => {
    const query = await parse({});

    expect(query).toBeInstanceOf(PaginationQueryDto);
    expect(query).toMatchObject({ page: 1, limit: 10 });
  });

  it('converts query strings to integers', async () => {
    expect(await parse({ page: '3', limit: '100' })).toMatchObject({
      page: 3,
      limit: 100,
    });
  });

  it.each([
    ['limit', '101', 'limit must not be greater than 100'],
    ['limit', '0', 'limit must not be less than 1'],
    ['page', '0', 'page must not be less than 1'],
    ['page', '1.5', 'page must be an integer number'],
    ['page', 'abc', 'page must be an integer number'],
    ['page', '', 'page must be an integer number'],
    ['page', ' ', 'page must be an integer number'],
    ['limit', '0x10', 'limit must be an integer number'],
    ['limit', '1e1', 'limit must be an integer number'],
    ['page', '1000001', 'page must not be greater than 1000000'],
  ])('rejects %s=%j with a VALIDATION_ERROR', async (field, value, message) => {
    const error = await parse({ [field]: value });

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details).toEqual([
      { field, messages: expect.arrayContaining([message]) },
    ]);
  });
});

describe('getPaginationOffset', () => {
  it.each([
    [1, 10, 0],
    [2, 10, 10],
    [5, 20, 80],
  ])('page %d with limit %d skips %d rows', (page, limit, offset) => {
    expect(getPaginationOffset({ page, limit })).toBe(offset);
  });
});

describe('paginate', () => {
  it('wraps the rows with page, limit, total and totalPages', () => {
    expect(paginate(['a', 'b'], 7, { page: 1, limit: 2 })).toEqual({
      data: ['a', 'b'],
      meta: { page: 1, limit: 2, total: 7, totalPages: 4 },
    });
  });

  it('returns an empty page beyond the last one', () => {
    expect(paginate([], 7, { page: 9, limit: 2 })).toEqual({
      data: [],
      meta: { page: 9, limit: 2, total: 7, totalPages: 4 },
    });
  });

  it('has zero pages when there are no rows', () => {
    expect(paginate([], 0, { page: 1, limit: 10 }).meta.totalPages).toBe(0);
  });
});
