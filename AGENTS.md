# ScamBrake project guidance

Before implementing or changing the project, read:

- `scambrake-plan/PLAN.md` for the agreed product, architecture, user flow, security boundaries, and deadline.
- `scambrake-plan/RESEARCH.md` for source links, PayPal/Vercel constraints, and the current submission overlap scan.
- `scambrake-plan/DEMO_SCRIPT.md` for the judge-facing story.

## Product and stack decisions

- Build ScamBrake as a voice-first consumer agent for social-engineering payment requests.
- The differentiating demo is a fictional urgent call blocked by a user-specific payment rule, followed by a real PayPal Sandbox purchase to the demo merchant.
- Use Next.js for the web app, NestJS for the API, Vercel for hosting, Gemini API for audio understanding/function calling, and PayPal Orders v2 Sandbox for checkout.
- Render is explicitly excluded. Sponsor tools are optional; do not add one without a useful product role.
- Ship REST endpoints and a small stateless MCP-over-HTTP interface over shared NestJS services. MCP must not expose capture.

## Security and accuracy boundaries

- Sandbox only. Never use live PayPal credentials or move real money.
- The model interprets untrusted audio/text and suggests actions. Deterministic server policy decides `ALLOW`, `HOLD`, or `BLOCK`.
- Never give the model PayPal credentials or a direct capture tool. Capture requires explicit user confirmation and server-side PayPal order checks.
- Do not claim voice authentication, deepfake detection, external payee verification, or a universal scam verdict.
- Only compare a requested recipient with the fictional, user-controlled records in the demo profile. Label these records as demo fixtures.
- Keep API keys on the server and do not retain raw audio or personal contact data.

## Submission expectations

The final project needs a public repository with an open-source license, complete setup instructions, a functional hosted demo or reproducible local run path, an AI/tool disclosure, and a demo video under three minutes. Keep the plan as one end-to-end build; do not split the product into v0/v1/v2 proposals.
