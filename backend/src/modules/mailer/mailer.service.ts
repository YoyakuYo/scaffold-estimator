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
        this.transport = nodemailer.createTransport({
          host: this.configService.get('SMTP_HOST'),
          port: parseInt(this.configService.get('SMTP_PORT') || '587', 10),
          secure: this.configService.get('SMTP_SECURE') === 'true',
          auth: { user, pass },
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
}
