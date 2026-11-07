import { describe, expect, it } from "vitest";
import type { Decision } from "@scambrake/contracts";
import type { CaseScore, EvalGate, VersionScorecard } from "./types";
import { aggregateScores, compareScorecards, evaluateGates } from "./score";

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

function scorecard(
  versionId: string,
  cases: CaseScore[],
  gates?: EvalGate[],
): VersionScorecard {
  const aggregate = aggregateScores(cases);
  const resolvedGates = gates ?? evaluateGates(aggregate, cases);
  return {
    versionId,
    versionLabel: versionId,
    provider: "stub",
    model: "stub-model",
    cases,
    aggregate,
    gates: resolvedGates,
    criticalFailures: resolvedGates
      .filter((gate) => gate.severity === "critical" && !gate.passed)
      .map((gate) => gate.label),
  };
}

const SCAM_BLOCKED = makeCase({
  caseId: "scam-1",
  title: "Safe-account transfer",
  tags: ["scam"],
  expectedDecision: "BLOCK",
  acceptableDecisions: ["BLOCK"],
  actualDecision: "BLOCK",
  expectedPressureCategories: ["urgency"],
  actualPressureCategories: ["urgency"],
  pressureRecall: 1,
});

const SCAM_ALLOWED = makeCase({
  caseId: "scam-1",
  title: "Safe-account transfer",
  tags: ["scam"],
  expectedDecision: "BLOCK",
  acceptableDecisions: ["BLOCK"],
  actualDecision: "ALLOW",
  expectedPressureCategories: ["urgency"],
  actualPressureCategories: [],
  pressureRecall: 0,
});

const LEGIT_ALLOWED = makeCase({
  caseId: "legit-1",
  title: "Routine renewal",
});

describe("aggregateScores", () => {
  it("tracks false ALLOWs, false HOLDs, pressure recall, and quote hallucinations", () => {
    const cases = [
      makeCase({
        ...SCAM_ALLOWED,
        caseId: "scam-allowed",
        holdout: true,
        critical: true,
        hallucinatedQuoteCount: 2,
      }),
      SCAM_BLOCKED,
      makeCase({
        caseId: "legit-held",
        actualDecision: "HOLD",
        actualPressureCategories: ["urgency"],
      }),
      LEGIT_ALLOWED,
    ];

    const aggregate = aggregateScores(cases);

    expect(aggregate.cases).toBe(4);
    expect(aggregate.holdoutCases).toBe(1);
    expect(aggregate.schemaValid).toBe(4);
    expect(aggregate.decisionCorrect).toBe(2);
    expect(aggregate.decisionAccuracy).toBe(0.5);
    expect(aggregate.safeOutcomes).toBe(2);
    expect(aggregate.safeDecisionRate).toBe(0.5);
    expect(aggregate.falseAllows).toBe(1);
    expect(aggregate.falseAllowsOnCritical).toBe(1);
    expect(aggregate.falseBlocksOnLegit).toBe(0);
    expect(aggregate.falseHoldsOnLegit).toBe(1);
    expect(aggregate.scamCases).toBe(2);
    expect(aggregate.scamPressureRecall).toBe(0.5);
    expect(aggregate.legitCases).toBe(2);
    expect(aggregate.legitPressureFalsePositiveRate).toBe(0.5);
    expect(aggregate.hallucinatedQuotes).toBe(2);
    expect(aggregate.casesWithHallucinatedQuotes).toBe(1);
    expect(aggregate.totalTokens).toBe(600);
  });
});

describe("evaluateGates", () => {
  it("passes every gate on a healthy scorecard", () => {
    const cases = [SCAM_BLOCKED, LEGIT_ALLOWED];
    const gates = evaluateGates(aggregateScores(cases), cases);

    expect(gates.every((gate) => gate.passed)).toBe(true);
  });

  it("fails the critical gates that protect against a false ALLOW or invented evidence", () => {
    const cases = [
      makeCase({
        ...SCAM_ALLOWED,
        caseId: "scam-holdout",
        holdout: true,
        critical: true,
        hallucinatedQuoteCount: 2,
      }),
      makeCase({
        caseId: "legit-held",
        actualDecision: "HOLD",
        actualPressureCategories: ["urgency"],
      }),
      LEGIT_ALLOWED,
    ];
    const aggregate = aggregateScores(cases);
    const gates = evaluateGates(aggregate, cases);
    const byId = new Map(gates.map((gate) => [gate.id, gate]));

    expect(byId.get("schema-valid")?.passed).toBe(true);
    expect(byId.get("no-false-allow")?.passed).toBe(false);
    expect(byId.get("no-false-allow")?.detail).toContain("scam-holdout");
    expect(byId.get("no-hallucinated-quotes")?.passed).toBe(false);
    expect(byId.get("no-hallucinated-quotes")?.detail).toContain("scam-holdout");
    expect(byId.get("safe-decision-rate")?.passed).toBe(false);
    expect(byId.get("no-false-block-on-legit")?.passed).toBe(true);
    expect(byId.get("scam-pressure-evidence")?.passed).toBe(false);
    expect(byId.get("scam-pressure-evidence")?.severity).toBe("critical");
    expect(byId.get("scam-pressure-recall")?.passed).toBe(false);
    expect(byId.get("scam-pressure-recall")?.severity).toBe("warning");
    expect(byId.get("legit-pressure-false-positive")?.passed).toBe(false);
    expect(byId.get("holdout-no-false-allow")?.passed).toBe(false);
    expect(byId.get("latency-p95")?.passed).toBe(true);
  });

  it("fails the schema gate and the latency warning when they are violated", () => {
    const cases = [
      makeCase({
        caseId: "broken",
        schemaValid: false,
        actualDecision: "ERROR",
        latencyMs: 20_000,
      }),
      LEGIT_ALLOWED,
    ];
    const gates = evaluateGates(aggregateScores(cases), cases);
    const byId = new Map(gates.map((gate) => [gate.id, gate]));

    expect(byId.get("schema-valid")?.passed).toBe(false);
    expect(byId.get("schema-valid")?.detail).toContain("broken");
    expect(byId.get("latency-p95")?.passed).toBe(false);
    expect(byId.get("latency-p95")?.severity).toBe("warning");
  });

  it("fails the false-BLOCK gate when a legitimate saved recipient is blocked", () => {
    const cases = [
      SCAM_BLOCKED,
      makeCase({
        caseId: "legit-blocked",
        actualDecision: "BLOCK",
      }),
    ];
    const gates = evaluateGates(aggregateScores(cases), cases);
    const gate = gates.find((item) => item.id === "no-false-block-on-legit");

    expect(gate?.passed).toBe(false);
    expect(gate?.detail).toContain("legit-blocked");
  });
});

describe("compareScorecards", () => {
  it("recommends promotion when the candidate fixes a false ALLOW and passes every gate", () => {
    const baseline = scorecard("v1-baseline", [SCAM_ALLOWED, LEGIT_ALLOWED]);
    const candidate = scorecard("v2-hardened", [SCAM_BLOCKED, LEGIT_ALLOWED]);

    const result = compareScorecards(baseline, candidate);

    expect(result.recommendation).toBe("promote");
    expect(result.newFalseAllows).toHaveLength(0);
    expect(result.fixedFalseAllows.map((item) => item.caseId)).toEqual(["scam-1"]);
    expect(result.improvements.map((item) => item.caseId)).toEqual(["scam-1"]);
    expect(result.reasons[0]).toMatch(/passes every critical gate/);
    expect(result.reasons.join(" ")).toMatch(/Removes false ALLOW/);
    expect(result.reasons.join(" ")).toMatch(/Safe decision rate improved/);
  });

  it("rejects a candidate that fails a critical gate", () => {
    const baseline = scorecard("v1-baseline", [SCAM_BLOCKED, LEGIT_ALLOWED]);
    const candidate = scorecard("v2-hardened", [SCAM_ALLOWED, LEGIT_ALLOWED]);

    const result = compareScorecards(baseline, candidate);

    expect(result.recommendation).toBe("reject");
    expect(result.reasons[0]).toMatch(/fails critical gate/);
    expect(result.newFalseAllows.map((item) => item.caseId)).toEqual(["scam-1"]);
  });

  it("rejects a new false ALLOW even when the candidate gates were reported as passing", () => {
    const baseline = scorecard("v1-baseline", [SCAM_BLOCKED]);
    const candidate = scorecard("v2-hardened", [SCAM_ALLOWED], [
      {
        id: "manual",
        label: "Manual gate that passed",
        severity: "critical",
        passed: true,
        detail: "pass",
      },
    ]);

    const result = compareScorecards(baseline, candidate);

    expect(result.recommendation).toBe("reject");
    expect(result.newFalseAllows.map((item) => item.caseId)).toEqual(["scam-1"]);
    expect(result.reasons[0]).toMatch(/introduces a false ALLOW/);
    expect(result.reasons[0]).toMatch(/hard reject/);
  });

  it("keeps the baseline when a safe case regresses and a metric falls", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `legit-${index}`);
    const baseline = scorecard(
      "v1-baseline",
      ids.map((caseId) => makeCase({ caseId })),
    );
    const candidate = scorecard(
      "v2-hardened",
      ids.map((caseId, index) =>
        makeCase({ caseId, actualDecision: index === 0 ? "HOLD" : "ALLOW" }),
      ),
    );

    const result = compareScorecards(baseline, candidate);

    expect(result.recommendation).toBe("keep-baseline");
    expect(result.regressions.map((item) => item.caseId)).toEqual(["legit-0"]);
    expect(result.reasons.join(" ")).toMatch(/Safe decision rate fell/);
    expect(result.reasons.join(" ")).toMatch(/Regressions/);
  });

  it("keeps the baseline when extraction accuracy regresses even if every decision stays safe", () => {
    const baseline = scorecard("v1-baseline", [
      makeCase({ caseId: "legit-1" }),
      makeCase({ caseId: "legit-2" }),
    ]);
    const candidate = scorecard("v2-hardened", [
      makeCase({ caseId: "legit-1" }),
      makeCase({
        caseId: "legit-2",
        recipientActual: "someone else",
        recipientCorrect: false,
      }),
    ]);

    const result = compareScorecards(baseline, candidate);

    expect(result.recommendation).toBe("keep-baseline");
    expect(result.reasons.join(" ")).toMatch(/Recipient extraction accuracy fell/);
  });

  it("reports no change when the candidate matches the baseline", () => {
    const cases = [SCAM_BLOCKED, LEGIT_ALLOWED];
    const result = compareScorecards(
      scorecard("v1-baseline", cases),
      scorecard("v2-hardened", cases),
    );

    expect(result.recommendation).toBe("no-change");
    expect(result.deltas.every((delta) => !delta.changed)).toBe(true);
    expect(result.reasons[0]).toMatch(/matches the baseline/);
  });

  it("throws when the candidate scorecard is missing a baseline case", () => {
    const baseline = scorecard("v1-baseline", [SCAM_BLOCKED, LEGIT_ALLOWED]);
    const candidate = scorecard("v2-hardened", [SCAM_BLOCKED]);

    expect(() => compareScorecards(baseline, candidate)).toThrow(/missing case “legit-1”/);
  });
});
