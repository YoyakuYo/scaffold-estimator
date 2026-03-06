import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { DrawingModule } from './modules/drawing/drawing.module';
import { EstimateModule } from './modules/estimate/estimate.module';
import { CostModule } from './modules/cost/cost.module';
import { ExportModule } from './modules/export/export.module';
import { RentalModule } from './modules/rental/rental.module';
import { AuthModule } from './modules/auth/auth.module';
import { ScaffoldConfigModule } from './modules/scaffold-config/scaffold-config.module';
import { QuotationModule } from './modules/quotation/quotation.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MailerModule } from './modules/mailer/mailer.module';
import { CompanyModule } from './modules/company/company.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { VisionBimModule } from './modules/vision-bim/vision-bim.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      // In production (e.g. Render), env vars come from the platform — don't require .env file
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('DatabaseConfig');

        // Prefer INTERNAL_DATABASE_URL on Render so backend talks to Postgres over private network (avoids timeouts).
        // External DATABASE_URL can timeout when Postgres is waking from sleep.
        const databaseUrl =
          configService.get('INTERNAL_DATABASE_URL') || configService.get('DATABASE_URL');
        if (databaseUrl && typeof databaseUrl === 'string' && databaseUrl.includes('://')) {
          const isInternal = !!configService.get('INTERNAL_DATABASE_URL');
          logger.log(`Using ${isInternal ? 'INTERNAL_DATABASE_URL' : 'DATABASE_URL'} connection string`);
          try {
            const urlObj = new URL(databaseUrl);
            const safeUrl =
              `${urlObj.protocol}//${urlObj.username}@${urlObj.hostname}:${urlObj.port}${urlObj.pathname}`;
            logger.log(`Connecting to: ${safeUrl}`);
            return {
              type: 'postgres',
              url: databaseUrl,
              entities: [__dirname + '/**/*.entity{.ts,.js}'],
              migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
              synchronize: false,
              logging: configService.get('NODE_ENV') === 'development',
              ssl: { rejectUnauthorized: false },
              // Long connect timeout for Render: free Postgres can take 60–90s to wake from sleep
              connectTimeoutMS: 120000,
              extra: {
                // Timeout when establishing a new connection (cold start / wake from sleep)
                connectionTimeoutMillis: 120000,
                // Recycle idle connections before server closes them (Supabase/cloud often close after 5–10 min idle)
                idleTimeoutMillis: 20000,
                max: 5,
                min: 0,
                keepAlive: true,
                keepAliveInitialDelayMillis: 5000,
                allowExitOnIdle: true,
                statement_timeout: 30000,
                // If using Supabase: prefer pooler URL (port 6543) to avoid "Connection terminated due to connection timeout"
              },
              retryAttempts: 15,
              retryDelay: 5000,
            };
          } catch (e) {
            logger.warn(`Could not parse DATABASE_URL, falling back to individual params: ${(e as Error).message}`);
          }
        }

        // Fallback: individual parameters (DB_* or PGHOST/PGUSER/PGPASSWORD for Render/Railway)
        logger.log('Using individual connection parameters');
        const dbHost =
          configService.get('DB_HOST') || configService.get('PGHOST');
        const dbPort = parseInt(
          configService.get('DB_PORT') || configService.get('PGPORT') || '5432',
          10,
        );
        const dbUsername =
          configService.get('DB_USERNAME') || configService.get('PGUSER');
        const dbPassword =
          configService.get('DB_PASSWORD') || configService.get('PGPASSWORD');
        const dbName =
          configService.get('DB_NAME') || configService.get('PGDATABASE') || 'postgres';

        if (!dbHost || !dbUsername || !dbPassword) {
          const missing = [
            !dbHost && 'DB_HOST or PGHOST',
            !dbUsername && 'DB_USERNAME or PGUSER',
            !dbPassword && 'DB_PASSWORD or PGPASSWORD',
          ]
            .filter(Boolean)
            .join(', ');
          logger.error(
            `Database config missing: ${missing}. Set these in Render Environment, or set DATABASE_URL / INTERNAL_DATABASE_URL (full connection string).`,
          );
          throw new Error(
            `Database configuration is required. Set DB_HOST, DB_USERNAME, DB_PASSWORD (or DATABASE_URL / INTERNAL_DATABASE_URL) in your environment variables.`,
          );
        }

        logger.log(`Connecting to ${dbHost}:${dbPort}/${dbName}`);
        
        return {
          type: 'postgres',
          host: dbHost,
          port: dbPort,
          username: dbUsername,
          password: dbPassword.trim(),
          database: dbName,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
          synchronize: false,
          logging: configService.get('NODE_ENV') === 'development',
          ssl: { rejectUnauthorized: false },
          connectTimeoutMS: 120000,
          extra: {
            connectionTimeoutMillis: 120000,
            idleTimeoutMillis: 20000,
            max: 5,
            min: 0,
            keepAlive: true,
            keepAliveInitialDelayMillis: 5000,
            allowExitOnIdle: true,
            statement_timeout: 30000,
          },
          retryAttempts: 15,
          retryDelay: 5000,
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('BullModule');
        const redisHost = configService.get('REDIS_HOST', 'localhost');
        const redisPort = configService.get('REDIS_PORT', 6379);
        logger.log(`Connecting to Redis at ${redisHost}:${redisPort} (background jobs will fail if unavailable)`);
        return {
          redis: {
            host: redisHost,
            port: redisPort,
            password: configService.get('REDIS_PASSWORD') || undefined,
            maxRetriesPerRequest: 3,
            connectTimeout: 5000,
            retryStrategy: (times: number) => {
              if (times > 3) {
                logger.warn('Redis unavailable - background job processing disabled. App will still work for all other features.');
                return null; // Stop retrying
              }
              return Math.min(times * 500, 2000);
            },
            enableOfflineQueue: false,
            lazyConnect: true,
          },
        };
      },
    }),
    AuthModule,
    DrawingModule,
    EstimateModule,
    CostModule,
    ExportModule,
    RentalModule,
    ScaffoldConfigModule,
    QuotationModule,
    MessagingModule,
    NotificationsModule,
    MailerModule,
    CompanyModule,
    SubscriptionModule,
    VisionBimModule,
  ],
})
export class AppModule {}
