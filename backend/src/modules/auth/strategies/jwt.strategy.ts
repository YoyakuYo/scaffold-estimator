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

  async validate(payload: any) {
    // Payload is already verified by JWT, just return user info
    return { 
      id: payload.sub || payload.id, 
      email: payload.email, 
      role: payload.role, 
      companyId: payload.companyId 
    };
  }
}
