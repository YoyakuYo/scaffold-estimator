import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { MailerService } from '../mailer/mailer.service';
import { mapPayloadToSnake, mapRowToCamel } from '../../common/utils/db-mapper';
import { User } from './user.entity';
import { CreateTeamInviteDto } from './dto/create-team-invite.dto';
import { AcceptTeamInviteSignupDto } from './dto/accept-team-invite.dto';

type InviteRow = Record<string, unknown>;

@Injectable()
export class TeamInviteService {
  private readonly logger = new Logger(TeamInviteService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly subscriptionService: SubscriptionService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private resolveCompanyIdForInvite(actor: { id: string; role: string; companyId: string }, dto: CreateTeamInviteDto): string {
    if (actor.role === 'superadmin') {
      if (!dto.companyId) {
        throw new BadRequestException('companyId is required when sending invites as superadmin.');
      }
      return dto.companyId;
    }
    return actor.companyId;
  }

  private async assertBranchBelongsToCompany(branchId: string, companyId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('company_branches')
      .select('id')
      .eq('id', branchId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error || !data) {
      throw new BadRequestException('Branch does not belong to the selected company.');
    }
  }

  private async loadInviteByRawToken(token: string): Promise<{ invite: InviteRow; inviteCamel: Record<string, unknown> }> {
    if (!token || token.length < 32) {
      throw new NotFoundException('Invalid or expired invite.');
    }
    const tokenHash = this.hashToken(token);
    const { data, error } = await this.supabase
      .getClient()
      .from('company_invites')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('status', 'pending')
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('Invalid or expired invite.');
    }
    if (new Date((data as { expires_at: string }).expires_at) <= new Date()) {
      await this.supabase
        .getClient()
        .from('company_invites')
        .update(mapPayloadToSnake({ status: 'expired', updatedAt: new Date().toISOString() }))
        .eq('id', (data as { id: string }).id);
      throw new NotFoundException('This invite has expired.');
    }
    const inviteCamel = mapRowToCamel<Record<string, unknown>>(data as Record<string, unknown>)!;
    return { invite: data as InviteRow, inviteCamel };
  }

  /** Reject if seat count is over limit (inconsistent); at-cap with a pending invite is OK (invite converts to user). */
  private async assertSeatAvailableForAccept(companyId: string): Promise<void> {
    const caps = await this.subscriptionService.resolveEffectiveCapabilitiesForCompany(companyId);
    if (caps.maxSeats <= 0 || caps.maxSeats >= 9000) return;
    const pressure = await this.subscriptionService.countCompanySeatPressure(companyId);
    if (pressure > caps.maxSeats) {
      throw new BadRequestException(
        'This company is over its subscription seat limit. Ask an admin to upgrade or revoke invites before joining.',
      );
    }
  }

  async getPreviewByToken(token: string): Promise<{
    companyName: string;
    branchName: string;
    emailMasked: string;
    role: string;
  }> {
    const { inviteCamel } = await this.loadInviteByRawToken(token);
    const companyId = inviteCamel.companyId as string;
    const branchId = inviteCamel.branchId as string;
    const email = inviteCamel.email as string;

    const client = this.supabase.getClient();
    const [{ data: comp }, { data: branch }] = await Promise.all([
      client.from('companies').select('name').eq('id', companyId).maybeSingle(),
      client.from('company_branches').select('name').eq('id', branchId).maybeSingle(),
    ]);
    const companyName = (comp as { name?: string } | null)?.name || 'Company';
    const branchName = (branch as { name?: string } | null)?.name || 'Branch';
    const [local, domain] = email.split('@');
    const emailMasked =
      local && domain
        ? `${local.slice(0, 2)}${local.length > 2 ? '…' : ''}@${domain}`
        : email;
    return {
      companyName,
      branchName,
      emailMasked,
      role: (inviteCamel.role as string) || 'viewer',
    };
  }

  async createInvite(
    actor: { id: string; role: string; companyId: string; email?: string },
    dto: CreateTeamInviteDto,
  ): Promise<{ id: string; joinUrl: string; emailSent: boolean }> {
    const companyId = this.resolveCompanyIdForInvite(actor, dto);
    await this.assertBranchBelongsToCompany(dto.branchId, companyId);

    const email = this.normalizeEmail(dto.email);
    if (actor.email && this.normalizeEmail(actor.email) === email) {
      throw new BadRequestException('You cannot invite your own email address.');
    }

    const caps = await this.subscriptionService.resolveEffectiveCapabilitiesForCompany(companyId);
    if (caps.maxSeats > 0 && caps.maxSeats < 9000) {
      const used = await this.subscriptionService.countCompanySeatPressure(companyId);
      if (used >= caps.maxSeats) {
        throw new BadRequestException(
          'Seat limit reached. Upgrade in Billing, revoke a pending invite, or remove a user before inviting.',
        );
      }
    }

    const { data: existingUser } = await this.supabase
      .getClient()
      .from('users')
      .select('id, company_id')
      .eq('email', email)
      .maybeSingle();
    if (existingUser) {
      const row = existingUser as { company_id: string };
      if (row.company_id === companyId) {
        throw new ConflictException('This user is already a member of your company.');
      }
      throw new ConflictException(
        'This email is already registered on another company. They must use a different email or contact support.',
      );
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const ttlDays = Math.max(
      1,
      parseInt(this.configService.get<string>('TEAM_INVITE_EXPIRY_DAYS')?.trim() || '14', 10) || 14,
    );
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const role = dto.role === 'estimator' ? 'estimator' : 'viewer';

    const ins = mapPayloadToSnake({
      companyId,
      branchId: dto.branchId,
      email,
      tokenHash,
      invitedByUserId: actor.id,
      role,
      status: 'pending',
      expiresAt,
    });

    const { data: saved, error } = await this.supabase
      .getClient()
      .from('company_invites')
      .insert(ins)
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505' || String(error.message).includes('unique')) {
        throw new ConflictException('A pending invite already exists for this email.');
      }
      this.logger.error('company_invites insert failed', error);
      throw new BadRequestException('Could not create invite.');
    }

    const frontendUrl = (this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001').replace(/\/$/, '');
    const joinUrl = `${frontendUrl}/join-team?token=${rawToken}`;

    const { data: comp } = await this.supabase.getClient().from('companies').select('name').eq('id', companyId).maybeSingle();
    const { data: br } = await this.supabase
      .getClient()
      .from('company_branches')
      .select('name')
      .eq('id', dto.branchId)
      .maybeSingle();
    const companyName = (comp as { name?: string } | null)?.name || 'Your team';
    const branchName = (br as { name?: string } | null)?.name || '';

    let emailSent = false;
    try {
      if (this.mailerService.mailConfigured()) {
        await this.mailerService.sendTeamInviteEmail(email, joinUrl, companyName, branchName, role);
        emailSent = true;
      } else {
        this.logger.warn('Mail not configured — invite created; share joinUrl manually.');
      }
    } catch (e) {
      this.logger.warn(`Team invite email failed: ${(e as Error).message}`);
    }

    return { id: (saved as { id: string }).id, joinUrl, emailSent };
  }

  async listInvites(companyId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('company_invites')
      .select('id, email, role, status, expires_at, created_at, branch_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return [];
    return (data || []).map((row: Record<string, unknown>) => mapRowToCamel<Record<string, unknown>>(row));
  }

  async revokeInvite(actor: { role: string; companyId: string }, inviteId: string, companyId: string): Promise<{ success: boolean }> {
    const targetCompany = actor.role === 'superadmin' ? companyId : actor.companyId;
    if (actor.role !== 'superadmin' && companyId !== actor.companyId) {
      throw new ForbiddenException();
    }
    const { data: row } = await this.supabase
      .getClient()
      .from('company_invites')
      .select('id, company_id, status')
      .eq('id', inviteId)
      .maybeSingle();
    if (!row || (row as { company_id: string }).company_id !== targetCompany) {
      throw new NotFoundException('Invite not found.');
    }
    if ((row as { status: string }).status !== 'pending') {
      throw new BadRequestException('Only pending invites can be revoked.');
    }
    await this.supabase
      .getClient()
      .from('company_invites')
      .update(mapPayloadToSnake({ status: 'revoked', updatedAt: new Date().toISOString() }))
      .eq('id', inviteId);
    return { success: true };
  }

  private buildAuthPayload(user: User) {
    return {
      access_token: this.jwtService.sign({
        email: user.email,
        sub: user.id,
        role: user.role,
        companyId: user.companyId,
      }),
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

  async acceptSignup(dto: AcceptTeamInviteSignupDto): Promise<{ access_token: string; user: unknown }> {
    const { invite, inviteCamel } = await this.loadInviteByRawToken(dto.token);
    const companyId = inviteCamel.companyId as string;
    const branchId = inviteCamel.branchId as string;
    const email = inviteCamel.email as string;
    const role = (inviteCamel.role as 'viewer' | 'estimator') || 'viewer';

    await this.assertSeatAvailableForAccept(companyId);

    const client = this.supabase.getClient();
    const { data: existing } = await client.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) {
      throw new ConflictException(
        'An account with this email already exists. Log in, open this invite link again, and accept from your session.',
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(dto.password, salt);
    const userIns = mapPayloadToSnake({
      email,
      passwordHash: hash,
      role,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      companyId,
      branchId,
      isActive: true,
      approvalStatus: 'approved',
    });

    const { data: saved, error } = await client.from('users').insert(userIns).select('*').single();
    if (error || !saved) {
      this.logger.error('acceptSignup user insert failed', error);
      throw new BadRequestException('Could not create your account.');
    }

    const user = mapRowToCamel<User>(saved as Record<string, unknown>)!;
    try {
      await this.subscriptionService.syncSubscriptionRowForCompanyMember(user.id);
    } catch (e) {
      this.logger.warn(`syncSubscriptionRowForCompanyMember: ${(e as Error).message}`);
    }

    await client
      .from('company_invites')
      .update(mapPayloadToSnake({ status: 'accepted', acceptedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
      .eq('id', (invite as { id: string }).id);

    const { passwordHash: _p, bankActivationCodeHash: _h, ...safe } = user;
    return this.buildAuthPayload(safe as User);
  }

  async acceptLoggedIn(
    userRow: { id: string; email: string; role: string; companyId: string },
    token: string,
  ): Promise<{ access_token: string; user: unknown }> {
    if (userRow.role === 'superadmin') {
      throw new BadRequestException('Super admin accounts cannot join a company via invite.');
    }
    const { invite, inviteCamel } = await this.loadInviteByRawToken(token);
    const companyId = inviteCamel.companyId as string;
    const branchId = inviteCamel.branchId as string;
    const inviteEmail = this.normalizeEmail(inviteCamel.email as string);
    if (this.normalizeEmail(userRow.email) !== inviteEmail) {
      throw new ForbiddenException('This invite was sent to a different email address. Log in with the invited account.');
    }

    await this.assertSeatAvailableForAccept(companyId);

    const client = this.supabase.getClient();
    const { data: fullUser } = await client.from('users').select('*').eq('id', userRow.id).maybeSingle();
    if (!fullUser) throw new NotFoundException('User not found.');
    const current = mapRowToCamel<User>(fullUser as Record<string, unknown>)!;

    if (current.companyId === companyId) {
      await client
        .from('company_invites')
        .update(mapPayloadToSnake({ status: 'accepted', acceptedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
        .eq('id', (invite as { id: string }).id);
      const { passwordHash: _p, bankActivationCodeHash: _h, ...safe } = current;
      return this.buildAuthPayload(safe as User);
    }

    const role = (inviteCamel.role as 'viewer' | 'estimator') || 'viewer';
    const { data: updated, error } = await client
      .from('users')
      .update(
        mapPayloadToSnake({
          companyId,
          branchId,
          role,
          approvalStatus: 'approved',
          isActive: true,
          pendingBankPlan: null,
          bankActivationCodeHash: null,
          bankActivationCodeExpiresAt: null,
        }),
      )
      .eq('id', userRow.id)
      .select('*')
      .single();

    if (error || !updated) {
      this.logger.error('acceptLoggedIn update failed', error);
      throw new BadRequestException('Could not join the company.');
    }

    const user = mapRowToCamel<User>(updated as Record<string, unknown>)!;
    try {
      await this.subscriptionService.syncSubscriptionRowForCompanyMember(user.id);
    } catch (e) {
      this.logger.warn(`syncSubscriptionRowForCompanyMember: ${(e as Error).message}`);
    }

    await client
      .from('company_invites')
      .update(mapPayloadToSnake({ status: 'accepted', acceptedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
      .eq('id', (invite as { id: string }).id);

    const { passwordHash: _p, bankActivationCodeHash: _h, ...safe } = user;
    return this.buildAuthPayload(safe as User);
  }
}
