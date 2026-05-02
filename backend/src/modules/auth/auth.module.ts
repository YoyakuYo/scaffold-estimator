import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { TeamInviteService } from './team-invite.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    forwardRef(() => SubscriptionModule),
    forwardRef(() => NotificationsModule),
    PlatformModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get('JWT_SECRET');
        if (!secret) throw new Error('JWT_SECRET is required. Set it in .env');
        return {
          secret,
          signOptions: {
            /** Default 30m; override with JWT_EXPIRES_IN (e.g. 3600s, 1h). */
            expiresIn: configService.get('JWT_EXPIRES_IN', '1800s'),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TeamInviteService, JwtStrategy, LocalStrategy],
  exports: [AuthService],
})
export class AuthModule {}
