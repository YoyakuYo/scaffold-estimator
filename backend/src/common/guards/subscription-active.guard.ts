import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SubscriptionService } from '../../modules/subscription/subscription.service';

@Injectable()
export class SubscriptionActiveGuard implements CanActivate {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.id) return false;
    if (user.role === 'superadmin') return true;

    const hasAccess = await this.subscriptionService.hasActiveAccess(user.id, user.role);
    if (!hasAccess) {
      throw new ForbiddenException(
        'Subscription required. Your 14-day trial has ended. Open Billing to continue.',
      );
    }
    return true;
  }
}
