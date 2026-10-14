import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'api/docs';

/**
 * Swagger UI assets are loaded from a CDN with a pinned version. On Vercel the
 * files that Nest serves from node_modules/swagger-ui-dist are not available,
 * so without this the UI would be a blank page (docs/08 §4.3).
 */
const SWAGGER_UI_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.29.1';

/** Serves the UI at /api/docs and the OpenAPI JSON at /api/docs-json. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Mini Order Management API')
    .setDescription(
      [
        'Products, stock and orders for a small online shop.',
        'Orders are created synchronously (stock is reserved in one transaction) and confirmed in the background by a worker.',
        'Money amounts are integers in VND. Every error uses the ErrorResponseDto shape.',
      ].join(' '),
    )
    .setVersion('1.0')
    .build();

  // A factory defers building the document until it is first requested,
  // which keeps serverless cold starts short.
  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: `${SWAGGER_PATH}-json`,
      raw: ['json'],
      customSiteTitle: 'Mini Order Management API',
      customCssUrl: `${SWAGGER_UI_CDN}/swagger-ui.min.css`,
      customJs: [
        `${SWAGGER_UI_CDN}/swagger-ui-bundle.min.js`,
        `${SWAGGER_UI_CDN}/swagger-ui-standalone-preset.min.js`,
      ],
      swaggerOptions: { displayRequestDuration: true },
    },
  );
}
