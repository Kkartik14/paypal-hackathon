import { describe, expect, it } from "vitest";
import { DEFAULT_CASES_PATH } from "./paths";
import { loadEvalCases, parseEvalCases, validateEvalCases } from "./cases";
import type { EvalCase } from "./types";

const CASES = loadEvalCases(DEFAULT_CASES_PATH);

function cloneCase(base: EvalCase, overrides: Partial<EvalCase>): EvalCase {
  return {
    ...base,
    ...overrides,
    tags: [...(overrides.tags ?? base.tags)],
    expected: {
      ...base.expected,
      ...(overrides.expected ?? {}),
      acceptableDecisions: [
        ...(overrides.expected?.acceptableDecisions ?? base.expected.acceptableDecisions),
      ],
      pressureCategories: [
        ...(overrides.expected?.pressureCategories ?? base.expected.pressureCategories),
      ],
    },
    idealExtraction: {
      ...base.idealExtraction,
      ...(overrides.idealExtraction ?? {}),
      pressureSignals: [
        ...(overrides.idealExtraction?.pressureSignals ?? base.idealExtraction.pressureSignals),
      ],
      missingFields: [
        ...(overrides.idealExtraction?.missingFields ?? base.idealExtraction.missingFields),
      ],
    },
  };
}

describe("eval case file", () => {
  it("loads the committed cases and validates every ideal extraction against the real policy", () => {
    expect(CASES).toHaveLength(12);
    expect(() => validateEvalCases(CASES)).not.toThrow();
  });

  it("has unique ids, at least one scam case, and exactly two holdouts", () => {
    expect(new Set(CASES.map((item) => item.id)).size).toBe(CASES.length);
    expect(CASES.filter((item) => item.tags.includes("scam")).length).toBeGreaterThan(0);
    expect(CASES.filter((item) => item.holdout).map((item) => item.id)).toEqual([
      "legit-quoted-scam-warning",
      "ambiguous-missing-amount",
    ]);
  });

  it("never expects ALLOW for a scam-tagged case", () => {
    for (const evalCase of CASES) {
      if (evalCase.tags.includes("scam")) {
        expect(evalCase.expected.decision).not.toBe("ALLOW");
      }
    }
  });

  it("rejects a duplicate id", () => {
    const duplicated = [CASES[0], CASES[0]];
    expect(() => parseEvalCases(duplicated)).toThrow(/Duplicate eval case id/);
  });

  it("rejects an invalid case shape", () => {
    expect(() => parseEvalCases([{ id: "Not Valid" }])).toThrow(/Invalid eval case file/);
  });

  it("fails loudly when the case file is missing", () => {
    expect(() => loadEvalCases("/definitely/not/here/cases.json")).toThrow(
      /Could not read eval cases/,
    );
  });
});

describe("validateEvalCases", () => {
  const base = CASES.find((item) => item.id === "legit-renewal");
  if (!base) throw new Error("legit-renewal case is missing");

  it("rejects an ideal extraction that produces a different decision than the label", () => {
    const broken = cloneCase(base, {
      id: "broken-hold-label",
      tags: ["ambiguous"],
      expected: {
        ...base.expected,
        decision: "HOLD",
        acceptableDecisions: ["HOLD"],
      },
    });

    expect(() => validateEvalCases([broken])).toThrow(/ideal extraction produces ALLOW/);
  });

  it("rejects ALLOW as an acceptable outcome for a non-ALLOW case", () => {
    const broken = cloneCase(base, {
      id: "broken-acceptable",
      tags: ["ambiguous"],
      expected: {
        ...base.expected,
        decision: "HOLD",
        acceptableDecisions: ["HOLD", "ALLOW"],
      },
    });

    expect(() => validateEvalCases([broken])).toThrow(
      /ALLOW cannot be an acceptable outcome/,
    );
  });

  it("rejects a scam-tagged case that expects ALLOW", () => {
    const broken = cloneCase(base, {
      id: "broken-scam-allow",
      tags: ["scam"],
    });

    expect(() => validateEvalCases([broken])).toThrow(/a scam-tagged case cannot expect ALLOW/);
  });

  it("rejects an ideal pressure quote that is not in the transcript", () => {
    const broken = cloneCase(base, {
      id: "broken-quote",
      expected: {
        ...base.expected,
        pressureCategories: ["urgency"],
      },
      idealExtraction: {
        ...base.idealExtraction,
        pressureSignals: [
          {
            quote: "This sentence was never spoken by anyone.",
            category: "urgency",
            explanation: "Invented evidence.",
          },
        ],
      },
    });

    expect(() => validateEvalCases([broken])).toThrow(
      /ideal pressure quote is not in the transcript/,
    );
  });

  it("rejects a case whose ideal extraction disagrees with the expected amount", () => {
    const broken = cloneCase(base, {
      id: "broken-amount",
      expected: {
        ...base.expected,
        amount: 999,
      },
    });

    expect(() => validateEvalCases([broken])).toThrow(/idealExtraction.amount/);
  });
});
