import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { QueryProductsDto } from './dto/query-products.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  const ID = '8c1f6a2e-3b7d-4c55-9a0e-2f6d1b7c9e10';
  const product = Object.assign(new Product(), {
    id: ID,
    sku: 'TSHIRT-WHITE-M',
    name: 'T-shirt',
    price: 199000,
    stock: 50,
    createdAt: new Date('2026-10-14T03:00:00.000Z'),
    updatedAt: new Date('2026-10-14T03:00:00.000Z'),
    deletedAt: null,
  });

  const queryBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  const repository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  async function expectProductNotFound(promise: Promise<unknown>) {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: ErrorCode.PRODUCT_NOT_FOUND,
      details: [{ productId: ID }],
    });
    expect((error as AppException).getStatus()).toBe(404);
  }

  describe('create', () => {
    it('inserts the product and returns the saved row', async () => {
      const dto = {
        sku: 'TSHIRT-WHITE-M',
        name: 'T-shirt',
        price: 199000,
        stock: 50,
      };
      repository.create.mockReturnValue(dto);
      repository.save.mockResolvedValue(product);

      await expect(service.create(dto)).resolves.toBe(product);
      expect(repository.create).toHaveBeenCalledWith(dto);
      expect(repository.save).toHaveBeenCalledWith(dto);
    });

    it('lets a duplicate SKU error from the database propagate (mapped to 409 by the filter)', async () => {
      const dbError = new Error('duplicate key');
      repository.create.mockReturnValue({});
      repository.save.mockRejectedValue(dbError);

      await expect(
        service.create({ sku: 'A', name: 'A', price: 1, stock: 1 }),
      ).rejects.toBe(dbError);
    });
  });

  describe('findAll', () => {
    const query = (values: Partial<QueryProductsDto>): QueryProductsDto =>
      Object.assign(new QueryProductsDto(), values);

    it('orders newest first with a stable tie-breaker and paginates', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[product], 21]);

      const result = await service.findAll(query({ page: 3, limit: 10 }));

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'product.createdAt',
        'DESC',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'product.id',
        'DESC',
      );
      expect(queryBuilder.skip).toHaveBeenCalledWith(20);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [product],
        meta: { page: 3, limit: 10, total: 21, totalPages: 3 },
      });
    });

    it('searches the name case-insensitively with LIKE wildcards escaped', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll(query({ search: '50%_off' }));

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "product.name ILIKE :pattern ESCAPE '\\'",
        { pattern: '%50\\%\\_off%' },
      );
    });

    it('filters on an inclusive price range, including a bound of 0', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll(query({ minPrice: 0, maxPrice: 300000 }));

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'product.price >= :minPrice',
        { minPrice: 0 },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'product.price <= :maxPrice',
        { maxPrice: 300000 },
      );
    });

    it('returns an empty page beyond the last one', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[], 3]);

      const result = await service.findAll(query({ page: 5, limit: 10 }));

      expect(result).toEqual({
        data: [],
        meta: { page: 5, limit: 10, total: 3, totalPages: 1 },
      });
    });
  });

  describe('findOne', () => {
    it('returns the product', async () => {
      repository.findOneBy.mockResolvedValue(product);

      await expect(service.findOne(ID)).resolves.toBe(product);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: ID });
    });

    it('throws PRODUCT_NOT_FOUND when it does not exist or was deleted', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expectProductNotFound(service.findOne(ID));
    });
  });

  describe('update', () => {
    it('updates only the fields that were sent, on a product that is not deleted', async () => {
      repository.update.mockResolvedValue({ affected: 1 });
      repository.findOneBy.mockResolvedValue({ ...product, price: 150000 });

      const result = await service.update(ID, {
        price: 150000,
        name: undefined,
      });

      expect(repository.update).toHaveBeenCalledWith(
        { id: ID, deletedAt: IsNull() },
        { price: 150000 },
      );
      expect(result.price).toBe(150000);
    });

    it('returns the product unchanged for an empty body', async () => {
      repository.findOneBy.mockResolvedValue(product);

      await expect(service.update(ID, {})).resolves.toBe(product);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws PRODUCT_NOT_FOUND when no row was updated', async () => {
      repository.update.mockResolvedValue({ affected: 0 });

      await expectProductNotFound(service.update(ID, { stock: 3 }));
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('throws PRODUCT_NOT_FOUND for an empty body on a missing product', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expectProductNotFound(service.update(ID, {}));
    });
  });

  describe('remove', () => {
    it('soft-deletes the product', async () => {
      repository.softDelete.mockResolvedValue({ affected: 1 });

      await expect(service.remove(ID)).resolves.toBeUndefined();
      expect(repository.softDelete).toHaveBeenCalledWith({ id: ID });
    });

    it('throws PRODUCT_NOT_FOUND when it is missing or already deleted', async () => {
      repository.softDelete.mockResolvedValue({ affected: 0 });

      await expectProductNotFound(service.remove(ID));
    });
  });
});
