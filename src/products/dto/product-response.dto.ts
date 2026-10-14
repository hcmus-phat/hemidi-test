import { ApiProperty } from '@nestjs/swagger';
import { Product } from '../entities/product.entity';

/** Public representation of a product. `deletedAt` is never exposed. */
export class ProductResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10',
  })
  id: string;

  @ApiProperty({ example: 'TSHIRT-WHITE-M' })
  sku: string;

  @ApiProperty({ example: 'Áo thun trắng size M' })
  name: string;

  @ApiProperty({
    type: 'integer',
    description: 'Price in VND',
    example: 199000,
  })
  price: number;

  @ApiProperty({ type: 'integer', example: 50 })
  stock: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-14T03:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time', example: '2026-10-14T03:00:00.000Z' })
  updatedAt: Date;

  static fromEntity(product: Product): ProductResponseDto {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      stock: product.stock,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
