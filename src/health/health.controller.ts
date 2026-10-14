import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CheckStatus,
  HealthResponseDto,
  HealthStatus,
} from './dto/health-response.dto';
import { HEALTH_CHECK_TIMEOUT_MS, HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Check the database and Redis',
    description: `Runs \`SELECT 1\` on PostgreSQL and \`PING\` on Redis in parallel, each with a ${HEALTH_CHECK_TIMEOUT_MS} ms timeout. 503 when either is down, with the same body shape (not the unified error body).`,
  })
  @ApiOkResponse({ type: HealthResponseDto, description: 'Both are up' })
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto,
    description: 'The database or Redis is down',
    example: {
      status: HealthStatus.Error,
      checks: { database: CheckStatus.Up, redis: CheckStatus.Down },
    },
  })
  async check(
    // passthrough: Nest still serialises the returned body; only the status
    // code is set here.
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const report = await this.healthService.check();
    if (report.status === HealthStatus.Error) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
