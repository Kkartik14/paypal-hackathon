import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ContactsService } from "../contacts/contacts.service";
import { parseJsonObject } from "../agent/extraction";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  buildExtractionPrompt,
  promptHash,
  type PromptVersion,
} from "../agent/prompts";
import type { EvalCase, ModelResponse, ModelUsage } from "./types";

export interface EvalModelClient {
  readonly name: "replay" | "live" | "stub";
  readonly model: string;
  extract(input: { evalCase: EvalCase; version: PromptVersion }): Promise<ModelResponse>;
}

/** A setup problem (missing cache, prompt drift), not a model result. */
export class EvalSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalSetupError";
  }
}

/** A provider failure for one case. The runner records it and continues. */
export class EvalProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EvalProviderError";
  }
}

const CacheEntrySchema = z.object({
  promptVersion: z.string(),
  promptHash: z.string(),
  model: z.string(),
  caseId: z.string(),
  recordedAt: z.string().datetime(),
  latencyMs: z.number().nonnegative(),
  usage: z
    .object({
      promptTokens: z.number().nonnegative(),
      completionTokens: z.number().nonnegative(),
      totalTokens: z.number().nonnegative(),
    })
    .nullable(),
  raw: z.record(z.string(), z.unknown()),
});
type CacheEntry = z.infer<typeof CacheEntrySchema>;

export function modelSlug(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function cacheFilePath(
  cacheDir: string,
  versionId: string,
  model: string,
  caseId: string,
): string {
  return path.join(cacheDir, versionId, modelSlug(model), `${caseId}.json`);
}

/** Replays committed model outputs. Default mode; no credentials needed. */
export class ReplayModelClient implements EvalModelClient {
  readonly name = "replay" as const;

  constructor(
    private readonly options: {
      cacheDir: string;
      model: string;
    },
  ) {}

  get model(): string {
    return this.options.model;
  }

  async extract(input: { evalCase: EvalCase; version: PromptVersion }): Promise<ModelResponse> {
    const file = cacheFilePath(
      this.options.cacheDir,
      input.version.id,
      this.options.model,
      input.evalCase.id,
    );

    let rawEntry: unknown;
    try {
      rawEntry = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new EvalSetupError(
          `No cached response for case “${input.evalCase.id}” at ${file}. Run \`pnpm eval:live\` with GROQ_API_KEY to record it, or check GROQ_MODEL.`,
        );
      }
      throw new EvalSetupError(
        `Could not read cached response at ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = CacheEntrySchema.safeParse(rawEntry);
    if (!parsed.success) {
      throw new EvalSetupError(`Invalid cache entry at ${file}: ${parsed.error.message}`);
    }
    const entry: CacheEntry = parsed.data;

    if (entry.promptVersion !== input.version.id) {
      throw new EvalSetupError(
        `Cache entry at ${file} is for prompt version “${entry.promptVersion}”, not “${input.version.id}”.`,
      );
    }
    if (entry.model !== this.options.model) {
      throw new EvalSetupError(
        `Cache entry at ${file} was recorded with model “${entry.model}”, not “${this.options.model}”.`,
      );
    }
    if (entry.caseId !== input.evalCase.id) {
      throw new EvalSetupError(
        `Cache entry at ${file} is for case “${entry.caseId}”, not “${input.evalCase.id}”.`,
      );
    }

    const expectedHash = promptHash(input.version);
    if (entry.promptHash !== expectedHash) {
      throw new EvalSetupError(
        `Cached response for “${input.evalCase.id}” was recorded with a different prompt (hash ${entry.promptHash.slice(0, 12)}…, expected ${expectedHash.slice(0, 12)}…). Re-record with \`pnpm eval:live\`.`,
      );
    }

    return {
      raw: entry.raw,
      latencyMs: entry.latencyMs,
      usage: entry.usage,
      model: entry.model,
      recordedAt: entry.recordedAt,
    };
  }
}

interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: GroqUsage;
}

/** Calls the production extraction prompt against Groq and records the raw output. */
export class LiveGroqModelClient implements EvalModelClient {
  readonly name = "live" as const;
  private readonly profile = new ContactsService().getProfile();

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      apiBase: string;
      cacheDir: string | null;
      timeoutMs?: number;
      maxRetries?: number;
    },
  ) {}

  get model(): string {
    return this.options.model;
  }

  async extract(input: { evalCase: EvalCase; version: PromptVersion }): Promise<ModelResponse> {
    const prompt = buildExtractionPrompt(input.version, {
      transcript: input.evalCase.transcript,
      payment: input.evalCase.payment,
      profile: this.profile,
      // The eval isolates the extraction phase. The profile rules and saved
      // recipients are already included in the prompt; the live tool round is
      // covered separately by provider tests.
      toolFindings: [],
    });

    const { payload, latencyMs } = await this.request({
      model: this.options.model,
      messages: [{ role: "user", content: prompt }],
      temperature: input.version.temperature,
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
    });

    const choice = payload.choices?.[0];
    if (!choice?.message?.content) {
      throw new EvalProviderError("Groq returned no extraction content.");
    }
    if (choice.finish_reason === "length") {
      throw new EvalProviderError("Groq extraction was cut short by max_completion_tokens.");
    }

    let raw: Record<string, unknown>;
    try {
      raw = parseJsonObject(choice.message.content);
    } catch (error) {
      throw new EvalProviderError(
        `Groq returned invalid JSON for case “${input.evalCase.id}”: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const usage = normalizeUsage(payload.usage);
    const recordedAt = new Date().toISOString();

    if (this.options.cacheDir) {
      const file = cacheFilePath(
        this.options.cacheDir,
        input.version.id,
        this.options.model,
        input.evalCase.id,
      );
      mkdirSync(path.dirname(file), { recursive: true });
      const entry: CacheEntry = {
        promptVersion: input.version.id,
        promptHash: promptHash(input.version),
        model: this.options.model,
        caseId: input.evalCase.id,
        recordedAt,
        latencyMs,
        usage,
        raw,
      };
      writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    }

    return {
      raw,
      latencyMs,
      usage,
      model: this.options.model,
      recordedAt,
    };
  }

  private async request(body: Record<string, unknown>): Promise<{ payload: GroqResponse; latencyMs: number }> {
    const maxRetries = this.options.maxRetries ?? 3;
    const timeoutMs = this.options.timeoutMs ?? 60_000;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(`${this.options.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(5_000);
          continue;
        }
        throw new EvalProviderError(
          `Groq request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Math.min(
          Math.max(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 20_000, 5_000),
          60_000,
        );
        if (attempt < maxRetries) {
          await sleep(waitMs);
          continue;
        }
        throw new EvalProviderError("Groq rate limit persisted after retries.", 429);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new EvalProviderError(
          `Groq HTTP ${response.status}: ${text.slice(0, 300)}`,
          response.status,
        );
      }

      const payload = (await response.json().catch(() => null)) as GroqResponse | null;
      if (!payload) {
        throw new EvalProviderError("Groq returned an unreadable response.");
      }
      return { payload, latencyMs: Date.now() - started };
    }

    throw new EvalProviderError("Groq request exhausted all retries.");
  }
}

/** Test double. The factory can throw to simulate a provider failure. */
export class StubModelClient implements EvalModelClient {
  readonly name = "stub" as const;

  constructor(
    private readonly factory: (input: {
      evalCase: EvalCase;
      version: PromptVersion;
    }) => Record<string, unknown> | Promise<Record<string, unknown>>,
    readonly model = "stub-model",
  ) {}

  async extract(input: { evalCase: EvalCase; version: PromptVersion }): Promise<ModelResponse> {
    return {
      raw: await this.factory(input),
      latencyMs: 1,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      model: this.model,
      recordedAt: new Date().toISOString(),
    };
  }
}

/**
 * Spaces live requests so the free-tier tokens-per-minute limit is respected.
 * The delay is between request starts, not between completions.
 */
export class ThrottledModelClient implements EvalModelClient {
  private lastStartedAt = 0;

  constructor(
    private readonly inner: EvalModelClient,
    private readonly throttleMs: number,
  ) {}

  get name(): EvalModelClient["name"] {
    return this.inner.name;
  }

  get model(): string {
    return this.inner.model;
  }

  async extract(input: { evalCase: EvalCase; version: PromptVersion }): Promise<ModelResponse> {
    if (this.throttleMs > 0) {
      const waitMs = this.lastStartedAt + this.throttleMs - Date.now();
      if (waitMs > 0) await sleep(waitMs);
    }
    this.lastStartedAt = Date.now();
    return this.inner.extract(input);
  }
}

function normalizeUsage(usage: GroqUsage | undefined): ModelUsage | null {
  if (!usage) return null;
  const promptTokens = numberOrZero(usage.prompt_tokens);
  const completionTokens = numberOrZero(usage.completion_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: numberOrZero(usage.total_tokens) || promptTokens + completionTokens,
  };
}

function numberOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
