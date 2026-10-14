import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { uuidParam } from './uuid-param.pipe';

describe('uuidParam', () => {
  const pipe = uuidParam('id');
  const metadata = { type: 'param', data: 'id' } as const;

  it('passes a UUID v4 through', async () => {
    const id = '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10';

    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });

  it.each(['abc', '123', '8c1f6a2e-3b7d-1c55-9a0e-2f6d1b7c9e10'])(
    'rejects %j with a VALIDATION_ERROR on the field',
    async (value) => {
      const error = await pipe
        .transform(value, metadata)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: [{ field: 'id', messages: ['id must be a UUID'] }],
      });
    },
  );
});
