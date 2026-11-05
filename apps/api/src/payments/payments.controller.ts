import { Body, Controller, Get, Header, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CaptureOrderRequestSchema, CreateOrderRequestSchema } from "@scambrake/contracts";
import { ApiException } from "../common/api.exception";
import { clientKey, RateLimitService } from "../common/rate-limit.service";
import { parseWith } from "../common/validate";
import { PaymentsService } from "./payments.service";

@Controller("v1/orders")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  create(@Body() body: unknown, @Req() request: Request) {
    this.guard(request, "orders:create", 20);
    const input = parseWith(CreateOrderRequestSchema, body);
    return this.payments.createOrder(input.ticket);
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string, @Req() request: Request) {
    this.guard(request, "orders:get", 60);
    return this.payments.getOrder(id);
  }

  @Post(":id/capture")
  @Header("Cache-Control", "no-store")
  capture(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) {
    this.guard(request, "orders:capture", 20);
    const input = parseWith(CaptureOrderRequestSchema, body);
    return this.payments.captureOrder(id, input.ticket);
  }

  private guard(request: Request, scope: string, limit: number): void {
    if (!this.rateLimit.consume(`${scope}:${clientKey(request)}`, limit, 10 * 60 * 1000)) {
      throw new ApiException(429, "RATE_LIMITED", "Too many payment requests. Wait a few minutes and try again.");
    }
  }
}
