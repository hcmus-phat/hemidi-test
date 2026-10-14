import type { ValidationError } from 'class-validator';
import { AppException, FieldErrorDetail } from './app.exception';

/**
 * Flattens class-validator's error tree into one entry per field, using a dotted
 * path for nested objects and array items:
 *
 *   items[0].quantity < 1  ->  { field: 'items.0.quantity', messages: ['quantity must not be less than 1'] }
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath?: string,
): FieldErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own: FieldErrorDetail[] = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    const nested = error.children?.length
      ? flattenValidationErrors(error.children, field)
      : [];
    return [...own, ...nested];
  });
}

/** `exceptionFactory` of the global ValidationPipe: 400 VALIDATION_ERROR with field details. */
export function validationExceptionFactory(
  errors: ValidationError[],
): AppException {
  return AppException.validation(flattenValidationErrors(errors));
}
