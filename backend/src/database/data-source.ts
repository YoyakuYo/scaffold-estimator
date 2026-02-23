import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';

config();

const configService = new ConfigService();

// Simplified: Use DATABASE_URL if provided, otherwise fallback to individual config
const databaseUrl = configService.get('DATABASE_URL');
const dbHost = configService.get('DB_HOST', '');
const isSupabase = databaseUrl?.includes('supabase.co') || dbHost.includes('supabase.co');

const dataSourceConfig = databaseUrl
  ? {
      type: 'postgres' as const,
      url: databaseUrl,
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      synchronize: false,
      logging: true,
      ssl: isSupabase ? { rejectUnauthorized: false } : false,
    }
  : {
      type: 'postgres' as const,
      host: configService.get('DB_HOST', 'localhost'),
      port: configService.get('DB_PORT', 5432),
      username: configService.get('DB_USERNAME', 'postgres'),
      password: configService.get('DB_PASSWORD', ''),
      database: configService.get('DB_NAME', 'postgres'),
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      synchronize: false,
      logging: true,
      ssl: isSupabase || configService.get('NODE_ENV') === 'production' ? {
        rejectUnauthorized: false,
      } : false,
    };

export default new DataSource(dataSourceConfig);
