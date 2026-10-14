import { ParseUUIDPipe } from '@nestjs/common';
import { AppException } from '../errors/app.exception';

/**
 * ParseUUIDPipe for a route parameter such as `:id`. A malformed id becomes a
 * 400 VALIDATION_ERROR with a field detail, like any other invalid input.
 *
 *   @Param('id', uuidParam('id')) id: string
 */
export function uuidParam(field: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () =>
      AppException.validation([
        { field, messages: [`${field} must be a UUID`] },
      ]),
  });
}
