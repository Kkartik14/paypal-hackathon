import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ContactsModule } from "../contacts/contacts.module";
import { PolicyModule } from "../policy/policy.module";
import { AnalysisController, ScenariosController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";

@Module({
  imports: [AgentModule, ContactsModule, PolicyModule],
  controllers: [AnalysisController, ScenariosController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
