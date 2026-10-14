import { ApiProperty } from '@nestjs/swagger';
import type { PaginationQueryDto } from './pagination-query.dto';

export class PaginationMetaDto {
  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 10 })
  limit: number;

  @ApiProperty({
    type: 'integer',
    description: 'Number of items matching the query',
    example: 7,
  })
  total: number;

  @ApiProperty({ type: 'integer', example: 1 })
  totalPages: number;
}

/**
 * Shape of every list response: `{ data: [...], meta: { page, limit, total, totalPages } }`.
 * Swagger schemas use a concrete subclass per resource (e.g. PaginatedProductsDto).
 */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMetaDto;
}

export function paginate<T>(
  data: T[],
  total: number,
  { page, limit }: PaginationQueryDto,
): Paginated<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
