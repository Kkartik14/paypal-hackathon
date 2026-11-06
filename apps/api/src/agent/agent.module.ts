import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { AgentService } from "./agent.service";
import { GroqAnalysisProvider, MockAnalysisProvider } from "./analysis-providers";

@Module({
  imports: [ContactsModule],
  providers: [AgentService, GroqAnalysisProvider, MockAnalysisProvider],
  exports: [AgentService],
})
export class AgentModule {}
