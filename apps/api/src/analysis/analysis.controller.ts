import { Body, Controller, Get, Header, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AnalyzeRequestSchema } from "@scambrake/contracts";
import { ApiException } from "../common/api.exception";
import { clientKey, RateLimitService } from "../common/rate-limit.service";
import { parseWith } from "../common/validate";
import { AppConfig } from "../config/app.config";
import { ContactsService } from "../contacts/contacts.service";
import { AnalysisService } from "./analysis.service";

@Controller("v1/analysis")
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: Request) {
    if (!this.rateLimit.consume(`analysis:${clientKey(request)}`, 30, 10 * 60 * 1000)) {
      throw new ApiException(
        429,
        "RATE_LIMITED",
        "Too many review requests from this connection. Wait a few minutes and try again.",
      );
    }
    const input = parseWith(AnalyzeRequestSchema, body);
    return this.analysis.analyze(input);
  }
}

@Controller("v1/demo")
export class DemoController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly config: AppConfig,
  ) {}

  @Get("scenarios")
  @Header("Cache-Control", "no-store")
  scenarios() {
    return {
      profile: this.contacts.getProfile(),
      merchant: this.contacts.getMerchant(),
      scenarios: this.contacts.listScenarios(),
      provider: this.config.aiProvider,
      paypal: {
        environment: "sandbox" as const,
        configured: this.config.paypalConfigured,
      },
      demoNotice:
        "Every person, organization, bank, merchant, and payment record in this demo is fictional. The PayPal Sandbox checkout pays the ScamBrake demo merchant, not the suspicious caller.",
    };
  }
}
