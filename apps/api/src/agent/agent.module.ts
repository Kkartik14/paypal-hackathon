import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { AgentService } from "./agent.service";
import { GeminiAnalysisProvider, MockAnalysisProvider } from "./analysis-providers";

@Module({
  imports: [ContactsModule],
  providers: [AgentService, GeminiAnalysisProvider, MockAnalysisProvider],
  exports: [AgentService],
})
export class AgentModule {}
