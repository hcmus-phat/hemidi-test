import { TimeoutError, withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value of a promise that settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'slow')).resolves.toBe(
      42,
    );
    // The timer was cleared: nothing is left to fire.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the error of a promise that fails in time', async () => {
    const error = new Error('boom');
    await expect(withTimeout(Promise.reject(error), 1000, 'slow')).rejects.toBe(
      error,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with a TimeoutError when the promise takes too long', async () => {
    const never = new Promise<never>(() => undefined);
    const result = withTimeout(never, 1000, 'Redis did not answer');

    jest.advanceTimersByTime(999);
    await Promise.resolve();
    jest.advanceTimersByTime(1);

    await expect(result).rejects.toThrow(TimeoutError);
    await expect(result).rejects.toThrow('Redis did not answer');
  });
});
