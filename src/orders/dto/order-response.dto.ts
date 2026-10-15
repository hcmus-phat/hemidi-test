import { ApiProperty } from '@nestjs/swagger';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { calculateLineTotal } from '../order-amounts';
import { CancelReason, OrderStatus } from '../order-status.enum';

const DATE_EXAMPLE = '2026-10-14T03:15:00.000Z';

/** One product of an order, from the snapshot taken when it was placed. */
export class OrderItemResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5d0c9b7e-1f2a-4c3d-8e4f-6a7b8c9d0e1f',
  })
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10',
  })
  productId: string;

  @ApiProperty({
    description: 'SKU when the order was placed',
    example: 'TSHIRT-WHITE-M',
  })
  productSku: string;

  @ApiProperty({
    description: 'Product name when the order was placed',
    example: 'Áo thun trắng size M',
  })
  productName: string;

  @ApiProperty({
    type: 'integer',
    description: 'Price in VND when the order was placed',
    example: 199000,
  })
  unitPrice: number;

  @ApiProperty({ type: 'integer', example: 2 })
  quantity: number;

  @ApiProperty({
    type: 'integer',
    description: 'unitPrice × quantity, in VND',
    example: 398000,
  })
  lineTotal: number;

  static fromEntity(item: OrderItem): OrderItemResponseDto {
    return {
      id: item.id,
      productId: item.productId,
      productSku: item.productSku,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: calculateLineTotal(item.unitPrice, item.quantity),
    };
  }
}

/** An order without its items (`GET /orders`). */
export class OrderSummaryDto {
  @ApiProperty({
    format: 'uuid',
    example: '0b7d4e2a-6f1c-4d8e-9b3a-5c2e1f0a9d77',
  })
  id: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  customerName: string;

  @ApiProperty({ description: 'Lower case', example: 'a.nguyen@example.com' })
  customerEmail: string;

  @ApiProperty({
    enum: OrderStatus,
    enumName: 'OrderStatus',
    example: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @ApiProperty({
    type: 'integer',
    description: 'Σ unitPrice × quantity, in VND',
    example: 548000,
  })
  totalAmount: number;

  // An inline enum that lists null. In OpenAPI 3.0, `nullable` only applies to
  // a `type` in the same schema: next to a $ref to a shared enum, the
  // document would not allow the null that most orders have.
  @ApiProperty({
    type: 'string',
    enum: [...Object.values(CancelReason), null],
    nullable: true,
    description: 'Set when status is CANCELLED',
    example: null,
  })
  cancelReason: CancelReason | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last processing error, set when status is FAILED',
    example: null,
  })
  failureReason: string | null;

  @ApiProperty({ format: 'date-time', example: DATE_EXAMPLE })
  createdAt: Date;

  @ApiProperty({ format: 'date-time', example: DATE_EXAMPLE })
  updatedAt: Date;

  static fromEntity(order: Order): OrderSummaryDto {
    return {
      id: order.id,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      status: order.status,
      totalAmount: order.totalAmount,
      cancelReason: order.cancelReason,
      failureReason: order.failureReason,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

/** An order with its status timestamps and items (`GET /orders/:id`). */
export class OrderDetailDto extends OrderSummaryDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  confirmedAt: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  cancelledAt: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  failedAt: Date | null;

  @ApiProperty({
    type: [OrderItemResponseDto],
    description: 'Sorted by productId',
  })
  items: OrderItemResponseDto[];

  /** `order.items` must be loaded. */
  static override fromEntity(order: Order): OrderDetailDto {
    return {
      ...OrderSummaryDto.fromEntity(order),
      confirmedAt: order.confirmedAt,
      cancelledAt: order.cancelledAt,
      failedAt: order.failedAt,
      items: order.items.map((item) => OrderItemResponseDto.fromEntity(item)),
    };
  }
}
