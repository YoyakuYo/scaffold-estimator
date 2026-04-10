import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { TeamInviteService } from './team-invite.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto, AdminResetPasswordDto } from './dto/update-user.dto';
import { ForgotPasswordDto, ResetPasswordWithTokenDto } from './dto/forgot-password.dto';
import { ApproveUserDto } from './dto/approve-user.dto';
import { VerifyBankActivationDto } from './dto/verify-bank-activation.dto';
import { CreateTeamInviteDto } from './dto/create-team-invite.dto';
import { AcceptTeamInviteSignupDto, AcceptTeamInviteSessionDto } from './dto/accept-team-invite.dto';
import { TransferCompanyAdminDto } from './dto/transfer-company-admin.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private teamInviteService: TeamInviteService,
  ) {}

  // ─── Authentication ───────────────────────────────────────

  @UseGuards(AuthGuard('local'))
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Request() req: any, @Body() loginDto: LoginDto) {
    const isSuperAdminLogin = loginDto.superadmin === true;
    const userRole = req.user?.role;

    if (isSuperAdminLogin) {
      if (userRole !== 'superadmin') {
        throw new ForbiddenException(
          'This account must use the normal login page. Super Admin login is only for platform administrators.',
        );
      }
    } else {
      if (userRole === 'superadmin') {
        throw new ForbiddenException(
          'Super admin accounts must use the Super Admin login page at /superadmin.',
        );
      }
    }

    const result = await this.authService.login(req.user);
    await this.authService.onLoginSuccess(
      req.user.id,
      req.ip || req.connection?.remoteAddress,
      req.headers?.['user-agent'],
    );
    return result;
  }

  // ─── Public Registration ──────────────────────────────────

  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ─── Team invites (join existing company) ─────────────────

  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Get('team-invites/preview')
  async teamInvitePreview(@Query('token') token: string) {
    if (!token?.trim()) throw new BadRequestException('token is required');
    return this.teamInviteService.getPreviewByToken(token.trim());
  }

  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @Post('team-invites/accept-signup')
  async teamInviteAcceptSignup(@Body() dto: AcceptTeamInviteSignupDto, @Req() req: any) {
    const out = await this.teamInviteService.acceptSignup(dto);
    await this.authService.onLoginSuccess(
      (out.user as { id: string }).id,
      req.ip || req.connection?.remoteAddress,
      req.headers?.['user-agent'],
    );
    return out;
  }

  @UseGuards(JwtAuthGuard)
  @Post('team-invites/accept-session')
  async teamInviteAcceptSession(@CurrentUser() user: any, @Body() dto: AcceptTeamInviteSessionDto, @Req() req: any) {
    const out = await this.teamInviteService.acceptLoggedIn(user, dto.token);
    await this.authService.onLoginSuccess(
      (out.user as { id: string }).id,
      req.ip || req.connection?.remoteAddress,
      req.headers?.['user-agent'],
    );
    return out;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Post('team-invites')
  async createTeamInvite(@CurrentUser() user: any, @Body() dto: CreateTeamInviteDto) {
    return this.teamInviteService.createInvite(user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Get('team-invites')
  async listTeamInvites(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    const cid = user.role === 'superadmin' ? companyId : user.companyId;
    if (!cid) {
      throw new BadRequestException('companyId query parameter is required when listing invites as superadmin.');
    }
    return this.teamInviteService.listInvites(user, cid);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Delete('team-invites/:inviteId')
  async revokeTeamInvite(
    @CurrentUser() user: any,
    @Param('inviteId') inviteId: string,
    @Query('companyId') companyId?: string,
  ) {
    const cid = user.role === 'superadmin' ? companyId : user.companyId;
    if (!cid) {
      throw new BadRequestException('companyId query parameter is required when revoking invites as superadmin.');
    }
    return this.teamInviteService.revokeInvite(user, inviteId, cid);
  }

  /** Always returns the same shape (no email enumeration). Requires SMTP + migration 118. */
  @Throttle({ default: { limit: 8, ttl: 900000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Throttle({ default: { limit: 15, ttl: 900000 } })
  @Post('reset-password')
  async resetPasswordWithToken(@Body() dto: ResetPasswordWithTokenDto) {
    return this.authService.resetPasswordWithToken(dto.token, dto.newPassword);
  }

  // ─── Current User Profile ─────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(@CurrentUser() user: any, @Body() dto: UpdateUserDto) {
    // Users can only update their own name/email, not role or active status
    const safeDto: UpdateUserDto = {
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
    };
    return this.authService.updateUser(user.id, safeDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }

  /** After bank-transfer approval: enter one-time code to unlock subscription (no SubscriptionActiveGuard). */
  @UseGuards(JwtAuthGuard)
  @Post('verify-bank-activation')
  async verifyBankActivation(@CurrentUser() user: any, @Body() dto: VerifyBankActivationDto) {
    return this.authService.verifyBankActivation(user.id, dto.code);
  }

  // ─── Heartbeat (presence) ─────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('heartbeat')
  async heartbeat(@CurrentUser() user: any) {
    return this.authService.heartbeat(user.id);
  }

  // ─── User Management: Super Admin (all) or company admin (org roster / CRUD) ─

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Get('users')
  async listUsers(@CurrentUser() user: any) {
    await this.authService.assertCompanyUserManagementAccess(user);
    const companyId = user.role === 'superadmin' ? undefined : user.companyId;
    return this.authService.listUsers(companyId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/stats')
  async getPlatformStats() {
    return this.authService.getPlatformStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/companies')
  async listCompanies(@CurrentUser() user: any) {
    return this.authService.listCompaniesForSuperAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/online')
  async getOnlineUsers() {
    return this.authService.getOnlineUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/pending/count')
  async getPendingUsersCount() {
    const count = await this.authService.getPendingUsersCount();
    return { count };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/:id/login-history')
  async getLoginHistory(@Param('id') id: string) {
    return this.authService.getLoginHistory(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Get('users/:id')
  async getUser(@CurrentUser() admin: any, @Param('id') id: string) {
    await this.authService.assertCompanyUserManagementAccess(admin);
    const u = await this.authService.getUser(id, { withCompany: true });
    if (admin.role !== 'superadmin' && u.companyId !== admin.companyId) {
      throw new ForbiddenException();
    }
    return u;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Post('users')
  async createUser(@CurrentUser() admin: any, @Body() dto: CreateUserDto) {
    return this.authService.createUser(dto, admin);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Put('users/:id')
  async updateUser(@CurrentUser() admin: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    await this.authService.assertCompanyUserManagementAccess(admin);
    return this.authService.updateUser(id, dto, admin);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users/:id/reset-password')
  async adminResetPassword(@CurrentUser() admin: any, @Param('id') id: string, @Body() dto: AdminResetPasswordDto) {
    return this.authService.adminResetPassword(id, dto.newPassword, admin);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'estimator', 'viewer')
  @Delete('users/:id')
  async deactivateUser(@CurrentUser() admin: any, @Param('id') id: string) {
    await this.authService.assertCompanyUserManagementAccess(admin);
    return this.authService.deactivateUser(id, admin);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users/:id/approve')
  async approveUser(@Param('id') id: string, @Body() dto: ApproveUserDto) {
    return this.authService.approveUser(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users/:id/reject')
  async rejectUser(@Param('id') id: string) {
    return this.authService.rejectUser(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('company/transfer-admin')
  async transferCompanyAdmin(@CurrentUser() user: any, @Body() dto: TransferCompanyAdminDto) {
    return this.authService.transferCompanyAdmin(user, dto);
  }
}
