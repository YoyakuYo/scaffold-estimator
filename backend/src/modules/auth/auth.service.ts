import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { User } from './user.entity';
import { LoginHistory } from './login-history.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto } from './dto/update-user.dto';
import { RegisterDto } from './dto/register.dto';
import { ApproveUserDto } from './dto/approve-user.dto';
import { TransferCompanyAdminDto } from './dto/transfer-company-admin.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { SubscriptionService } from '../subscription/subscription.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
    @Inject(forwardRef(() => SubscriptionService))
    private subscriptionService: SubscriptionService,
    private mailerService: MailerService,
  ) {}

  /** Create trial subscription when user is approved/created. Non-blocking so register never fails. */
  /** Superadmin bypasses; company users need `is_company_admin` for org user list, invites, and direct user creation. */
  async assertCompanyUserManagementAccess(actor: { id: string; role: string }): Promise<void> {
    if (actor.role === 'superadmin') return;
    const { data: row } = await this.supabase.getClient().from('users').select('is_company_admin').eq('id', actor.id).maybeSingle();
    const ok = row && (row as { is_company_admin: boolean }).is_company_admin === true;
    if (!ok) {
      throw new ForbiddenException('Only the company admin can manage users and invitations for your organization.');
    }
  }

  /** If the company has no admin, promote this user (e.g. first approved registration). */
  private async ensureCompanyHasAdminIfMissing(companyId: string | null | undefined, userId: string): Promise<void> {
    if (!companyId) return;
    const client = this.supabase.getClient();
    const { data: existing } = await client
      .from('users')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_company_admin', true)
      .limit(1);
    if (existing && existing.length > 0) return;
    await client
      .from('users')
      .update(mapPayloadToSnake({ isCompanyAdmin: true, isCompanySeat: false }))
      .eq('id', userId);
  }

  /** After the last company admin is removed (e.g. superadmin deactivation), promote the earliest member. */
  private async promoteEarliestUserToAdminIfNone(companyId: string): Promise<void> {
    const client = this.supabase.getClient();
    const { data: has } = await client
      .from('users')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_company_admin', true)
      .eq('is_active', true)
      .limit(1);
    if (has && has.length > 0) return;
    const { data: next } = await client
      .from('users')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .eq('approval_status', 'approved')
      .neq('role', 'superadmin')
      .order('created_at', { ascending: true })
      .limit(1);
    const nid = next?.[0] ? (next[0] as { id: string }).id : null;
    if (nid) {
      await client
        .from('users')
        .update(mapPayloadToSnake({ isCompanyAdmin: true, isCompanySeat: false }))
        .eq('id', nid);
    }
  }

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

  async createUser(
    dto: CreateUserDto,
    actor: { id: string; role: string; companyId: string },
  ): Promise<any> {
    if (actor.role !== 'superadmin') {
      await this.assertCompanyUserManagementAccess(actor);
    }
    const client = this.supabase.getClient();
    const { data: existing } = await client.from('users').select('id').eq('email', dto.email).maybeSingle();
    if (existing) throw new ConflictException('このメールアドレスは既に使用されています。');

    const targetCompanyId = dto.companyId || actor.companyId;
    if (actor.role !== 'superadmin' && targetCompanyId !== actor.companyId) {
      throw new ForbiddenException();
    }
    const caps = await this.subscriptionService.resolveEffectiveCapabilitiesForCompany(targetCompanyId);
    if (caps.maxSeats > 0 && caps.maxSeats < 9000) {
      const used = await this.subscriptionService.countCompanySeatPressure(targetCompanyId);
      if (used >= caps.maxSeats) {
        throw new BadRequestException(
          'Seat limit reached for your subscription. Upgrade in Billing, revoke a pending invite, or remove a user before adding another.',
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
      companyId: targetCompanyId,
      isActive: true,
      approvalStatus: 'approved',
      /** Superadmin-created accounts are org-primary style; company-admin-created are seat members. */
      isCompanySeat: actor.role !== 'superadmin',
      isCompanyAdmin: false,
    });
    const { data: saved, error } = await client.from('users').insert(userIns).select().single();
    if (error || !saved) {
      this.logger.error('Create user failed', error);
      throw new BadRequestException('Failed to create user.');
    }
    const user = mapRowToCamel<User>(saved as Record<string, unknown>);
    if (user) await this.ensureTrialSubscriptionForUser(user);
    if (user) await this.ensureCompanyHasAdminIfMissing(user.companyId, user.id);
    const { passwordHash: _pw, bankActivationCodeHash: _bah, ...result } = user || saved;
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
      const { passwordHash, bankActivationCodeHash: _bah, companies, ...rest } = u;
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
    const { passwordHash, bankActivationCodeHash: _bah, companies, ...rest } = u;
    const result: any = rest;
    if (companies && typeof companies === 'object' && 'name' in companies) result.companyName = (companies as { name: string }).name;
    return result;
  }

  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    actor?: { role: string; companyId?: string },
  ): Promise<any> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    if (actor && actor.role !== 'superadmin' && user.companyId !== actor.companyId) {
      throw new ForbiddenException();
    }

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
    const { passwordHash: _p, bankActivationCodeHash: _h, ...result } = out || (saved as User);
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

  async adminResetPassword(
    userId: string,
    newPassword: string,
    actor?: { role: string; companyId?: string },
  ): Promise<{ success: boolean }> {
    const { data: row } = await this.supabase.getClient().from('users').select('company_id').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    if (actor && actor.role !== 'superadmin' && (row as { company_id: string }).company_id !== actor.companyId) {
      throw new ForbiddenException();
    }
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    await this.supabase.getClient().from('users').update(mapPayloadToSnake({ passwordHash: hash })).eq('id', userId);
    return { success: true };
  }

  private hashPasswordResetToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private hashBankActivationCode(userId: string, code: string): string {
    const pepper =
      this.configService.get<string>('BANK_ACTIVATION_CODE_PEPPER')?.trim() || 'set-bank-activation-pepper-in-env';
    const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
    return createHash('sha256').update(`${pepper}:${userId}:${normalized}`, 'utf8').digest('hex');
  }

  /** One-time code; unique per approval (not a shared secret per plan). */
  private generateBankActivationCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(12);
    let out = '';
    for (let i = 0; i < 12; i++) {
      out += chars[bytes[i]! % chars.length];
    }
    return out;
  }

  private async resolveUserIdByEmail(email: string): Promise<string | null> {
    const q = email.trim();
    if (!q) return null;
    const client = this.supabase.getClient();
    const { data: rpcId, error: rpcErr } = await client.rpc('get_user_id_by_email_ci', { p_email: q });
    if (rpcId != null && rpcId !== '') {
      return rpcId as string;
    }
    if (rpcErr) {
      this.logger.debug?.(`get_user_id_by_email_ci: ${rpcErr.message} (using email fallback)`);
    }
    const { data: row } = await client.from('users').select('id').eq('email', q).maybeSingle();
    if (row) return (row as { id: string }).id;
    const { data: row2 } = await client.from('users').select('id').eq('email', q.toLowerCase()).maybeSingle();
    return row2 ? (row2 as { id: string }).id : null;
  }

  /**
   * Sends reset email when SMTP is configured and user is approved + active.
   * Response is always generic (no account enumeration).
   */
  async requestPasswordReset(emailRaw: string): Promise<{ ok: true; message: string }> {
    const message =
      'If an account exists for that email and can receive mail, we sent password reset instructions. The link expires in 1 hour.';
    const email = emailRaw?.trim() ?? '';
    if (!email) {
      return { ok: true, message };
    }

    const userId = await this.resolveUserIdByEmail(email);
    if (!userId) {
      return { ok: true, message };
    }

    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    const user = mapRowToCamel<User>(row as Record<string, unknown> | null);
    if (!user || user.approvalStatus !== 'approved' || !user.isActive) {
      return { ok: true, message };
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.supabase.getClient().from('password_reset_tokens').delete().eq('user_id', userId);

    const ins = mapPayloadToSnake({
      userId,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
    });
    const { error: insErr } = await this.supabase.getClient().from('password_reset_tokens').insert(ins);
    if (insErr) {
      this.logger.error(`password_reset_tokens insert failed: ${insErr.message}`);
      return { ok: true, message };
    }

    const frontendUrl = (this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001').replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

    try {
      const sent = await this.mailerService.sendPasswordResetEmail(user.email, resetUrl);
      if (!sent) {
        await this.supabase.getClient().from('password_reset_tokens').delete().eq('user_id', userId);
        this.logger.warn(
          'Password reset: mail not configured (set BREVO_API_KEY or SENDGRID_API_KEY + SMTP_FROM, or full SMTP_*). No email was sent.',
        );
      }
    } catch (err) {
      await this.supabase.getClient().from('password_reset_tokens').delete().eq('user_id', userId);
      this.logger.error(`Password reset email failed: ${(err as Error).message}`);
    }

    return { ok: true, message };
  }

  async resetPasswordWithToken(token: string, newPassword: string): Promise<{ success: boolean }> {
    const raw = token?.trim();
    if (!raw) {
      throw new BadRequestException('This reset link is invalid or has expired. Please request a new password reset.');
    }
    const tokenHash = this.hashPasswordResetToken(raw);
    const { data: tokRow, error } = await this.supabase
      .getClient()
      .from('password_reset_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error || !tokRow) {
      throw new BadRequestException('This reset link is invalid or has expired. Please request a new password reset.');
    }

    const expiresAt = new Date((tokRow as { expires_at: string }).expires_at);
    const userId = (tokRow as { user_id: string }).user_id;
    const tokenId = (tokRow as { id: string }).id;

    if (expiresAt.getTime() <= Date.now()) {
      await this.supabase.getClient().from('password_reset_tokens').delete().eq('id', tokenId);
      throw new BadRequestException('This reset link is invalid or has expired. Please request a new password reset.');
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    await this.supabase.getClient().from('users').update(mapPayloadToSnake({ passwordHash: hash })).eq('id', userId);
    await this.supabase.getClient().from('password_reset_tokens').delete().eq('user_id', userId);
    return { success: true };
  }

  async deactivateUser(
    userId: string,
    actor?: { id: string; role: string; companyId?: string },
  ): Promise<{ success: boolean }> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const target = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!target) throw new NotFoundException('ユーザーが見つかりません。');
    if (actor && actor.role !== 'superadmin' && target.companyId !== actor.companyId) {
      throw new ForbiddenException();
    }
    if (target.isCompanyAdmin && actor?.role !== 'superadmin') {
      throw new BadRequestException(
        'Transfer the company admin role to another member before deactivating this account.',
      );
    }
    await this.supabase.getClient().from('users').update({ is_active: false }).eq('id', userId);
    if (target.isCompanyAdmin && target.companyId && actor?.role === 'superadmin') {
      await this.promoteEarliestUserToAdminIfNone(target.companyId);
    }
    return { success: true };
  }

  async transferCompanyAdmin(
    actor: { id: string; role: string; companyId?: string },
    dto: TransferCompanyAdminDto,
  ): Promise<{ success: boolean }> {
    const client = this.supabase.getClient();
    let companyId: string;
    if (actor.role === 'superadmin') {
      if (!dto.companyId) {
        throw new BadRequestException('companyId is required when transferring company admin as platform superadmin.');
      }
      companyId = dto.companyId;
    } else {
      const { data: arow } = await client.from('users').select('*').eq('id', actor.id).maybeSingle();
      const au = mapRowToCamel<User>(arow as Record<string, unknown>);
      if (!au?.isCompanyAdmin) {
        throw new ForbiddenException('Only the company admin can transfer this role.');
      }
      companyId = au.companyId;
    }

    const { data: trow } = await client.from('users').select('*').eq('id', dto.targetUserId).maybeSingle();
    const target = mapRowToCamel<User>(trow as Record<string, unknown>);
    if (!target || target.companyId !== companyId) {
      throw new BadRequestException('Target user is not a member of this company.');
    }
    if (target.role === 'superadmin') {
      throw new BadRequestException('Invalid target.');
    }
    if (target.approvalStatus !== 'approved' || !target.isActive) {
      throw new BadRequestException('Target user must be active and approved.');
    }

    await client.from('users').update({ is_company_admin: false }).eq('company_id', companyId);
    const { error } = await client
      .from('users')
      .update(mapPayloadToSnake({ isCompanyAdmin: true, isCompanySeat: false }))
      .eq('id', target.id);
    if (error) {
      this.logger.error(`transferCompanyAdmin update failed: ${error.message}`);
      throw new BadRequestException('Could not transfer company admin.');
    }
    return { success: true };
  }

  async getProfile(userId: string): Promise<any> {
    return this.getUser(userId, { withCompany: true });
  }

  async approveUser(userId: string, dto?: ApproveUserDto): Promise<any> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    if (user.approvalStatus === 'approved') throw new BadRequestException('このユーザーは既に承認されています。');

    const mode = dto?.paymentActivation ?? 'standard';
    if (mode === 'bank_transfer') {
      if (!dto?.planTier) {
        throw new BadRequestException(
          'planTier is required when paymentActivation is bank_transfer (basic, medium, monthly, or premium).',
        );
      }
      await this.subscriptionService.ensureInactiveSubscriptionForPendingBank(userId);
      const code = this.generateBankActivationCode();
      const hash = this.hashBankActivationCode(userId, code);
      const ttlRaw = this.configService.get<string>('BANK_ACTIVATION_CODE_TTL_HOURS')?.trim() || '168';
      const ttlHours = Math.max(1, parseInt(ttlRaw, 10) || 168);
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
      const snake = mapPayloadToSnake({
        approvalStatus: 'approved' as const,
        pendingBankPlan: dto.planTier,
        bankActivationCodeHash: hash,
        bankActivationCodeExpiresAt: expiresAt.toISOString(),
      });
      const { data: saved, error } = await this.supabase.getClient().from('users').update(snake).eq('id', userId).select().single();
      if (error || !saved) throw new BadRequestException('Update failed.');
      const updated = mapRowToCamel<User>(saved as Record<string, unknown>);
      const frontendUrl = (this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001').replace(/\/$/, '');
      const activateUrl = `${frontendUrl}/activate-bank-subscription`;
      await this.notificationsService
        .create(userId, 'system', 'Enter your subscription code', {
          body: `Plan: ${dto.planTier}. Your code: ${code}. Open ${activateUrl} to confirm.`,
          link: '/activate-bank-subscription',
        })
        .catch(() => {});
      await this.mailerService
        .sendBankTransferActivationEmail(user.email, code, dto.planTier, activateUrl)
        .catch(() => {});
      const { passwordHash: _p, bankActivationCodeHash: _h, ...result } = updated || (saved as User);
      await this.ensureCompanyHasAdminIfMissing(updated?.companyId, userId);
      return result;
    }

    const snake = mapPayloadToSnake({
      approvalStatus: 'approved' as const,
      pendingBankPlan: null,
      bankActivationCodeHash: null,
      bankActivationCodeExpiresAt: null,
    });
    const { data: saved, error } = await this.supabase.getClient().from('users').update(snake).eq('id', userId).select().single();
    if (error || !saved) throw new BadRequestException('Update failed.');
    const updated = mapRowToCamel<User>(saved as Record<string, unknown>);
    if (updated) await this.ensureTrialSubscriptionForUser(updated);
    await this.notificationsService
      .create(userId, 'approval', 'Account approved', { body: 'Your account has been approved. You can now log in.', link: '/login' })
      .catch(() => {});
    await this.mailerService.sendApprovalEmail(user.email).catch(() => {});
    const { passwordHash: _p, bankActivationCodeHash: _h, ...result } = updated || (saved as User);
    await this.ensureCompanyHasAdminIfMissing(updated?.companyId, userId);
    return result;
  }

  async verifyBankActivation(userId: string, code: string): Promise<{ ok: true; plan: string }> {
    const { data: row } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('User not found');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user?.pendingBankPlan || !user.bankActivationCodeHash) {
      throw new BadRequestException('No bank transfer activation is pending for this account.');
    }
    if (user.bankActivationCodeExpiresAt && new Date(user.bankActivationCodeExpiresAt) < new Date()) {
      throw new BadRequestException('This activation code has expired. Contact support for a new code.');
    }
    const hash = this.hashBankActivationCode(userId, code);
    if (hash !== user.bankActivationCodeHash) {
      throw new BadRequestException('Invalid activation code.');
    }
    const planTier = user.pendingBankPlan;
    await this.supabase
      .getClient()
      .from('users')
      .update(
        mapPayloadToSnake({
          pendingBankPlan: null,
          bankActivationCodeHash: null,
          bankActivationCodeExpiresAt: null,
        }),
      )
      .eq('id', userId);
    await this.subscriptionService.activateBankVerifiedPlan(userId, planTier);
    return { ok: true, plan: planTier };
  }

  /**
   * Deletes rows that reference users(id) without ON DELETE CASCADE (e.g. quotations.created_by),
   * so pending/rejected signup removal does not fail on FK violations.
   */
  private async removeRowsBlockingUserDelete(client: SupabaseClient, userId: string): Promise<void> {
    const tables = ['quotations', 'estimates'] as const;
    for (const table of tables) {
      const { error } = await client.from(table).delete().eq('created_by', userId);
      if (!error) continue;
      const code = (error as { code?: string }).code;
      const msg = error.message || String(error);
      if (code === 'PGRST205' || msg.includes('schema cache') || msg.includes('Could not find the table')) {
        continue;
      }
      this.logger.warn(`removeRowsBlockingUserDelete: ${table} delete for user ${userId}: ${msg}`);
    }
  }

  async rejectUser(userId: string): Promise<{ success: true }> {
    const client = this.supabase.getClient();
    const { data: row } = await client.from('users').select('*').eq('id', userId).maybeSingle();
    if (!row) throw new NotFoundException('ユーザーが見つかりません。');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('ユーザーが見つかりません。');
    if (user.role === 'superadmin') {
      throw new ForbiddenException('Platform superadmin cannot be rejected.');
    }
    const isPending = user.approvalStatus === 'pending';
    const isRejected = user.approvalStatus === 'rejected';
    if (!isPending && !isRejected) {
      throw new BadRequestException(
        'Only pending signups (or legacy rejected rows) can be removed with reject. Deactivate approved users instead if needed.',
      );
    }

    const { email, companyId } = user;
    if (isPending) {
      await this.mailerService.sendRejectionEmail(email).catch(() => {});
    }

    await this.removeRowsBlockingUserDelete(client, userId);

    const { error: delErr } = await client.from('users').delete().eq('id', userId);
    if (delErr) {
      this.logger.error('rejectUser: user delete failed', delErr);
      const hint =
        (delErr as { message?: string }).message ||
        'Foreign key or database constraint may still reference this user.';
      throw new BadRequestException(
        `Could not remove this user: ${hint} If you use Supabase SQL, delete dependent rows first or contact support.`,
      );
    }

    const { count, error: cntErr } = await client
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);
    if (!cntErr && (count ?? 0) === 0) {
      const { error: compErr } = await client.from('companies').delete().eq('id', companyId);
      if (compErr) {
        this.logger.warn(`rejectUser: orphan company delete failed companyId=${companyId}`, compErr);
      }
    }

    return { success: true };
  }

  async getPendingUsersCount(): Promise<number> {
    const { count, error } = await this.supabase.getClient().from('users').select('*', { count: 'exact', head: true }).eq('approval_status', 'pending');
    if (error) return 0;
    return count ?? 0;
  }

  /**
   * Non-superadmin user count + distinct companies that have at least one such user.
   * Prefers RPC `admin_platform_tenant_stats` (see supabase-migrations/129_platform_tenant_stats.sql).
   */
  private async getTenantUserAndCompanyCounts(): Promise<{ users: number; companies: number }> {
    const client = this.supabase.getClient();
    const { data, error } = await client.rpc('admin_platform_tenant_stats');
    if (!error && data != null) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === 'object' && 'tenant_users' in row && 'tenant_companies' in row) {
        const typed = row as { tenant_users: unknown; tenant_companies: unknown };
        return {
          users: Number(typed.tenant_users),
          companies: Number(typed.tenant_companies),
        };
      }
    }
    if (error) {
      this.logger.warn(`admin_platform_tenant_stats RPC failed (${error.message}); using fallback counts`);
    }
    const { count: userCount, error: cErr } = await client
      .from('users')
      .select('*', { count: 'exact', head: true })
      .neq('role', 'superadmin');
    if (cErr) this.logger.warn(`tenant user count fallback: ${cErr.message}`);
    const { data: rows, error: rErr } = await client.from('users').select('company_id').neq('role', 'superadmin');
    if (rErr) {
      this.logger.warn(`distinct company fallback: ${rErr.message}`);
      return { users: userCount ?? 0, companies: 0 };
    }
    const ids = new Set(
      (rows || [])
        .map((r) => (r as { company_id: string | null }).company_id)
        .filter((id): id is string => id != null && id !== ''),
    );
    return { users: userCount ?? 0, companies: ids.size };
  }

  async getPlatformStats(): Promise<{
    totalUsers: number;
    pendingUsers: number;
    totalCompanies: number;
    onlineCount: number;
  }> {
    const [tenant, pendingRes, onlineUsers] = await Promise.all([
      this.getTenantUserAndCompanyCounts(),
      this.getPendingUsersCount(),
      this.getOnlineUsers(),
    ]);
    return {
      totalUsers: tenant.users,
      pendingUsers: pendingRes,
      totalCompanies: tenant.companies,
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
    return (companiesRows || [])
      .map((c: { id: string; name: string }) => ({
        id: c.id,
        name: c.name,
        userCount: countMap.get(c.id) ?? 0,
        branches: branchesByCompany.get(c.id) || [],
      }))
      .filter((c) => c.userCount > 0);
  }
}
