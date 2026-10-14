import type { TransformFnParams } from 'class-transformer';

/*
 * Transforms for `@Transform(...)` on DTO fields that arrive as strings. They
 * run before validation and leave any other value untouched, so the field's
 * own rules (`@IsString()`, `@IsInt()`, ...) still reject it with a clear message.
 */

export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const trimAndUpperCase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const trimAndLowerCase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** A plain decimal number: `10`, `-1`, `1.5`. */
const DECIMAL_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * For numeric query params, which are always strings. Only a plain decimal
 * number is converted. Anything else (`''`, `' '`, `'abc'`, `'0x10'`, `'1e3'`)
 * stays a string, so `@IsInt()` rejects it with a 400. `@Type(() => Number)`
 * would silently turn `''` into 0 (`?maxPrice=` would filter on `price <= 0`)
 * and `'0x10'` into 16.
 *
 * Fractions such as `'1.5'` are converted on purpose, so the error says
 * "must be an integer number" rather than also failing `@Min`/`@Max`.
 */
export const toNumberIfDecimal = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && DECIMAL_NUMBER.test(value)
    ? Number(value)
    : value;
