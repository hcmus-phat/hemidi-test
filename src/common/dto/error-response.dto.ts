import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ErrorDetail } from '../errors/app.exception';

/**
 * The unified error body returned by AllExceptionsFilter for every error
 * (docs/04 §2). Also used as the Swagger schema of error responses.
 */
export class ErrorResponseDto {
  @ApiProperty({
    type: 'integer',
    description: 'HTTP status code',
    example: 409,
  })
  statusCode: number;

  @ApiProperty({
    description:
      'Machine-readable error code, e.g. VALIDATION_ERROR, PRODUCT_NOT_FOUND, SKU_ALREADY_EXISTS, INSUFFICIENT_STOCK',
    example: 'INSUFFICIENT_STOCK',
  })
  error: string;

  @ApiProperty({
    description: 'Human-readable message (English)',
    example: 'Insufficient stock for 1 product(s)',
  })
  message: string;

  @ApiPropertyOptional({
    description:
      'Extra information, e.g. one entry per invalid field ({ field, messages }) or per product that is short of stock',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [
      {
        productId: '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10',
        sku: 'LAST-ITEM-001',
        requested: 2,
        available: 1,
      },
    ],
  })
  details?: ErrorDetail[];

  @ApiProperty({ description: 'Request path', example: '/orders' })
  path: string;

  @ApiProperty({
    description: 'When the error happened (ISO 8601, UTC)',
    format: 'date-time',
    example: '2026-10-14T03:15:00.000Z',
  })
  timestamp: string;
}
