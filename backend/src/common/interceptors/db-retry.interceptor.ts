import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError, timer } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

const MAX_RETRIES = 2; // 2 retries = 3 total attempts
const DELAY_MS = 3500; // Wait for DB to wake (e.g. Render free tier)

function isDbConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message?.toLowerCase() ?? '';
  return (
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('connection terminated due to connection timeout') ||
    msg.includes('connection terminated') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('connect econnrefused') ||
    msg.includes('connection refused')
  );
}

/**
 * Retries the request when a DB connection error occurs (e.g. Render Postgres
 * waking from sleep). Reduces 500s from transient "timeout exceeded when trying to connect".
 */
@Injectable()
export class DbConnectionRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DbConnectionRetryInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return this.tryHandle(next, 0);
  }

  private tryHandle(next: CallHandler, attempt: number): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (!isDbConnectionError(err)) {
          return throwError(() => err);
        }
        if (attempt >= MAX_RETRIES) {
          this.logger.warn(
            `DB connection error after ${attempt + 1} attempt(s), not retrying: ${(err as Error).message}`,
          );
          return throwError(() => err);
        }
        this.logger.log(
          `DB connection error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${DELAY_MS}ms...`,
        );
        return timer(DELAY_MS).pipe(
          switchMap(() => this.tryHandle(next, attempt + 1)),
        );
      }),
    );
  }
}
