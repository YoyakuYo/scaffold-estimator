import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, ApprovalStatus } from './user.entity';
import { Company } from './company.entity';
import { CompanyBranch } from '../company/company-branch.entity';
import { LoginHistory } from './login-history.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { Inject, forwardRef } from '@nestjs/common';
import { Subscription } from '../subscription/subscription.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    @InjectRepository(LoginHistory)
    private loginHistoryRepository: Repository<LoginHistory>,
    @InjectRepository(CompanyBranch)
    private branchRepository: Repository<CompanyBranch>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private jwtService: JwtService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
    private mailerService: MailerService,
  ) {}

  private async ensureTrialSubscriptionForUser(user: User): Promise<void> {
    if (!user || user.role === 'superadmin') return;

    const existing = await this.subscriptionRepository.findOne({ where: { userId: user.id } });
    if (existing) return;

    const trialStart = new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 14);

    const sub = this.subscriptionRepository.create({
      userId: user.id,
      companyId: user.companyId || null,
      plan: 'free_trial',
      status: 'trialing',
      trialStart,
      trialEnd,
    });
    await this.subscriptionRepository.save(sub);
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { email } });

    // DEBUG — remove after login is confirmed working
    console.log('[AUTH DEBUG] login attempt:', {
      email,
      userFound: !!user,
      hashStored: user ? `${user.passwordHash.substring(0, 10)}...len=${user.passwordHash.length}` : 'N/A',
      approvalStatus: user?.approvalStatus,
      isActive: user?.isActive,
      role: user?.role,
    });

    if (!user) {
      console.log('[AUTH DEBUG] FAIL: user not found in DB');
      return null;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    console.log('[AUTH DEBUG] bcrypt.compare result:', passwordMatch);

    if (!passwordMatch) {
      console.log('[AUTH DEBUG] FAIL: password does not match hash');
      return null;
    }

    if (user.approvalStatus !== 'approved') {
      throw new UnauthorizedException(
        user.approvalStatus === 'pending'
          ? 'Your account is pending admin approval. Please wait for approval before logging in.'
          : 'Your account has been rejected. Please contact support.',
      );
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
    }
    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role, companyId: user.companyId };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  /** Call after successful login: record login history and set last_active_at. */
  async onLoginSuccess(userId: string, ip?: string, userAgent?: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return;
    user.lastActiveAt = new Date();
    await this.userRepository.save(user);
    const entry = this.loginHistoryRepository.create({
      userId,
      ipAddress: ip || null,
      userAgent: userAgent || null,
    });
    await this.loginHistoryRepository.save(entry);
  }

  /** Heartbeat: update last_active_at (call from frontend every ~60s). */
  async heartbeat(userId: string): Promise<{ ok: boolean }> {
    await this.userRepository.update(userId, { lastActiveAt: new Date() });
    return { ok: true };
  }

  /** List users considered "online" (last_active_at within last 3 minutes). Admin only. */
  async getOnlineUsers(): Promise<any[]> {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000);
    const users = await this.userRepository.find({
      where: { isActive: true, approvalStatus: 'approved' },
      order: { lastActiveAt: 'DESC' },
    });
    const online = users.filter((u) => u.lastActiveAt && u.lastActiveAt >= cutoff);
    return online.map(({ passwordHash, ...rest }) => rest);
  }

  /** Get login history for a user. Admin only. */
  async getLoginHistory(userId: string, limit = 50): Promise<LoginHistory[]> {
    return this.loginHistoryRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async validateToken(token: string): Promise<User> {
    try {
      const payload = this.jwtService.verify(token);
      const user = await this.userRepository.findOne({ where: { id: payload.sub } });
      if (!user || !user.isActive || user.approvalStatus !== 'approved') {
        throw new UnauthorizedException('User not found, inactive, or not approved');
      }
      return user;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // ─── Public Registration ─────────────────────────────────────

  /**
   * Register a new user and company (public endpoint, no auth required).
   * User starts with 'pending' approval status.
   */
  async register(dto: RegisterDto): Promise<{ success: boolean; message: string; userId: string }> {
    // Check for duplicate email
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('このメールアドレスは既に使用されています。');
    }

    // Create company with structured address
    const company = new Company();
    company.name = dto.companyName;
    company.taxId = '';
    company.address = dto.companyAddress || '';
    company.phone = dto.companyPhone || '';
    company.email = dto.companyEmail || dto.email;
    company.postalCode = dto.companyPostalCode || '';
    company.prefecture = dto.companyPrefecture || '';
    company.city = dto.companyCity || '';
    company.town = dto.companyTown || '';
    company.addressLine = dto.companyAddressLine || '';
    company.building = dto.companyBuilding || '';
    const savedCompany = await this.companyRepository.save(company);

    // Create default headquarters branch with the same address
    const hqBranch = this.branchRepository.create({
      companyId: savedCompany.id,
      name: '本社',
      isHeadquarters: true,
      postalCode: dto.companyPostalCode || '',
      prefecture: dto.companyPrefecture || '',
      city: dto.companyCity || '',
      town: dto.companyTown || '',
      addressLine: dto.companyAddressLine || '',
      building: dto.companyBuilding || '',
      phone: dto.companyPhone || '',
    });
    await this.branchRepository.save(hqBranch);

    // Create user with pending status
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);

    const user = new User();
    user.email = dto.email;
    user.passwordHash = hash;
    user.role = 'viewer'; // Default to viewer, admin can change later
    user.firstName = dto.firstName;
    user.lastName = dto.lastName;
    user.companyId = savedCompany.id;
    user.isActive = true;
    user.approvalStatus = 'pending'; // Must be approved by admin

    const savedUser = await this.userRepository.save(user);

    return {
      success: true,
      message: 'Registration successful. Your account is pending admin approval. You will be notified once approved.',
      userId: savedUser.id,
    };
  }

  // ─── User Management ─────────────────────────────────────

  /**
   * Create a new user (admin only).
   */
  async createUser(dto: CreateUserDto, adminCompanyId: string): Promise<any> {
    // Check for duplicate email
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('このメールアドレスは既に使用されています。');
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);

    const user = new User();
    user.email = dto.email;
    user.passwordHash = hash;
    user.role = dto.role || 'viewer';
    user.firstName = dto.firstName || '';
    user.lastName = dto.lastName || '';
    user.companyId = dto.companyId || adminCompanyId;
    user.isActive = true;
    user.approvalStatus = 'approved'; // Admin-created users are auto-approved

    const saved = await this.userRepository.save(user);
    await this.ensureTrialSubscriptionForUser(saved);
    const { passwordHash: _pw, ...result } = saved;
    return result;
  }

  /**
   * List all users. If companyId is provided, filter by it; otherwise (admin) return all.
   */
  async listUsers(companyId?: string): Promise<any[]> {
    const where: any = {};
    if (companyId) {
      where.companyId = companyId;
    }
    const users = await this.userRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return users.map(({ passwordHash, ...rest }) => rest);
  }

  /**
   * Get a single user by ID.
   */
  async getUser(userId: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    const { passwordHash, ...result } = user;
    return result;
  }

  /**
   * Update user details (admin or self).
   */
  async updateUser(userId: string, dto: UpdateUserDto): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');

    if (dto.email && dto.email !== user.email) {
      const existing = await this.userRepository.findOne({ where: { email: dto.email } });
      if (existing) {
        throw new ConflictException('このメールアドレスは既に使用されています。');
      }
      user.email = dto.email;
    }

    if (dto.role !== undefined) user.role = dto.role;
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    const saved = await this.userRepository.save(user);
    const { passwordHash, ...result } = saved;
    return result;
  }

  /**
   * Change password (user changes their own password).
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: boolean }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('現在のパスワードが正しくありません。');
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(dto.newPassword, salt);
    await this.userRepository.save(user);

    return { success: true };
  }

  /**
   * Admin reset password for another user.
   */
  async adminResetPassword(userId: string, newPassword: string): Promise<{ success: boolean }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await this.userRepository.save(user);

    return { success: true };
  }

  /**
   * Deactivate a user (soft delete).
   */
  async deactivateUser(userId: string): Promise<{ success: boolean }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');

    user.isActive = false;
    await this.userRepository.save(user);

    return { success: true };
  }

  /**
   * Get current user profile from JWT payload.
   */
  async getProfile(userId: string): Promise<any> {
    return this.getUser(userId);
  }

  /**
   * Approve a pending user (admin only).
   */
  async approveUser(userId: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    
    if (user.approvalStatus === 'approved') {
      throw new BadRequestException('このユーザーは既に承認されています。');
    }

    user.approvalStatus = 'approved';
    const saved = await this.userRepository.save(user);
    await this.ensureTrialSubscriptionForUser(saved);
    await this.notificationsService
      .create(userId, 'approval', 'Account approved', {
        body: 'Your account has been approved. You can now log in.',
        link: '/login',
      })
      .catch(() => {});
    await this.mailerService.sendApprovalEmail(user.email).catch(() => {});
    const { passwordHash, ...result } = saved;
    return result;
  }

  /**
   * Reject a pending user (admin only).
   */
  async rejectUser(userId: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    
    if (user.approvalStatus === 'rejected') {
      throw new BadRequestException('このユーザーは既に拒否されています。');
    }

    user.approvalStatus = 'rejected';
    user.isActive = false; // Also deactivate rejected users
    const saved = await this.userRepository.save(user);
    await this.notificationsService
      .create(userId, 'rejection', 'Account not approved', {
        body: 'Your account request was not approved. Please contact support if you have questions.',
        link: '/login',
      })
      .catch(() => {});
    await this.mailerService.sendRejectionEmail(user.email).catch(() => {});
    const { passwordHash, ...result } = saved;
    return result;
  }

  /**
   * Get pending users count (for admin dashboard).
   */
  async getPendingUsersCount(): Promise<number> {
    return this.userRepository.count({ where: { approvalStatus: 'pending' } });
  }

  /**
   * Platform-wide stats for super admin dashboard.
   */
  async getPlatformStats(): Promise<{
    totalUsers: number;
    pendingUsers: number;
    totalCompanies: number;
    onlineCount: number;
  }> {
    const [totalUsers, pendingUsers, totalCompanies, onlineUsers] = await Promise.all([
      this.userRepository.count(),
      this.getPendingUsersCount(),
      this.companyRepository.count(),
      this.getOnlineUsers(),
    ]);
    return {
      totalUsers,
      pendingUsers,
      totalCompanies,
      onlineCount: onlineUsers.length,
    };
  }
}
