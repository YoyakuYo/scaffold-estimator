import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionService } from './subscription.service';

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMySubscription(@CurrentUser() user: any) {
    return this.subscriptionService.getMySubscription(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout-session')
  async createCheckoutSession(@CurrentUser() user: any) {
    return this.subscriptionService.createCheckoutSession(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal-session')
  async createPortalSession(@CurrentUser() user: any) {
    return this.subscriptionService.createPortalSession(user.id);
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: Request & { body: Buffer },
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.subscriptionService.handleWebhook(signature, req.body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/subscribers')
  async listSubscribers() {
    return this.subscriptionService.listSubscribers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('admin/:userId/extend-trial/:days')
  async extendTrial(
    @Param('userId') userId: string,
    @Param('days', ParseIntPipe) days: number,
  ) {
    return this.subscriptionService.adminExtendTrial(userId, days);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('admin/:userId/set-access')
  async setAccess(
    @Param('userId') userId: string,
    @Body() body: { access: 'active' | 'canceled' | 'expired' },
  ) {
    return this.subscriptionService.adminSetAccess(userId, body.access);
  }
}
