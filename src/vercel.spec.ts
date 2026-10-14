import type { Logger } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

// The real AppModule validates the environment when it is loaded; the
// handler only needs something to pass to NestFactory.create.
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('./bootstrap/configure-app', () => ({ configureApp: jest.fn() }));
jest.mock('@nestjs/core', () => ({ NestFactory: { create: jest.fn() } }));

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

describe('Vercel handler', () => {
  let handler: Handler;
  let create: jest.Mock;
  let logError: jest.SpyInstance;
  const expressApp = jest.fn();
  const nestApp = {
    init: jest.fn(),
    close: jest.fn(),
    getHttpAdapter: () => ({ getInstance: () => expressApp }),
  };
  const req = { url: '/health' } as IncomingMessage;

  function createResponse(): ServerResponse & { end: jest.Mock } {
    return {
      statusCode: 200,
      setHeader: jest.fn(),
      end: jest.fn(),
    } as unknown as ServerResponse & { end: jest.Mock };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    nestApp.init.mockResolvedValue(undefined);
    nestApp.close.mockResolvedValue(undefined);
    // Fresh module state (the cached app) for each test. The handler then
    // uses fresh copies of its imports too, so mocks are taken from them.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const common = require('@nestjs/common') as { Logger: typeof Logger };
    logError = jest.spyOn(common.Logger, 'error').mockImplementation();
    create = (require('@nestjs/core') as { NestFactory: { create: jest.Mock } })
      .NestFactory.create;
    handler = (require('./vercel') as { default: Handler }).default;
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts the app once and hands every request to Express, without listen()', async () => {
    create.mockResolvedValue(nestApp);
    const first = createResponse();
    const second = createResponse();

    await Promise.all([handler(req, first), handler(req, second)]);
    await handler(req, createResponse());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.any(Function), {
      abortOnError: false,
    });
    expect(nestApp.init).toHaveBeenCalledTimes(1);
    expect(expressApp).toHaveBeenCalledTimes(3);
    expect(expressApp).toHaveBeenCalledWith(req, first);
  });

  it('answers 503 in the unified error format when the start fails, and tries again on the next request', async () => {
    create
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(nestApp);
    const failed = createResponse();

    await handler(req, failed);

    expect(failed.statusCode).toBe(503);
    expect(failed.setHeader).toHaveBeenCalledWith(
      'content-type',
      'application/json; charset=utf-8',
    );
    expect(JSON.parse(failed.end.mock.calls[0][0] as string)).toEqual({
      statusCode: 503,
      error: 'SERVICE_UNAVAILABLE',
      message: 'The service could not start, please retry',
      path: '/health',
      timestamp: expect.any(String),
    });
    expect(logError).toHaveBeenCalledWith(
      'API failed to start: connect ECONNREFUSED',
      expect.any(String),
      'Vercel',
    );
    expect(expressApp).not.toHaveBeenCalled();

    const retried = createResponse();
    await handler(req, retried);

    expect(create).toHaveBeenCalledTimes(2);
    expect(expressApp).toHaveBeenCalledWith(req, retried);
  });

  it('closes a half-started app before the next attempt', async () => {
    create.mockResolvedValue(nestApp);
    nestApp.init.mockRejectedValueOnce(new Error('init failed'));

    await handler(req, createResponse());

    expect(nestApp.close).toHaveBeenCalledTimes(1);
    expect(expressApp).not.toHaveBeenCalled();
  });
});
