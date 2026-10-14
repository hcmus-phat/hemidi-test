import { HttpStatus, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import type { ErrorResponseDto } from './common/dto/error-response.dto';
import { ErrorCode } from './common/errors/error-codes';
import { errorMessage } from './common/utils/error-message';

/**
 * Entry point of the API on Vercel (docs/08 §4.1). `nest build` compiles it
 * to dist/vercel.js, which api/index.js exports as the function's handler.
 *
 * Vercel owns the HTTP server and calls the handler for every request, so
 * the app never calls listen(). The Nest app is created on the first
 * request of a function instance and reused while the instance stays warm.
 * main.ts and this file share configureApp(): same pipe, filter and Swagger.
 */

/** The Express app inside Nest, once the instance has started. */
let ready: Promise<RequestListener> | undefined;

async function bootstrap(): Promise<RequestListener> {
  // abortOnError: false makes a startup error (e.g. an invalid environment)
  // reject here instead of exiting the process.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: false,
  });
  try {
    configureApp(app);
    await app.init();
  } catch (error) {
    // Release the connections of the half-started app before a retry.
    await app.close().catch(() => undefined);
    throw error;
  }
  // The Express application: a (req, res) request listener.
  return app.getHttpAdapter().getInstance();
}

/**
 * Starts the app once per instance. Requests that arrive during the start
 * wait for the same promise. A failed start is not cached, so a transient
 * error (e.g. the database waking up) does not break the instance for good:
 * the next request tries again.
 */
function getApp(): Promise<RequestListener> {
  ready ??= bootstrap().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

/** 503 in the unified error format, when the app could not start. */
function sendStartupError(req: IncomingMessage, res: ServerResponse): void {
  const body: ErrorResponseDto = {
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    error: ErrorCode.SERVICE_UNAVAILABLE,
    message: 'The service could not start, please retry',
    path: req.url ?? '/',
    timestamp: new Date().toISOString(),
  };
  res.statusCode = body.statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let app: RequestListener;
  try {
    app = await getApp();
  } catch (error) {
    Logger.error(
      `API failed to start: ${errorMessage(error)}`,
      error instanceof Error ? error.stack : undefined,
      'Vercel',
    );
    sendStartupError(req, res);
    return;
  }
  app(req, res);
}
