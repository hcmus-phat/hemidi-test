import { AppException } from '../../common/errors/app.exception';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { OrderStatus } from '../order-status.enum';
import { QueryOrdersDto } from './query-orders.dto';

const pipe = createValidationPipe();

async function parse(query: Record<string, unknown>): Promise<unknown> {
  return pipe
    .transform(query, { type: 'query', metatype: QueryOrdersDto })
    .catch((error: unknown) => error);
}

describe('QueryOrdersDto', () => {
  it('keeps the pagination defaults and leaves status optional', async () => {
    const query = await parse({});

    expect(query).toBeInstanceOf(QueryOrdersDto);
    expect(query).toEqual({ page: 1, limit: 10 });
  });

  it.each(Object.values(OrderStatus))('accepts status=%s', async (status) => {
    expect(await parse({ status, page: '2', limit: '5' })).toEqual({
      status,
      page: 2,
      limit: 5,
    });
  });

  it.each(['pending', 'EXPIRED', ''])(
    'rejects status=%j with a VALIDATION_ERROR',
    async (status) => {
      const error = await parse({ status });

      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).details).toEqual([
        {
          field: 'status',
          messages: [
            'status must be one of the following values: PENDING, CONFIRMED, FAILED, CANCELLED',
          ],
        },
      ]);
    },
  );
});
