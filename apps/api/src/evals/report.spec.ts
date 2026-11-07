import { describe, expect, it } from "vitest";
import type { Decision } from "@scambrake/contracts";
import type { CaseScore, ComparisonReport, VersionScorecard } from "./types";
import { aggregateScores, compareScorecards, evaluateGates } from "./score";
import {
  renderComparisonJson,
  renderComparisonMarkdown,
  renderVersionJson,
  renderVersionMarkdown,
} from "./report";

const DEFAULTS: Omit<CaseScore, "caseId"> = {
  title: "A payment request",
  tags: ["legit"],
  holdout: false,
  critical: false,
  expectedDecision: "ALLOW",
  acceptableDecisions: ["ALLOW"],
  actualDecision: "ALLOW",
  decisionCorrect: true,
  safeOutcome: true,
  amountExpected: 18,
  amountActual: 18,
  amountCorrect: true,
  recipientExpected: "Kettle & Co.",
  recipientActual: "Kettle & Co.",
  recipientCorrect: true,
  organizationExpected: null,
  organizationActual: null,
  organizationCorrect: true,
  expectedPressureCategories: [],
  actualPressureCategories: [],
  pressureRecall: 1,
  pressurePrecision: 1,
  missingPressureCategories: [],
  extraPressureCategories: [],
  rawQuoteCount: 0,
  hallucinatedQuoteCount: 0,
  hallucinatedQuotes: [],
  schemaValid: true,
  error: null,
  latencyMs: 500,
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  model: "stub-model",
};

function makeCase(input: Partial<CaseScore> & { caseId: string }): CaseScore {
  const merged: CaseScore = { ...DEFAULTS, ...input, caseId: input.caseId };
  return {
    ...merged,
    decisionCorrect:
      input.decisionCorrect ?? merged.actualDecision === merged.expectedDecision,
    safeOutcome:
      input.safeOutcome ??
      merged.acceptableDecisions.includes(merged.actualDecision as Decision),
  };
}

function scorecard(versionId: string, cases: CaseScore[]): VersionScorecard {
  const aggregate = aggregateScores(cases);
  const gates = evaluateGates(aggregate, cases);
  return {
    versionId,
    versionLabel: versionId,
    provider: "stub",
    model: "stub-model",
    cases,
    aggregate,
    gates,
    criticalFailures: gates
      .filter((gate) => gate.severity === "critical" && !gate.passed)
      .map((gate) => gate.label),
  };
}

const BASELINE_CASE = makeCase({
  caseId: "scam-1",
  title: "Safe | account transfer",
  tags: ["scam"],
  expectedDecision: "BLOCK",
  acceptableDecisions: ["BLOCK"],
  actualDecision: "BLOCK",
  expectedPressureCategories: ["urgency"],
  actualPressureCategories: ["urgency"],
});

const REGRESSED_CASE = makeCase({
  ...BASELINE_CASE,
  actualDecision: "ALLOW",
  actualPressureCategories: [],
  pressureRecall: 0,
  decisionCorrect: false,
  safeOutcome: false,
});

const BASELINE = scorecard("v1-baseline", [BASELINE_CASE]);
const CANDIDATE = scorecard("v2-hardened", [REGRESSED_CASE]);
const COMPARISON = compareScorecards(BASELINE, CANDIDATE);
const REPORT: ComparisonReport = {
  generatedAt: "2026-11-07T00:00:00.000Z",
  baseline: BASELINE,
  candidate: CANDIDATE,
  ...COMPARISON,
  casesPath: "apps/api/evals/cases.json",
  cacheDir: "apps/api/evals/cache",
  live: false,
  caseCount: 1,
  holdoutCount: 0,
};

describe("renderComparisonMarkdown", () => {
  const markdown = renderComparisonMarkdown(REPORT);

  it("identifies the versions, mode, and recommendation", () => {
    expect(markdown).toContain("# ScamBrake prompt evaluation");
    expect(markdown).toContain("Model: `stub-model`");
    expect(markdown).toContain("Baseline: **v1-baseline**");
    expect(markdown).toContain("Candidate: **v2-hardened**");
    expect(markdown).toContain("Cases: 1 (0 holdout) · mode: replay");
    expect(markdown).toContain("**REJECT the candidate prompt**");
  });

  it("includes the gates, the scorecard, and the per-case result", () => {
    expect(markdown).toContain("No ALLOW on a request that should be held or blocked");
    expect(markdown).toContain("| Safe decision rate |");
    expect(markdown).toContain("Safe \\| account transfer");
    expect(markdown).toContain("| scam | BLOCK | BLOCK | ALLOW |");
  });

  it("shows the blocking failures and the decision change", () => {
    expect(markdown).toContain("## Blocking failures");
    expect(markdown).toContain(
      "**New false ALLOW** on “scam-1” (BLOCK → ALLOW)",
    );
    expect(markdown).toContain("## Decision changes");
    expect(markdown).toContain("“scam-1”: BLOCK → ALLOW (new false ALLOW, regression)");
  });

  it("states the method and its limits", () => {
    expect(markdown).toContain("does not use an LLM judge");
    expect(markdown).toContain("synthetic and authored by the same team");
    expect(markdown).toContain("No prompt is promoted from an aggregate score alone");
  });

  it("escapes pipes so the Markdown tables stay intact", () => {
    const row = markdown
      .split("\n")
      .find((line) => line.includes("Safe \\| account transfer"));
    expect(row?.split(" | ")).toHaveLength(8);
  });
});

describe("renderVersionMarkdown", () => {
  const markdown = renderVersionMarkdown(BASELINE);

  it("renders the gates and the cases", () => {
    expect(markdown).toContain("# ScamBrake prompt scorecard: v1-baseline");
    expect(markdown).toContain("Provider: stub · model: `stub-model`");
    expect(markdown).toContain("| Every extraction validates | critical | pass |");
    expect(markdown).toContain("Safe \\| account transfer");
    expect(markdown).toContain("| scam | BLOCK | BLOCK | yes | 100.0% | 0 |");
  });
});

describe("JSON renderers", () => {
  it("round-trips the comparison report", () => {
    const parsed = JSON.parse(renderComparisonJson(REPORT)) as ComparisonReport;
    expect(parsed).toEqual(REPORT);
  });

  it("round-trips a version scorecard", () => {
    const parsed = JSON.parse(renderVersionJson(BASELINE)) as VersionScorecard;
    expect(parsed).toEqual(BASELINE);
  });
});
