import { Module } from "@nestjs/common";
import { AnalysisModule } from "./analysis/analysis.module";
import { CommonModule } from "./common/common.module";
import { AppConfigModule } from "./config/app-config.module";
import { HealthController } from "./health/health.controller";
import { McpModule } from "./mcp/mcp.module";
import { PaymentsModule } from "./payments/payments.module";
import { PaypalModule } from "./paypal/paypal.module";

@Module({
  imports: [
    CommonModule,
    AppConfigModule,
    AnalysisModule,
    PaymentsModule,
    PaypalModule,
    McpModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
