import { ArgumentMetadata, ParseUUIDPipe } from '@nestjs/common';
import { AppException } from '../errors/app.exception';

/**
 * ParseUUIDPipe that also returns the id in lower case, the form PostgreSQL
 * returns. A UUID is case-insensitive, and the database compares it that way,
 * but code that builds a string from it does not: the job id
 * `order-{orderId}` is a case-sensitive Redis key.
 */
class LowerCaseUuidPipe extends ParseUUIDPipe {
  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<string> {
    // Without the `optional` option, a valid value is always a string.
    const id = (await super.transform(value, metadata)) as string;
    return id.toLowerCase();
  }
}

/**
 * Validates a route parameter such as `:id` as a UUID v4 and normalizes it to
 * lower case. A malformed id becomes a 400 VALIDATION_ERROR with a field
 * detail, like any other invalid input.
 *
 *   @Param('id', uuidParam('id')) id: string
 */
export function uuidParam(field: string): ParseUUIDPipe {
  return new LowerCaseUuidPipe({
    version: '4',
    exceptionFactory: () =>
      AppException.validation([
        { field, messages: [`${field} must be a UUID`] },
      ]),
  });
}
