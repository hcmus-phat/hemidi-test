import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OrderStatus } from '../order-status.enum';

/** `GET /orders` query: pagination and an optional status filter. */
export class QueryOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: OrderStatus,
    enumName: 'OrderStatus',
    description: 'Only orders in this status',
    example: OrderStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}
