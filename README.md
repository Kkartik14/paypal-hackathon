# ScamBrake

**Before money moves, check who is asking.**

ScamBrake is a voice-first payment safety agent for social-engineering payment requests. It reads a suspicious call, extracts the claimed identity and payment destination, checks a user's saved rules and recipients, and lets a deterministic server policy decide **ALLOW**, **HOLD**, or **BLOCK**. Only an ALLOW decision can create a PayPal Orders v2 **Sandbox** checkout for a fixed, fictional demo merchant.

Built for the PayPal AI Hackathon. Sandbox only — no live credentials and no real money.

- [Security boundaries and known limits](docs/SECURITY.md)
- [Under-three-minute demo script](docs/DEMO_SCRIPT.md)
- [Deployment notes](docs/DEPLOYMENT.md)

> **Demo video:** record a sub-three-minute walkthrough with the running app and add the public YouTube URL here before submission. The script and shot list are in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## What the demo shows

| Scenario | What happens | Expected result |
| --- | --- | --- |
| **The urgent support call** (fictional) | A caller claims to be bank security, invents a $900 transfer, pushes a “safe protection account,” and asks for secrecy. | **BLOCK** — the saved “never pay a support team” rule fires, the claimed identity contradicts the destination, and no PayPal order is created. |
| **The saved merchant purchase** (fictional) | A coffee subscription renewal for $18 from Kettle & Co., a recipient already in the demo profile. | **ALLOW** — the user can choose to open a real PayPal Sandbox checkout for exactly $18.00 USD. |

The differentiating moment is the separation of jobs: the AI gathers and quotes evidence; deterministic server code makes the money decision and holds the PayPal credentials.

## Architecture

```
┌──────────────────────────┐        REST / JSON        ┌───────────────────────────┐
│  Next.js web (apps/web)  │ ────────────────────────▶ │  NestJS API (apps/api)    │
│  review, evidence,       │                           │                           │
│  checkout return         │                           │  Analysis  ─▶ Groq or     │
└──────────────────────────┘                           │              demo engine  │
                                                       │  Policy    ─▶ ALLOW/HOLD/ │
┌──────────────────────────┐        JSON-RPC           │              BLOCK        │
│  MCP client              │ ────────────────────────▶ │  Payments  ─▶ ticket +    │
│  (read-only tools)       │                           │              PayPal       │
└──────────────────────────┘                           └─────────────┬─────────────┘
                                                                     │ Orders v2
                                                                     ▼
                                                       PayPal Sandbox (no live money)
```

**Checkout gate.** An ALLOW analysis issues a 20-minute HMAC-signed decision ticket bound to the analysis ID, profile, recipient, amount, and currency. Creating an order requires a valid ticket and a server-fixed $18.00 USD demo merchant. Capturing requires buyer approval at PayPal, the same ticket, a fresh order read, and matching order ID, analysis ID, amount, currency, and (when configured) payee. The AI never sees PayPal credentials and has no capture tool.

## Repository layout

```
apps/web                 Next.js 15 app (review desk, result, PayPal return)
apps/api                 NestJS 11 API (analysis, policy, payments, MCP)
packages/contracts       Shared Zod schemas and TypeScript types
fixtures/audio           Committed synthetic demo call clips + transcripts
scripts/generate-audio.mjs  Regenerates the clips with macOS say + ffmpeg
docs/                    Security, demo script, deployment
```

## Quick start (verified local path)

**Prerequisites:** Node.js 20+ and pnpm 11.

```bash
corepack enable
pnpm install

cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

pnpm dev
```

Open **http://localhost:3000**. The API runs at **http://localhost:4000** with health at `GET /api/health`.

No credentials are required for the main flow:

- The labelled **demo analysis engine** (`AI_PROVIDER=mock`) analyzes the committed transcripts and the two sample scenarios.
- Policy decisions, evidence highlighting, MCP tools, and the full UI work.
- PayPal checkout shows an amber “not configured” notice and returns `503` from order creation. Nothing is charged.

If port `4000` or `3000` is already in use, run the two processes separately with explicit ports:

```bash
pnpm --filter @scambrake/contracts build
PORT=4100 pnpm --filter @scambrake/api dev
PORT=3100 pnpm --filter @scambrake/web dev
```

Then set `WEB_ORIGIN=http://localhost:3100` in `.env` and `NEXT_PUBLIC_API_BASE_URL=http://localhost:4100/api` in `apps/web/.env.local`. `NEXT_PUBLIC_*` values are baked at build time, so restart the web process after changing them.

### Useful commands

```bash
pnpm dev          # build contracts, then run API + web in watch mode
pnpm build        # production builds for contracts, API, web
pnpm typecheck    # TypeScript across all packages
pnpm test         # policy, ticket, config, and Groq provider tests (29 tests)
pnpm audio        # regenerate demo clips (macOS say + ffmpeg)
```

## Enable Groq audio understanding

By default the app runs the **demo analysis engine**, which reads the transcript and uses committed fixture extractions for the two sample scenarios. It is clearly labelled as a demo engine in the UI.

For live audio analysis:

1. Create a Groq API key at [console.groq.com/keys](https://console.groq.com/keys).
2. In `.env`:

   ```bash
   AI_PROVIDER=groq
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
   ```

3. Restart `pnpm dev`. `GET /api/health` reports `aiProvider: "groq"`.

What Groq does:

- Transcribes audio with Groq Whisper (`whisper-large-v3-turbo` by default). Supported formats: m4a/mp4, mp3, wav, webm, ogg, flac — max 3 MB.
- Runs a read-only tool phase (`get_payment_rules`, `get_saved_recipient`) with `openai/gpt-oss-120b`.
- Makes a separate, strict JSON-schema extraction call for claimed identity, requested action, destination, amount, purpose, pressure quotes, missing fields, confidence, and a neutral summary. Tools and structured output are separate calls because Groq does not support them together.
- Treats the Whisper transcript as authoritative when audio is attached; a pasted transcript is used only when there is no audio.

Failure behavior is deliberately loud: if `AI_PROVIDER=groq` and the key is missing, analysis returns `503`. If Groq errors, times out, or returns invalid JSON, analysis returns `502`. There is **no fallback to ALLOW**.

Raw audio is decoded in memory, sent to Groq for transcription, and discarded. It is not written to disk or a database. Request logs exclude transcripts, audio, and contact data. Groq processes the submitted audio and transcript under its API terms; use the synthetic demo audio only.

## Enable PayPal Sandbox checkout

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) and switch to **Sandbox**.
2. Create a Sandbox app and copy its **Sandbox** client ID and secret.
3. Create (or choose) a Sandbox **business** account to receive the demo payment. Optionally name it `Kettle & Co.` so the Sandbox receipt matches the fictional demo merchant.
4. Create a Sandbox **personal** account to use as the buyer during the demo.
5. Put the app credentials in `.env`:

   ```bash
   PAYPAL_ENV=sandbox
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   # Optional but recommended: the Sandbox business account email.
   PAYPAL_PAYEE_EMAIL=...
   ```

6. Restart the API and confirm `GET /api/health` reports `paypalConfigured: true`.
7. In the UI, run **The saved merchant purchase** → **ALLOW** → **Pay with PayPal**. Log in with the Sandbox personal account, approve the order, return to `/checkout/return`, and press the final **Confirm and capture** button.

Safety properties:

- `PAYPAL_ENV` must be `sandbox`. Any other value refuses to start.
- `PAYPAL_API_BASE` must be a PayPal Sandbox host (or localhost in development). Live hosts are refused.
- The amount, currency, and demo merchant are fixed server-side. A client cannot choose a different checkout amount.
- If `PAYPAL_PAYEE_EMAIL` is set, the server checks the order's payee before capture and refuses on mismatch.
- The browser redirect is never treated as proof of payment. The return page re-reads the order from PayPal and shows a capture button only when PayPal reports `APPROVED`.
- Capture is idempotent per order. A completed order displays the PayPal capture ID and status.

> The PayPal Sandbox seller is the account that owns your API credentials. `Kettle & Co.` is a fictional demo merchant. Sandbox balances are not real money.

## Environment variables

The API loads the root `.env`, then `apps/api/.env`, then real process environment variables (process variables win). The web app reads `apps/web/.env.local`; only `NEXT_PUBLIC_*` values reach the browser.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` (or `groq` if a key exists) | Analysis engine selection. |
| `GROQ_API_KEY` | — | Server-side Groq key. Never exposed to the browser. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Chat, tool-call, and extraction model. |
| `GROQ_TRANSCRIPTION_MODEL` | `whisper-large-v3-turbo` | Speech-to-text model. |
| `GROQ_API_BASE` | `https://api.groq.com/openai/v1` | Optional OpenAI-compatible Groq base URL; keep the default in production. |
| `PAYPAL_ENV` | `sandbox` | Must remain `sandbox`; anything else aborts startup. |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | — | Sandbox app credentials. Missing values make checkout return `503`. |
| `PAYPAL_PAYEE_EMAIL` | — | Optional expected Sandbox seller; verified before capture. |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` | Sandbox-only API host. |
| `DECISION_TICKET_SECRET` | dev-only fallback | HMAC secret, at least 32 characters. Required when `NODE_ENV=production`. |
| `DECISION_TICKET_TTL_SECONDS` | `1200` | Decision-ticket lifetime (20 minutes). |
| `MCP_API_KEY` | — | Optional bearer token for `/mcp`. Empty means public. |
| `PORT` | `4000` | API port. |
| `WEB_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated CORS origins. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api` | Browser-visible API base for the web app. |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Configuration and provider status. |
| `GET` | `/api/v1/demo/scenarios` | Demo profile, merchant, scenarios, provider, PayPal status. |
| `POST` | `/api/v1/analysis` | Analyze audio/transcript, run policy, optionally issue a ticket. |
| `POST` | `/api/v1/orders` | Create a PayPal Sandbox order from an ALLOW ticket. |
| `GET` | `/api/v1/orders/:id` | Read a ScamBrake order from PayPal. |
| `POST` | `/api/v1/orders/:id/capture` | Capture an approved order after explicit confirmation. |
| `POST` | `/mcp` | Stateless MCP JSON-RPC (read-only tools). |

### Analyze a sample

```bash
curl -s http://localhost:4000/api/v1/analysis \
  -H 'Content-Type: application/json' \
  -d '{
    "mode": "scenario",
    "scenarioId": "urgent-support-call",
    "transcript": "This is Daniel Reed from Meridian Bank account security...",
    "payment": {
      "amount": 900,
      "currency": "USD",
      "recipientName": "Safe Account Protection",
      "recipientIdentifier": "secure-payments@protection-review.example"
    }
  }'
```

Or send `audioBase64` + `audioMimeType` (base64 without a `data:` prefix) and omit the transcript when Groq is configured. With audio attached, the server transcribes it before analysis.

## MCP over HTTP

`POST /mcp` is a stateless JSON-RPC 2.0 endpoint. It exposes **read-only** tools:

| Tool | Purpose |
| --- | --- |
| `analyze_payment_request` | Full evidence + deterministic decision for a transcript and payment. Tickets and checkout are scrubbed. |
| `get_saved_recipients` | The fictional demo profile's saved recipients. |
| `get_payment_rules` | The fictional demo profile's limits and rules. |
| `get_paypal_order` | Read a ScamBrake-created PayPal Sandbox order. |

MCP **cannot** create an order, issue a decision ticket, or capture money. There is no capture tool to call. If `MCP_API_KEY` is set, send it as `Authorization: Bearer …` or `x-api-key`.

Example client configuration:

```json
{
  "mcpServers": {
    "scambrake": {
      "type": "http",
      "url": "http://localhost:4000/mcp",
      "headers": { "Authorization": "Bearer YOUR_MCP_API_KEY" }
    }
  }
}
```

Omit `headers` when `MCP_API_KEY` is empty. `GET /mcp` and `DELETE /mcp` return `405`: the endpoint is stateless and does not offer server-sent events.

## Security and limitations

ScamBrake is a warning and a safer next step — not a fraud authority. In short:

- It does **not** authenticate voices, detect deepfakes, or verify an arbitrary external payee.
- Recipient checks use a small, fictional, user-controlled demo profile. They are not a bank, PayPal, or universal scam directory.
- A `HOLD` is not a verdict; it means independent confirmation is required.
- The AI cannot set the decision, edit rules, add recipients, or capture money.
- Sandbox only. No real money moves.

Read [`docs/SECURITY.md`](docs/SECURITY.md) for the threat model, ticket design, data handling, and production-hardening gaps.

## Tests

```bash
pnpm test
```

Covers the support-payment block, saved-recipient ALLOW, new-recipient HOLD, amount limits, submitted-detail mismatches, low-confidence HOLD, ticket signing, tampering, expiry, malformed input, startup guards for production secrets and live PayPal configuration, and the Groq pipeline (Whisper transcription, read-only tool round, strict extraction, and timeout/rate-limit errors) against mocked HTTP responses.

The full ALLOW → create order → buyer approval → capture path was also exercised against a local fake Orders v2 service. Real PayPal Sandbox and live Groq calls require the credentials described above; they are not used by the credential-free demo path.

## Demo audio

`fixtures/audio/*.m4a` are committed so the demo does not depend on text-to-speech at runtime. They were generated with macOS `say` and `ffmpeg` using synthetic voices; transcripts are in the matching `.txt` files and embedded in the API fixtures. Regenerate with:

```bash
pnpm audio   # requires macOS say + ffmpeg
```

Every person, bank, merchant, and payment record in the demo is fictional.

## Deployment

The web app is Vercel-ready. The API includes a Vercel serverless entry (`apps/api/api/index.cjs`) and `apps/api/vercel.json`, or can run on any Node 20+ host.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for environment variables, two-project setup, sandbox constraints, and the verified local fallback.

## AI and tool disclosure

- **Runtime AI:** Groq, using `whisper-large-v3-turbo` for speech-to-text and `openai/gpt-oss-120b` for read-only tool calls and strict structured extraction. If no key is configured, a clearly labelled deterministic demo engine runs instead.
- **Decision-making:** no AI. The ALLOW/HOLD/BLOCK decision comes from deterministic server policy in `apps/api/src/policy/policy.service.ts`.
- **Development:** this repository was built with an AI coding agent (OpenCode) as part of the hackathon workflow. Policy and ticket behavior are covered by automated tests.
- **Voices:** the demo clips use macOS synthetic text-to-speech. No real caller or human voice recording is included.
- **Data:** all people, organizations, recipients, and merchants are fictional fixtures. PayPal is used in Sandbox mode only.

## License

[MIT](LICENSE).
