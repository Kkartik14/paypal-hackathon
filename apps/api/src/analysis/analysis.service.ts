import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AnalysisResult,
  AnalyzeRequest,
  CheckoutSummary,
  PaymentRequest,
  Scenario,
} from "@scambrake/contracts";
import { DISCLAIMERS } from "@scambrake/contracts";
import { AgentService } from "../agent/agent.service";
import { ApiException } from "../common/api.exception";
import { ContactsService } from "../contacts/contacts.service";
import { MOCK_SCENARIO_EXTRACTIONS } from "../demo/demo-data";
import { PolicyService } from "../policy/policy.service";
import { TicketService } from "../policy/ticket.service";

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES: Record<string, string> = {
  "audio/mp4": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/webm": "audio/webm",
  "audio/ogg": "audio/ogg",
  "audio/flac": "audio/flac",
};

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly agent: AgentService,
    private readonly contacts: ContactsService,
    private readonly policy: PolicyService,
    private readonly tickets: TicketService,
  ) {}

  async analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    const startedAt = Date.now();
    const scenario = this.resolveScenario(request);
    const transcript = request.transcript?.trim() || scenario?.transcript || undefined;
    const audio = decodeAudio(request.audioBase64, request.audioMimeType);

    if (!transcript && !audio) {
      throw new ApiException(
        400,
        "MISSING_REQUEST_CONTENT",
        "Provide audio or a transcript so ScamBrake can review the request.",
      );
    }

    const inputDuration = Date.now() - startedAt;
    const fixtureExtraction =
      scenario && (!request.transcript?.trim() || request.transcript.trim() === scenario.transcript)
        ? MOCK_SCENARIO_EXTRACTIONS[scenario.id] ?? null
        : null;

    const agentStarted = Date.now();
    const analysis = await this.agent.analyze({
      payment: request.payment,
      profile: this.contacts.getProfile(),
      transcript,
      audio,
      scenario,
      mockExtraction: fixtureExtraction,
    });
    const agentDuration = Date.now() - agentStarted;

    const policyStarted = Date.now();
    const outcome = this.policy.evaluate({
      extraction: analysis.extraction,
      payment: request.payment,
      profile: this.contacts.getProfile(),
    });
    const policyDuration = Date.now() - policyStarted;

    const checkout = this.checkoutSummary(request.payment, outcome.decision);
    const analysisId = `an_${randomUUID().replace(/-/g, "")}`;
    let ticket: string | null = null;
    let ticketExpiresAt: string | null = null;
    const steps = [
      step("input", "Validated the request without retaining audio", inputDuration),
      step("agent", "Read the call and checked saved records", agentDuration),
      step("policy", "Applied deterministic payment rules", policyDuration),
    ];

    if (checkout.available) {
      const ticketStarted = Date.now();
      const bound = this.tickets.issue({
        analysisId,
        profileId: this.contacts.getProfile().id,
        recipientName: request.payment.recipientName,
        recipientIdentifier: request.payment.recipientIdentifier ?? null,
        amount: request.payment.amount,
        currency: request.payment.currency,
        purpose: request.payment.purpose ?? null,
        merchantName: this.contacts.getMerchant().name,
        merchantIdentifier: this.contacts.getMerchant().identifier,
      });
      ticket = bound.ticket;
      ticketExpiresAt = bound.expiresAt.toISOString();
      steps.push(step("ticket", "Issued a short-lived decision ticket", Date.now() - ticketStarted));
    }

    const result = this.buildResult({
      analysisId,
      request,
      scenario,
      analysis,
      outcome,
      checkout,
      ticket,
      ticketExpiresAt,
      steps,
    });
    this.logResult(result);
    return result;
  }

  private resolveScenario(request: AnalyzeRequest): Scenario | null {
    if (request.mode !== "scenario") return null;
    const id = request.scenarioId ?? "";
    const scenario = this.contacts.getScenario(id);
    if (!scenario) {
      throw new ApiException(404, "SCENARIO_NOT_FOUND", "That demo scenario does not exist.");
    }
    return scenario;
  }

  private checkoutSummary(payment: PaymentRequest, decision: string): CheckoutSummary {
    const merchant = this.contacts.getMerchant();
    const isMerchant = this.contacts.isDemoMerchant(
      payment.recipientName,
      payment.recipientIdentifier,
    );
    const amountMatches = Math.abs(payment.amount - merchant.amount) < 0.005;

    let reason: string | null = null;
    if (decision !== "ALLOW") {
      reason = "No checkout: the policy did not allow this request, so no PayPal order was created.";
    } else if (!isMerchant) {
      reason = `This demo checkout only pays the saved ScamBrake Sandbox merchant, ${merchant.name}.`;
    } else if (!amountMatches) {
      reason = `The demo checkout is fixed at $${merchant.amount.toFixed(2)} USD.`;
    }

    return {
      available: decision === "ALLOW" && isMerchant && amountMatches,
      reason,
      merchantName: merchant.name,
      merchantIdentifier: merchant.identifier,
      amount: payment.amount,
      currency: payment.currency,
      sandbox: true,
    };
  }

  private buildResult(input: {
    analysisId: string;
    request: AnalyzeRequest;
    scenario: Scenario | null;
    analysis: Awaited<ReturnType<AgentService["analyze"]>>;
    outcome: ReturnType<PolicyService["evaluate"]>;
    checkout: CheckoutSummary;
    ticket: string | null;
    ticketExpiresAt: string | null;
    steps: AnalysisResult["steps"];
  }): AnalysisResult {
    return {
      analysisId: input.analysisId,
      createdAt: new Date().toISOString(),
      mode: input.request.mode,
      scenarioId: input.scenario?.id ?? null,
      provider: input.analysis.provider,
      payment: input.request.payment,
      extraction: input.analysis.extraction,
      profileMatch: input.outcome.matchedRecipient
        ? {
            id: input.outcome.matchedRecipient.id,
            name: input.outcome.matchedRecipient.name,
            identifier: input.outcome.matchedRecipient.identifier,
            type: input.outcome.matchedRecipient.type,
          }
        : null,
      decision: input.outcome.decision,
      reasons: input.outcome.reasons,
      checks: input.outcome.checks,
      steps: input.steps,
      ticket: input.ticket,
      ticketExpiresAt: input.ticketExpiresAt,
      checkout: input.checkout,
      disclaimers: [...DISCLAIMERS],
    };
  }

  private logResult(result: AnalysisResult): void {
    // Deliberately excludes transcript, contact data, and audio.
    this.logger.log(
      `analysis ${result.analysisId} provider=${result.provider} decision=${result.decision} ` +
        `checkout=${result.checkout.available} steps=${result.steps.map((item) => `${item.key}:${item.durationMs}ms`).join(",")}`,
    );
  }
}

function step(key: string, label: string, durationMs: number): { key: string; label: string; durationMs: number } {
  return { key, label, durationMs: Math.max(0, Math.round(durationMs)) };
}

function decodeAudio(
  base64: string | undefined,
  mimeType: string | undefined,
): { base64: string; mimeType: string } | undefined {
  if (!base64) return undefined;

  const withoutPrefix = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const clean = withoutPrefix.replace(/\s/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    throw new ApiException(400, "INVALID_AUDIO", "The audio payload is not valid base64.");
  }

  const buffer = Buffer.from(clean, "base64");
  if (buffer.length === 0) {
    throw new ApiException(400, "INVALID_AUDIO", "The audio file is empty.");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new ApiException(
      413,
      "AUDIO_TOO_LARGE",
      "Audio must be 3 MB or smaller. Use a shorter clip or paste the transcript.",
    );
  }

  const originalMime = (mimeType ?? "audio/mp4").trim().toLowerCase().split(";")[0] ?? "audio/mp4";
  const normalizedMime = SUPPORTED_AUDIO_TYPES[originalMime];
  if (!normalizedMime) {
    throw new ApiException(
      415,
      "UNSUPPORTED_AUDIO_TYPE",
      "Unsupported audio type. Use m4a/mp4, mp3, wav, webm, ogg, or flac.",
    );
  }

  return { base64: buffer.toString("base64"), mimeType: normalizedMime };
}
