import type { ValueTransformer } from 'typeorm';

/**
 * Money is stored as `bigint` (VND, docs/03 §5). node-postgres returns `int8`
 * as a string to avoid precision loss, so entities convert it back to a number.
 *
 * DTO limits keep every amount far below Number.MAX_SAFE_INTEGER; the check
 * below makes a violation fail loudly instead of returning a wrong number.
 */
export const BigIntTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null | undefined => {
    if (value === null || value === undefined) {
      return value;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`bigint value out of safe range: ${value}`);
    }
    return parsed;
  },
} satisfies ValueTransformer;
