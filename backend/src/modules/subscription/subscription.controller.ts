import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BankWireIntentDto } from './dto/bank-wire-intent.dto';
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
  @Post('me/restart-fresh-trial')
  async restartFreshTrialSelfService(
    @CurrentUser() user: any,
    @Headers('x-trial-restart-secret') secret?: string,
  ) {
    return this.subscriptionService.selfServiceRestartFreshTrial(user.id, secret);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/bank-wire-intent')
  async createBankWireIntent(@CurrentUser() user: any, @Body() body: BankWireIntentDto) {
    return this.subscriptionService.createBankWireIntent(user.id, body.plan);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('admin/:userId/confirm-bank-wire')
  async confirmBankWire(@Param('userId') userId: string) {
    return this.subscriptionService.adminConfirmBankWirePayment(userId);
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
  @Post('admin/:userId/restart-fresh-trial')
  async restartFreshTrialAdmin(@Param('userId') userId: string) {
    return this.subscriptionService.applyFreshTrialWindow(userId);
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
