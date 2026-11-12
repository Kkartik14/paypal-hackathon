import { describe, expect, it } from "vitest";
import type { Extraction, PaymentRequest } from "@scambrake/contracts";
import { ContactsService } from "../contacts/contacts.service";
import { SCAMBRAKE_PROFILE, MOCK_SCENARIO_EXTRACTIONS } from "../fixtures/profile-data";
import { PolicyService } from "./policy.service";

function buildPolicy(): PolicyService {
  return new PolicyService(new ContactsService());
}

const safeExtraction = MOCK_SCENARIO_EXTRACTIONS["trusted-purchase"] as Extraction;
const urgentExtraction = MOCK_SCENARIO_EXTRACTIONS["urgent-support-call"] as Extraction;

const safePayment: PaymentRequest = {
  amount: 18,
  currency: "USD",
  recipientName: "Kettle & Co.",
  recipientIdentifier: "billing@kettleandco.example",
  purpose: "Monthly coffee subscription renewal",
};

describe("PolicyService", () => {
  it("blocks the fake support call before any checkout", () => {
    const outcome = buildPolicy().evaluate({
      extraction: urgentExtraction,
      payment: {
        amount: 900,
        currency: "USD",
        recipientName: "Safe Account Protection",
        recipientIdentifier: "secure-payments@protection-review.example",
      },
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("BLOCK");
    expect(outcome.matchedRecipient).toBeNull();
    const codes = outcome.reasons.map((reason) => reason.code);
    expect(codes).toContain("NEVER_PAY_SUPPORT");
    expect(codes).toContain("IDENTITY_MISMATCH_WITH_PRESSURE");
    expect(outcome.reasons.some((reason) => reason.severity === "block")).toBe(true);
    expect(outcome.reasons.every((reason) => Array.isArray(reason.evidenceQuotes))).toBe(true);
  });

  it("allows the saved merchant purchase within limits", () => {
    const outcome = buildPolicy().evaluate({
      extraction: safeExtraction,
      payment: safePayment,
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("ALLOW");
    expect(outcome.matchedRecipient?.name).toBe("Kettle & Co.");
    expect(outcome.limits.effectiveLimit).toBe(50);
    expect(outcome.reasons.map((reason) => reason.code)).toEqual(["POLICY_ALLOW"]);
    expect(outcome.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("holds a payment to a recipient outside the saved profile", () => {
    const outcome = buildPolicy().evaluate({
      extraction: {
        ...safeExtraction,
        requestedRecipientName: "Totally New Store",
        requestedRecipientIdentifier: "pay@new-store.example",
      },
      payment: {
        amount: 18,
        currency: "USD",
        recipientName: "Totally New Store",
        recipientIdentifier: "pay@new-store.example",
      },
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("HOLD");
    expect(outcome.matchedRecipient).toBeNull();
    expect(outcome.reasons.map((reason) => reason.code)).toContain(
      "RECIPIENT_NOT_IN_SAVED_PROFILE",
    );
  });

  it("holds an amount above the per-recipient limit", () => {
    const outcome = buildPolicy().evaluate({
      extraction: { ...safeExtraction, amount: 80 },
      payment: { ...safePayment, amount: 80 },
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("HOLD");
    expect(outcome.reasons.map((reason) => reason.code)).toContain(
      "AMOUNT_ABOVE_RECIPIENT_LIMIT",
    );
    expect(outcome.limits.recipientLimit).toBe(50);
  });

  it("holds an amount above the user's no-confirmation limit", () => {
    const outcome = buildPolicy().evaluate({
      extraction: { ...safeExtraction, amount: 150 },
      payment: { ...safePayment, amount: 150 },
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("HOLD");
    expect(outcome.reasons.map((reason) => reason.code)).toContain("AMOUNT_ABOVE_USER_LIMIT");
  });

  it("holds when the submitted amount differs from the analyzed request", () => {
    const outcome = buildPolicy().evaluate({
      extraction: safeExtraction,
      payment: { ...safePayment, amount: 19 },
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("HOLD");
    const codes = outcome.reasons.map((reason) => reason.code);
    expect(codes).toContain("PAYMENT_AMOUNT_MISMATCH");
  });

  it("holds low-confidence and incomplete analyses", () => {
    const outcome = buildPolicy().evaluate({
      extraction: {
        ...safeExtraction,
        amount: null,
        confidence: 0.2,
        missingFields: ["amount"],
      },
      payment: safePayment,
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("HOLD");
    const codes = outcome.reasons.map((reason) => reason.code);
    expect(codes).toContain("AMOUNT_NOT_IDENTIFIED");
    expect(codes).toContain("LOW_EXTRACTION_CONFIDENCE");
  });

  it("never allows a support claim even with a saved recipient name", () => {
    const outcome = buildPolicy().evaluate({
      extraction: {
        ...safeExtraction,
        requestedRecipientName: "Kettle & Co.",
        claimedOrganization: "Account security team",
        amount: 18,
      },
      payment: safePayment,
      profile: SCAMBRAKE_PROFILE,
    });

    expect(outcome.decision).toBe("BLOCK");
    expect(outcome.reasons.map((reason) => reason.code)).toContain("NEVER_PAY_SUPPORT");
  });
});
