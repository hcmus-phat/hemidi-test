import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { paginate, Paginated } from '../common/dto/paginated-response.dto';
import { getPaginationOffset } from '../common/dto/pagination-query.dto';
import { AppException } from '../common/errors/app.exception';
import {
  escapeLikePattern,
  LIKE_ESCAPE_CHAR,
} from '../common/utils/escape-like';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /**
   * SKU uniqueness is enforced by the partial unique index
   * uq_products_sku_active, not by a "check then insert" (which two concurrent
   * requests could both pass). AllExceptionsFilter maps the violation to
   * 409 SKU_ALREADY_EXISTS.
   */
  create(dto: CreateProductDto): Promise<Product> {
    return this.products.save(this.products.create(dto));
  }

  /**
   * Newest first, with id as a tie-breaker so pages are stable. Soft-deleted
   * rows are excluded automatically because the entity has @DeleteDateColumn.
   * A page beyond the last one simply returns no rows.
   */
  async findAll(query: QueryProductsDto): Promise<Paginated<Product>> {
    const qb = this.products
      .createQueryBuilder('product')
      .orderBy('product.createdAt', 'DESC')
      .addOrderBy('product.id', 'DESC')
      .skip(getPaginationOffset(query))
      .take(query.limit);

    if (query.search) {
      qb.andWhere(`product.name ILIKE :pattern ESCAPE '${LIKE_ESCAPE_CHAR}'`, {
        pattern: `%${escapeLikePattern(query.search)}%`,
      });
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('product.price >= :minPrice', { minPrice: query.minPrice });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('product.price <= :maxPrice', { maxPrice: query.maxPrice });
    }

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, query);
  }

  /** Soft-deleted products are excluded automatically (@DeleteDateColumn). */
  async findOne(id: string): Promise<Product> {
    const product = await this.products.findOneBy({ id });
    if (!product) {
      throw AppException.productNotFound(id);
    }
    return product;
  }

  /**
   * Partial update. Only the fields present in the body are written, and an
   * empty body returns the product unchanged. A single UPDATE ... WHERE
   * deleted_at IS NULL both checks that the product exists and applies the
   * change, so a concurrent delete cannot be overwritten.
   */
  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<Product>;

    if (Object.keys(changes).length > 0) {
      const { affected } = await this.products.update(
        { id, deletedAt: IsNull() },
        changes,
      );
      if (!affected) {
        throw AppException.productNotFound(id);
      }
    }
    return this.findOne(id);
  }

  /**
   * Soft delete: sets deleted_at. TypeORM only touches rows whose deleted_at is
   * still NULL, so deleting twice reports 404 the second time.
   */
  async remove(id: string): Promise<void> {
    const { affected } = await this.products.softDelete({ id });
    if (!affected) {
      throw AppException.productNotFound(id);
    }
  }
}
