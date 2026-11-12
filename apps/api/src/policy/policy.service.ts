import { Injectable } from "@nestjs/common";
import type {
  CheckResult,
  Decision,
  DecisionReason,
  Profile,
  Extraction,
  PaymentRequest,
  TrustedRecipient,
} from "@scambrake/contracts";
import { ContactsService, nameMatches, normalizeName } from "../contacts/contacts.service";

export interface PolicyOutcome {
  decision: Decision;
  reasons: DecisionReason[];
  checks: CheckResult[];
  matchedRecipient: TrustedRecipient | null;
  limits: {
    userLimit: number;
    recipientLimit: number | null;
    effectiveLimit: number;
  };
}

const SUPPORT_LANGUAGE =
  /\b(account security|security (team|department|center)|fraud (team|department|support|prevention)|support (team|department)|account protection|protection (account|team|service)|safe account|safe protection|secure account|protection account)\b/i;

const GENERIC_IDENTITY_TOKENS = new Set([
  "account",
  "accounts",
  "bank",
  "banking",
  "billing",
  "card",
  "center",
  "co",
  "company",
  "department",
  "fraud",
  "inc",
  "llc",
  "ltd",
  "payments",
  "protection",
  "safe",
  "security",
  "service",
  "services",
  "support",
  "team",
  "the",
  "and",
]);

@Injectable()
export class PolicyService {
  constructor(private readonly contacts: ContactsService) {}

  evaluate(input: {
    extraction: Extraction;
    payment: PaymentRequest;
    profile: Profile;
  }): PolicyOutcome {
    const { extraction, payment, profile } = input;
    const matchedRecipient = this.contacts.findRecipient(
      payment.recipientName,
      payment.recipientIdentifier,
    );

    const userLimit = profile.limits.withoutConfirmation;
    const recipientLimit = matchedRecipient?.maxWithoutConfirmation ?? null;
    const effectiveLimit = Math.min(userLimit, recipientLimit ?? Number.POSITIVE_INFINITY);

    const supportClaimDetected = this.hasSupportClaim(extraction);
    const identityMismatch = this.claimedIdentityMismatchesRecipient(extraction);
    const pressureCount = extraction.pressureSignals.length;
    const amountMatches = extraction.amount === null
      ? false
      : Math.abs(extraction.amount - payment.amount) < 0.011;
    const recipientMatches = this.requestedRecipientMatchesPayment(extraction, payment);
    const detailsComplete =
      extraction.amount !== null &&
      Boolean(extraction.requestedRecipientName) &&
      extraction.confidence >= 0.55;

    const reasons: Array<Omit<DecisionReason, "evidenceQuotes"> & { evidenceQuotes?: string[] }> = [];
    const checks: CheckResult[] = [];

    /* ---------------- explicit rule checks ---------------- */

    checks.push({
      id: "support-rule",
      label: "No support or security payment rule triggered",
      status: supportClaimDetected ? "fail" : "pass",
      detail: supportClaimDetected
        ? "The request claims a support/security identity or asks for a safe or protection account."
        : "The request is not framed as a support, security, or protection payment.",
    });

    if (supportClaimDetected) {
      reasons.push({
        code: "NEVER_PAY_SUPPORT",
        title: "Matches the rule “Never pay a support or security team”",
        detail:
          "This request claims a support or security identity, or redirects money to a “safe” or “protection” account. The saved rule blocks it before any PayPal order exists.",
        severity: "block",
        ruleId: "rule-never-pay-support",
        evidenceQuotes: this.evidenceFor(extraction, [
          "payment_instruction",
          "secrecy",
          "threat",
          "authority",
        ]),
      });
    }

    /* ---------------- claimed identity vs destination ---------------- */

    checks.push({
      id: "claimed-identity",
      label: "Claimed identity matches the payment destination",
      status: identityMismatch ? "fail" : "pass",
      detail: identityMismatch
        ? "The caller's claimed identity does not match the recipient where the money would go."
        : "The claimed identity and the requested recipient are consistent, or the claim was not clear enough to compare.",
    });

    if (identityMismatch) {
      const strongPressure = pressureCount >= 2;
      reasons.push({
        code: strongPressure ? "IDENTITY_MISMATCH_WITH_PRESSURE" : "CLAIMED_IDENTITY_MISMATCH",
        title: strongPressure
          ? "The caller's claim contradicts the payment destination"
          : "The caller and the payment destination do not match",
        detail: `The caller claims to be “${extraction.claimedIdentity ?? "unknown"}” from “${extraction.claimedOrganization ?? "an unidentified organization"}”, but the requested recipient is “${extraction.requestedRecipientName ?? payment.recipientName}”.`,
        severity: strongPressure ? "block" : "hold",
        evidenceQuotes: this.evidenceFor(extraction, ["payment_instruction", "secrecy", "threat", "inconsistency"]),
      });
    }

    /* ---------------- recipient profile ---------------- */

    checks.push({
      id: "saved-recipient",
      label: "Recipient is in the saved profile",
      status: matchedRecipient ? "pass" : "fail",
      detail: matchedRecipient
        ? `Matched the saved record for ${matchedRecipient.name} (${matchedRecipient.type}).`
        : `“${payment.recipientName}” is not one of this profile's saved recipients.`,
    });

    if (profile.rules.some((rule) => rule.id === "rule-trusted-recipient-only" && rule.enabled) && !matchedRecipient) {
      reasons.push({
        code: "RECIPIENT_NOT_IN_SAVED_PROFILE",
        title: "New recipient needs independent confirmation",
        detail:
          "This recipient is not in the user's saved profile. ScamBrake holds the request instead of paying a new recipient automatically.",
        severity: "hold",
        ruleId: "rule-trusted-recipient-only",
      });
    }

    /* ---------------- amount limits ---------------- */

    const aboveUserLimit = payment.amount > userLimit;
    const aboveRecipientLimit = recipientLimit !== null && payment.amount > recipientLimit;
    checks.push({
      id: "amount-limit",
      label: "Amount is within the saved limits",
      status: aboveUserLimit || aboveRecipientLimit ? "fail" : "pass",
      detail: aboveUserLimit
        ? `$${payment.amount.toFixed(2)} is above the user's $${userLimit.toFixed(2)} no-confirmation limit.`
        : aboveRecipientLimit
          ? `$${payment.amount.toFixed(2)} is above the $${recipientLimit?.toFixed(2)} limit saved for ${matchedRecipient?.name}.`
          : `$${payment.amount.toFixed(2)} is within the effective $${Number.isFinite(effectiveLimit) ? effectiveLimit.toFixed(2) : userLimit.toFixed(2)} limit.`,
    });

    if (aboveUserLimit && profile.rules.some((rule) => rule.id === "rule-confirmation-threshold" && rule.enabled)) {
      reasons.push({
        code: "AMOUNT_ABOVE_USER_LIMIT",
        title: "Amount is above the user's no-confirmation limit",
        detail: `The payment is $${payment.amount.toFixed(2)}; this profile requires confirmation above $${userLimit.toFixed(2)}.`,
        severity: "hold",
        ruleId: "rule-confirmation-threshold",
      });
    } else if (aboveRecipientLimit && matchedRecipient) {
      reasons.push({
        code: "AMOUNT_ABOVE_RECIPIENT_LIMIT",
        title: "Amount is above the limit saved for this recipient",
        detail: `The payment is $${payment.amount.toFixed(2)}; the saved limit for ${matchedRecipient.name} is $${recipientLimit?.toFixed(2)}.`,
        severity: "hold",
      });
    }

    /* ---------------- pressure ---------------- */

    checks.push({
      id: "pressure-language",
      label: "No urgency, secrecy, or payment-redirection cues",
      status: pressureCount > 0 ? "fail" : "pass",
      detail:
        pressureCount > 0
          ? `The request contains ${pressureCount} pressure or redirection cue${pressureCount === 1 ? "" : "s"}.`
          : "The request contains no urgency, secrecy, authority, or payment-redirection cues.",
    });

    if (pressureCount > 0) {
      reasons.push({
        code: "PRESSURE_LANGUAGE",
        title: "The request uses pressure or secrecy",
        detail:
          "Urgency, threats, secrecy, or instructions to bypass a saved contact channel are held for independent confirmation even when the recipient looks familiar.",
        severity: "hold",
        evidenceQuotes: this.evidenceFor(extraction, [
          "urgency",
          "secrecy",
          "authority",
          "threat",
          "inconsistency",
          "payment_instruction",
        ]),
      });
    }

    /* ---------------- extraction completeness ---------------- */

    checks.push({
      id: "extraction-complete",
      label: "Request details were extracted with enough confidence",
      status: detailsComplete ? "pass" : "fail",
      detail: detailsComplete
        ? `Extracted $${extraction.amount?.toFixed(2)} to “${extraction.requestedRecipientName}” with ${(extraction.confidence * 100).toFixed(0)}% model confidence.`
        : `The analysis is incomplete or low-confidence (${(extraction.confidence * 100).toFixed(0)}%). Missing: ${extraction.missingFields.join(", ") || "amount, recipient, or confidence"}.`,
    });

    if (extraction.amount === null) {
      reasons.push({
        code: "AMOUNT_NOT_IDENTIFIED",
        title: "The amount could not be identified",
        detail: "ScamBrake holds a payment when it cannot read the requested amount from the analysis.",
        severity: "hold",
      });
    }
    if (!extraction.requestedRecipientName) {
      reasons.push({
        code: "RECIPIENT_NOT_IDENTIFIED",
        title: "The requested recipient could not be identified",
        detail: "ScamBrake holds a payment when the destination cannot be read from the request.",
        severity: "hold",
      });
    }
    if (extraction.confidence < 0.55) {
      reasons.push({
        code: "LOW_EXTRACTION_CONFIDENCE",
        title: "The analysis is too uncertain to allow payment",
        detail: "The model's extraction confidence is below the server's 55% threshold. A person must review the request.",
        severity: "hold",
      });
    }

    /* ---------------- submitted fields vs request ---------------- */

    const submittedMatches = amountMatches && recipientMatches;
    checks.push({
      id: "submitted-details-match",
      label: "Submitted amount and recipient match the analyzed request",
      status: submittedMatches ? "pass" : "fail",
      detail:
        extraction.amount !== null && !amountMatches
          ? `The request says $${extraction.amount.toFixed(2)} but the form submitted $${payment.amount.toFixed(2)}.`
          : !recipientMatches
            ? `The request names “${extraction.requestedRecipientName ?? "an unknown recipient"}” but the form submitted “${payment.recipientName}”.`
            : "The submitted amount and recipient match the analyzed request.",
    });

    if (extraction.amount !== null && !amountMatches) {
      reasons.push({
        code: "PAYMENT_AMOUNT_MISMATCH",
        title: "The submitted amount does not match the request",
        detail: `The analysis found $${extraction.amount.toFixed(2)}, but the payment form submitted $${payment.amount.toFixed(2)}. Edited fields cannot unlock a payment.`,
        severity: "hold",
        evidenceQuotes: this.evidenceFor(extraction, ["payment_instruction"]),
      });
    }
    if (!recipientMatches) {
      reasons.push({
        code: "PAYMENT_RECIPIENT_MISMATCH",
        title: "The submitted recipient does not match the request",
        detail: `The analysis found “${extraction.requestedRecipientName ?? "an unknown recipient"}”, but the payment form submitted “${payment.recipientName}”.`,
        severity: "hold",
        evidenceQuotes: this.evidenceFor(extraction, ["payment_instruction", "inconsistency"]),
      });
    }

    /* ---------------- decision ---------------- */

    const hasBlock = reasons.some((reason) => reason.severity === "block");
    const hasHold = reasons.some((reason) => reason.severity === "hold");

    let decision: Decision;
    if (hasBlock) {
      decision = "BLOCK";
    } else if (hasHold) {
      decision = "HOLD";
    } else {
      decision = "ALLOW";
      reasons.push({
        code: "POLICY_ALLOW",
        title: "All saved-profile checks passed",
        detail: `The recipient matches the saved record for ${matchedRecipient?.name ?? payment.recipientName}, the amount is within the saved $${Number.isFinite(effectiveLimit) ? effectiveLimit.toFixed(2) : userLimit.toFixed(2)} limit, and no pressure or support-payment rule was found.`,
        severity: "info",
      });
    }

    reasons.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    return {
      decision,
      reasons: reasons.map((reason) => ({ ...reason, evidenceQuotes: reason.evidenceQuotes ?? [] })),
      checks,
      matchedRecipient,
      limits: { userLimit, recipientLimit, effectiveLimit },
    };
  }

  private hasSupportClaim(extraction: Extraction): boolean {
    const fields = [
      extraction.claimedIdentity,
      extraction.claimedOrganization,
      extraction.requestedAction,
      extraction.requestedRecipientName,
      extraction.purpose,
    ];
    return fields.some((field) => (field ? SUPPORT_LANGUAGE.test(field) : false));
  }

  private claimedIdentityMismatchesRecipient(extraction: Extraction): boolean {
    const claimed = normalizeName(
      `${extraction.claimedIdentity ?? ""} ${extraction.claimedOrganization ?? ""}`,
    );
    const destination = normalizeName(extraction.requestedRecipientName);
    if (!claimed || !destination) return false;

    if (claimed.includes(destination) || destination.includes(claimed)) return false;

    const tokens = claimed
      .split(" ")
      .filter((token) => token.length >= 4 && !GENERIC_IDENTITY_TOKENS.has(token));
    if (tokens.some((token) => destination.includes(token))) return false;

    // A short personal name ("Maya") should match "Maya Chen".
    const claimedName = normalizeName(extraction.claimedIdentity);
    if (claimedName && nameMatches(claimedName, destination)) return false;

    return true;
  }

  private requestedRecipientMatchesPayment(extraction: Extraction, payment: PaymentRequest): boolean {
    if (!extraction.requestedRecipientName) return false;
    if (nameMatches(extraction.requestedRecipientName, payment.recipientName)) return true;
    if (
      extraction.requestedRecipientIdentifier &&
      payment.recipientIdentifier &&
      extraction.requestedRecipientIdentifier.trim().toLowerCase() ===
        payment.recipientIdentifier.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  }

  private evidenceFor(extraction: Extraction, categories: string[]): string[] {
    return extraction.pressureSignals
      .filter((signal) => categories.includes(signal.category))
      .map((signal) => signal.quote)
      .slice(0, 4);
  }
}

function severityRank(severity: DecisionReason["severity"]): number {
  return severity === "block" ? 0 : severity === "hold" ? 1 : 2;
}
