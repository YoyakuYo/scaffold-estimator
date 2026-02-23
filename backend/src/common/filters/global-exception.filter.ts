import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Enhanced error logging with more details
    const errorDetails = {
      method: request.method,
      url: request.url,
      status,
      message: typeof message === 'string' ? message : (message as any).message || 'Internal server error',
      errorName: exception instanceof Error ? exception.name : 'Unknown',
      errorMessage: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
      body: request.body ? JSON.stringify(request.body).substring(0, 500) : undefined,
      query: request.query ? JSON.stringify(request.query) : undefined,
    };

    this.logger.error(
      `HTTP ${status} Error on ${request.method} ${request.url}: ${errorDetails.errorMessage}`,
      errorDetails.stack || '',
      JSON.stringify(errorDetails, null, 2),
    );

    // In development, include more error details
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const responseMessage = typeof message === 'string' 
      ? message 
      : (message as any).message || 'Internal server error';

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: responseMessage,
      ...(isDevelopment && exception instanceof Error && {
        error: exception.message,
        stack: exception.stack,
      }),
    });
  }
}
