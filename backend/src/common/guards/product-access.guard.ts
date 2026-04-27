import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_PRODUCT_KEY } from '../decorators/requires-product.decorator';
import { SubscriptionService } from '../../modules/subscription/subscription.service';
import type { ProductCode } from '../../modules/subscription/products';
import { hasProduct } from '../../modules/subscription/plan-capabilities';

/**
 * Phase 2 — multi-product gating.
 *
 * Reads the `@RequiresProduct(code)` metadata, resolves the user's
 * `EffectiveAccess`, and throws 403 when the product card is locked.
 * The 403 body intentionally embeds `productCode` so the frontend can deep-link
 * the user straight to /billing#<code> and show the matching upgrade CTA.
 */
@Injectable()
export class ProductAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProductCode | undefined>(
      REQUIRES_PRODUCT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = req?.user;
    if (!user) {
      throw new ForbiddenException({ productCode: required, message: 'Authentication required.' });
    }
    if (user.role === 'superadmin' || user.subscriptionExempt) return true;
    const access = await this.subscriptions.resolveEffectiveAccess(user.id, user.role);
    if (!hasProduct(access, required)) {
      throw new ForbiddenException({
        productCode: required,
        message: `Subscription required for ${required}.`,
      });
    }
    return true;
  }
}
