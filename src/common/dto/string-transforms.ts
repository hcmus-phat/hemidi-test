import type { TransformFnParams } from 'class-transformer';

/*
 * Normalisers for `@Transform(...)` on DTO string fields. They run before
 * validation and leave non-string values untouched, so `@IsString()` can still
 * reject them with a clear message.
 */

export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const trimAndUpperCase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const trimAndLowerCase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
