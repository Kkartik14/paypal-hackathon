import { Injectable, Logger } from "@nestjs/common";
import type {
  Profile,
  Extraction,
  PaymentRequest,
  Scenario,
} from "@scambrake/contracts";
import { ExtractionSchema } from "@scambrake/contracts";
import { ApiException } from "../common/api.exception";
import { AppConfig } from "../config/app.config";
import { ContactsService } from "../contacts/contacts.service";
import {
  normalizeExtraction,
  parseJsonObject,
  type PressureCategory,
} from "./extraction";
import {
  DEFAULT_PROMPT_VERSION,
  EXTRACTION_RESPONSE_SCHEMA,
  buildExtractionPrompt,
  buildToolPhasePrompt,
  getPromptVersion,
  type PromptVersion,
} from "./prompts";

/** Shared by all Groq calls so the route stays inside the 60s serverless limit. */
const ANALYSIS_BUDGET_MS = 50_000;
const TRANSCRIPTION_TIMEOUT_MS = 25_000;
const CHAT_TIMEOUT_MS = 25_000;
const MAX_TOOL_ROUNDS = 4;
const MIN_EXTRACTION_RESERVE_MS = 12_000;

export interface AgentAnalysisInput {
  payment: PaymentRequest;
  profile: Profile;
  transcript?: string;
  audio?: {
    base64: string;
    mimeType: string;
  };
  scenario?: Scenario | null;
  mockExtraction?: Extraction | null;
  /** Internal/eval override. Production uses DEFAULT_PROMPT_VERSION. */
  promptVersionId?: string | null;
}

export interface AgentAnalysisResult {
  provider: "groq" | "mock";
  extraction: Extraction;
  toolCalls: string[];
}

export interface AnalysisProviderClient {
  readonly name: "groq" | "mock";
  analyze(input: AgentAnalysisInput): Promise<{ extraction: Extraction; toolCalls: string[] }>;
}

@Injectable()
export class MockAnalysisProvider implements AnalysisProviderClient {
  readonly name = "mock" as const;

  async analyze(input: AgentAnalysisInput): Promise<{ extraction: Extraction; toolCalls: string[] }> {
    if (input.mockExtraction) {
      return {
        extraction: ExtractionSchema.parse(input.mockExtraction),
        toolCalls: ["get_payment_rules", "get_saved_recipient (saved profile fixture)"],
      };
    }

    const transcript = (input.transcript ?? "").trim();
    if (!transcript) {
      throw new ApiException(
        422,
        "TRANSCRIPT_REQUIRED",
        "The offline analysis engine needs a transcript. Add the words you heard, or configure Groq for audio analysis.",
      );
    }

    return {
      extraction: ExtractionSchema.parse(heuristicExtraction(transcript, input.payment)),
      toolCalls: ["get_payment_rules (saved profile fixture)", "get_saved_recipient (saved profile fixture)"],
    };
  }
}

@Injectable()
export class GroqAnalysisProvider implements AnalysisProviderClient {
  readonly name = "groq" as const;
  private readonly logger = new Logger(GroqAnalysisProvider.name);

  constructor(
    private readonly config: AppConfig,
    private readonly contacts: ContactsService,
  ) {}

  async analyze(input: AgentAnalysisInput): Promise<{ extraction: Extraction; toolCalls: string[] }> {
    if (!this.config.groqApiKey) {
      throw new ApiException(
        503,
        "AI_NOT_CONFIGURED",
        "Groq is selected but GROQ_API_KEY is missing. No PayPal order was created. Configure the key or set AI_PROVIDER=mock for the labelled offline engine.",
      );
    }

    // Keeps the whole analysis inside Vercel's 60-second function limit:
    // Whisper transcription, every tool round, and the extraction share one budget.
    const deadline = Date.now() + ANALYSIS_BUDGET_MS;
    const promptVersion = getPromptVersion(input.promptVersionId ?? DEFAULT_PROMPT_VERSION);

    const transcript = await this.resolveTranscript(input, deadline);
    const toolCalls: string[] = [];
    const toolFindings = await this.runToolPhase(
      input,
      transcript,
      toolCalls,
      deadline,
      promptVersion,
    );
    const extraction = await this.runExtractionPhase(
      input,
      transcript,
      toolFindings,
      deadline,
      promptVersion,
    );

    return { extraction, toolCalls };
  }

  /**
   * Audio is always transcribed by Whisper when present. A caller-supplied
   * transcript is used only when there is no audio, so audio cannot be paired
   * with a different, benign transcript in the same request.
   */
  private async resolveTranscript(input: AgentAnalysisInput, deadline: number): Promise<string> {
    if (input.audio) {
      const transcription = await this.transcribe(input.audio, deadline);
      if (!transcription) {
        throw new ApiException(
          422,
          "AI_TRANSCRIPT_EMPTY",
          "The audio did not contain recognizable speech. No PayPal order was created. Paste the transcript or try a clearer clip.",
        );
      }
      return transcription;
    }

    const transcript = (input.transcript ?? "").trim();
    if (!transcript) {
      throw new ApiException(
        422,
        "TRANSCRIPT_REQUIRED",
        "Provide audio or the words of the request so ScamBrake can review it.",
      );
    }
    return transcript.slice(0, 20_000);
  }

  private async transcribe(
    audio: { base64: string; mimeType: string },
    deadline: number,
  ): Promise<string> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from(audio.base64, "base64")], { type: audio.mimeType }),
      audioFilename(audio.mimeType),
    );
    form.append("model", this.config.groqTranscriptionModel);
    form.append("response_format", "json");
    form.append("temperature", "0");

    const payload = await this.request<{ text?: string }>(
      "/audio/transcriptions",
      { body: form },
      deadline,
      TRANSCRIPTION_TIMEOUT_MS,
      "transcription",
    );

    return typeof payload.text === "string" ? payload.text.trim().slice(0, 20_000) : "";
  }

  private async runToolPhase(
    input: AgentAnalysisInput,
    transcript: string,
    toolCalls: string[],
    deadline: number,
    promptVersion: PromptVersion,
  ): Promise<string[]> {
    const findings: string[] = [];
    const messages: GroqMessage[] = [
      {
        role: "user",
        content: buildToolPhasePrompt(promptVersion, {
          transcript,
          payment: input.payment,
        }),
      },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      // Reserve enough budget for strict extraction after the lookup phase.
      if (round > 0 && deadline - Date.now() < MIN_EXTRACTION_RESERVE_MS) break;

      const choice = await this.chat(
        {
          messages,
          tools: GROQ_TOOL_DECLARATIONS,
          tool_choice: "auto",
          parallel_tool_calls: false,
          temperature: 0.1,
          max_completion_tokens: 1024,
          reasoning_effort: "low",
          include_reasoning: false,
        },
        deadline,
      );

      const message = choice.message;
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) break;

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: calls,
      });

      for (const call of calls) {
        const name = call.function?.name ?? "unknown";
        const args = parseToolArguments(call.function?.arguments);
        toolCalls.push(name);
        const response = this.executeTool(name, args);
        findings.push(`${name}: ${JSON.stringify(response)}`);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(response),
        });
      }
    }

    return findings;
  }

  private async runExtractionPhase(
    input: AgentAnalysisInput,
    transcript: string,
    toolFindings: string[],
    deadline: number,
    promptVersion: PromptVersion,
  ): Promise<Extraction> {
    const prompt = buildExtractionPrompt(promptVersion, {
      transcript,
      payment: input.payment,
      profile: input.profile,
      toolFindings,
    });

    const choice = await this.chat(
      {
        messages: [{ role: "user", content: prompt }],
        temperature: promptVersion.temperature,
        max_completion_tokens: 4096,
        reasoning_effort: "low",
        include_reasoning: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "scambrake_payment_extraction",
            strict: true,
            schema: EXTRACTION_RESPONSE_SCHEMA,
          },
        },
      },
      deadline,
    );

    if (choice.finish_reason === "length") {
      throw new ApiException(
        502,
        "AI_INVALID_RESPONSE",
        "The AI provider's analysis was cut short. No PayPal order was created. Try a shorter clip or paste the transcript.",
      );
    }

    const content = choice.message.content;
    if (!content) {
      throw new ApiException(
        502,
        "AI_INVALID_RESPONSE",
        "The AI provider returned no analysis. No PayPal order was created. Please try again.",
      );
    }

    return normalizeExtraction(parseJsonObject(content), transcript, {
      onInvalid: (message) =>
        this.logger.warn(`Groq returned an extraction that failed validation: ${message}`),
    });
  }

  private async chat(
    body: Record<string, unknown>,
    deadline: number,
  ): Promise<GroqChoice> {
    const payload = await this.request<GroqChatResponse>(
      "/chat/completions",
      { body: { model: this.config.groqModel, ...body } },
      deadline,
      CHAT_TIMEOUT_MS,
      "analysis",
    );

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      throw new ApiException(
        502,
        "AI_INVALID_RESPONSE",
        "The AI provider returned an unreadable response. No PayPal order was created.",
      );
    }
    if (choice.message.refusal || choice.finish_reason === "content_filter") {
      throw new ApiException(
        422,
        "AI_CONTENT_BLOCKED",
        "The AI provider refused to analyze this content. No PayPal order was created.",
      );
    }
    return choice;
  }

  private async request<T>(
    path: string,
    options: { body: FormData | Record<string, unknown> },
    deadline: number,
    timeoutCap: number,
    phase: "transcription" | "analysis",
  ): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining < 1_000) {
      throw new ApiException(
        504,
        "AI_TIMEOUT",
        phase === "transcription"
          ? "Audio transcription exceeded the time budget. No PayPal order was created. Paste the transcript or try a shorter clip."
          : "The AI analysis exceeded its time budget. No PayPal order was created. Please try again.",
      );
    }

    const formBody = options.body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(`${this.config.groqApiBase}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.groqApiKey ?? ""}`,
          ...(formBody ? {} : { "Content-Type": "application/json" }),
        },
        body: formBody ? (options.body as FormData) : JSON.stringify(options.body),
        signal: AbortSignal.timeout(Math.min(remaining, timeoutCap)),
      });
    } catch (error) {
      this.logger.warn(
        `Groq ${phase} request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ApiException(
          504,
          "AI_TIMEOUT",
          phase === "transcription"
            ? "Audio transcription timed out. No PayPal order was created. Paste the transcript or try a shorter clip."
            : "The AI provider timed out. No PayPal order was created. Please try again.",
        );
      }
      throw new ApiException(
        502,
        "AI_PROVIDER_UNAVAILABLE",
        phase === "transcription"
          ? "The audio transcription service could not be reached. No PayPal order was created. Paste the transcript or try again."
          : "The AI provider could not be reached. No PayPal order was created. Please try again.",
      );
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as GroqErrorResponse | null;
      const providerMessage = payload?.error?.message ?? "";
      const providerCode = payload?.error?.code ?? "";
      this.logger.warn(
        `Groq ${phase} HTTP ${response.status}${providerCode ? ` (${providerCode})` : ""}: ${providerMessage.slice(0, 300)}`,
      );

      if (
        response.status === 400 &&
        /content|moderation|policy/i.test(`${providerCode} ${providerMessage}`)
      ) {
        throw new ApiException(
          422,
          "AI_CONTENT_BLOCKED",
          "The AI provider refused to analyze this content. No PayPal order was created.",
        );
      }
      if (response.status === 429) {
        throw new ApiException(
          503,
          "AI_PROVIDER_BUSY",
          "The AI provider is rate-limiting requests. No PayPal order was created. Wait a moment and try again.",
          { providerStatus: response.status, phase },
        );
      }

      throw new ApiException(
        502,
        "AI_PROVIDER_ERROR",
        phase === "transcription"
          ? "The audio could not be transcribed. No PayPal order was created. Paste the transcript or try again."
          : "The AI provider could not analyze this request. No PayPal order was created. Please try again.",
        { providerStatus: response.status, phase },
      );
    }

    const payload = (await response.json().catch(() => null)) as T | null;
    if (!payload) {
      throw new ApiException(
        502,
        "AI_INVALID_RESPONSE",
        "The AI provider returned an unreadable response. No PayPal order was created.",
      );
    }
    return payload;
  }

  private executeTool(name: string, args: Record<string, unknown>): unknown {
    if (name === "get_payment_rules") {
      return {
        profile: this.contacts.getProfile().displayName,
        limits: this.contacts.getProfile().limits,
        rules: this.contacts.getProfile().rules,
        notice: this.contacts.getProfile().fixtureNotice,
      };
    }
    if (name === "get_saved_recipient") {
      const query = typeof args.name === "string" ? args.name : "";
      const match = this.contacts.findRecipient(query, null);
      return match
        ? { found: true, recipient: match, notice: this.contacts.getProfile().fixtureNotice }
        : {
            found: false,
            query,
            savedRecipientNames: this.contacts.listRecipients().map((recipient) => recipient.name),
            notice: this.contacts.getProfile().fixtureNotice,
          };
    }
    return { error: "unknown_tool", message: "This tool is not available." };
  }
}

/* ------------------------------------------------------------------ */
/* Read-only tool declarations                                         */
/* ------------------------------------------------------------------ */

const GROQ_TOOL_DECLARATIONS = [
  {
    type: "function",
    function: {
      name: "get_payment_rules",
      description:
        "Read the fictional user's saved payment limits and rules. Read-only; no payment action.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_saved_recipient",
      description:
        "Look up one recipient in the fictional user's saved recipient list. Read-only; no payment action.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The recipient or organization name to look up.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
] as const;

/* ------------------------------------------------------------------ */
/* Groq wire types and parsing                                         */
/* ------------------------------------------------------------------ */

interface GroqToolCall {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

type GroqMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: GroqToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

interface GroqChoice {
  message: {
    content?: string | null;
    tool_calls?: GroqToolCall[];
    refusal?: string | null;
  };
  finish_reason?: string | null;
}

interface GroqChatResponse {
  choices?: GroqChoice[];
}

interface GroqErrorResponse {
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

function audioFilename(mimeType: string): string {
  switch (mimeType) {
    case "audio/mpeg":
      return "request.mp3";
    case "audio/wav":
      return "request.wav";
    case "audio/webm":
      return "request.webm";
    case "audio/ogg":
      return "request.ogg";
    case "audio/flac":
      return "request.flac";
    default:
      return "request.m4a";
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SPELLED_NUMBER_RUN = new RegExp(
  `\\b((?:${[...Object.keys(NUMBER_WORDS), "hundred", "thousand", "and"].join("|")})(?:[\\s-]+(?:${[
    ...Object.keys(NUMBER_WORDS),
    "hundred",
    "thousand",
    "and",
  ].join("|")}))*)\\s+(?:dollars?|bucks|usd)\\b`,
  "i",
);

/** Reads common spelled-out USD amounts ("nine hundred dollars", "eighteen"). */
function parseSpelledAmount(transcript: string): number | null {
  const match = SPELLED_NUMBER_RUN.exec(transcript);
  if (!match?.[1]) return null;
  const words = match[1].toLowerCase().split(/[\s-]+/).filter(Boolean);

  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const word of words) {
    if (word === "and") continue;
    if (word === "hundred") {
      current = (current || 1) * 100;
      sawNumber = true;
    } else if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      sawNumber = true;
    } else {
      const value = NUMBER_WORDS[word];
      if (value === undefined) return null;
      current += value;
      sawNumber = true;
    }
  }
  if (!sawNumber) return null;
  const amount = total + current;
  return amount > 0 && amount <= 1_000_000 ? amount : null;
}

/* ------------------------------------------------------------------ */
/* Heuristic fallback for the explicitly labelled offline engine       */
/* ------------------------------------------------------------------ */

function heuristicExtraction(transcript: string, payment: PaymentRequest): Extraction {
  const sentences = transcript.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [
    transcript,
  ];

  const amountMatch =
    transcript.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/) ??
    transcript.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i);
  const amount = amountMatch?.[1]
    ? Number(amountMatch[1].replace(/,/g, ""))
    : parseSpelledAmount(transcript);

  const identityMatch = transcript.match(
    /(?:this is|my name is|i am|i'm)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?)(?:\s+(?:from|at|with)\s+([A-Za-z][A-Za-z&.'-]*(?:\s+[A-Za-z&.'-]*){0,4}))?/i,
  );

  const signals: Array<{
    quote: string;
    category: PressureCategory;
    explanation: string;
    startSeconds: number;
  }> = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const matches: Array<{ category: PressureCategory; explanation: string }> = [];
    if (/\b(urgent|immediately|right away|today|now|final warning|last chance)\b/i.test(sentence)) {
      matches.push({ category: "urgency", explanation: "Time pressure pushes the user to act before checking." });
    }
    if (/\b(confidential|don't tell|do not tell|secret|between us|anyone)\b/i.test(sentence)) {
      matches.push({ category: "secrecy", explanation: "Secrecy prevents the user from checking with someone they trust." });
    }
    if (/\b(safe account|protection account|secure account|gift card|wire transfer|crypto|bitcoin)\b/i.test(sentence)) {
      matches.push({ category: "payment_instruction", explanation: "The request redirects money to a new or unusual destination." });
    }
    if (/\b(suspended|blocked|arrest|legal action|police|funds will|account will)\b/i.test(sentence)) {
      matches.push({ category: "threat", explanation: "A threat or loss claim creates fear around the payment." });
    }
    if (/\b(security|fraud|support team|verification)\b/i.test(sentence)) {
      matches.push({ category: "authority", explanation: "The caller leans on a claimed authority or support role." });
    }
    if (/\bnot the number on your card|use the (details|link) i (text|send)\b/i.test(sentence)) {
      matches.push({ category: "inconsistency", explanation: "The caller tells the user to bypass the saved contact channel." });
    }
    for (const match of matches) {
      const key = `${sentence}::${match.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push({ quote: sentence.slice(0, 400), ...match, startSeconds: 0 });
    }
  }

  const claimedIdentity = identityMatch?.[1]?.trim() ?? null;
  const claimedOrganization = identityMatch?.[2]?.trim() ?? null;
  const missingFields: string[] = [];
  if (amount === null) missingFields.push("amount");
  if (!payment.recipientName) missingFields.push("recipient");

  return {
    transcript: transcript.slice(0, 20_000),
    claimedIdentity,
    claimedOrganization,
    requestedAction: `Pay ${payment.recipientName}`,
    requestedRecipientName: payment.recipientName,
    requestedRecipientIdentifier: payment.recipientIdentifier ?? null,
    amount: amount === null ? null : Number.isFinite(amount) ? amount : null,
    currency: amount === null ? "UNKNOWN" : "USD",
    purpose: payment.purpose ?? null,
    pressureSignals: signals.slice(0, 12),
    missingFields,
    confidence: amount === null ? 0.42 : 0.66,
    summary:
      "Offline analysis of pasted text. It looks for amounts, claimed identities, and common pressure phrases. Configure Groq for live audio understanding and richer evidence.",
  };
}
