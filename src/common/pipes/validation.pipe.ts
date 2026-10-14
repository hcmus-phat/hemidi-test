import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../errors/validation-exception.factory';

/**
 * The global ValidationPipe (docs/02 §6):
 * - `whitelist` + `forbidNonWhitelisted`: an unknown body or query field is a 400.
 * - `transform`: the handler receives a DTO instance with `@Transform` applied.
 * - `exceptionFactory`: 400 VALIDATION_ERROR with one `details` entry per field.
 *
 * configureApp() registers it, and the DTO unit tests use it too, so the tests
 * always run against the production options.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
