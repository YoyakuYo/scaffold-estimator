import { SetMetadata } from '@nestjs/common';
import type { ProductCode } from '../../modules/subscription/products';

export const REQUIRES_PRODUCT_KEY = 'requires_product';

/**
 * Mark a controller or handler with a `ProductCode`. The `ProductAccessGuard`
 * then enforces that the current user has an active subscription (or trial)
 * for that product. Superadmin and subscription-exempt users bypass it.
 *
 * Usage:
 *   @RequiresProduct('construction_plan')
 *   @UseGuards(JwtAuthGuard, ProductAccessGuard)
 *   @Controller('construction-plan')
 *   export class ConstructionPlanController { ... }
 */
export const RequiresProduct = (product: ProductCode) =>
  SetMetadata(REQUIRES_PRODUCT_KEY, product);
