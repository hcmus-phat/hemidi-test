import {
  ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ParseUUIDPipe,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AllExceptionsFilter } from './all-exceptions.filter';

const PATH = '/products?page=1';
const P1 = '11111111-1111-4111-8111-111111111111';

function catchWithFilter(exception: unknown): {
  status: number;
  body: ErrorResponseDto;
} {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const request = { method: 'POST', url: PATH, originalUrl: PATH };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  expect(response.status).toHaveBeenCalledTimes(1);
  expect(response.json).toHaveBeenCalledTimes(1);
  return {
    status: response.status.mock.calls[0][0] as number,
    body: response.json.mock.calls[0][0] as ErrorResponseDto,
  };
}

function queryFailed(code: string, constraint?: string): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate key value'), {
    code,
    constraint,
  });
  return new QueryFailedError(
    'INSERT INTO "products" ("sku") VALUES ($1)',
    ['SECRET-SKU'],
    driverError,
  );
}

describe('AllExceptionsFilter', () => {
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('AppException', () => {
    it('returns its code, message and details in the unified format', () => {
      const exception = AppException.insufficientStock([
        { productId: P1, sku: 'LAST-ITEM-001', requested: 2, available: 1 },
      ]);

      const { status, body } = catchWithFilter(exception);

      expect(status).toBe(409);
      expect(body).toEqual({
        statusCode: 409,
        error: ErrorCode.INSUFFICIENT_STOCK,
        message: 'Insufficient stock for 1 product(s)',
        details: [
          { productId: P1, sku: 'LAST-ITEM-001', requested: 2, available: 1 },
        ],
        path: PATH,
        timestamp: expect.any(String),
      });
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      expect(loggerError).not.toHaveBeenCalled();
    });

    it('omits details when there are none', () => {
      const { status, body } = catchWithFilter(AppException.orderNotFound(P1));

      expect(status).toBe(404);
      expect(body.error).toBe(ErrorCode.ORDER_NOT_FOUND);
      expect(body.message).toBe(`Order ${P1} not found`);
      expect(body).not.toHaveProperty('details');
    });
  });

  describe('Nest HttpException', () => {
    it('maps an unknown route to 404 NOT_FOUND', () => {
      const { status, body } = catchWithFilter(
        new NotFoundException('Cannot GET /nope'),
      );

      expect(status).toBe(404);
      expect(body.error).toBe(ErrorCode.NOT_FOUND);
      expect(body.message).toBe('Cannot GET /nope');
    });

    it('maps a ParseUUIDPipe failure to 400 VALIDATION_ERROR', async () => {
      const error: unknown = await new ParseUUIDPipe()
        .transform('not-a-uuid', { type: 'param', data: 'id' })
        .catch((e: unknown) => e);

      const { status, body } = catchWithFilter(error);

      expect(status).toBe(400);
      expect(body.error).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.message).toContain('uuid');
    });

    it('joins an array of messages', () => {
      const { body } = catchWithFilter(
        new BadRequestException(['first problem', 'second problem']),
      );

      expect(body.error).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.message).toBe('first problem; second problem');
    });

    it('uses the HTTP status name for other 4xx errors', () => {
      const { status, body } = catchWithFilter(new PayloadTooLargeException());

      expect(status).toBe(413);
      expect(body.error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('keeps the message of a 503', () => {
      const { status, body } = catchWithFilter(
        new ServiceUnavailableException('Redis is not reachable'),
      );

      expect(status).toBe(503);
      expect(body.error).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(body.message).toBe('Redis is not reachable');
    });

    it('hides the message of a 500 and logs it', () => {
      const { status, body } = catchWithFilter(
        new InternalServerErrorException('connection string leaked'),
      );

      expect(status).toBe(500);
      expect(body.error).toBe(ErrorCode.INTERNAL_ERROR);
      expect(body.message).toBe('Internal server error');
      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });

  describe('Express middleware errors (http-errors)', () => {
    it('maps an exposed client error by its status, e.g. a body that is too large', () => {
      const error = Object.assign(new Error('request entity too large'), {
        status: 413,
        expose: true,
      });

      const { status, body } = catchWithFilter(error);

      expect(status).toBe(413);
      expect(body.error).toBe('PAYLOAD_TOO_LARGE');
      expect(body.message).toBe('request entity too large');
      expect(loggerError).not.toHaveBeenCalled();
    });

    it('treats a non-exposed error with a status as an internal error', () => {
      const error = Object.assign(new Error('socket hang up'), {
        status: 502,
        expose: false,
      });

      const { status, body } = catchWithFilter(error);

      expect(status).toBe(500);
      expect(body.message).toBe('Internal server error');
    });
  });

  describe('TypeORM QueryFailedError', () => {
    it.each([
      ['23505', 'uq_products_sku_active', 409, ErrorCode.SKU_ALREADY_EXISTS],
      ['23505', 'uq_order_items_order_product', 409, ErrorCode.CONFLICT],
      ['23503', 'fk_order_items_product', 409, ErrorCode.CONFLICT],
      [
        '23514',
        'chk_products_stock_non_negative',
        409,
        ErrorCode.INSUFFICIENT_STOCK,
      ],
      ['23514', 'chk_orders_total_non_negative', 409, ErrorCode.CONFLICT],
      ['22P02', undefined, 400, ErrorCode.VALIDATION_ERROR],
      ['55P03', undefined, 503, ErrorCode.SERVICE_UNAVAILABLE],
      ['40P01', undefined, 503, ErrorCode.SERVICE_UNAVAILABLE],
      ['42P01', undefined, 500, ErrorCode.INTERNAL_ERROR],
    ])(
      'maps code %s (constraint %s) to %i %s',
      (code, constraint, expectedStatus, expectedError) => {
        const { status, body } = catchWithFilter(queryFailed(code, constraint));

        expect(status).toBe(expectedStatus);
        expect(body.statusCode).toBe(expectedStatus);
        expect(body.error).toBe(expectedError);
      },
    );

    it('never returns the SQL or its parameters', () => {
      for (const code of ['23505', '42P01']) {
        const { body } = catchWithFilter(
          queryFailed(code, 'uq_products_sku_active'),
        );
        const serialized = JSON.stringify(body);

        expect(serialized).not.toContain('INSERT');
        expect(serialized).not.toContain('SECRET-SKU');
      }
    });

    it('logs database errors that end up as 5xx', () => {
      catchWithFilter(queryFailed('40P01'));
      catchWithFilter(queryFailed('23505', 'uq_products_sku_active'));

      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown errors', () => {
    it('returns 500 INTERNAL_ERROR without leaking the message or stack', () => {
      const error = new Error('password=hunter2');

      const { status, body } = catchWithFilter(error);

      expect(status).toBe(500);
      expect(body).toEqual({
        statusCode: 500,
        error: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        path: PATH,
        timestamp: expect.any(String),
      });
      expect(JSON.stringify(body)).not.toContain('hunter2');
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('POST /products?page=1 -> 500'),
        error.stack,
      );
    });

    it('handles values that are not Error instances', () => {
      const { status, body } = catchWithFilter('something odd');

      expect(status).toBe(500);
      expect(body.error).toBe(ErrorCode.INTERNAL_ERROR);
    });
  });
});
