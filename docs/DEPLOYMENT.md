# Deployment notes

ScamBrake is two deployable pieces:

- **web** — Next.js 15 (`apps/web`)
- **api** — NestJS 11 (`apps/api`) with REST and MCP

The verified submission path is the reproducible local run in the README. The Vercel path below is included for a hosted demo; it is deliberately Sandbox-only.

## Vercel: two projects

Deploy both projects from the same repository. Enable **Include source files outside of the Root Directory in the Build Step** for each project, because both depend on the workspace package `packages/contracts`.

### 1. API project

| Setting | Value |
| --- | --- |
| Root Directory | `apps/api` |
| Framework Preset | Other |
| Build Command | from `apps/api/vercel.json` |
| Node.js Version | 20.x or 22.x |

`apps/api/vercel.json` builds the contracts package and the API, then routes all requests to the compiled serverless entry `apps/api/api/index.cjs`, which reuses a Nest/Express instance across warm invocations. The compiled entry is required because Nest's dependency injection needs the decorator metadata emitted by `tsc`.

Environment variables:

```bash
AI_PROVIDER=groq              # or mock for a credential-free demo
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo

PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=...          # Sandbox app credentials only
PAYPAL_CLIENT_SECRET=...
PAYPAL_PAYEE_EMAIL=...        # optional but recommended
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com

DECISION_TICKET_SECRET=...    # openssl rand -hex 32
DECISION_TICKET_TTL_SECONDS=1200

MCP_API_KEY=...               # recommended on a public deployment
WEB_ORIGIN=https://your-web-project.vercel.app
```

Notes:

- `WEB_ORIGIN` must be the exact web origin, with no trailing slash. It also determines the PayPal return URL (`<origin>/checkout/return`). If you list multiple origins, the **first** is used for PayPal redirects.
- Vercel serverless functions have a 4.5 MB request body limit. The API accepts 3 MB of audio, which becomes roughly 4 MB as base64. Use short clips or the transcript on Vercel.
- Function `maxDuration` is set to 60 seconds. The Groq pipeline has a 50-second deadline across Whisper transcription, all tool rounds, and the extraction call, so the function keeps headroom for response handling.
- Rate limiting is in-memory and per instance. It is a speed bump, not a quota. Put a real limiter in front of a public deployment.
- The API is stateless. No database, disk, or webhook setup is required.
- `PAYPAL_ENV` must remain `sandbox`. The API refuses to start on a live environment or live API host.

Verify after deployment:

```bash
curl https://your-api.vercel.app/api/health
```

`status` is `ok` only when PayPal, AI, and the ticket secret are all configured. `degraded` is expected for a credential-free demo.

### 2. Web project

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework Preset | Next.js |
| Build Command | from `apps/web/vercel.json` |
| Node.js Version | 20.x or 22.x |

Environment variable:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-api.vercel.app/api
```

This value is compiled into the browser bundle. Redeploy the web project after changing it.

After both are live:

1. Set the API's `WEB_ORIGIN` to the final web origin and redeploy the API.
2. Open the web app, run the trusted purchase, approve with a PayPal Sandbox personal account, and confirm the return page reads `APPROVED` before capture.
3. Confirm the receipt shows the capture ID and the Sandbox label.

## Any Node 20+ host

The API is a normal NestJS server. A single-instance host works without the serverless entry:

```bash
pnpm install
pnpm build

# API process
PORT=4000 \
WEB_ORIGIN=https://your-web.example \
DECISION_TICKET_SECRET="$(openssl rand -hex 32)" \
PAYPAL_ENV=sandbox \
PAYPAL_CLIENT_ID=... \
PAYPAL_CLIENT_SECRET=... \
pnpm --filter @scambrake/api start

# Web process
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.example/api \
pnpm --filter @scambrake/web start
```

Put TLS and a reverse proxy in front, keep the API on a private network where possible, and set a durable rate limit at the edge. The server binds `0.0.0.0` on `PORT`.

`NEXT_PUBLIC_API_BASE_URL` must be set at **build** time for the web app, not only at runtime.

## Local production check

```bash
pnpm build
pnpm --filter @scambrake/api start    # terminal 1, :4000
pnpm --filter @scambrake/web start    # terminal 2, :3000
```

Then:

```bash
curl http://localhost:4000/api/health
open http://localhost:3000
```

## PayPal Sandbox setup checklist

- [ ] Developer Dashboard is in **Sandbox** mode.
- [ ] A Sandbox app exists; its client ID and secret are in the API environment (not the web project).
- [ ] A Sandbox business account receives the payment. Optional: name it `Kettle & Co.` and set `PAYPAL_PAYEE_EMAIL` to its email.
- [ ] A Sandbox personal account is available as the buyer.
- [ ] The API's `WEB_ORIGIN` matches the deployed web origin exactly.
- [ ] No live credentials exist in any environment variable.
- [ ] The receipt shows a real Sandbox capture ID and no real money moved.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `503 PAYPAL_NOT_CONFIGURED` | Missing or empty `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. |
| `502 PAYPAL_AUTH_FAILED` | Live credentials used, or Sandbox app disabled. |
| Checkout button missing | Decision is not `ALLOW`, amount is not exactly `$18.00`, or the recipient is not the demo merchant. |
| PayPal returns to the wrong URL | `WEB_ORIGIN` first entry is wrong; redeploy the API. |
| Browser calls `localhost:4000` in production | `NEXT_PUBLIC_API_BASE_URL` was missing at build time; rebuild the web project. |
| `502 AI_PROVIDER_UNAVAILABLE` / `AI_NOT_CONFIGURED` | Groq selected without a valid key, quota, or network access. No order was created. |
| `503 AI_PROVIDER_BUSY` | Groq rate limit hit. Wait and retry; no order was created. |
| `504 AI_TIMEOUT` | The 50-second Groq pipeline budget ran out. Use a shorter clip or paste the transcript. |
| API exits with “DECISION_TICKET_SECRET … required in production” | `NODE_ENV=production` without a valid ticket secret. Generate one with `openssl rand -hex 32`. |
| CORS error in the browser | `WEB_ORIGIN` does not exactly match the web origin (scheme, host, port). |
| Vercel function cannot find `dist/serverless.js` | Build command did not run, or source outside the root directory is excluded. |

Never switch to live PayPal credentials to “make the demo work.” A missing Sandbox checkout is acceptable; a live payment is not.
