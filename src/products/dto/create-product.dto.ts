import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { trim, trimAndUpperCase } from '../../common/dto/string-transforms';

export const SKU_PATTERN = /^[A-Z0-9_-]+$/;
/**
 * The SKU a client may send, for Swagger: lower case is accepted because the
 * DTO upper-cases the value before it checks SKU_PATTERN.
 */
const SKU_INPUT_PATTERN = '^[A-Za-z0-9_-]+$';
/** Upper bounds keep every order total far below Number.MAX_SAFE_INTEGER (docs/03 §5). */
export const MAX_PRICE = 1_000_000_000;
export const MAX_STOCK = 1_000_000;

export class CreateProductDto {
  @ApiProperty({
    description:
      'Stock keeping unit. Trimmed and upper-cased before it is validated and stored; unique among products that are not deleted.',
    example: 'TSHIRT-WHITE-M',
    minLength: 1,
    maxLength: 64,
    pattern: SKU_INPUT_PATTERN,
  })
  @Transform(trimAndUpperCase)
  @IsString()
  @Length(1, 64)
  @Matches(SKU_PATTERN, {
    message: 'sku may only contain letters, digits, "-" and "_"',
  })
  sku: string;

  @ApiProperty({
    description: 'Product name (trimmed)',
    example: 'Áo thun trắng size M',
    minLength: 1,
    maxLength: 255,
  })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({
    type: 'integer',
    description: 'Price in VND, an integer',
    example: 199000,
    minimum: 0,
    maximum: MAX_PRICE,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  price: number;

  @ApiProperty({
    type: 'integer',
    description: 'Units in stock',
    example: 50,
    minimum: 0,
    maximum: MAX_STOCK,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  stock: number;
}
