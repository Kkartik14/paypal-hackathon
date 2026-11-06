import { Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app.config";
import {
  AgentAnalysisInput,
  AgentAnalysisResult,
  GroqAnalysisProvider,
  MockAnalysisProvider,
} from "./analysis-providers";

@Injectable()
export class AgentService {
  constructor(
    private readonly config: AppConfig,
    private readonly groq: GroqAnalysisProvider,
    private readonly mock: MockAnalysisProvider,
  ) {}

  analyze(input: AgentAnalysisInput): Promise<AgentAnalysisResult> {
    const provider = this.config.aiProvider === "groq" ? this.groq : this.mock;
    return provider.analyze(input).then((result) => ({
      provider: provider.name,
      extraction: result.extraction,
      toolCalls: result.toolCalls,
    }));
  }
}
