/**
 * PostgreSQL SQLSTATE codes that AllExceptionsFilter maps to API errors.
 * See https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
  CHARACTER_NOT_IN_REPERTOIRE: '22021',
  STRING_DATA_RIGHT_TRUNCATION: '22001',
  LOCK_NOT_AVAILABLE: '55P03',
  DEADLOCK_DETECTED: '40P01',
} as const;

/**
 * Constraint names the filter recognises. They come from the migrations
 * (docs/03 §4), which is why every constraint is named explicitly.
 */
export const DbConstraint = {
  PRODUCTS_SKU_ACTIVE: 'uq_products_sku_active',
  PRODUCTS_STOCK_NON_NEGATIVE: 'chk_products_stock_non_negative',
} as const;
