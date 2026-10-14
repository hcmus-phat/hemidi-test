import { OutboxEvent } from '../../outbox/entities/outbox-event.entity';
import { OrderStatus } from '../order-status.enum';
import {
  DispatchStatus,
  OrderJobsResponseDto,
} from './order-jobs-response.dto';

describe('OrderJobsResponseDto.from', () => {
  const ORDER_ID = '99999999-9999-4999-8999-999999999999';

  function event(values: Partial<OutboxEvent>): OutboxEvent {
    return Object.assign(new OutboxEvent(), {
      publishedAt: null,
      publishAttempts: 0,
      lastError: null,
      ...values,
    });
  }

  it('reports an event still in the outbox as PENDING, with its last error', () => {
    const dto = OrderJobsResponseDto.from({
      orderId: ORDER_ID,
      orderStatus: OrderStatus.PENDING,
      event: event({
        publishAttempts: 3,
        lastError: 'Redis did not answer within 3000 ms',
      }),
      jobs: [],
    });

    expect(dto).toEqual({
      orderId: ORDER_ID,
      orderStatus: OrderStatus.PENDING,
      dispatch: {
        status: DispatchStatus.PENDING,
        publishedAt: null,
        publishAttempts: 3,
        lastError: 'Redis did not answer within 3000 ms',
      },
      jobs: [],
    });
  });

  it('reports a published event as PUBLISHED', () => {
    const publishedAt = new Date('2026-10-14T03:15:00.910Z');

    const dto = OrderJobsResponseDto.from({
      orderId: ORDER_ID,
      orderStatus: OrderStatus.CONFIRMED,
      event: event({ publishedAt, publishAttempts: 1 }),
      jobs: [],
    });

    expect(dto.dispatch).toEqual({
      status: DispatchStatus.PUBLISHED,
      publishedAt,
      publishAttempts: 1,
      lastError: null,
    });
  });

  it('returns a null dispatch when the order has no outbox event', () => {
    const dto = OrderJobsResponseDto.from({
      orderId: ORDER_ID,
      orderStatus: OrderStatus.CANCELLED,
      event: null,
      jobs: [],
    });

    expect(dto.dispatch).toBeNull();
  });
});
