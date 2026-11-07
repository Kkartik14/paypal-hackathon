import type { CaseDelta, ComparisonReport, VersionScorecard } from "./types";

export function renderComparisonMarkdown(report: ComparisonReport): string {
  const { baseline, candidate } = report;
  const lines: string[] = [];

  lines.push("# ScamBrake prompt evaluation");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Model: \`${candidate.model}\``);
  lines.push("");
  lines.push(
    `Baseline: **${baseline.versionId}** (${baseline.versionLabel}) · ${baseline.provider}`,
  );
  lines.push("");
  lines.push(
    `Candidate: **${candidate.versionId}** (${candidate.versionLabel}) · ${candidate.provider}`,
  );
  lines.push("");
  lines.push(
    `Cases: ${report.caseCount} (${report.holdoutCount} holdout) · mode: ${report.live ? "live" : "replay"}`,
  );
  lines.push("");

  lines.push("## Recommendation");
  lines.push("");
  lines.push(`**${recommendationLabel(report.recommendation)}**`);
  lines.push("");
  for (const reason of report.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push("");

  lines.push("## Critical gates");
  lines.push("");
  lines.push("| Gate | Severity | Baseline | Candidate | Detail |");
  lines.push("|---|---|---|---|---|");
  const candidateGates = new Map(candidate.gates.map((gate) => [gate.id, gate]));
  for (const gate of baseline.gates) {
    const candidateGate = candidateGates.get(gate.id);
    lines.push(
      `| ${escapePipes(gate.label)} | ${gate.severity} | ${gate.passed ? "pass" : "FAIL"} | ${
        candidateGate?.passed ? "pass" : "FAIL"
      } | ${escapePipes(candidateGate?.detail ?? "missing")} |`,
    );
  }
  lines.push("");

  lines.push("## Aggregate scorecard");
  lines.push("");
  lines.push("| Metric | Baseline | Candidate | Delta |");
  lines.push("|---|---:|---:|---:|");
  const metrics: Array<{
    label: string;
    value: (scorecard: VersionScorecard) => string;
    delta: (before: number, after: number) => string;
    raw: (scorecard: VersionScorecard) => number;
  }> = [
    {
      label: "Cases",
      value: (s) => String(s.aggregate.cases),
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.cases,
    },
    {
      label: "Schema valid",
      value: (s) => `${s.aggregate.schemaValid}/${s.aggregate.cases}`,
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.schemaValid,
    },
    {
      label: "Safe decision rate",
      value: (s) => percent(s.aggregate.safeDecisionRate),
      delta: (a, b) => percentageDelta(a, b),
      raw: (s) => s.aggregate.safeDecisionRate,
    },
    {
      label: "Exact decision accuracy",
      value: (s) => percent(s.aggregate.decisionAccuracy),
      delta: (a, b) => percentageDelta(a, b),
      raw: (s) => s.aggregate.decisionAccuracy,
    },
    {
      label: "False ALLOWs",
      value: (s) => String(s.aggregate.falseAllows),
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.falseAllows,
    },
    {
      label: "False BLOCKs on legit",
      value: (s) => String(s.aggregate.falseBlocksOnLegit),
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.falseBlocksOnLegit,
    },
    {
      label: "False HOLDs on legit",
      value: (s) => String(s.aggregate.falseHoldsOnLegit),
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.falseHoldsOnLegit,
    },
    {
      label: "Scam pressure recall",
      value: (s) => percent(s.aggregate.scamPressureRecall),
      delta: (a, b) => percentageDelta(a, b),
      raw: (s) => s.aggregate.scamPressureRecall,
    },
    {
      label: "Legit pressure false-positive rate",
      value: (s) => percent(s.aggregate.legitPressureFalsePositiveRate),
      delta: (a, b) => percentageDelta(a, b),
      raw: (s) => s.aggregate.legitPressureFalsePositiveRate,
    },
    {
      label: "Hallucinated quotes",
      value: (s) => String(s.aggregate.hallucinatedQuotes),
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.hallucinatedQuotes,
    },
    {
      label: "Amount accuracy",
      value: (s) => percent(s.aggregate.amountAccuracy),
      delta: (a, b) => percentageDelta(a, b),
      raw: (s) => s.aggregate.amountAccuracy,
    },
    {
      label: "Recipient accuracy",
      value: (s) => percent(s.aggregate.recipientAccuracy),
      delta: (a, b) => percentageDelta(a, b),
      raw: (s) => s.aggregate.recipientAccuracy,
    },
    {
      label: "Median latency",
      value: (s) => `${s.aggregate.medianLatencyMs}ms`,
      delta: (a, b) => signed(b - a) + "ms",
      raw: (s) => s.aggregate.medianLatencyMs,
    },
    {
      label: "p95 latency",
      value: (s) => `${s.aggregate.p95LatencyMs}ms`,
      delta: (a, b) => signed(b - a) + "ms",
      raw: (s) => s.aggregate.p95LatencyMs,
    },
    {
      label: "Total tokens",
      value: (s) => s.aggregate.totalTokens.toLocaleString("en-US"),
      delta: (a, b) => signed(b - a),
      raw: (s) => s.aggregate.totalTokens,
    },
  ];
  for (const metric of metrics) {
    lines.push(
      `| ${metric.label} | ${metric.value(baseline)} | ${metric.value(candidate)} | ${metric.delta(
        metric.raw(baseline),
        metric.raw(candidate),
      )} |`,
    );
  }
  lines.push("");

  lines.push("## Per-case results");
  lines.push("");
  lines.push(
    "| Case | Tags | Expected | Baseline | Candidate | Delta | Safe? | Hallucinated quotes |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  const deltaById = new Map(report.deltas.map((delta) => [delta.caseId, delta]));
  const candidateById = new Map(candidate.cases.map((item) => [item.caseId, item]));
  for (const before of baseline.cases) {
    const after = candidateById.get(before.caseId);
    const delta = deltaById.get(before.caseId);
    if (!after || !delta) continue;
    const safe = after.safeOutcome ? "yes" : after.actualDecision === "ALLOW" ? "FALSE ALLOW" : "no";
    lines.push(
      `| ${escapePipes(before.title)} | ${before.tags.join(", ")} | ${before.expectedDecision} | ${before.actualDecision} | ${after.actualDecision} | ${deltaLabel(delta)} | ${safe} | ${after.hallucinatedQuoteCount} |`,
    );
  }
  lines.push("");

  const criticalFailures = candidate.gates.filter(
    (gate) => gate.severity === "critical" && !gate.passed,
  );
  if (criticalFailures.length > 0 || report.newFalseAllows.length > 0) {
    lines.push("## Blocking failures");
    lines.push("");
    for (const gate of criticalFailures) {
      lines.push(`- **${gate.label}** — ${gate.detail}`);
    }
    for (const delta of report.newFalseAllows) {
      lines.push(
        `- **New false ALLOW** on “${delta.caseId}” (${delta.baseline} → ${delta.candidate}).`,
      );
    }
    lines.push("");
  }

  const changed = report.deltas.filter((delta) => delta.changed);
  if (changed.length > 0) {
    lines.push("## Decision changes");
    lines.push("");
    for (const delta of changed) {
      const flags: string[] = [];
      if (delta.fixedFalseAllow) flags.push("fixed false ALLOW");
      if (delta.newFalseAllow) flags.push("new false ALLOW");
      if (delta.improvement) flags.push("improvement");
      if (delta.regression) flags.push("regression");
      lines.push(
        `- “${delta.caseId}”: ${delta.baseline} → ${delta.candidate}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`,
      );
    }
    lines.push("");
  }

  lines.push("## Method and limits");
  lines.push("");
  lines.push(
    "- The harness scores the real extraction normalization, the real deterministic `PolicyService`, and the real shared contracts. It does not use an LLM judge.",
  );
  lines.push(
    "- The default `replay` mode reads committed raw model outputs. It needs no credentials and cannot create a PayPal order. `--live` records fresh outputs with the production prompt and model.",
  );
  lines.push(
    "- The evaluation isolates the extraction phase. The profile rules and saved recipients are included in the prompt; the read-only tool round is covered separately by the provider tests.",
  );
  lines.push(
    "- The cases are synthetic and authored by the same team. The holdout split is procedural, not an unbiased benchmark. Treat the result as a regression gate, not a claim of real-world accuracy.",
  );
  lines.push(
    "- No prompt is promoted from an aggregate score alone. A candidate must pass every critical gate, introduce no new false ALLOW, and avoid holdout regressions. A human still reviews the change.",
  );
  lines.push("");

  return lines.join("\n");
}

export function renderVersionMarkdown(scorecard: VersionScorecard): string {
  const lines: string[] = [];
  lines.push(`# ScamBrake prompt scorecard: ${scorecard.versionId}`);
  lines.push("");
  lines.push(`Version: **${scorecard.versionLabel}**`);
  lines.push("");
  lines.push(`Provider: ${scorecard.provider} · model: \`${scorecard.model}\``);
  lines.push("");
  lines.push("## Gates");
  lines.push("");
  lines.push("| Gate | Severity | Result | Detail |");
  lines.push("|---|---|---|---|");
  for (const gate of scorecard.gates) {
    lines.push(
      `| ${escapePipes(gate.label)} | ${gate.severity} | ${gate.passed ? "pass" : "FAIL"} | ${escapePipes(gate.detail)} |`,
    );
  }
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| Case | Tags | Expected | Actual | Safe? | Pressure recall | Hallucinated quotes |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const item of scorecard.cases) {
    lines.push(
      `| ${escapePipes(item.title)} | ${item.tags.join(", ")} | ${item.expectedDecision} | ${item.actualDecision} | ${
        item.safeOutcome ? "yes" : "no"
      } | ${
        item.expectedPressureCategories.length === 0
          ? "n/a"
          : percent(item.pressureRecall)
      } | ${item.hallucinatedQuoteCount} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderComparisonJson(report: ComparisonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderVersionJson(scorecard: VersionScorecard): string {
  return `${JSON.stringify(scorecard, null, 2)}\n`;
}

function recommendationLabel(recommendation: ComparisonReport["recommendation"]): string {
  switch (recommendation) {
    case "promote":
      return "PROMOTE the candidate prompt";
    case "reject":
      return "REJECT the candidate prompt";
    case "keep-baseline":
      return "KEEP the baseline prompt";
    default:
      return "NO CHANGE";
  }
}

function deltaLabel(delta: CaseDelta): string {
  if (!delta.changed) return "=";
  const flags: string[] = [];
  if (delta.fixedFalseAllow) flags.push("fixed");
  if (delta.newFalseAllow) flags.push("new false ALLOW");
  return `${delta.baseline} → ${delta.candidate}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function percentageDelta(before: number, after: number): string {
  const delta = (after - before) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
