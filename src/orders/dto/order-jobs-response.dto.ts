import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { OutboxEvent } from '../../outbox/entities/outbox-event.entity';
import type { OrderJobSnapshot } from '../../queue/order-queue.producer';
import { OrderStatus } from '../order-status.enum';
import type { OrderJobs } from '../orders.service';

const ORDER_ID_EXAMPLE = '0b7d4e2a-6f1c-4d8e-9b3a-5c2e1f0a9d77';

/** Whether the ORDER_CREATED event of the order reached the queue. */
export enum DispatchStatus {
  /** Still in the outbox: the relay has not published it yet. */
  PENDING = 'PENDING',
  PUBLISHED = 'PUBLISHED',
}

/** Job states BullMQ reports, plus `unknown` for a job that disappeared meanwhile. */
const JOB_STATES = [
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
  'active',
  'completed',
  'failed',
  'unknown',
];

/** The outbox side: has the order been handed to the queue yet? (docs/04 §4.6) */
export class OrderDispatchDto {
  @ApiProperty({
    enum: DispatchStatus,
    enumName: 'DispatchStatus',
    example: DispatchStatus.PUBLISHED,
  })
  status: DispatchStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the relay published the event; null until then',
    example: '2026-10-14T03:15:00.910Z',
  })
  publishedAt: Date | null;

  @ApiProperty({
    type: 'integer',
    description: 'How many times the relay tried to publish the event',
    example: 1,
  })
  publishAttempts: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last publish error, e.g. Redis unreachable',
    example: null,
  })
  lastError: string | null;

  static fromEntity(event: OutboxEvent): OrderDispatchDto {
    return {
      status: event.publishedAt
        ? DispatchStatus.PUBLISHED
        : DispatchStatus.PENDING,
      publishedAt: event.publishedAt,
      publishAttempts: event.publishAttempts,
      lastError: event.lastError,
    };
  }
}

/** One BullMQ job of the order (docs/04 §4.6). */
export class OrderJobDto implements OrderJobSnapshot {
  @ApiProperty({ example: `order-${ORDER_ID_EXAMPLE}` })
  jobId: string;

  @ApiProperty({ example: 'process-order' })
  name: string;

  @ApiProperty({
    enum: JOB_STATES,
    description: '`delayed` means waiting for a retry',
    example: 'failed',
  })
  state: OrderJobSnapshot['state'];

  @ApiProperty({
    type: 'integer',
    description: 'Attempts that have ended (failed or completed)',
    example: 4,
  })
  attemptsMade: number;

  @ApiProperty({ type: 'integer', example: 4 })
  maxAttempts: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Error of the last failed attempt, also set while waiting for a retry',
    example: 'Simulated random processing failure',
  })
  failedReason: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      '`{ "result": "CONFIRMED" }` or `{ "skipped": true, "reason": "..." }`; null until the job completes',
    example: null,
  })
  returnValue: unknown;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-14T03:15:00.900Z',
  })
  createdAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Start of the last attempt',
    example: '2026-10-14T03:15:29.300Z',
  })
  processedAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-14T03:15:33.800Z',
  })
  finishedAt: string | null;
}

/** `GET /orders/:id/jobs`: where the order is in its background processing. */
@ApiExtraModels(OrderDispatchDto)
export class OrderJobsResponseDto {
  @ApiProperty({ format: 'uuid', example: ORDER_ID_EXAMPLE })
  orderId: string;

  @ApiProperty({
    enum: OrderStatus,
    enumName: 'OrderStatus',
    example: OrderStatus.FAILED,
  })
  orderStatus: OrderStatus;

  // In OpenAPI 3.0, `nullable` next to a $ref does not allow null: it only
  // applies to a `type` in the same schema. So null is a branch of its own,
  // a schema whose only value is null.
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(OrderDispatchDto) },
      { type: 'object', nullable: true, enum: [null] },
    ],
    description: 'The ORDER_CREATED outbox event; null if there is none',
  })
  dispatch: OrderDispatchDto | null;

  @ApiProperty({
    type: [OrderJobDto],
    description:
      'Empty until the relay published the order, and after BullMQ removed the finished job',
  })
  jobs: OrderJobDto[];

  static from(orderJobs: OrderJobs): OrderJobsResponseDto {
    const { orderId, orderStatus, event, jobs } = orderJobs;
    return {
      orderId,
      orderStatus,
      dispatch: event ? OrderDispatchDto.fromEntity(event) : null,
      jobs,
    };
  }
}
