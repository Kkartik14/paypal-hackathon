import type {
  DemoMerchant,
  DemoProfile,
  Extraction,
  Scenario,
} from "@scambrake/contracts";

/**
 * Fictional demo fixtures. These are the only "trusted contact" records
 * ScamBrake compares against, and the UI labels them as demo data.
 */

export const DEMO_PROFILE: DemoProfile = {
  id: "demo-riya-sharma",
  displayName: "Riya Sharma",
  currency: "USD",
  limits: {
    withoutConfirmation: 100,
  },
  rules: [
    {
      id: "rule-never-pay-support",
      title: "Never pay a support or security team",
      description:
        "ScamBrake never authorizes a payment to someone who claims to be account security, fraud support, or a protection service. Banks and payment companies do not ask you to move money to a safe account.",
      kind: "never_pay_support",
      enabled: true,
    },
    {
      id: "rule-confirmation-threshold",
      title: "Confirm anything above $100",
      description:
        "A payment above this user's $100.00 limit needs independent confirmation, even when the recipient is saved.",
      kind: "confirmation_threshold",
      enabled: true,
    },
    {
      id: "rule-trusted-recipient-only",
      title: "Pay saved recipients only",
      description:
        "A new recipient is held for confirmation instead of being paid automatically.",
      kind: "trusted_recipient_only",
      enabled: true,
    },
  ],
  trustedRecipients: [
    {
      id: "kettle-co",
      name: "Kettle & Co.",
      aliases: ["Kettle and Co.", "Kettle & Co. Demo Store"],
      identifier: "billing@kettleandco.example",
      type: "merchant",
      maxWithoutConfirmation: 50,
      note: "Fictional demo merchant. Its PayPal Sandbox seller account receives the successful demo purchase.",
    },
    {
      id: "maya-chen",
      name: "Maya Chen",
      aliases: ["Maya"],
      identifier: "maya.chen@example.test",
      type: "person",
      maxWithoutConfirmation: 75,
      note: "Fictional demo contact.",
    },
  ],
  fixtureNotice:
    "Demo fixture: a fictional profile, two fictional recipients, and user-set rules. Not a bank, PayPal, or universal directory.",
};

export const DEMO_MERCHANT: DemoMerchant = {
  name: "Kettle & Co.",
  identifier: "billing@kettleandco.example",
  amount: 18,
  currency: "USD",
  sandboxNote:
    "This PayPal Sandbox checkout pays the ScamBrake demo merchant, not the suspicious caller. Sandbox money is not real money.",
};

export const URGENT_SUPPORT_TRANSCRIPT =
  "This is Daniel Reed from Meridian Bank account security. Someone tried to move $900 from your account this morning. To protect your funds, move $900 to our safe protection account today. Use the account details I text you, not the number on your card. Keep this confidential and don't discuss it with anyone until the review is complete. If you delay, the transfer will go through and we can't reverse it.";

export const SAFE_PURCHASE_TRANSCRIPT =
  "Hi, this is Kettle and Co. billing with a quick note about your monthly coffee subscription. Your renewal is $18.00 for the November roast. This is the same saved payment method and the same amount as last month. No action is needed beyond approving the renewal whenever you're ready. Thanks, and have a good week.";

export const DEMO_SCENARIOS: Scenario[] = [
  {
    id: "urgent-support-call",
    title: "The urgent support call",
    subtitle: "A caller claims to be bank security and pushes a $900 transfer.",
    kind: "unsafe",
    transcript: URGENT_SUPPORT_TRANSCRIPT,
    audioUrl: "/audio/urgent-support-call.m4a",
    audioMimeType: "audio/mp4",
    payment: {
      amount: 900,
      currency: "USD",
      recipientName: "Safe Account Protection",
      recipientIdentifier: "secure-payments@protection-review.example",
      purpose: "Move funds to a protection account",
    },
    expectedDecision: "BLOCK",
    expectedSummary: "A new protection account, pressure, and secrecy stop this request.",
    fixtureNotice: "Fictional call, caller, bank, and recipient. Not a real recording.",
  },
  {
    id: "trusted-purchase",
    title: "The saved merchant purchase",
    subtitle: "An $18 renewal from a merchant already in the demo profile.",
    kind: "safe",
    transcript: SAFE_PURCHASE_TRANSCRIPT,
    audioUrl: "/audio/trusted-purchase.m4a",
    audioMimeType: "audio/mp4",
    payment: {
      amount: 18,
      currency: "USD",
      recipientName: "Kettle & Co.",
      recipientIdentifier: "billing@kettleandco.example",
      purpose: "Monthly coffee subscription renewal",
    },
    expectedDecision: "ALLOW",
    expectedSummary: "Saved recipient, saved amount, and no pressure language.",
    fixtureNotice: "Fictional merchant and voice clip. The PayPal Sandbox seller is the demo merchant.",
  },
];

/** High-confidence extraction used by the explicitly labelled demo engine. */
export const MOCK_SCENARIO_EXTRACTIONS: Record<string, Extraction> = {
  "urgent-support-call": {
    transcript: URGENT_SUPPORT_TRANSCRIPT,
    claimedIdentity: "Daniel Reed",
    claimedOrganization: "Meridian Bank account security",
    requestedAction: "Move $900 to a safe protection account",
    requestedRecipientName: "Safe Account Protection",
    requestedRecipientIdentifier: "secure-payments@protection-review.example",
    amount: 900,
    currency: "USD",
    purpose: "Move funds to a protection account",
    pressureSignals: [
      {
        quote: "Someone tried to move $900 from your account this morning.",
        category: "threat",
        explanation: "A fabricated account compromise creates fear before the payment ask.",
        startSeconds: 5,
      },
      {
        quote: "To protect your funds, move $900 to our safe protection account today.",
        category: "payment_instruction",
        explanation: "The caller redirects the payment to a new 'protection account' with time pressure.",
        startSeconds: 11,
      },
      {
        quote: "Use the account details I text you, not the number on your card.",
        category: "inconsistency",
        explanation: "The caller tells the user to bypass the saved, independently verified contact channel.",
        startSeconds: 17,
      },
      {
        quote: "Keep this confidential and don't discuss it with anyone until the review is complete.",
        category: "secrecy",
        explanation: "Secrecy prevents the user from checking the request with someone they trust.",
        startSeconds: 24,
      },
      {
        quote: "If you delay, the transfer will go through and we can't reverse it.",
        category: "urgency",
        explanation: "A countdown and an irreversible-loss claim push the user to act without checking.",
        startSeconds: 30,
      },
    ],
    missingFields: [],
    confidence: 0.94,
    summary:
      "A caller claiming to be Meridian Bank account security pressures the user to move $900 to a new protection account today, using texted details instead of the number on the card and asking for secrecy.",
  },
  "trusted-purchase": {
    transcript: SAFE_PURCHASE_TRANSCRIPT,
    claimedIdentity: "Kettle and Co. billing",
    claimedOrganization: "Kettle & Co.",
    requestedAction: "Approve the monthly subscription renewal",
    requestedRecipientName: "Kettle & Co.",
    requestedRecipientIdentifier: "billing@kettleandco.example",
    amount: 18,
    currency: "USD",
    purpose: "Monthly coffee subscription renewal",
    pressureSignals: [],
    missingFields: [],
    confidence: 0.96,
    summary:
      "A routine $18.00 subscription renewal from Kettle & Co., matching the saved demo merchant, saved amount, and usual payment method. No urgency or secrecy language.",
  },
};
