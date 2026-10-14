import { INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { swaggerConfig } from '../config/configuration';
import { setupSwagger } from './swagger';

/**
 * Global setup shared by every HTTP entry point (main.ts, the Vercel handler and
 * the e2e tests), so they all validate input and format errors the same way.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // Close DB connections cleanly on SIGTERM (Docker, Railway, Ctrl+C).
  app.enableShutdownHooks();

  const swagger = app.get<ConfigType<typeof swaggerConfig>>(swaggerConfig.KEY);
  if (swagger.enabled) {
    setupSwagger(app);
  }
}
