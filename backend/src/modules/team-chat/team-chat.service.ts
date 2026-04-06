import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapPayloadToSnake, mapRowToCamel } from '../../common/utils/db-mapper';
import { User } from '../auth/user.entity';

export interface TeamChatMessageOut {
  id: string;
  body: string;
  createdAt: string;
  sender: { id: string; email: string; firstName: string | null; lastName: string | null };
}

@Injectable()
export class TeamChatService {
  constructor(private readonly supabase: SupabaseService) {}

  private async getUserOrFail(userId: string): Promise<User> {
    const { data: row, error } = await this.supabase.getClient().from('users').select('*').eq('id', userId).maybeSingle();
    if (error || !row) throw new NotFoundException('User not found');
    const user = mapRowToCamel<User>(row as Record<string, unknown>);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async listMessages(userId: string, limit = 80): Promise<{ messages: TeamChatMessageOut[] }> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin' || !user.companyId) {
      throw new BadRequestException('Team chat is only available for company accounts.');
    }
    const cap = Math.min(200, Math.max(1, limit));
    const client = this.supabase.getClient();
    const { data: rows, error } = await client
      .from('team_chat_messages')
      .select('id, body, created_at, sender_id')
      .eq('company_id', user.companyId)
      .order('created_at', { ascending: false })
      .limit(cap);
    if (error) {
      throw new BadRequestException('Could not load team messages.');
    }
    const list = rows || [];
    const senderIds = [...new Set(list.map((r: { sender_id: string }) => r.sender_id))];
    const senderMap = new Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }>();
    if (senderIds.length) {
      const { data: usersRows } = await client.from('users').select('id, email, first_name, last_name').in('id', senderIds);
      for (const ur of usersRows || []) {
        const u = mapRowToCamel<User>(ur as Record<string, unknown>);
        if (u) {
          senderMap.set(u.id, {
            id: u.id,
            email: u.email,
            firstName: u.firstName ?? null,
            lastName: u.lastName ?? null,
          });
        }
      }
    }
    const messages: TeamChatMessageOut[] = list.map((r: Record<string, unknown>) => {
      const m = mapRowToCamel<{ id: string; body: string; createdAt: string; senderId: string }>(r)!;
      const sender =
        senderMap.get(m.senderId) ||
        ({ id: m.senderId, email: '', firstName: null, lastName: null } as TeamChatMessageOut['sender']);
      return { id: m.id, body: m.body, createdAt: m.createdAt, sender };
    });
    messages.reverse();
    return { messages };
  }

  async sendMessage(userId: string, bodyRaw: string): Promise<TeamChatMessageOut> {
    const user = await this.getUserOrFail(userId);
    if (user.role === 'superadmin' || !user.companyId) {
      throw new BadRequestException('Team chat is only available for company accounts.');
    }
    if (user.approvalStatus !== 'approved' || !user.isActive) {
      throw new ForbiddenException('Account is not active.');
    }
    const body = bodyRaw?.trim() ?? '';
    if (!body.length) throw new BadRequestException('Message body is required.');
    const ins = mapPayloadToSnake({
      companyId: user.companyId,
      senderId: user.id,
      body,
    });
    const { data: saved, error } = await this.supabase
      .getClient()
      .from('team_chat_messages')
      .insert(ins)
      .select('id, body, created_at, sender_id')
      .single();
    if (error || !saved) {
      throw new BadRequestException('Could not send message.');
    }
    const m = mapRowToCamel<{ id: string; body: string; createdAt: string; senderId: string }>(saved as Record<string, unknown>)!;
    const { data: su } = await this.supabase
      .getClient()
      .from('users')
      .select('id, email, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();
    const u = mapRowToCamel<User>(su as Record<string, unknown>);
    const sender = u
      ? { id: u.id, email: u.email, firstName: u.firstName ?? null, lastName: u.lastName ?? null }
      : { id: user.id, email: user.email, firstName: user.firstName ?? null, lastName: user.lastName ?? null };
    return { id: m.id, body: m.body, createdAt: m.createdAt, sender };
  }

  /** Minimal profile for DM header; any approved company member may call for a same-company peer. */
  async getDmPeerProfile(
    userId: string,
    peerId: string,
  ): Promise<{ id: string; email: string; firstName: string | null; lastName: string | null }> {
    if (userId === peerId) {
      throw new BadRequestException('Invalid peer.');
    }
    const me = await this.getUserOrFail(userId);
    const peer = await this.getUserOrFail(peerId);
    await this.assertDmPeers(me, peer);
    return {
      id: peer.id,
      email: peer.email,
      firstName: peer.firstName ?? null,
      lastName: peer.lastName ?? null,
    };
  }

  private async assertDmPeers(me: User, peer: User): Promise<void> {
    if (me.role === 'superadmin' || peer.role === 'superadmin') {
      throw new BadRequestException('Direct messages are only for company accounts.');
    }
    if (!me.companyId || me.companyId !== peer.companyId) {
      throw new ForbiddenException('You can only message users in your company.');
    }
    if (me.approvalStatus !== 'approved' || !me.isActive) {
      throw new ForbiddenException('Account is not active.');
    }
    if (peer.approvalStatus !== 'approved' || !peer.isActive) {
      throw new BadRequestException('That user is not available for messaging.');
    }
  }

  /** 1:1 thread between the current user and peer (same company). */
  async listDmMessages(userId: string, peerId: string, limit = 80): Promise<{ messages: TeamChatMessageOut[] }> {
    if (userId === peerId) {
      throw new BadRequestException('You cannot open a direct message with yourself.');
    }
    const me = await this.getUserOrFail(userId);
    const peer = await this.getUserOrFail(peerId);
    await this.assertDmPeers(me, peer);
    const cap = Math.min(200, Math.max(1, limit));
    const client = this.supabase.getClient();
    const cid = me.companyId!;
    const [out1, out2] = await Promise.all([
      client
        .from('team_dm_messages')
        .select('id, body, created_at, sender_id')
        .eq('company_id', cid)
        .eq('sender_id', userId)
        .eq('recipient_id', peerId)
        .order('created_at', { ascending: false })
        .limit(cap),
      client
        .from('team_dm_messages')
        .select('id, body, created_at, sender_id')
        .eq('company_id', cid)
        .eq('sender_id', peerId)
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(cap),
    ]);
    const raw = [...(out1.data || []), ...(out2.data || [])];
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of raw) {
      const id = (r as { id: string }).id;
      if (!byId.has(id)) byId.set(id, r as Record<string, unknown>);
    }
    const merged = Array.from(byId.values()).sort(
      (a, b) =>
        new Date((a as { created_at: string }).created_at).getTime() -
        new Date((b as { created_at: string }).created_at).getTime(),
    );
    const sliced = merged.slice(-cap);
    const senderIds = [...new Set(sliced.map((r) => (r as { sender_id: string }).sender_id))];
    const senderMap = new Map<string, TeamChatMessageOut['sender']>();
    if (senderIds.length) {
      const { data: usersRows } = await client.from('users').select('id, email, first_name, last_name').in('id', senderIds);
      for (const ur of usersRows || []) {
        const u = mapRowToCamel<User>(ur as Record<string, unknown>);
        if (u) {
          senderMap.set(u.id, {
            id: u.id,
            email: u.email,
            firstName: u.firstName ?? null,
            lastName: u.lastName ?? null,
          });
        }
      }
    }
    const messages: TeamChatMessageOut[] = sliced.map((r) => {
      const row = mapRowToCamel<{ id: string; body: string; createdAt: string; senderId: string }>(r)!;
      const sender =
        senderMap.get(row.senderId) ||
        ({ id: row.senderId, email: '', firstName: null, lastName: null } as TeamChatMessageOut['sender']);
      return { id: row.id, body: row.body, createdAt: row.createdAt, sender };
    });
    return { messages };
  }

  async sendDmMessage(userId: string, peerId: string, bodyRaw: string): Promise<TeamChatMessageOut> {
    if (userId === peerId) {
      throw new BadRequestException('You cannot message yourself.');
    }
    const me = await this.getUserOrFail(userId);
    const peer = await this.getUserOrFail(peerId);
    await this.assertDmPeers(me, peer);
    const body = bodyRaw?.trim() ?? '';
    if (!body.length) throw new BadRequestException('Message body is required.');
    const ins = mapPayloadToSnake({
      companyId: me.companyId,
      senderId: me.id,
      recipientId: peer.id,
      body,
    });
    const { data: saved, error } = await this.supabase
      .getClient()
      .from('team_dm_messages')
      .insert(ins)
      .select('id, body, created_at, sender_id')
      .single();
    if (error || !saved) {
      throw new BadRequestException('Could not send message.');
    }
    const m = mapRowToCamel<{ id: string; body: string; createdAt: string; senderId: string }>(saved as Record<string, unknown>)!;
    const sender = {
      id: me.id,
      email: me.email,
      firstName: me.firstName ?? null,
      lastName: me.lastName ?? null,
    };
    return { id: m.id, body: m.body, createdAt: m.createdAt, sender };
  }
}
