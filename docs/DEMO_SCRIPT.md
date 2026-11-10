# ScamBrake demo script

**Target runtime:** 2 minutes 20 seconds (hard limit: 3 minutes)
**Format:** screen recording with voice-over
**Environment:** local app or hosted demo (https://scambrake-web-kappa.vercel.app), PayPal **Sandbox**, fictional fixtures only

## Before recording

- [ ] `pnpm dev` is running, or the hosted demo is live.
- [ ] `pnpm eval:check` passes locally, so the build uses the prompt that passed the offline gates.
- [ ] `GET /api/health` shows the expected `aiProvider` and, for the full story, `paypalConfigured: true`.
- [ ] A PayPal Sandbox **personal** buyer account is available. Sign out of PayPal before recording.
- [ ] The browser is on `http://localhost:3000` or https://scambrake-web-kappa.vercel.app in a fresh session (or press **Reset demo**).
- [ ] Browser zoom is 110%, bookmarks/extension bars are hidden, and no `.env`, terminal secrets, or personal tabs are visible.
- [ ] Audio is checked with a 5-second test. Record at 1080p or higher.
- [ ] Do not show real names, emails, credentials, or any live PayPal account.

If Groq is not configured, the demo still works with the labelled **demo analysis engine**. Say so if it appears; do not imply live audio understanding. If PayPal is not configured, checkout is unavailable by design — use a configured Sandbox for the recorded success path.

## 0:00–0:15 — The problem

**Show:** ScamBrake home screen, hero and the dark “incoming call” preview.

**Say:**
> “A payment agent can do exactly what you asked and still help a scammer — if the request came from a convincing call. ScamBrake checks the conversation and the payment details before money moves.”

## 0:15–0:55 — The fake support call

**Show:**

1. Click **The urgent support call**.
2. Play a few seconds of the fictional clip, then pause. Point at the transcript.
3. Click **Review request**.
4. On the result, scroll through the highlighted evidence: “move $900,” “safe protection account,” “keep this confidential.”
5. Pause on the **BLOCK** stamp, the saved rule, the claimed-identity mismatch, and the line **No PayPal order was created.**

**Say:**
> “This caller claims to be bank security and asks the user to move $900 to a new ‘protection account.’ The agent extracts the request and quotes the pressure cues. Then server-side policy checks it against this user's saved rules and recipients.”

> “The model surfaced the evidence. The policy made the decision. The AI cannot override the user's rule, change a limit, or call PayPal capture. No order exists.”

## 0:55–1:10 — Safe next action

**Show:** Scroll to the safer-next-step panel and the rule-check list.

**Say:**
> “The safer action is to stop the call and contact the bank through the number on the card — not the details in the request. ScamBrake does not claim to authenticate the voice or prove a deepfake.”

## 1:10–1:32 — The trusted purchase

**Show:** Click **Try the trusted $18 purchase**. The saved merchant scenario loads. Click **Review request**.

**Say:**
> “Now the other path. This is an $18 coffee subscription renewal from Kettle and Co., a merchant already saved in the demo profile, at the usual amount. The saved recipient, per-recipient limit, and no-pressure checks all pass.”

**Show:** The **ALLOW** result, the saved-profile match, and the green rule checks.

## 1:32–2:05 — PayPal Sandbox checkout

**Show:**

1. Scroll to **PayPal Sandbox checkout**, pointing at the fixed demo merchant and **$18.00 USD**.
2. Click the yellow **PayPal Pay $18.00** button.
3. Log in with the Sandbox buyer and approve the order.
4. Land on `/checkout/return`. Point at **APPROVED** and the message that nothing has been captured yet.
5. Click **Confirm and capture $18.00**.
6. Show the receipt: **Sandbox payment captured**, capture ID, amount, and the **sandbox** label.

**Say:**
> “Only an ALLOW decision creates a short-lived signed ticket. The server fixes the merchant, amount, and currency — the browser cannot change them. PayPal approves the buyer, then ScamBrake re-reads the live order and checks the amount, currency, analysis ID, and Sandbox payee before the final capture.”

> “This is a real Orders v2 Sandbox transaction, but Sandbox money is not real money. The demo merchant is fictional; the suspicious caller never receives anything.”

## 2:05–2:20 — The boundary

**Show:** Scroll to **What this demo proves. And what it does not.** Then the MCP line at the bottom.

**Say:**
> “The model reads the conversation. A deterministic policy controls the money. No voice authentication, no deepfake detection, no universal payee check — just a clear boundary before checkout. The read-only MCP endpoint exposes analysis and status, and no capture tool at all.”

## Close

**Show:** Home screen or the blocked result.

**Say:**
> “ScamBrake. Before money moves, check who is asking.”

## Backup plan

If PayPal Sandbox is unavailable during recording:

1. Keep the blocked path and the ALLOW decision in the video.
2. On the checkout panel, show the amber “sandbox checkout is not configured” notice (or the API's `503` message) and say: “Checkout is unavailable without server-side Sandbox credentials; analysis and policy still work. The repository includes the full create → approve → capture path.”
3. Do not fake a receipt. A missing capture is better than a fabricated one.

If Groq is unavailable, use the demo engine and explicitly disclose it on camera. Do not claim live audio analysis when the demo engine is running.

If you mention the evaluation, say only what it is: an offline regression harness over 12 authored synthetic cases that scores extraction plus the real policy, with a hard gate against false `ALLOW`. It is not a benchmark of real-world scam detection.

## Claims checklist

Use:

- “server-side policy decides”
- “fictional demo profile”
- “PayPal Sandbox”
- “saved recipient and saved limits”
- “the model extracts evidence”
- “prompts are versioned and gated offline” (only if you show the eval)

Avoid:

- “we verify who is calling”
- “we detect deepfakes”
- “we know this is a scam”
- “bank-grade” or “guaranteed safe”
- “real payment” (it is Sandbox)
- “benchmarked accuracy” or “trained on scam data” (the eval set is 12 synthetic authored cases)
