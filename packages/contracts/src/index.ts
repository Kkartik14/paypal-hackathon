import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

export const DECISIONS = ["ALLOW", "HOLD", "BLOCK"] as const;
export const DecisionSchema = z.enum(DECISIONS);
export type Decision = z.infer<typeof DecisionSchema>;

export const ANALYSIS_PROVIDERS = ["groq", "mock"] as const;
export const AnalysisProviderSchema = z.enum(ANALYSIS_PROVIDERS);
export type AnalysisProvider = z.infer<typeof AnalysisProviderSchema>;

/* ------------------------------------------------------------------ */
/* Payment request                                                     */
/* ------------------------------------------------------------------ */

export const PaymentRequestSchema = z.object({
  /** Amount the user is considering paying. */
  amount: z.number().finite().positive().max(10_000),
  currency: z.literal("USD"),
  recipientName: z.string().trim().min(1).max(160),
  recipientIdentifier: z.string().trim().max(200).optional(),
  purpose: z.string().trim().max(500).optional(),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

/* ------------------------------------------------------------------ */
/* Analysis input                                                      */
/* ------------------------------------------------------------------ */

export const AnalyzeRequestSchema = z.object({
  mode: z.enum(["scenario", "custom"]),
  scenarioId: z.string().min(1).max(80).optional(),
  transcript: z.string().max(20_000).optional(),
  /** Base64 (no data: prefix). Hard-capped again after decoding at 3 MB. */
  audioBase64: z.string().max(4_500_000).optional(),
  audioMimeType: z.string().max(100).optional(),
  payment: PaymentRequestSchema,
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export const PressureCategorySchema = z.enum([
  "urgency",
  "secrecy",
  "authority",
  "payment_instruction",
  "threat",
  "inconsistency",
  "other",
]);
export type PressureCategory = z.infer<typeof PressureCategorySchema>;

export const PressureSignalSchema = z.object({
  /** Exact quote from the transcript whenever possible. */
  quote: z.string().min(1).max(400),
  category: PressureCategorySchema,
  explanation: z.string().min(1).max(300),
  startSeconds: z.number().min(0).max(3600).optional(),
});
export type PressureSignal = z.infer<typeof PressureSignalSchema>;

export const ExtractionSchema = z.object({
  transcript: z.string().min(1).max(20_000),
  claimedIdentity: z.string().max(200).nullable(),
  claimedOrganization: z.string().max(200).nullable(),
  requestedAction: z.string().max(500),
  requestedRecipientName: z.string().max(200).nullable(),
  requestedRecipientIdentifier: z.string().max(200).nullable(),
  /** Null means the model could not identify an amount. */
  amount: z.number().min(0).max(1_000_000).nullable(),
  currency: z.enum(["USD", "UNKNOWN"]),
  purpose: z.string().max(500).nullable(),
  pressureSignals: z.array(PressureSignalSchema).max(12),
  missingFields: z.array(z.string().max(80)).max(12),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(1200),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/* ------------------------------------------------------------------ */
/* Saved profile (fictional fixtures)                                  */
/* ------------------------------------------------------------------ */

export const TrustedRecipientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  identifier: z.string().nullable(),
  type: z.enum(["merchant", "person", "institution"]),
  /** Extra per-recipient ceiling, in USD. */
  maxWithoutConfirmation: z.number().positive(),
  note: z.string(),
});
export type TrustedRecipient = z.infer<typeof TrustedRecipientSchema>;

export const PaymentRuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(["never_pay_support", "confirmation_threshold", "trusted_recipient_only"]),
  enabled: z.boolean(),
});
export type PaymentRule = z.infer<typeof PaymentRuleSchema>;

export const ProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  currency: z.literal("USD"),
  limits: z.object({
    withoutConfirmation: z.number().positive(),
  }),
  rules: z.array(PaymentRuleSchema),
  trustedRecipients: z.array(TrustedRecipientSchema),
  fixtureNotice: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MerchantSchema = z.object({
  name: z.string().min(1),
  identifier: z.string().nullable(),
  amount: z.number().positive(),
  currency: z.literal("USD"),
  sandboxNote: z.string(),
});
export type Merchant = z.infer<typeof MerchantSchema>;

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  kind: z.enum(["unsafe", "safe"]),
  transcript: z.string().min(1),
  audioUrl: z.string().min(1),
  audioMimeType: z.string().min(1),
  payment: PaymentRequestSchema,
  expectedDecision: DecisionSchema,
  expectedSummary: z.string(),
  fixtureNotice: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenariosResponseSchema = z.object({
  profile: ProfileSchema,
  merchant: MerchantSchema,
  scenarios: z.array(ScenarioSchema),
  provider: AnalysisProviderSchema,
  paypal: z.object({
    environment: z.literal("sandbox"),
    configured: z.boolean(),
  }),
  notice: z.string(),
});
export type ScenariosResponse = z.infer<typeof ScenariosResponseSchema>;

/* ------------------------------------------------------------------ */
/* Analysis result                                                     */
/* ------------------------------------------------------------------ */

export const CheckResultSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["pass", "fail", "skipped"]),
  detail: z.string(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const DecisionReasonSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  severity: z.enum(["block", "hold", "info"]),
  evidenceQuotes: z.array(z.string()).default([]),
  ruleId: z.string().optional(),
});
export type DecisionReason = z.infer<typeof DecisionReasonSchema>;

export const AnalysisStepSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  durationMs: z.number().min(0),
});
export type AnalysisStep = z.infer<typeof AnalysisStepSchema>;

export const CheckoutSummarySchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  merchantName: z.string().min(1),
  merchantIdentifier: z.string().nullable(),
  amount: z.number().positive(),
  currency: z.literal("USD"),
  sandbox: z.literal(true),
});
export type CheckoutSummary = z.infer<typeof CheckoutSummarySchema>;

export const ProfileMatchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  identifier: z.string().nullable(),
  type: z.enum(["merchant", "person", "institution"]),
});
export type ProfileMatch = z.infer<typeof ProfileMatchSchema>;

export const AnalysisResultSchema = z.object({
  analysisId: z.string().min(1),
  createdAt: z.string().datetime(),
  mode: z.enum(["scenario", "custom"]),
  scenarioId: z.string().nullable(),
  provider: AnalysisProviderSchema,
  payment: PaymentRequestSchema,
  extraction: ExtractionSchema,
  profileMatch: ProfileMatchSchema.nullable(),
  decision: DecisionSchema,
  reasons: z.array(DecisionReasonSchema),
  checks: z.array(CheckResultSchema),
  steps: z.array(AnalysisStepSchema),
  /** Short-lived, signed ALLOW ticket. Never issued through MCP. */
  ticket: z.string().nullable(),
  ticketExpiresAt: z.string().datetime().nullable(),
  checkout: CheckoutSummarySchema,
  disclaimers: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export const CreateOrderRequestSchema = z.object({
  ticket: z.string().min(20).max(8000),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

export const CreateOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  approveUrl: z.string().url(),
  amount: z.number().positive(),
  currency: z.literal("USD"),
  merchantName: z.string().min(1),
  environment: z.literal("sandbox"),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>;

export const CaptureInfoSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  amount: z.number().positive(),
  currency: z.literal("USD"),
  createTime: z.string().nullable(),
});
export type CaptureInfo = z.infer<typeof CaptureInfoSchema>;

export const OrderViewSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  amount: z.number().positive(),
  currency: z.literal("USD"),
  merchantName: z.string().min(1),
  /** Actual payee reported by PayPal, when available. */
  paypalPayee: z.string().nullable(),
  customId: z.string().nullable(),
  createTime: z.string().nullable(),
  environment: z.literal("sandbox"),
  capture: CaptureInfoSchema.nullable(),
});
export type OrderView = z.infer<typeof OrderViewSchema>;

export const CaptureOrderRequestSchema = z.object({
  ticket: z.string().min(20).max(8000),
});
export type CaptureOrderRequest = z.infer<typeof CaptureOrderRequestSchema>;

/* ------------------------------------------------------------------ */
/* Health and errors                                                   */
/* ------------------------------------------------------------------ */

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("scambrake-api"),
  checks: z.object({
    paypalConfigured: z.boolean(),
    paypalEnvironment: z.literal("sandbox"),
    aiProvider: AnalysisProviderSchema,
    aiConfigured: z.boolean(),
    ticketSecretConfigured: z.boolean(),
    webOriginConfigured: z.boolean(),
  }),
  timestamp: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/* ------------------------------------------------------------------ */
/* Shared constants                                                    */
/* ------------------------------------------------------------------ */

export const MCP_TOOL_NAMES = [
  "analyze_payment_request",
  "get_saved_recipients",
  "get_payment_rules",
  "get_paypal_order",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const DISCLAIMERS = [
  "ScamBrake analyzes the content of a request. It does not authenticate a caller's voice or prove that a voice is a deepfake.",
  "Recipient checks use a small, fictional saved profile. They are not a PayPal directory, bank directory, or universal scam database.",
  "The PayPal Sandbox purchase pays the ScamBrake Sandbox merchant. It is not a payment to the suspicious caller, and no real money moves.",
  "The AI gathers evidence and explains it. A deterministic server policy makes the final ALLOW, HOLD, or BLOCK decision.",
] as const;
