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
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('DatabaseConfig');
        
        // Try DATABASE_URL first (if it's a complete connection string from Supabase)
        const databaseUrl = configService.get('DATABASE_URL');
        if (databaseUrl && databaseUrl.includes('@') && databaseUrl.includes('://')) {
          logger.log('Using DATABASE_URL connection string directly');
          try {
            const urlObj = new URL(databaseUrl);
            logger.log(`Connecting to: ${urlObj.protocol}//${urlObj.username}@${urlObj.hostname}:${urlObj.port}${urlObj.pathname}`);
            return {
              type: 'postgres',
              url: databaseUrl,
              entities: [__dirname + '/**/*.entity{.ts,.js}'],
              migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
              synchronize: false, // Disabled - use Supabase SQL migrations instead
              logging: configService.get('NODE_ENV') === 'development',
              ssl: { rejectUnauthorized: false },
            };
          } catch (e) {
            logger.warn(`Could not parse DATABASE_URL, falling back to individual params: ${e.message}`);
          }
        }
        
        // Fallback: Use individual parameters (all from env — no hardcoded secrets)
        logger.log('Using individual connection parameters');
        const dbHost = configService.get('DB_HOST');
        const dbPort = parseInt(configService.get('DB_PORT', '5432'), 10);
        const dbUsername = configService.get('DB_USERNAME');
        const dbPassword = configService.get('DB_PASSWORD');
        const dbName = configService.get('DB_NAME', 'postgres');

        if (!dbHost || !dbUsername || !dbPassword) {
          logger.error('DB_HOST, DB_USERNAME, and DB_PASSWORD are required in .env');
          throw new Error('Database configuration is required (DB_HOST, DB_USERNAME, DB_PASSWORD)');
        }

        logger.log(`Connecting to ${dbHost}:${dbPort}/${dbName}`);
        
        return {
          type: 'postgres',
          host: dbHost,
          port: dbPort,
          username: dbUsername,
          password: dbPassword.trim(), // Trim any whitespace
          database: dbName,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
          synchronize: false, // Disabled - use Supabase SQL migrations instead
          logging: configService.get('NODE_ENV') === 'development',
          ssl: { rejectUnauthorized: false },
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
    AiModule,
  ],
})
export class AppModule {}
