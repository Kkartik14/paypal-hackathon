import { describe, expect, it } from "vitest";
import { ApiException } from "../common/api.exception";
import {
  auditRawQuotes,
  normalizeExtraction,
  parseJsonObject,
} from "./extraction";

const TRANSCRIPT =
  "This exact sentence is in the transcript. This is a routine renewal with no pressure.";

const RAW = {
  claimedIdentity: "Kettle and Co. billing",
  claimedOrganization: "Kettle & Co.",
  requestedAction: "Approve the renewal",
  requestedRecipientName: "Kettle & Co.",
  requestedRecipientIdentifier: "billing@kettleandco.example",
  amount: 18,
  currency: "USD",
  purpose: "Monthly coffee subscription renewal",
  pressureSignals: [
    {
      quote: "This exact sentence is in the transcript.",
      category: "urgency",
      explanation: "A real quote.",
      startSeconds: null,
    },
    {
      quote: "This sentence was never spoken.",
      category: "threat",
      explanation: "A hallucinated quote.",
      startSeconds: null,
    },
  ],
  missingFields: [],
  confidence: 0.93,
  summary: "A routine renewal.",
};

describe("normalizeExtraction", () => {
  it("drops quotes that do not appear in the transcript", () => {
    const extraction = normalizeExtraction(RAW, TRANSCRIPT);

    expect(extraction.transcript).toBe(TRANSCRIPT);
    expect(extraction.pressureSignals).toHaveLength(1);
    expect(extraction.pressureSignals[0]?.quote).toBe(
      "This exact sentence is in the transcript.",
    );
  });

  it("normalizes unknown categories and clamps confidence", () => {
    const extraction = normalizeExtraction(
      {
        ...RAW,
        pressureSignals: [
          {
            quote: "This exact sentence is in the transcript.",
            category: "made_up_category",
            explanation: "Unknown category.",
            startSeconds: null,
          },
        ],
        confidence: 4,
      },
      TRANSCRIPT,
    );

    expect(extraction.pressureSignals[0]?.category).toBe("other");
    expect(extraction.confidence).toBe(1);
  });

  it("fails loudly on an empty transcript", () => {
    expect(() => normalizeExtraction(RAW, "   ")).toThrow(ApiException);
  });
});

describe("auditRawQuotes", () => {
  it("counts hallucinated quotes before normalization removes them", () => {
    const audit = auditRawQuotes(RAW, TRANSCRIPT);

    expect(audit.total).toBe(2);
    expect(audit.hallucinated).toBe(1);
    expect(audit.entries.map((entry) => entry.present)).toEqual([true, false]);
  });

  it("returns an empty audit when there are no pressure signals", () => {
    expect(auditRawQuotes({ ...RAW, pressureSignals: [] }, TRANSCRIPT)).toEqual({
      total: 0,
      hallucinated: 0,
      entries: [],
    });
  });
});

describe("parseJsonObject", () => {
  it("accepts a fenced JSON object", () => {
    expect(parseJsonObject('```json\n{"amount":18}\n```')).toEqual({ amount: 18 });
  });

  it("rejects an array", () => {
    expect(() => parseJsonObject("[1,2,3]")).toThrow(ApiException);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseJsonObject("{not json")).toThrow(ApiException);
  });
});
