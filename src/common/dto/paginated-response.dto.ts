import type { PaginationQueryDto } from './pagination-query.dto';

export class PaginationMetaDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Shape of every list response: `{ data: [...], meta: { page, limit, total, totalPages } }`. */
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
