import type { Extraction } from "@scambrake/contracts";
import { ExtractionSchema } from "@scambrake/contracts";
import { ApiException } from "../common/api.exception";

export type PressureCategory = Extraction["pressureSignals"][number]["category"];

const PRESSURE_CATEGORY_VALUES: readonly string[] = [
  "urgency",
  "secrecy",
  "authority",
  "payment_instruction",
  "threat",
  "inconsistency",
  "other",
];

export function isPressureCategory(value: string): value is PressureCategory {
  return PRESSURE_CATEGORY_VALUES.includes(value);
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const value = JSON.parse(cleaned) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiException(
      502,
      "AI_INVALID_RESPONSE",
      "The AI provider returned analysis that was not valid JSON. No PayPal order was created.",
    );
  }
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}

/** Loose comparison for checking that a quoted cue really appears in the transcript. */
export function comparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NormalizeExtractionOptions {
  /** Called when the normalized object still fails schema validation. */
  onInvalid?: (message: string) => void;
}

/**
 * Applies the same server-side normalization as the live Groq provider.
 * The model never gets to bypass schema validation, quote verification, or
 * the cap on evidence. The eval harness calls this exact function so its
 * scorecard measures production behavior rather than a copy.
 */
export function normalizeExtraction(
  raw: Record<string, unknown>,
  transcript: string,
  options: NormalizeExtractionOptions = {},
): Extraction {
  if (!transcript.trim()) {
    throw new ApiException(
      502,
      "AI_INVALID_RESPONSE",
      "The AI provider did not return a transcript. No PayPal order was created. Try the transcript fallback.",
    );
  }

  const normalized: Record<string, unknown> = {
    transcript,
    claimedIdentity: nullableString(raw.claimedIdentity),
    claimedOrganization: nullableString(raw.claimedOrganization),
    requestedAction:
      typeof raw.requestedAction === "string" && raw.requestedAction.trim()
        ? raw.requestedAction.trim().slice(0, 500)
        : "Unclear payment request",
    requestedRecipientName: nullableString(raw.requestedRecipientName),
    requestedRecipientIdentifier: nullableString(raw.requestedRecipientIdentifier),
    amount: typeof raw.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : null,
    currency: raw.currency === "USD" ? "USD" : "UNKNOWN",
    purpose: nullableString(raw.purpose),
    pressureSignals: Array.isArray(raw.pressureSignals)
      ? raw.pressureSignals
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .slice(0, 12)
          .map((item) => {
            const rawCategory = typeof item.category === "string" ? item.category : "";
            const category = isPressureCategory(rawCategory) ? rawCategory : "other";
            return {
              quote: typeof item.quote === "string" ? item.quote.trim().slice(0, 400) : "",
              category,
              explanation:
                typeof item.explanation === "string" ? item.explanation.trim().slice(0, 300) : "",
              ...(typeof item.startSeconds === "number" && item.startSeconds >= 0
                ? { startSeconds: Math.min(item.startSeconds, 3600) }
                : {}),
            };
          })
          // A quote must actually appear in the transcript. This keeps a
          // hallucinated cue from causing a false HOLD.
          .filter(
            (item) =>
              item.quote &&
              item.explanation &&
              comparableText(transcript).includes(comparableText(item.quote)),
          )
      : [],
    missingFields: Array.isArray(raw.missingFields)
      ? raw.missingFields
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 12)
      : [],
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.4,
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim().slice(0, 1200)
        : "The request was analyzed, but the model did not provide a summary.",
  };

  const result = ExtractionSchema.safeParse(normalized);
  if (!result.success) {
    options.onInvalid?.(result.error.message);
    throw new ApiException(
      502,
      "AI_INVALID_RESPONSE",
      "The AI provider returned an incomplete analysis. No PayPal order was created. Please try again.",
    );
  }
  return result.data;
}

export interface QuoteAuditEntry {
  quote: string;
  category: string;
  present: boolean;
}

export interface QuoteAudit {
  total: number;
  hallucinated: number;
  entries: QuoteAuditEntry[];
}

/**
 * Measures hallucinated quotes in the raw model response, before the
 * normalization step removes them. A prompt that invents evidence fails the
 * eval even if the deterministic policy would have ignored the invented cue.
 */
export function auditRawQuotes(
  raw: Record<string, unknown>,
  transcript: string,
): QuoteAudit {
  const comparableTranscript = comparableText(transcript);
  const signals = Array.isArray(raw.pressureSignals) ? raw.pressureSignals : [];
  const entries: QuoteAuditEntry[] = signals
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const quote = typeof item.quote === "string" ? item.quote.trim() : "";
      const category = typeof item.category === "string" ? item.category : "unknown";
      return {
        quote,
        category,
        present: Boolean(quote) && comparableTranscript.includes(comparableText(quote)),
      };
    });
  return {
    total: entries.length,
    hallucinated: entries.filter((entry) => !entry.present).length,
    entries,
  };
}
