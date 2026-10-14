import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** One entry of `details`. Its shape depends on the error code. */
export type ErrorDetail = Record<string, unknown>;

/** `details` entry of a VALIDATION_ERROR, e.g. `{ field: 'items.0.quantity', messages: [...] }`. */
export interface FieldErrorDetail extends ErrorDetail {
  field: string;
  messages: string[];
}

/** `details` entry of an INSUFFICIENT_STOCK error, one per product that is short. */
export interface InsufficientStockDetail extends ErrorDetail {
  productId: string;
  sku: string;
  requested: number;
  available: number;
}

/**
 * Business error with a machine-readable code. AllExceptionsFilter turns it into
 * `{ statusCode, error: code, message, details }`.
 *
 * Services throw it through the static factories below, so each error code is
 * always produced with the same HTTP status and message format.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: ErrorDetail[],
  ) {
    super(message, status);
  }

  static validation(
    details: FieldErrorDetail[],
    message = 'Request validation failed',
  ): AppException {
    return new AppException(
      ErrorCode.VALIDATION_ERROR,
      message,
      HttpStatus.BAD_REQUEST,
      details,
    );
  }

  static productNotFound(productIds: string | string[]): AppException {
    const ids = Array.isArray(productIds) ? productIds : [productIds];
    const message =
      ids.length === 1
        ? `Product ${ids[0]} not found`
        : `${ids.length} products not found`;
    return new AppException(
      ErrorCode.PRODUCT_NOT_FOUND,
      message,
      HttpStatus.NOT_FOUND,
      ids.map((productId) => ({ productId })),
    );
  }

  static orderNotFound(orderId: string): AppException {
    return new AppException(
      ErrorCode.ORDER_NOT_FOUND,
      `Order ${orderId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }

  static skuAlreadyExists(sku?: string): AppException {
    const message = sku
      ? `A product with SKU ${sku} already exists`
      : 'A product with this SKU already exists';
    return new AppException(
      ErrorCode.SKU_ALREADY_EXISTS,
      message,
      HttpStatus.CONFLICT,
    );
  }

  static insufficientStock(items: InsufficientStockDetail[]): AppException {
    return new AppException(
      ErrorCode.INSUFFICIENT_STOCK,
      `Insufficient stock for ${items.length} product(s)`,
      HttpStatus.CONFLICT,
      items,
    );
  }

  /** e.g. `invalidOrderStatus('FAILED', 'cancelled')` -> "Order cannot be cancelled in status FAILED". */
  static invalidOrderStatus(status: string, action: string): AppException {
    return new AppException(
      ErrorCode.INVALID_ORDER_STATUS,
      `Order cannot be ${action} in status ${status}`,
      HttpStatus.CONFLICT,
    );
  }

  static serviceUnavailable(message: string): AppException {
    return new AppException(
      ErrorCode.SERVICE_UNAVAILABLE,
      message,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
