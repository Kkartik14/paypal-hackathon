import "../env";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PROMPT_VERSION,
  PROMPT_VERSIONS,
  getPromptVersion,
} from "../agent/prompts";
import { loadEvalCases, validateEvalCases } from "./cases";
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_CASES_PATH,
  DEFAULT_REPORTS_DIR,
} from "./paths";
import {
  LiveGroqModelClient,
  ReplayModelClient,
  ThrottledModelClient,
  type EvalModelClient,
} from "./model-client";
import { renderComparisonJson, renderComparisonMarkdown, renderVersionJson, renderVersionMarkdown } from "./report";
import { runVersion } from "./runner";
import { compareScorecards } from "./score";
import type { ComparisonReport, EvalCase, VersionScorecard } from "./types";

interface CliOptions {
  command: "compare" | "run" | "list";
  baseline: string;
  candidate: string;
  versions: string[];
  live: boolean;
  writeCache: boolean;
  cacheDir: string;
  casesPath: string;
  outDir: string;
  throttleMs: number;
  failOnGate: boolean;
  requirePromotion: boolean;
  includeHoldout: boolean;
  caseIds: string[];
  help: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const allCases = loadEvalCases(options.casesPath);
  validateEvalCases(allCases);
  const cases = selectCases(allCases, options);

  if (options.command === "list") {
    printCaseList(cases);
    return;
  }

  const client = createClient(options);

  if (options.command === "run") {
    const versionIds = options.versions.length > 0 ? options.versions : [options.candidate];
    for (const versionId of versionIds) {
      const version = getPromptVersion(versionId);
      const scorecard = await runVersion({ version, cases, client });
      const markdown = renderVersionMarkdown(scorecard);
      const json = renderVersionJson(scorecard);
      const files = writeReports(options.outDir, `scorecard-${version.id}`, markdown, json);
      printVersionSummary(scorecard, files.markdown);
      if (options.failOnGate && scorecard.criticalFailures.length > 0) {
        process.exitCode = 1;
      }
    }
    return;
  }

  const baselineVersion = getPromptVersion(options.baseline);
  const candidateVersion = getPromptVersion(options.candidate);
  const baseline = await runVersion({ version: baselineVersion, cases, client });
  const candidate = await runVersion({ version: candidateVersion, cases, client });
  const result = compareScorecards(baseline, candidate);
  const report: ComparisonReport = {
    generatedAt: new Date().toISOString(),
    baseline,
    candidate,
    ...result,
    casesPath: options.casesPath,
    cacheDir: options.cacheDir,
    live: options.live,
    caseCount: cases.length,
    holdoutCount: cases.filter((item) => item.holdout).length,
  };

  const markdown = renderComparisonMarkdown(report);
  const json = renderComparisonJson(report);
  const files = writeReports(
    options.outDir,
    `comparison-${baseline.versionId}-vs-${candidate.versionId}`,
    markdown,
    json,
  );
  printComparisonSummary(report, files.markdown);
  enforceExitCode(options, report);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "compare",
    baseline: "v2-hardened",
    candidate: DEFAULT_PROMPT_VERSION,
    versions: [],
    live: false,
    writeCache: true,
    cacheDir: DEFAULT_CACHE_DIR,
    casesPath: DEFAULT_CASES_PATH,
    outDir: DEFAULT_REPORTS_DIR,
    throttleMs: 0,
    failOnGate: false,
    requirePromotion: false,
    includeHoldout: true,
    caseIds: [],
    help: false,
  };

  const args = [...argv];
  const first = args[0];
  if (first && !first.startsWith("-")) {
    if (first !== "compare" && first !== "run" && first !== "list") {
      throw new Error(`Unknown command “${first}”. Use compare, run, or list.`);
    }
    options.command = first;
    args.shift();
  }

  let throttleProvided = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--baseline":
        options.baseline = requireValue(args, ++index, arg);
        break;
      case "--candidate":
        options.candidate = requireValue(args, ++index, arg);
        break;
      case "--version":
        options.versions.push(requireValue(args, ++index, arg));
        break;
      case "--live":
        options.live = true;
        break;
      case "--replay":
        options.live = false;
        break;
      case "--write-cache":
        options.writeCache = true;
        break;
      case "--no-write-cache":
        options.writeCache = false;
        break;
      case "--cache":
        options.cacheDir = path.resolve(requireValue(args, ++index, arg));
        break;
      case "--cases":
        options.casesPath = path.resolve(requireValue(args, ++index, arg));
        break;
      case "--out":
        options.outDir = path.resolve(requireValue(args, ++index, arg));
        break;
      case "--throttle":
        options.throttleMs = parseNonNegativeInt(requireValue(args, ++index, arg), arg);
        throttleProvided = true;
        break;
      case "--case":
        options.caseIds.push(requireValue(args, ++index, arg));
        break;
      case "--fail-on-gate":
        options.failOnGate = true;
        break;
      case "--require-promotion":
        options.requirePromotion = true;
        break;
      case "--include-holdout":
        options.includeHoldout = true;
        break;
      case "--exclude-holdout":
        options.includeHoldout = false;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option “${arg}”. Use --help for usage.`);
    }
  }

  if (options.live && !throttleProvided) {
    options.throttleMs = 25_000;
  }
  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseNonNegativeInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function selectCases(cases: EvalCase[], options: CliOptions): EvalCase[] {
  let selected = cases;
  if (!options.includeHoldout) {
    selected = selected.filter((item) => !item.holdout);
  }
  if (options.caseIds.length > 0) {
    const wanted = new Set(options.caseIds);
    const missing = options.caseIds.filter((id) => !cases.some((item) => item.id === id));
    if (missing.length > 0) {
      throw new Error(`Unknown case id(s): ${missing.join(", ")}`);
    }
    selected = selected.filter((item) => wanted.has(item.id));
  }
  if (selected.length === 0) {
    throw new Error("No eval cases selected.");
  }
  return selected;
}

function createClient(options: CliOptions): EvalModelClient {
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

  if (!options.live) {
    return new ReplayModelClient({ cacheDir: options.cacheDir, model });
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is required for --live. Add it to the repository .env or the process environment.",
    );
  }
  const apiBase = (process.env.GROQ_API_BASE ?? "https://api.groq.com/openai/v1").replace(
    /\/+$/,
    "",
  );
  assertProviderBase(apiBase);

  const live = new LiveGroqModelClient({
    apiKey,
    model,
    apiBase,
    cacheDir: options.writeCache ? options.cacheDir : null,
  });
  return options.throttleMs > 0 ? new ThrottledModelClient(live, options.throttleMs) : live;
}

function assertProviderBase(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GROQ_API_BASE must be a valid URL.");
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("GROQ_API_BASE must use HTTPS (localhost is allowed for tests).");
  }
}

function writeReports(
  outDir: string,
  stem: string,
  markdown: string,
  json: string,
): { markdown: string; json: string } {
  mkdirSync(outDir, { recursive: true });
  const latestMarkdown = path.join(outDir, "latest.md");
  const latestJson = path.join(outDir, "latest.json");
  const namedMarkdown = path.join(outDir, `${stem}.md`);
  const namedJson = path.join(outDir, `${stem}.json`);
  writeFileSync(latestMarkdown, markdown, "utf8");
  writeFileSync(latestJson, json, "utf8");
  writeFileSync(namedMarkdown, markdown, "utf8");
  writeFileSync(namedJson, json, "utf8");
  return { markdown: namedMarkdown, json: namedJson };
}

function printCaseList(cases: EvalCase[]): void {
  console.log(`ScamBrake eval cases · ${cases.length}`);
  console.log("");
  console.log(
    `${"ID".padEnd(38)} ${"TAGS".padEnd(24)} ${"EXPECTED".padEnd(10)} ${"ACCEPTABLE".padEnd(14)} HOLDOUT CRITICAL`,
  );
  for (const item of cases) {
    console.log(
      `${item.id.padEnd(38)} ${item.tags.join(",").padEnd(24)} ${item.expected.decision.padEnd(10)} ${item.expected.acceptableDecisions.join("/").padEnd(14)} ${(item.holdout ? "yes" : "no").padEnd(7)} ${item.critical ? "yes" : "no"}`,
    );
  }
}

function printVersionSummary(scorecard: VersionScorecard, reportPath: string): void {
  const result = scorecard.criticalFailures.length === 0 ? "pass" : "FAIL";
  console.log(
    `${scorecard.versionId}: ${result} · safe ${scorecard.aggregate.safeOutcomes}/${scorecard.aggregate.cases} · ` +
      `false ALLOW ${scorecard.aggregate.falseAllows} · hallucinated ${scorecard.aggregate.hallucinatedQuotes} · ` +
      `exact ${percent(scorecard.aggregate.decisionAccuracy)}`,
  );
  console.log(`Report: ${reportPath}`);
}

function printComparisonSummary(report: ComparisonReport, reportPath: string): void {
  console.log(
    `ScamBrake prompt eval · ${report.caseCount} cases · ${report.live ? "live" : "replay"} · ${report.candidate.model}`,
  );
  console.log(
    `Baseline ${report.baseline.versionId}: safe ${report.baseline.aggregate.safeOutcomes}/${report.baseline.aggregate.cases} · ` +
      `false ALLOW ${report.baseline.aggregate.falseAllows} · hallucinated ${report.baseline.aggregate.hallucinatedQuotes} · ` +
      `exact ${percent(report.baseline.aggregate.decisionAccuracy)}`,
  );
  console.log(
    `Candidate ${report.candidate.versionId}: safe ${report.candidate.aggregate.safeOutcomes}/${report.candidate.aggregate.cases} · ` +
      `false ALLOW ${report.candidate.aggregate.falseAllows} · hallucinated ${report.candidate.aggregate.hallucinatedQuotes} · ` +
      `exact ${percent(report.candidate.aggregate.decisionAccuracy)}`,
  );
  console.log(`Recommendation: ${report.recommendation.toUpperCase()}`);
  for (const reason of report.reasons) {
    console.log(`- ${reason}`);
  }
  console.log(`Report: ${reportPath}`);
}

function enforceExitCode(options: CliOptions, report: ComparisonReport | undefined): void {
  const criticalFailure = report?.candidate.gates.some(
    (gate) => gate.severity === "critical" && !gate.passed,
  );
  const newFalseAllow = (report?.newFalseAllows.length ?? 0) > 0;

  if (options.failOnGate && (criticalFailure || newFalseAllow)) {
    process.exitCode = 1;
  }
  if (
    options.requirePromotion &&
    report &&
    report.recommendation !== "promote" &&
    report.recommendation !== "no-change"
  ) {
    process.exitCode = 1;
  }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printHelp(): void {
  console.log(`ScamBrake prompt evaluation

Usage:
  eval compare [options]       Compare two prompt versions (default)
  eval run [options]           Score one or more versions
  eval list [options]          List the cases

Options:
  --baseline <id>              Baseline version (default: v2-hardened)
  --candidate <id>             Candidate version (default: ${DEFAULT_PROMPT_VERSION})
  --version <id>               Version to score for “run”; repeatable
  --live                       Call Groq and record raw outputs
  --replay                     Read committed outputs (default)
  --cache <dir>                Cache directory (default: apps/api/evals/cache)
  --cases <path>               Case file (default: apps/api/evals/cases.json)
  --out <dir>                  Report directory (default: apps/api/evals/reports)
  --case <id>                  Limit to one case; repeatable
  --exclude-holdout            Skip holdout cases
  --throttle <ms>              Minimum spacing between live requests (default: 25000)
  --no-write-cache             Do not record live outputs
  --fail-on-gate               Exit 1 if a critical gate fails or a new false ALLOW appears
  --require-promotion          Exit 1 unless the recommendation is promote or no-change
  -h, --help                   Show this help

Prompt versions: ${Object.keys(PROMPT_VERSIONS).join(", ")}
`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
