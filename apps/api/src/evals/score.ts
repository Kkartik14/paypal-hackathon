import type {
  AggregateScore,
  CaseDelta,
  CaseScore,
  EvalGate,
  Recommendation,
  VersionScorecard,
} from "./types";

export function aggregateScores(cases: CaseScore[]): AggregateScore {
  const total = cases.length;
  const scamCases = cases.filter((item) => item.tags.includes("scam"));
  const legitCases = cases.filter((item) => item.tags.includes("legit"));
  const latencies = cases.map((item) => item.latencyMs);
  const tokenTotals = cases.reduce(
    (acc, item) => {
      acc.prompt += item.usage?.promptTokens ?? 0;
      acc.completion += item.usage?.completionTokens ?? 0;
      acc.total += item.usage?.totalTokens ?? 0;
      return acc;
    },
    { prompt: 0, completion: 0, total: 0 },
  );

  const scamPressureCases = scamCases.filter(
    (item) => item.expectedPressureCategories.length > 0,
  );

  return {
    cases: total,
    holdoutCases: cases.filter((item) => item.holdout).length,
    schemaValid: cases.filter((item) => item.schemaValid).length,
    decisionCorrect: cases.filter((item) => item.decisionCorrect).length,
    decisionAccuracy: ratio(cases.filter((item) => item.decisionCorrect).length, total),
    safeOutcomes: cases.filter((item) => item.safeOutcome).length,
    safeDecisionRate: ratio(cases.filter((item) => item.safeOutcome).length, total),
    falseAllows: cases.filter(isFalseAllow).length,
    falseAllowsOnCritical: cases.filter((item) => item.critical && isFalseAllow(item)).length,
    falseBlocksOnLegit: legitCases.filter(
      (item) => item.expectedDecision === "ALLOW" && item.actualDecision === "BLOCK",
    ).length,
    falseHoldsOnLegit: legitCases.filter(
      (item) => item.expectedDecision === "ALLOW" && item.actualDecision === "HOLD",
    ).length,
    scamCases: scamCases.length,
    scamPressureRecall: mean(scamPressureCases.map((item) => item.pressureRecall)),
    legitCases: legitCases.length,
    legitPressureFalsePositiveRate: ratio(
      legitCases.filter((item) => item.actualPressureCategories.length > 0).length,
      legitCases.length,
    ),
    hallucinatedQuotes: cases.reduce((sum, item) => sum + item.hallucinatedQuoteCount, 0),
    casesWithHallucinatedQuotes: cases.filter((item) => item.hallucinatedQuoteCount > 0).length,
    amountAccuracy: mean(cases.map((item) => (item.amountCorrect ? 1 : 0))),
    recipientAccuracy: mean(cases.map((item) => (item.recipientCorrect ? 1 : 0))),
    organizationAccuracy: mean(cases.map((item) => (item.organizationCorrect ? 1 : 0))),
    medianLatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    totalPromptTokens: tokenTotals.prompt,
    totalCompletionTokens: tokenTotals.completion,
    totalTokens: tokenTotals.total,
  };
}

export function evaluateGates(
  aggregate: AggregateScore,
  cases: CaseScore[],
): EvalGate[] {
  const schemaFailures = cases.filter((item) => !item.schemaValid);
  const falseAllowCases = cases.filter(isFalseAllow);
  const hallucinatedCases = cases.filter((item) => item.hallucinatedQuoteCount > 0);
  const holdoutFalseAllows = cases.filter((item) => item.holdout && isFalseAllow(item));
  const falseBlockCases = cases.filter(
    (item) => item.tags.includes("legit") && item.expectedDecision === "ALLOW" && item.actualDecision === "BLOCK",
  );
  const scamCasesWithoutPressure = cases.filter(
    (item) =>
      item.tags.includes("scam") &&
      item.expectedPressureCategories.length > 0 &&
      item.actualPressureCategories.length === 0,
  );

  return [
    {
      id: "schema-valid",
      label: "Every extraction validates",
      severity: "critical",
      passed: schemaFailures.length === 0,
      detail:
        schemaFailures.length === 0
          ? `${cases.length}/${cases.length} valid`
          : `${schemaFailures.length} invalid: ${describeCases(schemaFailures)}`,
    },
    {
      id: "no-false-allow",
      label: "No ALLOW on a request that should be held or blocked",
      severity: "critical",
      passed: falseAllowCases.length === 0,
      detail:
        falseAllowCases.length === 0
          ? "0 false ALLOWs"
          : `${falseAllowCases.length} false ALLOW(s): ${describeCases(falseAllowCases)}`,
    },
    {
      id: "no-hallucinated-quotes",
      label: "No pressure quote invented outside the transcript",
      severity: "critical",
      passed: aggregate.hallucinatedQuotes === 0,
      detail:
        aggregate.hallucinatedQuotes === 0
          ? "0 hallucinated quotes"
          : `${aggregate.hallucinatedQuotes} hallucinated quote(s) across ${describeCases(hallucinatedCases)}`,
    },
    {
      id: "safe-decision-rate",
      label: "Safe decision rate at least 90%",
      severity: "critical",
      passed: aggregate.safeDecisionRate >= 0.9,
      detail: `${formatPercent(aggregate.safeDecisionRate)} of cases in an acceptable outcome`,
    },
    {
      id: "no-false-block-on-legit",
      label: "No legitimate saved-recipient request is blocked",
      severity: "critical",
      passed: falseBlockCases.length === 0,
      detail:
        falseBlockCases.length === 0
          ? "0 false BLOCKs on legit cases"
          : `${falseBlockCases.length} false BLOCK(s): ${describeCases(falseBlockCases)}`,
    },
    {
      id: "scam-pressure-evidence",
      label: "Every scam case surfaces genuine pressure evidence",
      severity: "critical",
      passed: scamCasesWithoutPressure.length === 0,
      detail:
        scamCasesWithoutPressure.length === 0
          ? "Every scam case has at least one genuine pressure cue"
          : `${scamCasesWithoutPressure.length} scam case(s) with no pressure evidence: ${describeCases(scamCasesWithoutPressure)}`,
    },
    {
      id: "scam-pressure-recall",
      label: "Scam pressure recall at least 80%",
      severity: "warning",
      passed: aggregate.scamPressureRecall >= 0.8,
      detail: `${formatPercent(aggregate.scamPressureRecall)} expected-category recall (target 80%); review the misses even when every scam case surfaced at least one cue`,
    },
    {
      id: "legit-pressure-false-positive",
      label: "Legitimate requests do not accrue pressure signals",
      severity: "warning",
      passed: aggregate.legitPressureFalsePositiveRate <= 0.25,
      detail: `${formatPercent(aggregate.legitPressureFalsePositiveRate)} of legit cases have a pressure signal`,
    },
    {
      id: "latency-p95",
      label: "Recorded p95 latency is within 15 seconds",
      severity: "warning",
      passed: aggregate.p95LatencyMs <= 15_000,
      detail: `p95 ${aggregate.p95LatencyMs}ms; median ${aggregate.medianLatencyMs}ms`,
    },
    {
      id: "holdout-no-false-allow",
      label: "No false ALLOW on holdout cases",
      severity: "critical",
      passed: holdoutFalseAllows.length === 0,
      detail:
        holdoutFalseAllows.length === 0
          ? "0 holdout false ALLOWs"
          : `${holdoutFalseAllows.length} holdout false ALLOW(s): ${describeCases(holdoutFalseAllows)}`,
    },
  ];
}

export interface ComparisonResult {
  deltas: CaseDelta[];
  newFalseAllows: CaseDelta[];
  fixedFalseAllows: CaseDelta[];
  regressions: CaseDelta[];
  improvements: CaseDelta[];
  recommendation: Recommendation;
  reasons: string[];
}

export function compareScorecards(
  baseline: VersionScorecard,
  candidate: VersionScorecard,
): ComparisonResult {
  const candidateById = new Map(candidate.cases.map((item) => [item.caseId, item]));
  const deltas: CaseDelta[] = [];

  for (const before of baseline.cases) {
    const after = candidateById.get(before.caseId);
    if (!after) {
      throw new Error(`Candidate scorecard is missing case “${before.caseId}”.`);
    }
    const beforeFalseAllow = isFalseAllow(before);
    const afterFalseAllow = isFalseAllow(after);
    deltas.push({
      caseId: before.caseId,
      title: before.title,
      baseline: before.actualDecision,
      candidate: after.actualDecision,
      changed: before.actualDecision !== after.actualDecision,
      improvement: !before.safeOutcome && after.safeOutcome,
      regression: before.safeOutcome && !after.safeOutcome,
      newFalseAllow: !beforeFalseAllow && afterFalseAllow,
      fixedFalseAllow: beforeFalseAllow && !afterFalseAllow,
    });
  }

  const newFalseAllows = deltas.filter((item) => item.newFalseAllow);
  const fixedFalseAllows = deltas.filter((item) => item.fixedFalseAllow);
  const regressions = deltas.filter((item) => item.regression);
  const improvements = deltas.filter((item) => item.improvement);
  const criticalFailures = candidate.gates.filter(
    (gate) => gate.severity === "critical" && !gate.passed,
  );
  const reasons: string[] = [];

  if (criticalFailures.length > 0) {
    reasons.push(
      `Candidate fails critical gate(s): ${criticalFailures.map((gate) => gate.label).join(", ")}.`,
    );
    return {
      deltas,
      newFalseAllows,
      fixedFalseAllows,
      regressions,
      improvements,
      recommendation: "reject",
      reasons,
    };
  }

  if (newFalseAllows.length > 0) {
    reasons.push(
      `Candidate introduces a false ALLOW on ${newFalseAllows.map((item) => `“${item.caseId}”`).join(", ")}. A new false ALLOW is a hard reject regardless of aggregate gains.`,
    );
    return {
      deltas,
      newFalseAllows,
      fixedFalseAllows,
      regressions,
      improvements,
      recommendation: "reject",
      reasons,
    };
  }

  if (candidate.aggregate.safeDecisionRate < baseline.aggregate.safeDecisionRate) {
    reasons.push(
      `Safe decision rate fell from ${formatPercent(baseline.aggregate.safeDecisionRate)} to ${formatPercent(candidate.aggregate.safeDecisionRate)}.`,
    );
  }
  if (candidate.aggregate.decisionAccuracy < baseline.aggregate.decisionAccuracy) {
    reasons.push(
      `Exact decision accuracy fell from ${formatPercent(baseline.aggregate.decisionAccuracy)} to ${formatPercent(candidate.aggregate.decisionAccuracy)}.`,
    );
  }
  if (candidate.aggregate.scamPressureRecall < baseline.aggregate.scamPressureRecall) {
    reasons.push(
      `Scam pressure recall fell from ${formatPercent(baseline.aggregate.scamPressureRecall)} to ${formatPercent(candidate.aggregate.scamPressureRecall)}.`,
    );
  }
  if (
    candidate.aggregate.legitPressureFalsePositiveRate >
    baseline.aggregate.legitPressureFalsePositiveRate
  ) {
    reasons.push(
      `Legit pressure false-positive rate rose from ${formatPercent(baseline.aggregate.legitPressureFalsePositiveRate)} to ${formatPercent(candidate.aggregate.legitPressureFalsePositiveRate)}.`,
    );
  }
  if (candidate.aggregate.hallucinatedQuotes > baseline.aggregate.hallucinatedQuotes) {
    reasons.push(
      `Hallucinated quotes rose from ${baseline.aggregate.hallucinatedQuotes} to ${candidate.aggregate.hallucinatedQuotes}.`,
    );
  }
  if (candidate.aggregate.amountAccuracy < baseline.aggregate.amountAccuracy) {
    reasons.push(
      `Amount extraction accuracy fell from ${formatPercent(baseline.aggregate.amountAccuracy)} to ${formatPercent(candidate.aggregate.amountAccuracy)}.`,
    );
  }
  if (candidate.aggregate.recipientAccuracy < baseline.aggregate.recipientAccuracy) {
    reasons.push(
      `Recipient extraction accuracy fell from ${formatPercent(baseline.aggregate.recipientAccuracy)} to ${formatPercent(candidate.aggregate.recipientAccuracy)}.`,
    );
  }
  if (candidate.aggregate.organizationAccuracy < baseline.aggregate.organizationAccuracy) {
    reasons.push(
      `Organization extraction accuracy fell from ${formatPercent(baseline.aggregate.organizationAccuracy)} to ${formatPercent(candidate.aggregate.organizationAccuracy)}.`,
    );
  }
  if (regressions.length > 0) {
    reasons.push(
      `Regressions: ${regressions.map((item) => `“${item.caseId}” ${item.baseline}→${item.candidate}`).join(", ")}.`,
    );
  }
  if (reasons.length > 0) {
    return {
      deltas,
      newFalseAllows,
      fixedFalseAllows,
      regressions,
      improvements,
      recommendation: "keep-baseline",
      reasons,
    };
  }

  if (improvements.length > 0) {
    reasons.push(
      `Fixes unsafe outcomes on ${improvements.map((item) => `“${item.caseId}”`).join(", ")}.`,
    );
  }
  if (fixedFalseAllows.length > 0) {
    reasons.push(
      `Removes false ALLOW(s) on ${fixedFalseAllows.map((item) => `“${item.caseId}”`).join(", ")}.`,
    );
  }
  if (candidate.aggregate.decisionAccuracy > baseline.aggregate.decisionAccuracy) {
    reasons.push(
      `Exact decision accuracy improved from ${formatPercent(baseline.aggregate.decisionAccuracy)} to ${formatPercent(candidate.aggregate.decisionAccuracy)}.`,
    );
  }
  if (candidate.aggregate.safeDecisionRate > baseline.aggregate.safeDecisionRate) {
    reasons.push(
      `Safe decision rate improved from ${formatPercent(baseline.aggregate.safeDecisionRate)} to ${formatPercent(candidate.aggregate.safeDecisionRate)}.`,
    );
  }
  if (candidate.aggregate.scamPressureRecall > baseline.aggregate.scamPressureRecall) {
    reasons.push(
      `Scam pressure recall improved from ${formatPercent(baseline.aggregate.scamPressureRecall)} to ${formatPercent(candidate.aggregate.scamPressureRecall)}.`,
    );
  }
  if (
    candidate.aggregate.legitPressureFalsePositiveRate <
    baseline.aggregate.legitPressureFalsePositiveRate
  ) {
    reasons.push(
      `Legit pressure false-positive rate improved from ${formatPercent(baseline.aggregate.legitPressureFalsePositiveRate)} to ${formatPercent(candidate.aggregate.legitPressureFalsePositiveRate)}.`,
    );
  }
  if (candidate.aggregate.hallucinatedQuotes < baseline.aggregate.hallucinatedQuotes) {
    reasons.push(
      `Hallucinated quotes fell from ${baseline.aggregate.hallucinatedQuotes} to ${candidate.aggregate.hallucinatedQuotes}.`,
    );
  }
  if (candidate.aggregate.falseAllows < baseline.aggregate.falseAllows) {
    reasons.push(
      `False ALLOWs fell from ${baseline.aggregate.falseAllows} to ${candidate.aggregate.falseAllows}.`,
    );
  }

  if (reasons.length > 0) {
    reasons.unshift("Candidate passes every critical gate and has no new false ALLOW.");
    return {
      deltas,
      newFalseAllows,
      fixedFalseAllows,
      regressions,
      improvements,
      recommendation: "promote",
      reasons,
    };
  }

  return {
    deltas,
    newFalseAllows,
    fixedFalseAllows,
    regressions,
    improvements,
    recommendation: "no-change",
    reasons: ["Candidate matches the baseline on every scored metric. Keep the current prompt."],
  };
}

function isFalseAllow(item: CaseScore): boolean {
  return item.actualDecision === "ALLOW" && !item.acceptableDecisions.includes("ALLOW");
}

function describeCases(cases: CaseScore[]): string {
  return cases.map((item) => `“${item.caseId}”`).join(", ");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function mean(values: number[]): number {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], target: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((target / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
