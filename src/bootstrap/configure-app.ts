import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { validationExceptionFactory } from '../common/errors/validation-exception.factory';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { swaggerConfig } from '../config/configuration';
import { setupSwagger } from './swagger';

/**
 * Global setup shared by every HTTP entry point (main.ts, the Vercel handler and
 * the e2e tests), so they all validate input and format errors the same way.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // Close DB connections cleanly on SIGTERM (Docker, Railway, Ctrl+C).
  app.enableShutdownHooks();

  const swagger = app.get<ConfigType<typeof swaggerConfig>>(swaggerConfig.KEY);
  if (swagger.enabled) {
    setupSwagger(app);
  }
}
