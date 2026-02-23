import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { evaluate } from 'mathjs';

@Injectable()
export class FormulaEvaluationService {
  private readonly logger = new Logger(FormulaEvaluationService.name);

  async evaluate(
    expression: string,
    variables: Record<string, any>,
    context: Record<string, any>,
  ): Promise<number> {
    // Validate formula to prevent injection
    if (!this.isValidFormula(expression)) {
      throw new BadRequestException('Invalid formula expression');
    }

    // Build scope with resolved variables
    const scope = await this.resolveVariables(variables, context);

    try {
      const result = evaluate(expression, scope);
      const numResult = Number(result);
      
      if (isNaN(numResult) || !isFinite(numResult)) {
        throw new BadRequestException('Formula evaluation resulted in invalid number');
      }

      return numResult;
    } catch (error) {
      this.logger.error(`Formula evaluation error: ${error.message}`, error.stack);
      throw new BadRequestException(`Formula evaluation error: ${error.message}`);
    }
  }

  private isValidFormula(expression: string): boolean {
    // Whitelist allowed characters and functions
    // Allow: numbers, basic operators, parentheses, variable names, basic math functions
    const allowedPattern = /^[0-9a-zA-Z_+\-*/()., \s]+$/;
    
    if (!allowedPattern.test(expression)) {
      return false;
    }

    // Block potentially dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/i,
      /function\s*\(/i,
      /require\s*\(/i,
      /import\s+/i,
      /process\./i,
      /global\./i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(expression)) {
        return false;
      }
    }

    return true;
  }

  private async resolveVariables(
    variables: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const scope: Record<string, any> = {};

    for (const [key, varDef] of Object.entries(variables)) {
      const def = varDef as any;

      switch (def.source) {
        case 'geometry':
          // Get from geometry context
          scope[key] = context[def.name] || def.value || 0;
          break;
        case 'rental_config':
          // Get from rental config context
          scope[key] = context[def.name] || def.value || 0;
          break;
        case 'master_data':
          // Get from master data (would need to fetch from DB)
          scope[key] = def.value || 0;
          break;
        case 'user_input':
          scope[key] = def.value || 0;
          break;
        default:
          scope[key] = def.value || 0;
      }
    }

    return scope;
  }
}
