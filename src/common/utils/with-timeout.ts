/** Thrown by `withTimeout` when the operation takes too long. */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

/**
 * Resolves or rejects like `promise`, or rejects with a TimeoutError after
 * `ms` milliseconds, whichever comes first.
 *
 * The operation itself is not cancelled: it may still complete later. Only
 * use it for operations that are safe to repeat, such as reads or adding a
 * job with a fixed id.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
