import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toNumberIfDecimal, trim } from '../../common/dto/string-transforms';
import { IsGreaterThanOrEqualTo } from '../../common/validators/is-greater-than-or-equal-to.decorator';

/** Keeps price filters inside the range Postgres `bigint` and JS numbers share. */
const MAX_PRICE_FILTER = Number.MAX_SAFE_INTEGER;

/** `GET /products` query: pagination, name search and an inclusive price range. */
export class QueryProductsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Part of the product name, case-insensitive. % and _ are matched literally.',
    maxLength: 100,
    example: 'áo',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Minimum price in VND (inclusive)',
    minimum: 0,
    example: 100000,
  })
  @IsOptional()
  @Transform(toNumberIfDecimal)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_FILTER)
  minPrice?: number;

  @ApiPropertyOptional({
    description:
      'Maximum price in VND (inclusive). Must not be lower than minPrice.',
    minimum: 0,
    example: 300000,
  })
  @IsOptional()
  @Transform(toNumberIfDecimal)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_FILTER)
  @IsGreaterThanOrEqualTo('minPrice')
  maxPrice?: number;
}
