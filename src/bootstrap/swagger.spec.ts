import { INestApplication } from '@nestjs/common';
import type {
  OpenAPIObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { HealthController } from '../health/health.controller';
import { HealthService } from '../health/health.service';
import { OrdersController } from '../orders/orders.controller';
import { OrdersService } from '../orders/orders.service';
import { ProductsController } from '../products/products.controller';
import { ProductsService } from '../products/products.service';
import { createSwaggerDocument } from './swagger';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
};

describe('createSwaggerDocument', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController, OrdersController, HealthController],
      providers: [
        { provide: ProductsService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: HealthService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = createSwaggerDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function schema(name: string): Schema {
    return document.components?.schemas?.[name] as Schema;
  }

  /** Schema of a query param of `GET path`, or `{}` if there is no such param. */
  function queryParam(
    name: string,
    path = '/products',
  ): SchemaObject | ReferenceObject {
    const parameters = document.paths[path].get?.parameters ?? [];
    // A parameter can also be a $ref to a shared definition, which has no name.
    const parameter = parameters.find(
      (p): p is ParameterObject => 'name' in p && p.name === name,
    );
    return parameter?.schema ?? {};
  }

  it('documents GET /health with the same body for 200 and 503', () => {
    const responses = document.paths['/health'].get?.responses ?? {};
    const healthSchema = {
      $ref: '#/components/schemas/HealthResponseDto',
    };

    expect(Object.keys(responses)).toEqual(['200', '503']);
    expect(responses['200']).toMatchObject({
      content: { 'application/json': { schema: healthSchema } },
    });
    expect(responses['503']).toMatchObject({
      content: {
        'application/json': {
          schema: healthSchema,
          example: {
            status: 'error',
            checks: { database: 'up', redis: 'down' },
          },
        },
      },
    });
    expect(document.components?.schemas?.CheckStatus).toMatchObject({
      enum: ['up', 'down'],
    });
    expect(document.components?.schemas?.HealthStatus).toMatchObject({
      enum: ['ok', 'error'],
    });
  });

  it('lists every order endpoint', () => {
    expect(Object.keys(document.paths['/orders'])).toEqual(
      expect.arrayContaining(['get', 'post']),
    );
    expect(Object.keys(document.paths['/orders/{id}'])).toEqual(
      expect.arrayContaining(['get']),
    );
    expect(Object.keys(document.paths['/orders/{id}/cancel'])).toEqual([
      'patch',
    ]);
    expect(Object.keys(document.paths['/orders/{id}/jobs'])).toEqual(['get']);
  });

  it('documents the 503 of GET /orders/{id}/jobs, when Redis is unreachable', () => {
    expect(
      Object.keys(document.paths['/orders/{id}/jobs'].get?.responses ?? {}),
    ).toEqual(expect.arrayContaining(['200', '400', '404', '503']));
  });

  it('documents the status filter of GET /orders as an enum', () => {
    expect(document.components?.schemas?.OrderStatus).toMatchObject({
      enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'],
    });
    expect(queryParam('status', '/orders')).toEqual({
      $ref: '#/components/schemas/OrderStatus',
    });
  });

  it('lists every product endpoint', () => {
    expect(Object.keys(document.paths['/products'])).toEqual(
      expect.arrayContaining(['get', 'post']),
    );
    expect(Object.keys(document.paths['/products/{id}'])).toEqual(
      expect.arrayContaining(['get', 'patch', 'delete']),
    );
  });

  // Money and counts are integers (docs/04 §1). Without `type: 'integer'`,
  // Swagger would publish them as `number`, i.e. allow 1.5.
  it.each([
    ['CreateProductDto', 'price'],
    ['CreateProductDto', 'stock'],
    ['UpdateProductDto', 'price'],
    ['ProductResponseDto', 'price'],
    ['ProductResponseDto', 'stock'],
    ['OrderItemDto', 'quantity'],
    ['OrderItemResponseDto', 'unitPrice'],
    ['OrderItemResponseDto', 'quantity'],
    ['OrderItemResponseDto', 'lineTotal'],
    ['OrderDetailDto', 'totalAmount'],
    ['OrderSummaryDto', 'totalAmount'],
    ['OrderDispatchDto', 'publishAttempts'],
    ['OrderJobDto', 'attemptsMade'],
    ['OrderJobDto', 'maxAttempts'],
    ['PaginationMetaDto', 'page'],
    ['PaginationMetaDto', 'totalPages'],
    ['ErrorResponseDto', 'statusCode'],
  ])('documents %s.%s as an integer', (dto, property) => {
    expect(schema(dto).properties[property].type).toBe('integer');
  });

  it.each([
    ['page', 1, 1_000_000],
    ['limit', 1, 100],
    ['minPrice', 0, Number.MAX_SAFE_INTEGER],
    ['maxPrice', 0, Number.MAX_SAFE_INTEGER],
  ])(
    'documents the query param %s as an integer in [%d, %d]',
    (name, minimum, maximum) => {
      expect(queryParam(name)).toMatchObject({
        type: 'integer',
        minimum,
        maximum,
      });
    },
  );

  // OpenAPI 3.0: `nullable` only applies to a `type` in the same schema, so
  // `nullable` next to a $ref (or allOf) would not allow null.
  it.each(['OrderSummaryDto', 'OrderDetailDto'])(
    'allows a null %s.cancelReason, with an inline enum that lists null',
    (dto) => {
      expect(schema(dto).properties.cancelReason).toMatchObject({
        type: 'string',
        nullable: true,
        enum: ['CUSTOMER_REQUEST', 'EXPIRED', null],
      });
      expect(schema(dto).properties.cancelReason).not.toHaveProperty('allOf');
    },
  );

  it('allows a null OrderJobsResponseDto.dispatch, with a null branch next to the $ref', () => {
    expect(schema('OrderJobsResponseDto').properties.dispatch).toMatchObject({
      oneOf: [
        { $ref: '#/components/schemas/OrderDispatchDto' },
        { type: 'object', nullable: true, enum: [null] },
      ],
    });
    expect(schema('OrderDispatchDto').properties.status).toBeDefined();
  });

  it('accepts a lower-case SKU, as the API does', () => {
    const pattern = new RegExp(
      schema('CreateProductDto').properties.sku.pattern as string,
    );

    expect(pattern.test('tshirt-white-m')).toBe(true);
    expect(pattern.test('TSHIRT WHITE')).toBe(false);
  });
});
