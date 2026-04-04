import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Email via SendGrid HTTP API (recommended on PaaS) or SMTP (nodemailer).
 *
 * Password reset / notifications:
 * - Prefer: SENDGRID_API_KEY + SMTP_FROM (HTTPS to api.sendgrid.com, avoids SMTP timeouts on Render).
 * - Or: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
@Injectable()
export class MailerService {
  private readonly sendGridApiKey: string | null;
  private readonly smtpEnabled: boolean;
  private readonly transport: any;

  constructor(private configService: ConfigService) {
    this.sendGridApiKey = this.configService.get<string>('SENDGRID_API_KEY')?.trim() || null;

    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.smtpEnabled = !!(smtpHost && smtpUser && smtpPass);
    this.transport = null;

    if (this.smtpEnabled) {
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

  /** True if we can send (SendGrid API or SMTP). */
  mailConfigured(): boolean {
    const from =
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      this.configService.get<string>('SMTP_USER')?.trim();
    if (this.sendGridApiKey && from) return true;
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

  private async sendWithSendGrid(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!this.sendGridApiKey) throw new Error('SendGrid API key missing');
    const from = this.parseFrom();
    if (!from.email) throw new Error('SMTP_FROM is required for SendGrid');

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.sendGridApiKey}`,
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
    if (this.sendGridApiKey) {
      await this.sendWithSendGrid(to, subject, text, html);
      return;
    }
    if (!this.transport) return;
    const from = this.resolveFromHeader();
    await this.transport.sendMail({ from, to, subject, text, html: html || text });
  }

  async sendApprovalEmail(to: string): Promise<void> {
    const subject = 'Account approved';
    const text = 'Your account has been approved. You can now log in to the platform.';
    await this.send(to, subject, text);
  }

  async sendRejectionEmail(to: string): Promise<void> {
    const subject = 'Account request update';
    const text = 'Your account request was not approved. Please contact support if you have questions.';
    await this.send(to, subject, text);
  }

  async sendNewMessageFromSupportEmail(to: string, preview: string): Promise<void> {
    const subject = 'New message from support';
    const text = `You have a new message from support.\n\nPreview: ${preview.slice(0, 100)}...\n\nLog in to the platform to view and reply.`;
    await this.send(to, subject, text);
  }

  /** Password reset email. Uses SendGrid API when SENDGRID_API_KEY is set; else SMTP. */
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
