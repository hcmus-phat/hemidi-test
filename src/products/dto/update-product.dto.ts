import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * Every field is optional and follows the same rules as on creation.
 * `skipNullProperties: false` keeps validating explicit `null` values, so
 * `{ "name": null }` is a 400 instead of reaching the NOT NULL column.
 * `stock` is an absolute value (ADR-022).
 */
export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {}
