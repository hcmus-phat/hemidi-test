import { Logger } from '@nestjs/common';
import { exitIfShutdownHangs, SHUTDOWN_TIMEOUT_MS } from './shutdown-watchdog';

describe('exitIfShutdownHangs', () => {
  const handlers = new Map<string, () => void>();

  beforeEach(() => {
    jest.useFakeTimers();
    handlers.clear();
    // Capture the listeners instead of adding them to the real process.
    jest.spyOn(process, 'once').mockImplementation(((
      event: string,
      listener: () => void,
    ) => {
      handlers.set(event, listener);
      return process;
    }) as typeof process.once);
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(Logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('listens to SIGTERM and SIGINT', () => {
    exitIfShutdownHangs('Worker');

    expect([...handlers.keys()]).toEqual(['SIGTERM', 'SIGINT']);
  });

  it.each(['SIGTERM', 'SIGINT'])(
    'exits with code 1 when the shutdown started by %s takes too long',
    (signal) => {
      exitIfShutdownHangs('Worker');
      handlers.get(signal)!();

      jest.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS - 1);
      expect(process.exit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(Logger.error).toHaveBeenCalledWith(
        `Graceful shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms, exiting`,
        undefined,
        'Worker',
      );
    },
  );

  it('does nothing until a signal arrives', () => {
    exitIfShutdownHangs('Worker');

    jest.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS * 10);

    expect(process.exit).not.toHaveBeenCalled();
  });
});
