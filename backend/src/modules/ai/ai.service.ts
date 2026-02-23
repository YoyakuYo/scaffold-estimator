import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openai: OpenAI;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set — AI features will be unavailable');
      this.logger.warn('Please set OPENAI_API_KEY in your .env file in the backend directory');
    } else {
      // Log first 10 chars and last 4 chars for debugging (without exposing full key)
      const maskedKey = apiKey.length > 14 
        ? `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`
        : '***';
      this.logger.log(`OpenAI API key found: ${maskedKey}`);
    }
    this.openai = new OpenAI({
      apiKey: apiKey || 'not-set',
    });
    
    // Get model from env, default to gpt-4o-mini (cheaper alternative)
    // Available models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo, etc.
    this.model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    this.logger.log(`Using OpenAI model: ${this.model}`);
    this.logger.log(`To change model, set OPENAI_MODEL in .env (e.g., OPENAI_MODEL=gpt-4o)`);
  }

  get client(): OpenAI {
    return this.openai;
  }

  getModel(): string {
    return this.model;
  }

  isAvailable(): boolean {
    const key = this.configService.get<string>('OPENAI_API_KEY');
    return !!key && key !== 'not-set';
  }
}
