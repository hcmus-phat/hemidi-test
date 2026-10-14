import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
/** Sanity bound so that (page - 1) * limit always fits in a Postgres OFFSET. */
export const MAX_PAGE = 1_000_000;

/**
 * `?page=&limit=` shared by every list endpoint. Query values arrive as strings,
 * so `@Type(() => Number)` converts them before validation.
 */
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = DEFAULT_PAGE;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}

/** Number of rows to skip for the requested page. */
export function getPaginationOffset({
  page,
  limit,
}: PaginationQueryDto): number {
  return (page - 1) * limit;
}
