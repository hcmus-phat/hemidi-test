import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { uuidParam } from '../common/pipes/uuid-param.pipe';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderJobsResponseDto } from './dto/order-jobs-response.dto';
import { OrderDetailDto, OrderSummaryDto } from './dto/order-response.dto';
import { PaginatedOrdersDto } from './dto/paginated-orders.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { OrdersService } from './orders.service';

const ORDER_ID_PARAM = {
  name: 'id',
  description: 'Order id (UUID v4)',
  format: 'uuid',
} as const;

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

  @Get()
  @ApiOperation({
    summary: 'List orders',
    description:
      'Newest first, without items. A page beyond the last one returns an empty `data` array.',
  })
  @ApiOkResponse({ type: PaginatedOrdersDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Invalid query parameter, e.g. an unknown status',
  )
  async findAll(@Query() query: QueryOrdersDto): Promise<PaginatedOrdersDto> {
    const { data, meta } = await this.ordersService.findAll(query);
    return { data: data.map((o) => OrderSummaryDto.fromEntity(o)), meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order with its items' })
  @ApiParam(ORDER_ID_PARAM)
  @ApiOkResponse({ type: OrderDetailDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'id is not a UUID',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.ORDER_NOT_FOUND,
    'Order does not exist',
  )
  async findOne(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<OrderDetailDto> {
    return OrderDetailDto.fromEntity(await this.ordersService.findOne(id));
  }

  @Get(':id/jobs')
  @ApiOperation({
    summary: 'Get the processing job of an order',
    description:
      'Shows whether the order was handed to the queue (`dispatch`, from the outbox) and the state of its BullMQ job: attempts, last error, result. `jobs` is empty until the worker publishes the order, and after the finished job was removed from Redis.',
  })
  @ApiParam(ORDER_ID_PARAM)
  @ApiOkResponse({ type: OrderJobsResponseDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'id is not a UUID',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.ORDER_NOT_FOUND,
    'Order does not exist',
  )
  @ApiErrorResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    ErrorCode.SERVICE_UNAVAILABLE,
    'Redis is unreachable or did not answer in time; retry',
  )
  async findJobs(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<OrderJobsResponseDto> {
    return OrderJobsResponseDto.from(await this.ordersService.getOrderJobs(id));
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Only a PENDING or CONFIRMED order can be cancelled (cancelReason CUSTOMER_REQUEST). Its stock is given back in the same transaction. No request body.',
  })
  @ApiParam(ORDER_ID_PARAM)
  @ApiOkResponse({ type: OrderDetailDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'id is not a UUID',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.ORDER_NOT_FOUND,
    'Order does not exist',
  )
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_ORDER_STATUS,
    'The order is FAILED or already CANCELLED',
  )
  @ApiErrorResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    ErrorCode.SERVICE_UNAVAILABLE,
    'Timed out waiting for a lock under heavy load; retry',
  )
  async cancel(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<OrderDetailDto> {
    return OrderDetailDto.fromEntity(await this.ordersService.cancel(id));
  }
}
