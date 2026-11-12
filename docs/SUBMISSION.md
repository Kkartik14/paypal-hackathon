# ScamBrake submission pack

Ready-to-paste copy for the PayPal AI Hackathon Devpost entry. Replace the video
placeholder after recording. Do not add live PayPal credentials, buyer passwords,
or personal data to the submission or this repository.

## Links

| Field | Value |
| --- | --- |
| Public repository | https://github.com/Kkartik14/paypal-hackathon |
| Hosted app | https://scambrake-web-kappa.vercel.app |
| API health | https://scambrake-api.vercel.app/api/health |
| Walkthrough video | _Add the public YouTube URL before submitting_ |
| License | MIT |

## Devpost fields

**Project name:** ScamBrake

**Tagline:** Before money moves, check who is asking.

**Short description:**

ScamBrake is a voice-first payment safety agent for social-engineering requests.
It reads a suspicious call, extracts the claimed identity and payment destination,
checks the user's saved rules and recipients, and lets deterministic server policy
decide ALLOW, HOLD, or BLOCK. Only an ALLOW decision can open a PayPal Orders v2
Sandbox checkout, for a server-fixed merchant and amount.

**Long description:**

A convincing call can make a dangerous payment feel routine. The caller claims to
be bank security, invents a problem, and redirects the payment to a "safe" account.
A general-purpose agent can follow that instruction perfectly and still help the
scammer.

ScamBrake puts a brake between the conversation and the money:

1. **Read the request.** Groq Whisper transcribes the clip. `openai/gpt-oss-120b`
   extracts the claimed identity, requested action, destination, amount, purpose,
   pressure quotes, and missing details as schema-validated evidence.
2. **Check saved records.** Read-only tools retrieve the user's saved recipients
   and payment rules. The model cannot edit them, add a recipient, or call PayPal.
3. **Apply deterministic policy.** Server code checks the never-pay-support rule,
   saved-recipient match, per-recipient limit, confirmation threshold, identity
   mismatch, and pressure language. The model never chooses ALLOW, HOLD, or BLOCK.
4. **Move money only after ALLOW.** An ALLOW result issues a 20-minute HMAC-signed
   decision ticket. Creating a PayPal Sandbox order requires that ticket and a
   server-fixed $18.00 USD merchant. Capture requires buyer approval at PayPal, a
   fresh order read, and matching order ID, analysis ID, amount, currency, and
   (when configured) Sandbox payee. The browser cannot change the checkout amount.

The walkthrough shows both paths: a fictional bank-security call is blocked before
any PayPal order exists, and a saved $18 coffee subscription is allowed through a
real PayPal Orders v2 Sandbox checkout and capture.

**How PayPal is used:** OAuth 2.0 client credentials, Orders v2 create, get, and
capture. Sandbox only. No live credentials and no real money.

**How AI is used:** Groq `whisper-large-v3-turbo` for speech-to-text and
`openai/gpt-oss-120b` for read-only tool calls and strict structured extraction.
A deterministic offline engine can run without an API key and is labelled as such
in the UI. The payment decision is never made by the model.

**What it does not claim:** ScamBrake does not authenticate a voice, detect a
deepfake, verify an arbitrary external payee, or issue a universal scam verdict.
Recipient checks use a small, fictional, user-controlled saved profile. A HOLD is
not a verdict; it means independent confirmation is required.

**Built with:** Next.js 15, NestJS 11, TypeScript, Zod, Groq, PayPal Orders v2
Sandbox, Vercel, MCP over HTTP.

## AI and tool disclosure

- Runtime AI: Groq Whisper and GPT-OSS. The AI extracts evidence only.
- Decision-making: deterministic server policy in
  `apps/api/src/policy/policy.service.ts`.
- Prompt evaluation: offline harness over 12 authored synthetic cases with
  committed Groq outputs, a real-policy scorecard, and hard release gates. No LLM
  judge and no live A/B test on payment decisions.
- Development: this repository was built with an AI coding agent (OpenCode) as
  part of the hackathon workflow. Policy and ticket behavior are covered by tests.
- Voices: synthetic macOS text-to-speech only. No real caller recording is included.
- Data: all people, organizations, recipients, and merchants are fictional
  fixtures. PayPal is used in Sandbox mode only.

## Video

Record with [`WALKTHROUGH.md`](WALKTHROUGH.md). Target 2:20, hard limit 3:00.
The required story is:

1. The fictional urgent call is blocked, and no PayPal order is created.
2. The saved $18 purchase returns ALLOW and completes a PayPal Sandbox capture.
3. The closing boundary: AI reads the conversation; deterministic policy controls
   the money; no voice authentication or deepfake claim.

## Pre-submit checklist

- [ ] Walkthrough video is public on YouTube and under three minutes.
- [ ] Video URL is in the Devpost entry and README.
- [ ] Repository is public, with `LICENSE`, setup instructions, and `.env.example`.
- [ ] Hosted app loads and `/api/health` reports `status: ok`.
- [ ] `GET /api/v1/scenarios` returns the saved profile and both scenarios.
- [ ] Blocked path returns `BLOCK` and no checkout ticket.
- [ ] Saved-merchant path returns `ALLOW` and creates a Sandbox order.
- [ ] No live PayPal credentials or real personal data appear in the video,
      repository, screenshots, or Devpost text.
- [ ] AI/tool disclosure is included in the Devpost entry.
- [ ] Submission is complete before **Nov 12, 12:00 PM PT** (Nov 13, 1:30 AM IST).
