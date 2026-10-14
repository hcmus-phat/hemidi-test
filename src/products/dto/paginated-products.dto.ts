import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { ProductResponseDto } from './product-response.dto';

/** Swagger schema of `GET /products`. */
export class PaginatedProductsDto {
  @ApiProperty({ type: [ProductResponseDto] })
  data: ProductResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
