import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SubscriptionService } from '../../modules/subscription/subscription.service';
import { PlatformService } from '../../modules/platform/platform.service';

@Injectable()
export class SubscriptionAiGuard implements CanActivate {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly platformService: PlatformService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    await this.platformService.assertAiExtractionAllowed();
    const caps = await this.subscriptionService.resolveEffectiveCapabilities(user.id, user.role);
    if (!caps.aiExtract) {
      throw new ForbiddenException(
        'AI extraction requires a Premium subscription. Upgrade in Billing or use file upload / CAD on a Medium plan.',
      );
    }
    return true;
  }
}
