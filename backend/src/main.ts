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

  // CORS configuration
  // In development: allow all origins
  // In production: allow FRONTEND_URL (comma-separated), plus .onrender.com subdomains
  const isProduction = process.env.NODE_ENV === 'production';

  const allowedOrigins: string[] = [];
  const rawOrigins = process.env.FRONTEND_URL || process.env.CORS_ORIGINS || '';
  if (rawOrigins) {
    rawOrigins.split(',').forEach((o) => {
      const trimmed = o.trim().replace(/\/+$/, '');
      if (trimmed) allowedOrigins.push(trimmed);
    });
  }
  if (!isProduction) {
    allowedOrigins.push('http://localhost:3001', 'http://127.0.0.1:3001');
  }

  logger.log(`CORS allowed origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : '(all in dev)'}`);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);

      const normalized = origin.replace(/\/+$/, '');

      if (!isProduction) return callback(null, true);

      if (allowedOrigins.includes(normalized)) return callback(null, true);

      // Auto-allow .onrender.com subdomains (both services are on Render)
      if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(normalized)) {
        return callback(null, true);
      }

      logger.warn(`CORS rejected origin: ${origin} — allowed: [${allowedOrigins.join(', ')}]`);
      callback(null, false);
    },
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
