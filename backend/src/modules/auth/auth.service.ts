import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, ApprovalStatus } from './user.entity';
import { Company } from './company.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      // Check if user is approved
      if (user.approvalStatus !== 'approved') {
        throw new UnauthorizedException(
          user.approvalStatus === 'pending'
            ? 'Your account is pending admin approval. Please wait for approval before logging in.'
            : 'Your account has been rejected. Please contact support.',
        );
      }
      // Check if user is active
      if (!user.isActive) {
        throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
      }
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
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

    // Create company
    const company = new Company();
    company.name = dto.companyName;
    company.taxId = dto.companyTaxId || '';
    company.address = dto.companyAddress || '';
    company.phone = dto.companyPhone || '';
    company.email = dto.companyEmail || dto.email;
    const savedCompany = await this.companyRepository.save(company);

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
    const { passwordHash: _pw, ...result } = saved;
    return result;
  }

  /**
   * List all users (optionally filter by companyId).
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
    const { passwordHash, ...result } = saved;
    return result;
  }

  /**
   * Get pending users count (for admin dashboard).
   */
  async getPendingUsersCount(): Promise<number> {
    return this.userRepository.count({ where: { approvalStatus: 'pending' } });
  }
}
