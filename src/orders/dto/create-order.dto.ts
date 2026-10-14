import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { trim, trimAndLowerCase } from '../../common/dto/string-transforms';

/** Upper bounds keep every order total far below Number.MAX_SAFE_INTEGER (docs/03 §5). */
export const MAX_ORDER_ITEMS = 50;
export const MAX_ITEM_QUANTITY = 1000;

export class OrderItemDto {
  @ApiProperty({
    description:
      'Id of a product that is not deleted (UUID v4). Lower-cased before it is validated and looked up.',
    format: 'uuid',
    example: '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10',
  })
  @Transform(trimAndLowerCase)
  @IsUUID('4')
  productId: string;

  @ApiProperty({
    type: 'integer',
    description: 'Units to order',
    minimum: 1,
    maximum: MAX_ITEM_QUANTITY,
    example: 2,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity: number;
}

/**
 * Key compared by @ArrayUnique. An item without a productId gets a key of
 * its own, so it is reported by its own field error rather than as a
 * duplicate of another incomplete item.
 */
const productIdKey = (item: Partial<OrderItemDto>): unknown =>
  item.productId ?? Symbol('missing productId');

/**
 * `validateIf` for the rules on each item: they only run on an array, so a
 * missing or non-array `items` is reported by @IsArray rather than by
 * messages about items that do not exist.
 */
const isArray = (_dto: object, items: unknown): boolean => Array.isArray(items);

export class CreateOrderDto {
  @ApiProperty({
    description: 'Customer name (trimmed)',
    minLength: 1,
    maxLength: 255,
    example: 'Nguyen Van A',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  customerName: string;

  @ApiProperty({
    description: 'Customer email. Trimmed and lower-cased before it is stored.',
    format: 'email',
    maxLength: 255,
    example: 'A.Nguyen@Example.com',
  })
  @Transform(trimAndLowerCase)
  @IsEmail()
  @MaxLength(255)
  customerEmail: string;

  @ApiProperty({
    type: [OrderItemDto],
    description:
      'Products to order. A productId may appear only once (ADR-010): send the total quantity instead.',
    minItems: 1,
    maxItems: MAX_ORDER_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  // Runs on the transformed items, so ids that differ only in case are duplicates.
  @ArrayUnique(productIdKey, {
    message: 'items must not contain the same productId more than once',
  })
  // @ValidateNested accepts an array as an item and only validates what is
  // inside it, so without this rule `items: [[]]` would pass and reach the
  // service. isObject is false for arrays and null.
  @IsObject({ each: true, validateIf: isArray })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
