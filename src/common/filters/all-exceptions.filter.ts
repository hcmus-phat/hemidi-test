import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { AppException, ErrorDetail } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { DbConstraint, PgErrorCode } from '../errors/pg-error-codes';

interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
}

const INTERNAL_ERROR: ApiError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Internal server error',
};

/**
 * Errors from Express middleware are not HttpExceptions. body-parser uses the
 * http-errors package, which marks client errors with `expose: true`
 * (e.g. 413 when the body is too large).
 */
function isExposedHttpError(
  exception: unknown,
): exception is Error & { status: number } {
  if (!(exception instanceof Error)) {
    return false;
  }
  const { status, expose } = exception as {
    status?: unknown;
    expose?: unknown;
  };
  return typeof status === 'number' && expose === true;
}

/**
 * SQLSTATE and SQL of a failed query, for the log only (docs/04 §2). The stack
 * of a QueryFailedError holds neither. Query parameters are left out on
 * purpose: they can contain customer emails (docs/02 §8).
 */
function describeFailedQuery(exception: unknown): string {
  if (!(exception instanceof QueryFailedError)) {
    return '';
  }
  const { code } = (exception.driverError ?? {}) as { code?: unknown };
  const sqlState = typeof code === 'string' ? code : 'unknown';
  return ` [SQLSTATE ${sqlState}] ${exception.query}`;
}

/** Error codes for HTTP errors raised by Nest or Express (unknown route, ParseUUIDPipe, ...). */
const ERROR_CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

/**
 * Turns every exception into the unified error format:
 * - AppException: its own code, message and details.
 * - Nest HttpException (unknown route, ParseUUIDPipe, ...): code derived from the status.
 * - Client errors from Express middleware (body-parser): code derived from the status.
 * - TypeORM QueryFailedError: mapped by Postgres error code and constraint name.
 * - Anything else: 500 INTERNAL_ERROR. The stack is logged, never returned.
 *
 * Every 5xx is logged with its stack, plus the SQLSTATE and SQL for a failed
 * query. 4xx errors are expected and not logged.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const path = request.originalUrl ?? request.url;

    const error = this.toApiError(exception);

    if (error.status >= 500) {
      this.logger.error(
        `${request.method} ${path} -> ${error.status} ${error.code}${describeFailedQuery(exception)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseDto = {
      statusCode: error.status,
      error: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
      path,
      timestamp: new Date().toISOString(),
    };
    response.status(error.status).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof QueryFailedError) {
      const mapped = this.fromDatabaseError(exception.driverError);
      return mapped ? this.fromAppException(mapped) : INTERNAL_ERROR;
    }
    if (exception instanceof AppException) {
      return this.fromAppException(exception);
    }
    if (exception instanceof HttpException) {
      return this.fromStatus(exception.getStatus(), this.messageOf(exception));
    }
    if (isExposedHttpError(exception)) {
      return this.fromStatus(exception.status, exception.message);
    }
    return INTERNAL_ERROR;
  }

  private fromAppException(exception: AppException): ApiError {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  /** Error code for an HTTP error raised by Nest or Express rather than by our code. */
  private fromStatus(status: number, message: string): ApiError {
    const code = ERROR_CODE_BY_STATUS[status];
    if (code) {
      return { status, code, message };
    }
    if (status >= 500) {
      return INTERNAL_ERROR;
    }
    // Any other 4xx, e.g. 413 -> PAYLOAD_TOO_LARGE.
    return { status, code: HttpStatus[status] ?? 'HTTP_ERROR', message };
  }

  /** Maps database errors that are caused by the request rather than by a bug. */
  private fromDatabaseError(driverError: unknown): AppException | undefined {
    // node-postgres errors carry the SQLSTATE code and the violated constraint.
    const { code, constraint } = (driverError ?? {}) as {
      code?: string;
      constraint?: string;
    };

    switch (code) {
      case PgErrorCode.UNIQUE_VIOLATION:
        return constraint === DbConstraint.PRODUCTS_SKU_ACTIVE
          ? AppException.skuAlreadyExists()
          : this.conflict();
      case PgErrorCode.CHECK_VIOLATION:
        return constraint === DbConstraint.PRODUCTS_STOCK_NON_NEGATIVE
          ? new AppException(
              ErrorCode.INSUFFICIENT_STOCK,
              'Insufficient stock',
              HttpStatus.CONFLICT,
            )
          : this.conflict();
      case PgErrorCode.FOREIGN_KEY_VIOLATION:
        return this.conflict();
      // A value Postgres cannot read (22P02, e.g. a malformed uuid) or store
      // (22021, e.g. a NUL character, which text columns do not accept).
      case PgErrorCode.INVALID_TEXT_REPRESENTATION:
      case PgErrorCode.CHARACTER_NOT_IN_REPERTOIRE:
        return new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Invalid input value',
          HttpStatus.BAD_REQUEST,
        );
      case PgErrorCode.LOCK_NOT_AVAILABLE:
      case PgErrorCode.DEADLOCK_DETECTED:
        return AppException.serviceUnavailable(
          'The database is busy, please retry',
        );
      default:
        return undefined;
    }
  }

  private conflict(): AppException {
    return new AppException(
      ErrorCode.CONFLICT,
      'Request conflicts with the current state of the data',
      HttpStatus.CONFLICT,
    );
  }

  /** Nest exceptions carry either a string or `{ message: string | string[] }`. */
  private messageOf(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    const { message } = response as { message?: unknown };
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return typeof message === 'string' ? message : exception.message;
  }
}
