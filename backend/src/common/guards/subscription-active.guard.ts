import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class SubscriptionActiveGuard implements CanActivate {

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Subscription trial disabled for now - allow all authenticated users
    return true;
  }
}
