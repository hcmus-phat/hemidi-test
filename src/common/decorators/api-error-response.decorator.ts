import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { ErrorCode } from '../errors/error-codes';

/**
 * Documents one error response of an endpoint with the unified error schema:
 *
 *   @ApiErrorResponse(HttpStatus.NOT_FOUND, ErrorCode.PRODUCT_NOT_FOUND, 'Product does not exist or was deleted')
 */
export function ApiErrorResponse(
  status: HttpStatus,
  code: ErrorCode,
  description: string,
): MethodDecorator & ClassDecorator {
  return ApiResponse({
    status,
    description: `${code}: ${description}`,
    type: ErrorResponseDto,
  });
}
