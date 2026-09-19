import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllHttpExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();
    const request = ctx.getRequest();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody = {
      statusCode: httpStatus,
      message: this.getErrorMessage(exception),
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
    };

    if (httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logServerError(
        exception,
        httpStatus,
        httpAdapter.getRequestMethod(request),
        httpAdapter.getRequestUrl(request),
      );
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }

  /**
   * Logs every 5xx, including HttpExceptions such as a 503 from a failing
   * dependency. When a service wrapped the original error as the exception's
   * `cause`, the stack logged is the cause's, so the real reason is visible.
   */
  private logServerError(
    exception: unknown,
    status: number,
    method: string,
    url: string,
  ): void {
    const origin =
      exception instanceof HttpException && exception.cause
        ? exception.cause
        : exception;
    // The query string is dropped: it can hold user input such as search terms.
    const path = url.split('?')[0];

    this.logger.error(
      `${method} ${path} -> ${status}: ${
        exception instanceof Error ? exception.message : String(exception)
      }`,
      origin instanceof Error ? origin.stack : undefined,
    );
  }

  private getErrorMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) {
      return 'An unexpected error occurred.';
    }

    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const message = response.message;
      if (typeof message === 'string' || Array.isArray(message)) {
        return message;
      }
    }

    return exception.message;
  }
}
