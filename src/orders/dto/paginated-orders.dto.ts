import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { OrderSummaryDto } from './order-response.dto';

/** Swagger schema of `GET /orders`. */
export class PaginatedOrdersDto {
  @ApiProperty({ type: [OrderSummaryDto] })
  data: OrderSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
