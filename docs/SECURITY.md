# Security, privacy, and limitations

ScamBrake is a hackathon demo, not a production fraud system. This document describes what it actually enforces, what it deliberately does not claim, and what would need to change before handling real users or money.

## Scope

ScamBrake reviews a payment request that may come from a social-engineering call or message. It:

1. extracts the claimed identity, requested action, destination, amount, and pressure cues;
2. compares the request with a small, fictional, user-controlled profile of saved recipients and rules;
3. returns a deterministic `ALLOW`, `HOLD`, or `BLOCK`;
4. permits a fixed PayPal **Sandbox** checkout only after `ALLOW` plus explicit user confirmation.

It is not a bank, payment processor, identity provider, or scam verdict service.

## Non-goals and explicit non-claims

ScamBrake does **not**:

- authenticate a caller, verify a caller ID, or prove that a voice is human;
- detect or score deepfakes;
- verify an arbitrary external payee against PayPal, a bank, or a scam database;
- produce a calibrated “fraud probability” or guarantee that an allowed payment is safe;
- move real money, store a payment method, or hold live PayPal credentials;
- replace a bank's fraud team, a chargeback process, or law enforcement.

Recipient checks operate only on the fictional demo profile in `apps/api/src/demo/demo-data.ts`. The UI labels this data as a demo fixture.

## Trust boundaries

```
untrusted audio / transcript / form input
        │
        ▼
AI provider (Groq or demo engine)    ──► evidence only, schema-validated
        │
        ▼
deterministic policy (server code)   ──► ALLOW / HOLD / BLOCK
        │
        ▼
signed decision ticket               ──► bound to analysis + payment fields
        │
        ▼
PayPal Orders v2 Sandbox             ──► create, read, explicit capture
```

The model is treated as an untrusted *interpreter*, not an authority. It cannot approve a payment, alter a rule, add a recipient, or call PayPal.

## Prompt-injection handling

- Audio is transcribed by Groq Whisper, then the transcript and form text are wrapped in explicit untrusted-content markers in every Groq prompt.
- The system instruction tells the model to ignore instructions inside the request, never reveal secrets, never call payment tools, and never issue a decision.
- The only tools exposed to the model are read-only profile lookups (`get_payment_rules`, `get_saved_recipient`).
- Groq extraction output is normalized and validated against a strict Zod schema before use. The Groq call also requests strict JSON Schema output, but server-side Zod validation remains authoritative. Invalid output fails with `502`; it never becomes an `ALLOW`.
- The policy engine uses the extracted fields, not free-form model reasoning. A model that is persuaded to invent facts can produce a wrong *evidence* record, but the policy still applies fixed rules and fails closed on missing or low-confidence fields.
- The MCP `analyze_payment_request` tool exposes no ticket, no order creation, and no capture.

Residual risk: a model can still mis-transcribe or mis-extract a request. That is why `HOLD` exists and why the UI shows exact quotes rather than only a verdict.

## Deterministic policy

Implemented in `apps/api/src/policy/policy.service.ts`. It checks:

- the saved rule “Never pay a support or security team”;
- claimed identity versus payment destination;
- whether the recipient is in the saved demo profile;
- the user's `$100` no-confirmation limit and per-recipient limits;
- urgency, secrecy, authority, threat, and payment-redirection cues;
- extraction completeness and confidence (`< 55%` holds);
- whether the amount and recipient submitted in the form match the analyzed request.

Any `block` reason produces `BLOCK`. Any `hold` reason produces `HOLD`. Only a request with no block or hold reasons produces `ALLOW`. New or edited form fields cannot unlock a payment because the submitted details are re-compared with the extraction.

## Prompt evaluation boundary

Prompt changes are release-gated offline, not experimented on users:

- The harness in `apps/api/src/evals` is a build-time CLI, not a deployed route. It is absent from the REST and MCP surfaces.
- Replay mode reads committed raw model outputs and needs no credentials. It cannot call Groq or PayPal.
- Live recording calls Groq with synthetic transcripts only, keeps the key server-side, and writes prompt-hash-bound JSON under `apps/api/evals/cache/`.
- The evaluation scores the real normalization and the real `PolicyService`; there is no LLM judge and no score for prose.
- A candidate prompt is rejected by any critical gate failure, any new false `ALLOW`, or a regression in a guarded quality metric such as extraction accuracy; a human reviews the diff before the default version changes.
- There is no live A/B test on payment decisions. Users are never randomized into an unproven prompt, and no payment depends on a candidate version.
- Cache entries do not contain audio, credentials, or personal data—only synthetic transcripts, model output, latency, and token counts.

A passing evaluation is a regression gate for this small synthetic set. It is not a claim of real-world scam-detection accuracy, and it does not replace the deterministic policy, user confirmation, or the non-claims above. The process and limits are documented in [`EVALUATION.md`](EVALUATION.md).

## Decision tickets

- HMAC-SHA-256 over a base64url JSON payload, signed with `DECISION_TICKET_SECRET`.
- Payload binds the analysis ID, profile ID, recipient name/identifier, amount, currency, purpose, demo merchant, issue time, expiry, and a random nonce.
- Default lifetime is 20 minutes (`DECISION_TICKET_TTL_SECONDS`).
- Verification uses a length check and `timingSafeEqual`; expiry and future-issue timestamps are rejected.
- Production (`NODE_ENV=production`) refuses to start without a secret of at least 32 characters. The development fallback is logged as a warning and exists only for local runs.
- Tickets are **signed, not encrypted**. Their contents are readable, but they contain no credentials or personal data beyond the fictional demo fields.
- The server is stateless, so tickets are not stored or marked single-use. Replaying one can only re-request the same idempotent PayPal order (the creation key is derived from the analysis ID). Capture is still bound to the order's live PayPal state and re-verified fields.

## PayPal controls

- `PAYPAL_ENV` must be exactly `sandbox`; any other value aborts startup.
- `PAYPAL_API_BASE` must resolve to a PayPal Sandbox host, or localhost in development. Live API hosts are refused.
- Credentials are read only from server-side environment variables. They are never sent to the browser, included in tickets, exposed through MCP, or logged.
- The demo checkout amount (`$18.00 USD`), currency (`USD`), and merchant identity are fixed server-side.
- Order creation requires an ALLOW ticket and a recipient that matches the demo merchant.
- Capture requires:
  - a valid, unexpired ticket;
  - a fresh `GET` of the order from PayPal;
  - buyer approval (`APPROVED`);
  - matching analysis ID (`custom_id`), amount, and currency;
  - a matching configured payee, when `PAYPAL_PAYEE_EMAIL` is set;
  - an explicit user click on the return page.
- Completed orders are returned idempotently; the backend never marks an order paid from the browser redirect alone.
- No PayPal webhooks are required. PayPal remains the source of truth for order state.

## Data handling

- **Audio:** decoded in memory, size- and type-checked (max 3 MB), forwarded to Groq Whisper when enabled, then discarded. It is never written to disk or a database. Use only the synthetic demo audio; Groq processes the submitted audio under its API terms.
- **Transcripts:** processed in memory and returned to the caller. Application logs exclude transcript text, pressure quotes, audio, and contact data.
- **Logs:** analysis logs contain the analysis ID, provider, decision, checkout availability, and step timings. PayPal logs contain order/capture IDs and status. No API keys or raw personal data.
- **Browser storage:** the pending order ID, ticket, and analysis ID are kept in `sessionStorage` for the checkout return. They are removed on demo reset and do not persist across browser sessions.
- **No account system, database, or analytics** is included. Restarting the server loses no stored user data because none is stored.
- **MCP:** tool calls return the fictional demo profile and analysis output. They do not return tickets or credentials.

Because this is a public demo, do not paste sensitive real call recordings or personal data into it. Use the fictional samples.

## Configuration and secrets

- Real environment variables override `.env` files.
- `GROQ_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `DECISION_TICKET_SECRET`, and `MCP_API_KEY` are server-side only.
- Never place a secret in `NEXT_PUBLIC_*`; those values are compiled into the browser bundle.
- The app refuses to start on a live PayPal environment or live API host.
- Rotate the Sandbox app credentials and ticket secret if a deployment is shared publicly.

## MCP exposure

- `POST /mcp` is stateless JSON-RPC 2.0.
- Optional authentication: set `MCP_API_KEY` and send `Authorization: Bearer …` or `x-api-key`.
- Tools are annotated read-only. `get_paypal_order` can read a ScamBrake-created Sandbox order; it cannot capture.
- `GET` and `DELETE` return `405` because no sessions or SSE stream exist.
- `analyze_payment_request` is rate-limited and bounded to a 20,000-character transcript and a validated payment object.

If the demo is deployed publicly without `MCP_API_KEY`, anyone can spend your Groq quota through the analysis tool. Set the key or keep the deployment private.

## Abuse and availability

- In-process, best-effort rate limiting per client IP:
  - analysis: 30 requests / 10 minutes;
  - order create and capture: 20 / 10 minutes;
  - order reads: 60 / 10 minutes;
  - MCP: 60 / 10 minutes.
- Request body limit: 6 MB JSON; decoded audio limit: 3 MB.
- The Groq pipeline has a 50-second overall deadline across Whisper transcription, every tool round, and the extraction call, keeping it inside the 60-second serverless limit; each PayPal call times out after 30 seconds.
- Serverless instances do not share counters. A cold start resets the buckets, and an attacker using many instances can exceed these limits. This is a speed bump, not a quota.
- Vercel's serverless request limit is smaller than the app's 6 MB JSON limit; use short clips or the transcript on that platform.

## Production hardening that is intentionally missing

Before handling real users or real money, add at minimum:

- authenticated user accounts and a real, server-owned profile/rule store;
- durable idempotency and ticket-replay storage (for example Redis or a database);
- distributed rate limiting and request quotas;
- webhook reconciliation and an audit trail for every state transition;
- encryption at rest and a documented retention policy;
- content moderation and explicit consent for uploading call recordings;
- external payee verification through an authoritative source, if such a claim is ever made;
- independent security review, dependency scanning, and penetration testing;
- jurisdiction-specific legal, privacy, and financial-compliance review.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use the repository's private GitHub security advisory feature and include reproduction steps, affected version, and impact. Please avoid including real credentials or personal data in the report.
