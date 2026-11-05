import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module";
import { ContactsModule } from "../contacts/contacts.module";
import { PaymentsModule } from "../payments/payments.module";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

@Module({
  imports: [AnalysisModule, ContactsModule, PaymentsModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
