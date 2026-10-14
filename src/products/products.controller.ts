import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { uuidParam } from '../common/pipes/uuid-param.pipe';
import { CreateProductDto } from './dto/create-product.dto';
import { PaginatedProductsDto } from './dto/paginated-products.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

const PRODUCT_ID_PARAM = {
  name: 'id',
  description: 'Product id (UUID v4)',
  format: 'uuid',
} as const;

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a product' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Invalid body or unknown field',
  )
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ErrorCode.SKU_ALREADY_EXISTS,
    'Another product that is not deleted already uses this SKU',
  )
  async create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.create(dto),
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List products',
    description:
      'Newest first. `search` matches part of the name (case-insensitive); `minPrice` and `maxPrice` are inclusive. A page beyond the last one returns an empty `data` array.',
  })
  @ApiOkResponse({ type: PaginatedProductsDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Invalid query parameter, or minPrice greater than maxPrice',
  )
  async findAll(
    @Query() query: QueryProductsDto,
  ): Promise<PaginatedProductsDto> {
    const { data, meta } = await this.productsService.findAll(query);
    return { data: data.map((p) => ProductResponseDto.fromEntity(p)), meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'id is not a UUID',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.PRODUCT_NOT_FOUND,
    'Product does not exist or was deleted',
  )
  async findOne(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.findOne(id),
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update some fields of a product',
    description:
      'Only the fields sent are changed; an empty body returns the product unchanged. `stock` is set to the given absolute value.',
  })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Invalid id, body or unknown field',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.PRODUCT_NOT_FOUND,
    'Product does not exist or was deleted',
  )
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ErrorCode.SKU_ALREADY_EXISTS,
    'Another product that is not deleted already uses this SKU',
  )
  async update(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.update(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete a product',
    description:
      'The product disappears from the API and can no longer be ordered; existing orders keep their snapshot. Its SKU can be reused.',
  })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'id is not a UUID',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    ErrorCode.PRODUCT_NOT_FOUND,
    'Product does not exist or was already deleted',
  )
  async remove(@Param('id', uuidParam('id')) id: string): Promise<void> {
    await this.productsService.remove(id);
  }
}
