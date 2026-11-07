import { z } from "zod";
import {
  DecisionSchema,
  ExtractionSchema,
  PaymentRequestSchema,
  PressureCategorySchema,
} from "@scambrake/contracts";

export const EvalTagSchema = z.enum([
  "scam",
  "legit",
  "ambiguous",
  "injection",
  "false-positive-trap",
]);
export type EvalTag = z.infer<typeof EvalTagSchema>;

/** The extraction fields a well-behaved model should produce for a case. */
export const IdealExtractionSchema = ExtractionSchema.omit({ transcript: true });

export const EvalCaseSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "case ids must be lowercase, numbers, and hyphens"),
  title: z.string().min(1).max(160),
  tags: z.array(EvalTagSchema).min(1),
  holdout: z.boolean().default(false),
  critical: z.boolean().default(false),
  transcript: z.string().min(1).max(20_000),
  payment: PaymentRequestSchema,
  expected: z.object({
    decision: DecisionSchema,
    /** Safe outcomes for this case. ALLOW is never safe when the expected decision is not ALLOW. */
    acceptableDecisions: z.array(DecisionSchema).min(1),
    amount: z.number().min(0).nullable(),
    requestedRecipientName: z.string().max(200).nullable(),
    claimedOrganization: z.string().max(200).nullable(),
    pressureCategories: z.array(PressureCategorySchema),
  }),
  idealExtraction: IdealExtractionSchema,
  notes: z.string().max(1200).default(""),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelResponse {
  raw: Record<string, unknown>;
  latencyMs: number;
  usage: ModelUsage | null;
  model: string;
  recordedAt: string;
}

export type ActualDecision = "ALLOW" | "HOLD" | "BLOCK" | "ERROR";

export interface CaseScore {
  caseId: string;
  title: string;
  tags: EvalTag[];
  holdout: boolean;
  critical: boolean;
  expectedDecision: EvalCase["expected"]["decision"];
  acceptableDecisions: EvalCase["expected"]["acceptableDecisions"];
  actualDecision: ActualDecision;
  decisionCorrect: boolean;
  safeOutcome: boolean;
  amountExpected: number | null;
  amountActual: number | null;
  amountCorrect: boolean;
  recipientExpected: string | null;
  recipientActual: string | null;
  recipientCorrect: boolean;
  organizationExpected: string | null;
  organizationActual: string | null;
  organizationCorrect: boolean;
  expectedPressureCategories: string[];
  actualPressureCategories: string[];
  pressureRecall: number;
  pressurePrecision: number;
  missingPressureCategories: string[];
  extraPressureCategories: string[];
  rawQuoteCount: number;
  hallucinatedQuoteCount: number;
  hallucinatedQuotes: string[];
  schemaValid: boolean;
  error: string | null;
  latencyMs: number;
  usage: ModelUsage | null;
  model: string;
}

export interface AggregateScore {
  cases: number;
  holdoutCases: number;
  schemaValid: number;
  decisionCorrect: number;
  decisionAccuracy: number;
  safeOutcomes: number;
  safeDecisionRate: number;
  falseAllows: number;
  falseAllowsOnCritical: number;
  falseBlocksOnLegit: number;
  falseHoldsOnLegit: number;
  scamCases: number;
  scamPressureRecall: number;
  legitCases: number;
  legitPressureFalsePositiveRate: number;
  hallucinatedQuotes: number;
  casesWithHallucinatedQuotes: number;
  amountAccuracy: number;
  recipientAccuracy: number;
  organizationAccuracy: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export interface EvalGate {
  id: string;
  label: string;
  severity: "critical" | "warning";
  passed: boolean;
  detail: string;
}

export interface VersionScorecard {
  versionId: string;
  versionLabel: string;
  provider: "replay" | "live" | "stub";
  model: string;
  cases: CaseScore[];
  aggregate: AggregateScore;
  gates: EvalGate[];
  criticalFailures: string[];
}

export interface CaseDelta {
  caseId: string;
  title: string;
  baseline: ActualDecision;
  candidate: ActualDecision;
  changed: boolean;
  improvement: boolean;
  regression: boolean;
  newFalseAllow: boolean;
  fixedFalseAllow: boolean;
}

export type Recommendation = "promote" | "keep-baseline" | "reject" | "no-change";

export interface ComparisonReport {
  generatedAt: string;
  baseline: VersionScorecard;
  candidate: VersionScorecard;
  deltas: CaseDelta[];
  newFalseAllows: CaseDelta[];
  fixedFalseAllows: CaseDelta[];
  regressions: CaseDelta[];
  improvements: CaseDelta[];
  recommendation: Recommendation;
  reasons: string[];
  casesPath: string;
  cacheDir: string;
  live: boolean;
  caseCount: number;
  holdoutCount: number;
}
