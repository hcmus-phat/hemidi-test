import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderDetailDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Place an order',
    description:
      'In one transaction: locks the products, checks and takes their stock, stores the order as PENDING with a snapshot of each product, and records an ORDER_CREATED event. A worker then confirms the order in the background. This endpoint does not depend on Redis.',
  })
  @ApiCreatedResponse({ type: OrderDetailDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Invalid body or unknown field, no items, or the same productId twice',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.PRODUCT_NOT_FOUND,
    'A product does not exist or was deleted; details lists every missing productId',
  )
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ErrorCode.INSUFFICIENT_STOCK,
    'Not enough stock; details lists every product that is short. Nothing was changed',
  )
  @ApiErrorResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    ErrorCode.SERVICE_UNAVAILABLE,
    'Timed out waiting for a product lock under heavy load; retry',
  )
  async create(@Body() dto: CreateOrderDto): Promise<OrderDetailDto> {
    return OrderDetailDto.fromEntity(await this.ordersService.create(dto));
  }
}
