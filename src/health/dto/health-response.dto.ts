import { ApiProperty } from '@nestjs/swagger';

/** Overall result of GET /health: `ok` only when every check is `up`. */
export enum HealthStatus {
  Ok = 'ok',
  Error = 'error',
}

/** Result of one check. */
export enum CheckStatus {
  Up = 'up',
  Down = 'down',
}

export class HealthChecksDto {
  @ApiProperty({
    enum: CheckStatus,
    enumName: 'CheckStatus',
    description: 'PostgreSQL answered `SELECT 1` within the timeout',
    example: CheckStatus.Up,
  })
  database: CheckStatus;

  @ApiProperty({
    enum: CheckStatus,
    enumName: 'CheckStatus',
    description: 'Redis answered `PING` within the timeout',
    example: CheckStatus.Up,
  })
  redis: CheckStatus;
}

/**
 * Body of GET /health, for both 200 and 503 (docs/04 §4.7). A 503 keeps this
 * shape instead of the unified error body, so a monitor sees which
 * dependency is down.
 */
export class HealthResponseDto {
  @ApiProperty({
    enum: HealthStatus,
    enumName: 'HealthStatus',
    example: HealthStatus.Ok,
  })
  status: HealthStatus;

  @ApiProperty({ type: HealthChecksDto })
  checks: HealthChecksDto;
}
