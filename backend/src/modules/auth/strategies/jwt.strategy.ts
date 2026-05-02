import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const s = configService.get('JWT_SECRET');
        if (!s) throw new Error('JWT_SECRET is required. Set it in .env');
        return s;
      })(),
    });
  }

  async validate(payload: { sub?: string; id?: string; imp?: string }) {
    const userId = payload.sub || payload.id;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Invalid token');
    }
    if (payload.imp) {
      const actor = await this.authService.getUserForJwtPayload(userId);
      if ((actor as { role?: string }).role !== 'superadmin') {
        throw new UnauthorizedException('Invalid token');
      }
      const target = await this.authService.getUserForJwtPayload(payload.imp);
      return {
        ...target,
        impersonatedBy: actor.id,
        impersonatedByEmail: (actor as { email?: string }).email ?? null,
      };
    }
    return this.authService.getUserForJwtPayload(userId);
  }
}
