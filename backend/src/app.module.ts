import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { SupabaseModule } from './modules/supabase/supabase.module';
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
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    SupabaseModule,
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
