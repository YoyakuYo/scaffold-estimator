import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto, AdminResetPasswordDto } from './dto/update-user.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ─── Authentication ───────────────────────────────────────

  @UseGuards(AuthGuard('local'))
  @Post('login')
  async login(@Request() req: any, @Body() loginDto: LoginDto) {
    const result = await this.authService.login(req.user);
    await this.authService.onLoginSuccess(
      req.user.id,
      req.ip || req.connection?.remoteAddress,
      req.headers?.['user-agent'],
    );
    return result;
  }

  // ─── Public Registration ──────────────────────────────────

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
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

  // ─── Heartbeat (presence) ─────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('heartbeat')
  async heartbeat(@CurrentUser() user: any) {
    return this.authService.heartbeat(user.id);
  }

  // ─── User Management (Admin Only) ────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users')
  async listUsers(@CurrentUser() user: any) {
    return this.authService.listUsers(undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('admin/stats')
  async getPlatformStats() {
    return this.authService.getPlatformStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/online')
  async getOnlineUsers() {
    return this.authService.getOnlineUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/:id/login-history')
  async getLoginHistory(@Param('id') id: string) {
    return this.authService.getLoginHistory(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/:id')
  async getUser(@Param('id') id: string) {
    return this.authService.getUser(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users')
  async createUser(@CurrentUser() admin: any, @Body() dto: CreateUserDto) {
    return this.authService.createUser(dto, admin.companyId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Put('users/:id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.authService.updateUser(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users/:id/reset-password')
  async adminResetPassword(@Param('id') id: string, @Body() dto: AdminResetPasswordDto) {
    return this.authService.adminResetPassword(id, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Delete('users/:id')
  async deactivateUser(@Param('id') id: string) {
    return this.authService.deactivateUser(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users/:id/approve')
  async approveUser(@Param('id') id: string) {
    return this.authService.approveUser(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Post('users/:id/reject')
  async rejectUser(@Param('id') id: string) {
    return this.authService.rejectUser(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @Get('users/pending/count')
  async getPendingUsersCount() {
    const count = await this.authService.getPendingUsersCount();
    return { count };
  }
}
