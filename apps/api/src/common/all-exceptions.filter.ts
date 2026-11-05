import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { ApiException } from "./api.exception";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof ApiException) {
      this.write(response, exception.getStatus(), exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof ZodError) {
      this.write(response, HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Request validation failed.", {
        issues: exception.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === "string"
          ? raw
          : typeof raw === "object" && raw !== null && "message" in raw
            ? String((raw as { message: unknown }).message)
            : exception.message;
      this.write(response, status, status === 404 ? "NOT_FOUND" : "REQUEST_FAILED", message);
      return;
    }

    this.logger.error(
      `Unhandled error on ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    this.write(
      response,
      HttpStatus.INTERNAL_SERVER_ERROR,
      "INTERNAL_ERROR",
      "Something went wrong on the server. No payment was created.",
    );
  }

  private write(
    response: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    if (response.headersSent) return;
    response.status(status).json({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    });
  }
}
