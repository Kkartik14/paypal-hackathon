# ScamBrake project guidance

Before implementing or changing the project, read:

- `local/scambrake-plan/PLAN.md` for the agreed product, architecture, user flow, security boundaries, and deadline.
- `local/scambrake-plan/RESEARCH.md` for source links, PayPal/Vercel constraints, and the current submission overlap scan.
- `local/scambrake-plan/WALKTHROUGH.md` for the judge-facing story.
- `docs/EVALUATION.md` and `local/scambrake-plan/EVALUATION.md` for the prompt evaluation process and the current decision log.

## Product and stack decisions

- Build ScamBrake as a voice-first consumer agent for social-engineering payment requests.
- The differentiating moment is a fictional urgent call blocked by a user-specific payment rule, followed by a real PayPal Sandbox purchase to the Sandbox merchant.
- Use Next.js for the web app, NestJS for the API, Vercel for hosting, Groq (Whisper transcription plus GPT-OSS tool calling and structured extraction) for audio understanding, and PayPal Orders v2 Sandbox for checkout.
- Render is explicitly excluded. Sponsor tools are optional; do not add one without a useful product role.
- Ship REST endpoints and a small stateless MCP-over-HTTP interface over shared NestJS services. MCP must not expose capture.

## Security and accuracy boundaries

- Sandbox only. Never use live PayPal credentials or move real money.
- The model interprets untrusted audio/text and suggests actions. Deterministic server policy decides `ALLOW`, `HOLD`, or `BLOCK`.
- Never give the model PayPal credentials or a direct capture tool. Capture requires explicit user confirmation and server-side PayPal order checks.
- Do not claim voice authentication, deepfake detection, external payee verification, or a universal scam verdict.
- Only compare a requested recipient with the fictional, user-controlled records in the saved profile. Label these records as fictional fixtures.
- Keep API keys on the server and do not retain raw audio or personal contact data.

## Prompt changes

- Prompts are versioned code. Never edit a released prompt in place; add a new version under `apps/api/src/agent/prompts.ts`.
- Any prompt change must pass `pnpm eval:check` against the committed cases and replay cache. Do not change `DEFAULT_PROMPT_VERSION` without a passing paired comparison and a human-reviewed scorecard.
- Treat a new false `ALLOW`, a critical gate failure, a holdout regression, or a regression in a guarded quality metric (including amount/recipient extraction accuracy) as a hard reject. Do not trade a safety failure for a better average.
- Add a synthetic regression case before changing a prompt in response to a live failure. Do not paste real recordings or personal data into the case set.
- The eval is offline only. Do not add a live A/B test on payment decisions, an LLM judge, or a deployed eval endpoint.
- Live recording (`pnpm eval:record`) calls Groq only, uses synthetic transcripts, respects the throttle, and never calls PayPal. Commit the resulting cache so replay stays credential-free.
- Report eval results with their limits: 12 synthetic authored cases, extraction plus deterministic policy, not a real-world accuracy benchmark.

## Submission expectations

The final project needs a public repository with an open-source license, complete setup instructions, a functional hosted app or reproducible local run path, an AI/tool disclosure, and a walkthrough video under three minutes. Keep the plan as one end-to-end build; do not split the product into v0/v1/v2 proposals.
