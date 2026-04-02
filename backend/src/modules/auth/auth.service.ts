import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { LoginHistory } from './login-history.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private jwtService: JwtService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
    @Inject(forwardRef(() => SubscriptionService))
    private subscriptionService: SubscriptionService,
    private mailerService: MailerService,
  ) {}

  /** Create trial subscription when user is approved/created. Non-blocking so register never fails. */
  private async ensureTrialSubscriptionForUser(user: User): Promise<void> {
    if (!user || user.role === 'superadmin') return;
    try {
      await this.subscriptionService.ensureSubscriptionForUser(user.id);
    } catch (err) {
      this.logger.warn(
        `Could not ensure subscription for user ${user.id} (subscriptions table may be missing): ${(err as Error).message}`,
      );
    }
  }

  async validateUser(email: string, password: string): Promise<any> {
    const { data: rows, error } = await this.supabase
      .getClient()
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.warn('Auth DB error:', error.message);
      return null;
    }
    const user = mapRowToCamel<User>(rows as Record<string, unknown> | null);

    this.logger.debug?.(`Login attempt: ${email}, found: ${!!user}`);

    if (!user) return null;

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) return null;

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
    const client = this.supabase.getClient();
    await client.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', userId);
    await client.from('login_history').insert(
      mapPayloadToSnake({ userId, ipAddress: ip || null, userAgent: userAgent || null }),
    );
  }

  /** Heartbeat: update last_active_at (call from frontend every ~60s). */
  async heartbeat(userId: string): Promise<{ ok: boolean }> {
    await this.supabase
      .getClient()
      .from('users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId);
    return { ok: true };
  }

  /** List users considered "online" (last_active_at within last 3 minutes). Excludes superadmin. Admin only. */
  async getOnlineUsers(): Promise<any[]> {
    const { data: rows, error } = await this.supabase
      .getClient()
      .from('users')
      .select('*')
      .eq('is_active', true)
      .eq('approval_status', 'approved')
      .order('last_active_at', { ascending: false });

    if (error) return [];
    const users = mapRowsToCamel<User>(rows || []);
    const cutoff = new Date(Date.now() - 3 * 60 * 1000);
    const online = users.filter(
      (u) => u.role !== 'superadmin' && u.lastActiveAt && new Date(u.lastActiveAt) >= cutoff,
    );
    return online.map(({ passwordHash, ...rest }) => rest);
  }

  /** Get login history for a user. Admin only. */
  async getLoginHistory(userId: string, limit = 50): Promise<LoginHistory[]> {
    const { data: rows, error } = await this.supabase
      .getClient()
      .from('login_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return mapRowsToCamel<LoginHistory>(rows || []);
  }

  async validateToken(token: string): Promise<User> {
    try {
      const payload = this.jwtService.verify(token);
      const { data: row, error } = await this.supabase
        .getClient()
        .from('users')
        .select('*')
        .eq('id', payload.sub)
        .maybeSingle();

      if (error || !row) throw new UnauthorizedException('Invalid token');
      const user = mapRowToCamel<User>(row as Record<string, unknown>);
      if (!user || !user.isActive || user.approvalStatus !== 'approved') {
        throw new UnauthorizedException('User not found, inactive, or not approved');
      }
      return user;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // ─── Public Registration ─────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ success: boolean; message: string; userId: string }> {
    const client = this.supabase.getClient();

    const { data: existing } = await client.from('users').select('id').eq('email', dto.email).maybeSingle();
    if (existing) throw new ConflictException('このメールアドレスは既に使用されています。');

    const companyIns = mapPayloadToSnake<Record<string, unknown>>({
      name: dto.companyName,
      taxId: '',
      address: dto.companyAddress || '',
      phone: dto.companyPhone || '',
      email: dto.companyEmail || dto.email,
      postalCode: dto.companyPostalCode || '',
      prefecture: dto.companyPrefecture || '',
      city: dto.companyCity || '',
      town: dto.companyTown || '',
      addressLine: dto.companyAddressLine || '',
      building: dto.companyBuilding || '',
    });
    const { data: savedCompany, error: companyErr } = await client
      .from('companies')
      .insert(companyIns)
      .select('id')
      .single();
    if (companyErr || !savedCompany) {
      this.logger.error('Register company insert failed', companyErr);
      throw new BadRequestException('Registration failed.');
    }

    const companyId = (savedCompany as { id: string }).id;
    const branchIns = mapPayloadToSnake<Record<string, unknown>>({
      companyId,
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
    await client.from('company_branches').insert(branchIns);

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);
    const userIns = mapPayloadToSnake<Record<string, unknown>>({
      email: dto.email,
      passwordHash: hash,
      role: 'viewer',
      firstName: dto.firstName,
      lastName: dto.lastName,
      companyId,
      isActive: true,
      approvalStatus: 'pending',
    });
    const { data: savedUser, error: userErr } = await client.from('users').insert(userIns).select('id').single();
    if (userErr || !savedUser) {
      this.logger.error('Register user insert failed', userErr);
      throw new BadRequestException('Registration failed.');
    }
    const userId = (savedUser as { id: string }).id;

    return {
      success: true,
      message:
        'Registration successful. Your account is pending admin approval. You will be notified once approved.',
      userId,
    };
  }

  // ─── User Management ─────────────────────────────────────

  async createUser(dto: CreateUserDto, adminCompanyId: string): Promise<any> {
    const client = this.supabase.getClient();
    const { data: existing } = await client.from('users').select('id').eq('email', dto.email).maybeSingle();
    if (existing) throw new ConflictException('このメールアドレスは既に使用されています。');

    const targetCompanyId = dto.companyId || adminCompanyId;
    const caps = await this.subscriptionService.resolveEffectiveCapabilitiesForCompany(targetCompanyId);
    if (caps.maxSeats > 0 && caps.maxSeats < 9000) {
      const used = await this.subscriptionService.countCompanySeats(targetCompanyId);
      if (used >= caps.maxSeats) {
        throw new BadRequestException(
          'Seat limit reached for your subscription. Upgrade in Billing or remove a user before adding another.',
        );
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);
    const userIns = mapPayloadToSnake<Record<string, unknown>>({
      email: dto.email,
      passwordHash: hash,
      role: dto.role || 'viewer',
      firstName: dto.firstName || '',
      lastName: dto.lastName || '',
      companyId: dto.companyId || adminCompanyId,
      isActive: true,
      approvalStatus: 'approved',
    });
    const { data: saved, error } = await client.from('users').insert(userIns).select().single();
    if (error || !saved) {
      this.logger.error('Create user failed', error);
      throw new BadRequestException('Failed to create user.');
    }
    const user = mapRowToCamel<User>(saved as Record<string, unknown>);
    if (user) await this.ensureTrialSubscriptionForUser(user);
    const { passwordHash: _pw, ...result } = user || saved;
    return result;
  }

  async listUsers(companyId?: string): Promise<any[]> {
    let q = this.supabase.getClient().from('users').select('*, companies(name)').order('created_at', { ascending: false });
    if (companyId) q = q.eq('company_id', companyId);
    const { data: rows, error } = await q;
    if (error) return [];
    const users = (rows || []).map((r: Record<string, unknown>) => {
      const u = mapRowToCamel<User & { companies?: { name: string } | null }>(r);
      if (!u) return null;
      const { passwordHash, companies, ...rest } = u;
      const out: any = rest;
      if (companies && typeof companies === 'object' && 'name' in companies) out.companyName = (companies as { name: string }).name;
      return out;
    });
    return users.filter((u) => u && u.role !== 'superadmin');
  }

  async getUser(userId: string, options?: { withCompany?: boolean }): Promise<any> {
    const select = options?.withCompany ? '*, companies(name)' : '*';
    const { data: row, error } = await this.supabase
      .getClient()
      .from('users')
      .select(select)
      .eq('id', userId)
      .maybeSingle();

    if (error || !row) throw new NotFoundException('ユーザーが見つかりません。');
    const u = mapRowToCamel<User & { companies?: { name: string } | null }>(row as unknown as Record<string, unknown>);
    if (!u) throw new NotFoundException('ユーザーが見つかりません。');
    const { passwordHash, companies, ...rest } = u;
    const result: any = rest;
    if (companies && typeof companies === 'object' && 'name' in companies) result.companyName = (companies as { name: string }).name;
    return result;
  }

  async updateUser(userId: string, dto: UpdateUserDto): Promise<any> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');

    const updates: Record<string, unknown> = {};
    if (dto.email !== undefined && dto.email !== user.email) {
      const { data: existing } = await this.supabase.getClient().from('users').select('id').eq('email', dto.email).maybeSingle();
      if (existing) throw new ConflictException('このメールアドレスは既に使用されています。');
      updates.email = dto.email;
    }
    if (dto.role !== undefined) updates.role = dto.role;
    if (dto.firstName !== undefined) updates.firstName = dto.firstName;
    if (dto.lastName !== undefined) updates.lastName = dto.lastName;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;

    const snake = mapPayloadToSnake(updates);
    const { data: saved, error } = await this.supabase.getClient().from('users').update(snake).eq('id', userId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    const out = mapRowToCamel<User>(saved as Record<string, unknown>);
    const { passwordHash: _p, ...result } = out || (saved as User);
    return result;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: boolean }> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) throw new BadRequestException('現在のパスワードが正しくありません。');

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.newPassword, salt);
    await this.supabase.getClient().from('users').update(mapPayloadToSnake({ passwordHash: hash })).eq('id', userId);
    return { success: true };
  }

  async adminResetPassword(userId: string, newPassword: string): Promise<{ success: boolean }> {
    const { data: row } = await this.supabase.getClient().from('users').select('id').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    await this.supabase.getClient().from('users').update(mapPayloadToSnake({ passwordHash: hash })).eq('id', userId);
    return { success: true };
  }

  async deactivateUser(userId: string): Promise<{ success: boolean }> {
    const { data: row } = await this.supabase.getClient().from('users').select('id').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    await this.supabase.getClient().from('users').update({ is_active: false }).eq('id', userId);
    return { success: true };
  }

  async getProfile(userId: string): Promise<any> {
    return this.getUser(userId, { withCompany: true });
  }

  async approveUser(userId: string): Promise<any> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    if (user.approvalStatus === 'approved') throw new BadRequestException('このユーザーは既に承認されています。');

    const snake = mapPayloadToSnake({ approvalStatus: 'approved' });
    const { data: saved, error } = await this.supabase.getClient().from('users').update(snake).eq('id', userId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    const updated = mapRowToCamel<User>(saved as Record<string, unknown>);
    if (updated) await this.ensureTrialSubscriptionForUser(updated);
    await this.notificationsService.create(userId, 'approval', 'Account approved', { body: 'Your account has been approved. You can now log in.', link: '/login' }).catch(() => {});
    await this.mailerService.sendApprovalEmail(user.email).catch(() => {});
    const { passwordHash, ...result } = updated || (saved as User);
    return result;
  }

  async rejectUser(userId: string): Promise<any> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    if (user.approvalStatus === 'rejected') throw new BadRequestException('このユーザーは既に拒否されています。');

    await this.supabase.getClient().from('users').update(mapPayloadToSnake({ approvalStatus: 'rejected', isActive: false })).eq('id', userId);
    await this.notificationsService.create(userId, 'rejection', 'Account not approved', { body: 'Your account request was not approved. Please contact support if you have questions.', link: '/login' }).catch(() => {});
    await this.mailerService.sendRejectionEmail(user.email).catch(() => {});
    const { passwordHash, ...result } = user;
    return result;
  }

  async getPendingUsersCount(): Promise<number> {
    const { count, error } = await this.supabase.getClient().from('users').select('*', { count: 'exact', head: true }).eq('approval_status', 'pending');
    if (error) return 0;
    return count ?? 0;
  }

  async getPlatformStats(): Promise<{
    totalUsers: number;
    pendingUsers: number;
    totalCompanies: number;
    onlineCount: number;
  }> {
    const client = this.supabase.getClient();
    const [totalRes, pendingRes, companiesRes, onlineUsers] = await Promise.all([
      client.from('users').select('*', { count: 'exact', head: true }),
      this.getPendingUsersCount(),
      client.from('companies').select('*', { count: 'exact', head: true }),
      this.getOnlineUsers(),
    ]);
    return {
      totalUsers: totalRes.count ?? 0,
      pendingUsers: pendingRes,
      totalCompanies: companiesRes.count ?? 0,
      onlineCount: onlineUsers.length,
    };
  }

  async listCompaniesForSuperAdmin(): Promise<
    Array<{ id: string; name: string; userCount: number; branches: Array<{ id: string; name: string; isHeadquarters: boolean }> }>
  > {
    const client = this.supabase.getClient();
    const { data: companiesRows } = await client.from('companies').select('id, name').order('name');
    const { data: usersRows } = await client.from('users').select('company_id').neq('role', 'superadmin');
    const { data: branchesRows } = await client.from('company_branches').select('id, company_id, name, is_headquarters').order('name');

    const countMap = new Map<string, number>();
    for (const u of usersRows || []) {
      const cid = (u as { company_id: string }).company_id;
      countMap.set(cid, (countMap.get(cid) || 0) + 1);
    }
    const branchesByCompany = new Map<string, Array<{ id: string; name: string; isHeadquarters: boolean }>>();
    for (const b of branchesRows || []) {
      const r = b as { id: string; company_id: string; name: string; is_headquarters: boolean };
      if (!branchesByCompany.has(r.company_id)) branchesByCompany.set(r.company_id, []);
      branchesByCompany.get(r.company_id)!.push({ id: r.id, name: r.name, isHeadquarters: r.is_headquarters });
    }
    return (companiesRows || []).map((c: { id: string; name: string }) => ({
      id: c.id,
      name: c.name,
      userCount: countMap.get(c.id) ?? 0,
      branches: branchesByCompany.get(c.id) || [],
    }));
  }
}
