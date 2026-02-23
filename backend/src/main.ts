import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as express from 'express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  // Prevent Redis connection errors from crashing the app
  process.on('unhandledRejection', (reason: any) => {
    const logger = new Logger('UnhandledRejection');
    
    // Handle Redis connection errors (single error or AggregateError)
    const isRedisError = 
      (reason?.code === 'ECONNREFUSED' && reason?.message?.includes('6379')) ||
      (reason?.name === 'AggregateError' && reason?.errors?.some?.((e: any) => 
        e?.code === 'ECONNREFUSED' && e?.message?.includes('6379')
      )) ||
      (reason?.message?.includes?.('Redis') && reason?.message?.includes?.('6379'));
    
    if (isRedisError) {
      logger.warn('Redis connection refused - background jobs disabled, app continues normally');
      return;
    }
    
    logger.error('Unhandled rejection:', reason);
  });

  // Create app with body parser disabled so we can configure it manually
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const logger = new Logger('Bootstrap');

  // Get Express instance and configure body parsers with 50 MB limit
  // This allows large SVG / base64 image payloads for PDF exports
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: '50mb' }));
  expressApp.use(express.urlencoded({ limit: '50mb', extended: true }));
  // Note: multipart/form-data is handled by multer via FileInterceptor, not body-parser

  // Ensure uploads directory exists
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
    logger.log(`Created uploads directory: ${uploadsDir}`);
  }

  // Serve static files from uploads directory
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CORS — allow all origins.
  // Auth is handled by JWT Bearer tokens, not cookies, so CORS origin
  // restrictions add no security. This avoids breakage across Vercel,
  // Render, custom domains, PWA installs, and localhost.
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Health check at root for Render / load balancer probes
  expressApp.get('/', (_req, res) => res.json({ status: 'ok' }));
  expressApp.head('/', (_req, res) => res.sendStatus(200));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
