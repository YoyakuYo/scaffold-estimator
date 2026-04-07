import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Email via Brevo HTTP API, SendGrid HTTP API, or SMTP (nodemailer).
 *
 * Password reset / notifications:
 * - Prefer: BREVO_API_KEY + SMTP_FROM (HTTPS to api.brevo.com).
 * - Or: SENDGRID_API_KEY + SMTP_FROM (HTTPS to api.sendgrid.com).
 * - Or SMTP (e.g. Brevo relay — same env names Brevo shows in their UI):
 *     SMTP_HOST=smtp-relay.brevo.com
 *     SMTP_PORT=587
 *     SMTP_USER=<Brevo SMTP login>
 *     SMTP_PASS=<Brevo SMTP key>
 *     Optional: SMTP_FROM="Name <verified@domain.com>" (else From falls back to SMTP_USER)
 *     Port 587: leave SMTP_SECURE unset or false (STARTTLS).
 *
 * When BREVO_API_KEY or SENDGRID_API_KEY is set, SMTP transport is not created — avoids
 * Render/cloud SMTP timeouts when you intended to use HTTPS APIs.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private readonly smtpEnabled: boolean;
  private readonly transport: any;

  constructor(private configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.smtpEnabled = !!(smtpHost && smtpUser && smtpPass);
    this.transport = null;

    const skipSmtpBecauseApi =
      !!this.getBrevoApiKey() || !!this.getSendGridApiKey();

    if (this.smtpEnabled && !skipSmtpBecauseApi) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        const host = smtpHost!.trim();
        const port = parseInt(this.configService.get('SMTP_PORT') || '587', 10);
        const secure = this.configService.get('SMTP_SECURE') === 'true';
        const preferIpv4 = this.configService.get('SMTP_USE_IPV6') !== 'true';
        this.transport = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user: smtpUser, pass: smtpPass },
          connectionTimeout: 90_000,
          greetingTimeout: 45_000,
          socketTimeout: 90_000,
          tls: {
            minVersion: 'TLSv1.2',
            servername: host,
          },
          ...(preferIpv4 ? { family: 4 as const } : {}),
        });
      } catch {
        this.transport = null;
      }
    }
  }

  onModuleInit(): void {
    const from =
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      this.configService.get<string>('SMTP_USER')?.trim();
    if (this.getBrevoApiKey() && from) {
      this.logger.log('Email delivery: Brevo HTTPS API (api.brevo.com). SMTP transport skipped.');
      return;
    }
    if (this.getSendGridApiKey() && from) {
      this.logger.log('Email delivery: SendGrid HTTPS API. SMTP transport skipped.');
      return;
    }
    if (this.transport) {
      const host = this.configService.get<string>('SMTP_HOST')?.trim() || '(unknown host)';
      this.logger.warn(
        `Email delivery: SMTP to ${host}. If this times out on your host, set BREVO_API_KEY + SMTP_FROM instead.`,
      );
      return;
    }
    this.logger.warn(
      'Email delivery: not configured (need BREVO_API_KEY or SENDGRID_API_KEY + SMTP_FROM, or SMTP_HOST+SMTP_USER+SMTP_PASS).',
    );
  }

  /**
   * Read on demand so runtime env (e.g. PaaS inject) matches send().
   * Also accepts legacy SENDINBLUE_API_KEY.
   */
  private getBrevoApiKey(): string | null {
    const k =
      this.configService.get<string>('BREVO_API_KEY')?.trim() ||
      this.configService.get<string>('SENDINBLUE_API_KEY')?.trim();
    return k || null;
  }

  private getSendGridApiKey(): string | null {
    const k = this.configService.get<string>('SENDGRID_API_KEY')?.trim();
    return k || null;
  }

  /** True if we can send (Brevo / SendGrid API or SMTP). */
  mailConfigured(): boolean {
    const from =
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      this.configService.get<string>('SMTP_USER')?.trim();
    if (this.getBrevoApiKey() && from) return true;
    if (this.getSendGridApiKey() && from) return true;
    return this.smtpEnabled && !!this.transport;
  }

  private resolveFromHeader(): string {
    return (
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      this.configService.get<string>('SMTP_USER')?.trim() ||
      ''
    );
  }

  private parseFrom(): { email: string; name?: string } {
    const raw = this.resolveFromHeader();
    const m = raw.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
    return { email: raw.trim() };
  }

  private async sendWithBrevo(to: string, subject: string, text: string, html?: string): Promise<void> {
    const apiKey = this.getBrevoApiKey();
    if (!apiKey) throw new Error('Brevo API key missing');
    const from = this.parseFrom();
    if (!from.email) throw new Error('SMTP_FROM is required for Brevo');

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: from.name ? { email: from.email, name: from.name } : { email: from.email },
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brevo API ${res.status}: ${body.slice(0, 800)}`);
    }
  }

  private async sendWithSendGrid(to: string, subject: string, text: string, html?: string): Promise<void> {
    const apiKey = this.getSendGridApiKey();
    if (!apiKey) throw new Error('SendGrid API key missing');
    const from = this.parseFrom();
    if (!from.email) throw new Error('SMTP_FROM is required for SendGrid');

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        subject,
        content: [
          { type: 'text/plain', value: text },
          ...(html ? [{ type: 'text/html', value: html }] : []),
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SendGrid API ${res.status}: ${body.slice(0, 800)}`);
    }
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!this.mailConfigured()) return;
    if (this.getBrevoApiKey()) {
      await this.sendWithBrevo(to, subject, text, html);
      return;
    }
    if (this.getSendGridApiKey()) {
      await this.sendWithSendGrid(to, subject, text, html);
      return;
    }
    if (!this.transport) return;
    const from = this.resolveFromHeader();
    const smtpHost = this.configService.get<string>('SMTP_HOST')?.trim() || '';
    try {
      await this.transport.sendMail({ from, to, subject, text, html: html || text });
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      const isTimeout = /timeout|ETIMEDOUT|ECONNRESET|Connection timeout/i.test(msg);
      const brevoSmtp = /brevo|sendinblue/i.test(smtpHost);
      if (isTimeout && brevoSmtp) {
        throw new Error(
          `${msg} — Outbound SMTP to Brevo is often blocked or times out on cloud hosts (e.g. Render). ` +
            'Set BREVO_API_KEY (Brevo → Transactional → API keys) and SMTP_FROM to send over HTTPS instead of smtp-relay.brevo.com.',
        );
      }
      if (isTimeout) {
        throw new Error(
          `${msg} — SMTP frequently times out from PaaS. Prefer BREVO_API_KEY, SENDGRID_API_KEY, or another HTTPS email API instead of raw SMTP.`,
        );
      }
      throw e;
    }
  }

  async sendApprovalEmail(to: string): Promise<void> {
    const subject = 'Account approved';
    const text = 'Your account has been approved. You can now log in to the platform.';
    await this.send(to, subject, text);
  }

  async sendTeamInviteEmail(
    to: string,
    joinUrl: string,
    companyName: string,
    branchName: string,
    role: string,
  ): Promise<void> {
    const subject = `You're invited to join ${companyName}`;
    const branchLine = branchName ? `Branch: ${branchName}\n` : '';
    const text = [
      `You have been invited to join ${companyName} on the scaffold estimation platform.`,
      branchLine,
      `Role: ${role}`,
      '',
      'Open this link to create your account or sign in and accept:',
      joinUrl,
      '',
      'If you did not expect this email, you can ignore it.',
    ]
      .filter(Boolean)
      .join('\n');
    const html = `<p>You have been invited to join <strong>${escapeHtml(companyName)}</strong>.</p>
${branchName ? `<p>Branch: <strong>${escapeHtml(branchName)}</strong></p>` : ''}
<p>Role: <strong>${escapeHtml(role)}</strong></p>
<p><a href="${escapeHtml(joinUrl)}">Accept invitation</a></p>
<p style="color:#666;font-size:12px;">If the button does not work, copy this URL:<br/>${escapeHtml(joinUrl)}</p>`;
    await this.send(to, subject, text, html);
  }

  /** Bank transfer: plaintext code emailed once; not returned in approve API response. */
  async sendBankTransferActivationEmail(
    to: string,
    code: string,
    planTier: string,
    activateUrl: string,
  ): Promise<void> {
    const subject = 'Your subscription activation code';
    const text = [
      'Your account is approved.',
      `Selected plan: ${planTier}.`,
      'Enter this activation code in the app to unlock your subscription:',
      '',
      code,
      '',
      `Activation page: ${activateUrl}`,
      '',
      'If you did not register or pay by bank transfer, you can ignore this email.',
    ].join('\n');
    await this.send(to, subject, text);
  }

  async sendRejectionEmail(to: string): Promise<void> {
    const subject = 'Account request not approved';
    const text = [
      'Your signup request was not approved, and the account we created for your registration has been removed from our system.',
      '',
      'You will not be able to log in with this registration. If you believe this was a mistake, contact support.',
    ].join('\n');
    await this.send(to, subject, text);
  }

  async sendNewMessageFromSupportEmail(to: string, preview: string): Promise<void> {
    const subject = 'New message from support';
    const text = `You have a new message from support.\n\nPreview: ${preview.slice(0, 100)}...\n\nLog in to the platform to view and reply.`;
    await this.send(to, subject, text);
  }

  /** Password reset email. Uses Brevo or SendGrid API when configured; else SMTP. */
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    if (!this.mailConfigured()) {
      return false;
    }
    const subject = 'Password reset — 仮設材積算システム / Scaffold estimator';
    const text = [
      'パスワード再設定のリクエストを受け付けました。',
      '次のリンクから新しいパスワードを設定してください（1時間有効・1回限り）:',
      resetUrl,
      '',
      'We received a request to reset your password.',
      'Open this link to choose a new password (valid for 1 hour, one-time use):',
      resetUrl,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n');
    const html = `
      <p>パスワード再設定のリクエストを受け付けました。</p>
      <p><a href="${resetUrl}">パスワードを再設定する</a>（1時間有効・1回限り）</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <p>We received a request to reset your password.</p>
      <p><a href="${resetUrl}">Set a new password</a> (valid for 1 hour, one-time use).</p>
      <p style="color:#666;font-size:12px">If you did not request this, ignore this email.</p>
    `;
    await this.send(to, subject, text, html);
    return true;
  }
}
