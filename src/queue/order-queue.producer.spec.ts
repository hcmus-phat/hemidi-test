import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { TimeoutError } from '../common/utils/with-timeout';
import { jobsConfig } from '../config/configuration';
import {
  OrderQueueProducer,
  REDIS_OPERATION_TIMEOUT_MS,
} from './order-queue.producer';
import { ORDER_PROCESSING_QUEUE } from './queue.constants';

describe('OrderQueueProducer', () => {
  const ORDER_ID = '99999999-9999-4999-8999-999999999999';
  const JOB_ID = `order-${ORDER_ID}`;

  const queue = { on: jest.fn(), add: jest.fn(), getJob: jest.fn() };
  let producer: OrderQueueProducer;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderQueueProducer,
        { provide: getQueueToken(ORDER_PROCESSING_QUEUE), useValue: queue },
        {
          provide: jobsConfig.KEY,
          useValue: {
            attempts: 4,
            backoffDelayMs: 2000,
            keepCompletedSeconds: 604800,
            keepFailedSeconds: 1209600,
          },
        },
      ],
    }).compile();
    producer = moduleRef.get(OrderQueueProducer);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('listens to queue errors, so BullMQ does not print each one with its stack', () => {
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  describe('enqueueProcessOrder', () => {
    it('adds the process-order job with its fixed id, 4 attempts and an exponential backoff', async () => {
      queue.add.mockResolvedValue({ id: JOB_ID });

      await producer.enqueueProcessOrder(ORDER_ID);

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'process-order',
        { orderId: ORDER_ID },
        {
          jobId: JOB_ID,
          attempts: 4,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 604800 },
          removeOnFail: { age: 1209600 },
        },
      );
    });

    it('passes a Redis error on to the caller', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      queue.add.mockRejectedValue(error);

      await expect(producer.enqueueProcessOrder(ORDER_ID)).rejects.toBe(error);
    });

    it('gives up when Redis does not answer in time', async () => {
      jest.useFakeTimers();
      queue.add.mockReturnValue(new Promise(() => undefined));

      const result = producer.enqueueProcessOrder(ORDER_ID);
      jest.advanceTimersByTime(REDIS_OPERATION_TIMEOUT_MS);

      await expect(result).rejects.toThrow(TimeoutError);
    });
  });

  describe('getOrderJobs', () => {
    it('returns the state of the job of the order', async () => {
      queue.getJob.mockResolvedValue({
        id: JOB_ID,
        name: 'process-order',
        getState: jest.fn().mockResolvedValue('failed'),
        attemptsMade: 4,
        opts: { attempts: 4 },
        failedReason: 'Simulated random processing failure',
        returnvalue: null,
        timestamp: Date.parse('2026-10-14T03:15:00.900Z'),
        processedOn: Date.parse('2026-10-14T03:15:29.300Z'),
        finishedOn: Date.parse('2026-10-14T03:15:33.800Z'),
      });

      const jobs = await producer.getOrderJobs(ORDER_ID);

      expect(queue.getJob).toHaveBeenCalledWith(JOB_ID);
      expect(jobs).toEqual([
        {
          jobId: JOB_ID,
          name: 'process-order',
          state: 'failed',
          attemptsMade: 4,
          maxAttempts: 4,
          failedReason: 'Simulated random processing failure',
          returnValue: null,
          createdAt: '2026-10-14T03:15:00.900Z',
          processedAt: '2026-10-14T03:15:29.300Z',
          finishedAt: '2026-10-14T03:15:33.800Z',
        },
      ]);
    });

    it('uses null for what a waiting job does not have yet', async () => {
      queue.getJob.mockResolvedValue({
        id: JOB_ID,
        name: 'process-order',
        getState: jest.fn().mockResolvedValue('waiting'),
        attemptsMade: 0,
        opts: { attempts: 4 },
        timestamp: Date.parse('2026-10-14T03:15:00.900Z'),
      });

      const [job] = await producer.getOrderJobs(ORDER_ID);

      expect(job).toMatchObject({
        state: 'waiting',
        attemptsMade: 0,
        failedReason: null,
        returnValue: null,
        processedAt: null,
        finishedAt: null,
      });
    });

    it('returns no job when the order has none in Redis', async () => {
      queue.getJob.mockResolvedValue(undefined);

      await expect(producer.getOrderJobs(ORDER_ID)).resolves.toEqual([]);
    });

    it('gives up when Redis does not answer in time', async () => {
      jest.useFakeTimers();
      queue.getJob.mockReturnValue(new Promise(() => undefined));

      const result = producer.getOrderJobs(ORDER_ID);
      jest.advanceTimersByTime(REDIS_OPERATION_TIMEOUT_MS);

      await expect(result).rejects.toThrow(
        `Redis did not answer within ${REDIS_OPERATION_TIMEOUT_MS} ms`,
      );
    });
  });
});
