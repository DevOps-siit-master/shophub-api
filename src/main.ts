import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Registered before the router so it counts every request — including
  // guard-rejected (401/403) and unmatched (404) ones (spec 4.1).
  const httpMetrics = app.get(HttpMetricsMiddleware);
  app.use(httpMetrics.use.bind(httpMetrics));

  const configService = app.get(ConfigService);

  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin, credentials: true });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ShopHub API')
    .setDescription(
      'Shop-site management API (req 1.2) — CRUD over Kubernetes Shop, Wallet and DiscordChannel custom resources',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);
}

void bootstrap();
