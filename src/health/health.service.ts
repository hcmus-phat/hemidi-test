import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { errorMessage } from '../common/utils/error-message';
import { withTimeout } from '../common/utils/with-timeout';
import { ORDER_PROCESSING_QUEUE } from '../queue/queue.constants';
import {
  CheckStatus,
  HealthResponseDto,
  HealthStatus,
} from './dto/health-response.dto';

/** Longest wait for each check: GET /health never hangs on a dead dependency. */
export const HEALTH_CHECK_TIMEOUT_MS = 2000;

/**
 * Checks the two dependencies of the API (docs/04 §4.7), in parallel:
 *
 * - database: `SELECT 1` through the TypeORM connection pool;
 * - Redis: `PING` through the connection of the order-processing queue, the
 *   same one that GET /orders/:id/jobs uses.
 *
 * Each check is `down` when it fails or does not answer within
 * HEALTH_CHECK_TIMEOUT_MS. The reason is logged, never returned.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(ORDER_PROCESSING_QUEUE) private readonly queue: Queue,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [database, redis] = await Promise.all([
      this.probe('database', () => this.dataSource.query('SELECT 1')),
      this.probe('redis', () => this.pingRedis()),
    ]);
    const allUp = database === CheckStatus.Up && redis === CheckStatus.Up;
    return {
      status: allUp ? HealthStatus.Ok : HealthStatus.Error,
      checks: { database, redis },
    };
  }

  private async probe(
    name: string,
    operation: () => Promise<unknown>,
  ): Promise<CheckStatus> {
    try {
      await withTimeout(
        operation(),
        HEALTH_CHECK_TIMEOUT_MS,
        `no answer within ${HEALTH_CHECK_TIMEOUT_MS} ms`,
      );
      return CheckStatus.Up;
    } catch (error) {
      this.logger.warn(`Health check: ${name} is down: ${errorMessage(error)}`);
      return CheckStatus.Down;
    }
  }

  /**
   * BullMQ 6 types its connection as an adapter that only declares the
   * commands BullMQ itself uses, without PING. The object is a proxy over
   * the ioredis client that BullMQ created from our connection options, and
   * it forwards every other command, PING included, to that client.
   */
  private async pingRedis(): Promise<void> {
    const client = await this.queue.getBackend().client;
    await (client as unknown as Pick<Redis, 'ping'>).ping();
  }
}
