import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal email service. Sends only when SMTP is configured (SMTP_HOST, SMTP_USER, SMTP_PASS).
 * To enable: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in .env.
 */
@Injectable()
export class MailerService {
  private readonly enabled: boolean;
  private readonly transport: any;

  constructor(private configService: ConfigService) {
    const host = this.configService.get('SMTP_HOST');
    const user = this.configService.get('SMTP_USER');
    const pass = this.configService.get('SMTP_PASS');
    this.enabled = !!(host && user && pass);
    if (this.enabled) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        const host = this.configService.get<string>('SMTP_HOST')!.trim();
        const port = parseInt(this.configService.get('SMTP_PORT') || '587', 10);
        const secure = this.configService.get('SMTP_SECURE') === 'true';
        // PaaS hosts (e.g. Render) often hang on IPv6 to some SMTP providers; IPv4 + longer timeouts fixes "Connection timeout".
        const preferIpv4 = this.configService.get('SMTP_USE_IPV6') !== 'true';
        this.transport = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user, pass },
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
        this.enabled = false;
        this.transport = null;
      }
    } else {
      this.transport = null;
    }
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!this.enabled || !this.transport) return;
    const from = this.configService.get('SMTP_FROM') || this.configService.get('SMTP_USER');
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

  /** Self-service password reset link (single use, expires in 1 hour). Returns false if SMTP is not configured. */
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    if (!this.enabled || !this.transport) {
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
