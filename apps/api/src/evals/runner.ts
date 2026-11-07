import type { Extraction } from "@scambrake/contracts";
import { auditRawQuotes, normalizeExtraction } from "../agent/extraction";
import type { PromptVersion } from "../agent/prompts";
import { ContactsService, nameMatches } from "../contacts/contacts.service";
import { PolicyService } from "../policy/policy.service";
import type { EvalModelClient } from "./model-client";
import { EvalSetupError } from "./model-client";
import { aggregateScores, evaluateGates } from "./score";
import type { CaseScore, EvalCase, ModelResponse, VersionScorecard } from "./types";

export async function runVersion(input: {
  version: PromptVersion;
  cases: EvalCase[];
  client: EvalModelClient;
  contacts?: ContactsService;
  policy?: PolicyService;
}): Promise<VersionScorecard> {
  const contacts = input.contacts ?? new ContactsService();
  const policy = input.policy ?? new PolicyService(contacts);
  const profile = contacts.getProfile();
  const caseScores: CaseScore[] = [];

  for (const evalCase of input.cases) {
    caseScores.push(
      await scoreCase({
        evalCase,
        version: input.version,
        client: input.client,
        policy,
        profile,
      }),
    );
  }

  const aggregate = aggregateScores(caseScores);
  const gates = evaluateGates(aggregate, caseScores);

  return {
    versionId: input.version.id,
    versionLabel: input.version.label,
    provider: input.client.name,
    model: input.client.model,
    cases: caseScores,
    aggregate,
    gates,
    criticalFailures: gates
      .filter((gate) => gate.severity === "critical" && !gate.passed)
      .map((gate) => gate.label),
  };
}

async function scoreCase(input: {
  evalCase: EvalCase;
  version: PromptVersion;
  client: EvalModelClient;
  policy: PolicyService;
  profile: ReturnType<ContactsService["getProfile"]>;
}): Promise<CaseScore> {
  const { evalCase } = input;
  let response: ModelResponse | null = null;
  let error: string | null = null;

  try {
    response = await input.client.extract({
      evalCase,
      version: input.version,
    });
  } catch (caught) {
    if (caught instanceof EvalSetupError) throw caught;
    error = errorMessage(caught);
  }

  if (!response) {
    return emptyCaseScore(evalCase, input.client.model, error ?? "No model response.");
  }

  const quoteAudit = auditRawQuotes(response.raw, evalCase.transcript);
  let extraction: Extraction | null = null;
  try {
    extraction = normalizeExtraction(response.raw, evalCase.transcript);
  } catch (caught) {
    error = errorMessage(caught);
  }

  if (!extraction) {
    return {
      ...emptyCaseScore(evalCase, response.model, error ?? "Extraction failed validation."),
      rawQuoteCount: quoteAudit.total,
      hallucinatedQuoteCount: quoteAudit.hallucinated,
      hallucinatedQuotes: quoteAudit.entries
        .filter((entry) => !entry.present)
        .map((entry) => entry.quote),
      latencyMs: response.latencyMs,
      usage: response.usage,
    };
  }

  const outcome = input.policy.evaluate({
    extraction,
    payment: evalCase.payment,
    profile: input.profile,
  });

  const expectedCategories = evalCase.expected.pressureCategories;
  const actualCategories = extraction.pressureSignals.map((signal) => signal.category);
  const expectedSet = new Set(expectedCategories);
  const actualSet = new Set(actualCategories);
  const missingCategories = expectedCategories.filter((category) => !actualSet.has(category));
  const extraCategories = [...actualSet].filter((category) => !expectedSet.has(category));

  return {
    caseId: evalCase.id,
    title: evalCase.title,
    tags: evalCase.tags,
    holdout: evalCase.holdout,
    critical: evalCase.critical,
    expectedDecision: evalCase.expected.decision,
    acceptableDecisions: evalCase.expected.acceptableDecisions,
    actualDecision: outcome.decision,
    decisionCorrect: outcome.decision === evalCase.expected.decision,
    safeOutcome: evalCase.expected.acceptableDecisions.includes(outcome.decision),
    amountExpected: evalCase.expected.amount,
    amountActual: extraction.amount,
    amountCorrect: amountsMatch(evalCase.expected.amount, extraction.amount),
    recipientExpected: evalCase.expected.requestedRecipientName,
    recipientActual: extraction.requestedRecipientName,
    recipientCorrect: textsMatch(
      evalCase.expected.requestedRecipientName,
      extraction.requestedRecipientName,
    ),
    organizationExpected: evalCase.expected.claimedOrganization,
    organizationActual: extraction.claimedOrganization,
    organizationCorrect: textsMatch(
      evalCase.expected.claimedOrganization,
      extraction.claimedOrganization,
    ),
    expectedPressureCategories: expectedCategories,
    actualPressureCategories: [...actualSet],
    pressureRecall: recall(expectedCategories, missingCategories),
    pressurePrecision: precision(expectedCategories, actualCategories, extraCategories),
    missingPressureCategories: missingCategories,
    extraPressureCategories: extraCategories,
    rawQuoteCount: quoteAudit.total,
    hallucinatedQuoteCount: quoteAudit.hallucinated,
    hallucinatedQuotes: quoteAudit.entries
      .filter((entry) => !entry.present)
      .map((entry) => entry.quote),
    schemaValid: true,
    error: null,
    latencyMs: response.latencyMs,
    usage: response.usage,
    model: response.model,
  };
}

function emptyCaseScore(evalCase: EvalCase, model: string, error: string): CaseScore {
  return {
    caseId: evalCase.id,
    title: evalCase.title,
    tags: evalCase.tags,
    holdout: evalCase.holdout,
    critical: evalCase.critical,
    expectedDecision: evalCase.expected.decision,
    acceptableDecisions: evalCase.expected.acceptableDecisions,
    actualDecision: "ERROR",
    decisionCorrect: false,
    safeOutcome: false,
    amountExpected: evalCase.expected.amount,
    amountActual: null,
    amountCorrect: evalCase.expected.amount === null,
    recipientExpected: evalCase.expected.requestedRecipientName,
    recipientActual: null,
    recipientCorrect: evalCase.expected.requestedRecipientName === null,
    organizationExpected: evalCase.expected.claimedOrganization,
    organizationActual: null,
    organizationCorrect: evalCase.expected.claimedOrganization === null,
    expectedPressureCategories: evalCase.expected.pressureCategories,
    actualPressureCategories: [],
    pressureRecall: 0,
    pressurePrecision: 0,
    missingPressureCategories: [...evalCase.expected.pressureCategories],
    extraPressureCategories: [],
    rawQuoteCount: 0,
    hallucinatedQuoteCount: 0,
    hallucinatedQuotes: [],
    schemaValid: false,
    error,
    latencyMs: 0,
    usage: null,
    model,
  };
}

function amountsMatch(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return Math.abs(expected - actual) < 0.011;
}

function textsMatch(expected: string | null, actual: string | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return nameMatches(expected, actual);
}

function recall(expected: string[], missing: string[]): number {
  if (expected.length === 0) return missing.length === 0 ? 1 : 0;
  return (expected.length - missing.length) / expected.length;
}

function precision(
  expected: string[],
  actual: string[],
  extra: string[],
): number {
  if (actual.length === 0) return expected.length === 0 ? 1 : 0;
  return (actual.length - extra.length) / actual.length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
