import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { toNumberIfDecimal } from './string-transforms';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
/** Sanity bound so that (page - 1) * limit always fits in a Postgres OFFSET. */
export const MAX_PAGE = 1_000_000;

/**
 * `?page=&limit=` shared by every list endpoint. Query values arrive as strings:
 * `toNumberIfDecimal` converts plain numbers and leaves anything else (such as
 * an empty `?page=`) for `@IsInt()` to reject.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number, starting at 1',
    minimum: 1,
    maximum: MAX_PAGE,
    default: DEFAULT_PAGE,
    example: 1,
  })
  @Transform(toNumberIfDecimal)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Items per page',
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: 10,
  })
  @Transform(toNumberIfDecimal)
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
