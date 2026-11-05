import { Controller, Get, Header } from "@nestjs/common";
import type { HealthResponse } from "@scambrake/contracts";
import { AppConfig } from "../config/app.config";
import { PaypalService } from "../paypal/paypal.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly config: AppConfig,
    private readonly paypal: PaypalService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  health(): HealthResponse {
    const checks = {
      paypalConfigured: this.paypal.configured,
      paypalEnvironment: "sandbox" as const,
      aiProvider: this.config.aiProvider,
      aiConfigured: this.config.aiConfigured,
      ticketSecretConfigured: this.config.ticketSecretConfigured,
      webOriginConfigured: Boolean(process.env.WEB_ORIGIN),
    };
    return {
      status:
        checks.paypalConfigured && checks.aiConfigured && checks.ticketSecretConfigured
          ? "ok"
          : "degraded",
      service: "scambrake-api",
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
