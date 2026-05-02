import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message =
        typeof errorResponse === 'string'
          ? errorResponse
          : (errorResponse as { message: string | string[] }).message ||
            exception.message;
    }

    if (status >= 500) {
      Sentry.captureException(exception);
    } else if (status >= 400) {
      // Capture 4xx errors from the payment/transaction flow so unexpected client
      // errors (expired quotes, session not found mid-flow) are visible in Sentry.
      const request = ctx.getRequest<{ url?: string; method?: string }>();
      const url = request?.url ?? '';
      if (
        url.includes('/transactions') ||
        url.includes('/payment-sessions') ||
        url.includes('/quotes')
      ) {
        Sentry.captureException(exception, {
          tags: { statusCode: status, url },
          level: 'warning',
        });
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
