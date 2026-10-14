import { Logger } from '@nestjs/common';
import { createRedisErrorLogger } from './redis-error-logger';

describe('createRedisErrorLogger', () => {
  const logger = { warn: jest.fn() } as unknown as Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('logs a repeated error once a minute at most', () => {
    const onError = createRedisErrorLogger(logger, 'Queue q');
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:6379');

    onError(refused);
    onError(refused);
    jest.advanceTimersByTime(59_999);
    onError(refused);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Queue q: Redis error: connect ECONNREFUSED 127.0.0.1:6379',
    );

    jest.advanceTimersByTime(1);
    onError(refused);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('logs each distinct error', () => {
    const onError = createRedisErrorLogger(logger, 'Queue q');

    onError(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    onError(new Error('READONLY You cannot write against a read only replica'));

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
