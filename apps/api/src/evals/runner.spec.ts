import { describe, expect, it } from "vitest";
import { getPromptVersion } from "../agent/prompts";
import { loadEvalCases } from "./cases";
import { EvalProviderError, EvalSetupError, ReplayModelClient, StubModelClient } from "./model-client";
import { DEFAULT_CASES_PATH } from "./paths";
import { runVersion } from "./runner";

const CASES = loadEvalCases(DEFAULT_CASES_PATH);
const VERSION = getPromptVersion("v2-hardened");

function caseById(id: string) {
  const found = CASES.find((item) => item.id === id);
  if (!found) throw new Error(`missing case ${id}`);
  return found;
}

const idealClient = new StubModelClient(({ evalCase }) => ({
  ...evalCase.idealExtraction,
}));

describe("runVersion", () => {
  it("scores the ideal extraction against the real policy and passes every gate", async () => {
    const scorecard = await runVersion({
      version: VERSION,
      cases: CASES,
      client: idealClient,
    });

    expect(scorecard.provider).toBe("stub");
    expect(scorecard.model).toBe("stub-model");
    expect(scorecard.cases).toHaveLength(CASES.length);
    expect(scorecard.aggregate.safeOutcomes).toBe(CASES.length);
    // The gift-card case has no spoken recipient, so the ideal extraction is
    // held rather than blocked. HOLD is acceptable; the preferred BLOCK would
    // require copying a form-only name the caller never said.
    expect(scorecard.aggregate.decisionCorrect).toBe(CASES.length - 1);
    expect(scorecard.aggregate.falseAllows).toBe(0);
    expect(scorecard.aggregate.hallucinatedQuotes).toBe(0);
    expect(scorecard.aggregate.amountAccuracy).toBe(1);
    expect(scorecard.aggregate.recipientAccuracy).toBe(1);
    expect(scorecard.aggregate.organizationAccuracy).toBe(1);
    expect(scorecard.aggregate.holdoutCases).toBe(2);
    expect(scorecard.aggregate.totalTokens).toBe(CASES.length * 150);
    expect(scorecard.criticalFailures).toEqual([]);
    expect(scorecard.gates.every((gate) => gate.passed)).toBe(true);
  });

  it("fails the false-ALLOW gate when a saved merchant impersonation loses its pressure evidence", async () => {
    const evalCase = caseById("scam-saved-merchant-impersonation");
    const client = new StubModelClient(({ evalCase: current }) => ({
      ...current.idealExtraction,
      pressureSignals: [],
    }));

    const scorecard = await runVersion({ version: VERSION, cases: [evalCase], client });
    const score = scorecard.cases[0];

    expect(score?.actualDecision).toBe("ALLOW");
    expect(score?.decisionCorrect).toBe(false);
    expect(score?.safeOutcome).toBe(false);
    expect(scorecard.aggregate.falseAllows).toBe(1);
    expect(scorecard.aggregate.falseAllowsOnCritical).toBe(1);
    expect(scorecard.criticalFailures).toContain(
      "No ALLOW on a request that should be held or blocked",
    );
    expect(scorecard.gates.find((gate) => gate.id === "no-false-allow")?.detail).toContain(
      "scam-saved-merchant-impersonation",
    );
  });

  it("counts quotes the model invented even when normalization removes them", async () => {
    const evalCase = caseById("legit-renewal");
    const client = new StubModelClient(({ evalCase: current }) => ({
      ...current.idealExtraction,
      pressureSignals: [
        {
          quote: "You must pay immediately or lose access.",
          category: "urgency",
          explanation: "This sentence never appears in the transcript.",
          startSeconds: null,
        },
      ],
    }));

    const scorecard = await runVersion({ version: VERSION, cases: [evalCase], client });
    const score = scorecard.cases[0];

    expect(score?.actualDecision).toBe("ALLOW");
    expect(score?.safeOutcome).toBe(true);
    expect(score?.schemaValid).toBe(true);
    expect(score?.rawQuoteCount).toBe(1);
    expect(score?.hallucinatedQuoteCount).toBe(1);
    expect(score?.hallucinatedQuotes).toEqual([
      "You must pay immediately or lose access.",
    ]);
    expect(scorecard.aggregate.hallucinatedQuotes).toBe(1);
    expect(scorecard.criticalFailures).toContain(
      "No pressure quote invented outside the transcript",
    );
  });

  it("records a provider failure as an ERROR case and continues", async () => {
    const evalCase = caseById("scam-gift-card");
    const client = new StubModelClient(() => {
      throw new EvalProviderError("Groq rate limit persisted after retries.", 429);
    });

    const scorecard = await runVersion({ version: VERSION, cases: [evalCase], client });
    const score = scorecard.cases[0];

    expect(score?.actualDecision).toBe("ERROR");
    expect(score?.schemaValid).toBe(false);
    expect(score?.safeOutcome).toBe(false);
    expect(score?.error).toMatch(/rate limit persisted/);
    expect(score?.latencyMs).toBe(0);
    expect(scorecard.aggregate.schemaValid).toBe(0);
    expect(scorecard.criticalFailures).toContain("Every extraction validates");
  });

  it("records an extraction that fails schema validation as an ERROR case", async () => {
    const evalCase = caseById("legit-renewal");
    const client = new StubModelClient(({ evalCase: current }) => ({
      ...current.idealExtraction,
      amount: -5,
    }));

    const scorecard = await runVersion({ version: VERSION, cases: [evalCase], client });
    const score = scorecard.cases[0];

    expect(score?.actualDecision).toBe("ERROR");
    expect(score?.schemaValid).toBe(false);
    expect(score?.error).toMatch(/incomplete analysis|invalid/i);
    expect(score?.rawQuoteCount).toBe(0);
  });

  it("propagates a replay setup problem instead of scoring it as a model failure", async () => {
    const client = new ReplayModelClient({
      cacheDir: "/definitely/not/a/cache",
      model: "openai/gpt-oss-120b",
    });

    await expect(
      runVersion({ version: VERSION, cases: [caseById("legit-renewal")], client }),
    ).rejects.toBeInstanceOf(EvalSetupError);
  });

  it("keeps the missing-amount holdout as HOLD with a null amount", async () => {
    const evalCase = caseById("ambiguous-missing-amount");
    const scorecard = await runVersion({
      version: VERSION,
      cases: [evalCase],
      client: idealClient,
    });
    const score = scorecard.cases[0];

    expect(score?.actualDecision).toBe("HOLD");
    expect(score?.amountActual).toBeNull();
    expect(score?.amountCorrect).toBe(true);
    expect(score?.safeOutcome).toBe(true);
  });
});
