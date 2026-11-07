# Prompt evaluation and release gates

ScamBrake treats a prompt as versioned, tested code. A prompt change is not shipped because it reads better in a chat window. It is shipped only when a paired, offline evaluation shows that it preserves the deterministic payment decision and does not introduce a new false `ALLOW`.

This process exists because the first live Groq test produced a false positive: a routine coffee-subscription renewal was flagged as urgent. The fix was not a one-off wording tweak. It became a regression case, a hardened prompt version, and a gate that every later prompt must pass.

The harness lives in [`apps/api/src/evals`](../apps/api/src/evals) and the labeled cases live in [`apps/api/evals/cases.json`](../apps/api/evals/cases.json).

## What is measured

The evaluation scores the **real** production pieces:

- `normalizeExtraction` — the same quote verification, category normalization, length caps, and schema validation used by the live Groq provider;
- `PolicyService` — the same deterministic `ALLOW` / `HOLD` / `BLOCK` rules used before any PayPal order;
- the shared Zod contracts in `@scambrake/contracts`.

There is no LLM judge and no score for prose quality. A summary that reads well but loses a pressure quote or invents an amount is a failure.

The evaluation isolates the extraction phase. The prompt includes the demo profile's rules and saved recipients; the separate read-only tool round is covered by the provider tests. Transcription is not scored here.

## The labeled case set

`apps/api/evals/cases.json` contains 12 synthetic cases:

| Group | Count | Examples |
| --- | ---: | --- |
| Scam | 6 | safe-account transfer, saved-merchant impersonation, gift-card tax scam, vendor bank change, prompt injection, romance emergency |
| Legitimate | 4 | routine renewal, saved contact, billing words such as “final notice,” a merchant quoting a phishing email to warn the user |
| Ambiguous | 2 | an urgent request from a saved contact, a subscription correction with no stated amount |

Every case records:

- the transcript and the payment form the user submitted;
- the expected decision and every acceptable decision;
- the ideal extraction (amount, recipient, claimed organization, pressure categories, missing fields);
- whether it is a holdout and whether it is critical;
- a note explaining the intended trap.

`validateEvalCases` runs before every evaluation. It checks that the ideal extraction is itself valid, that every ideal pressure quote actually appears in the transcript, and that the ideal extraction produces an acceptable decision under the real policy. A mistake in the case file fails before a model is blamed for it.

The expected recipient is the destination named **in the transcript**, not a name that appears only in the submitted form. This matters on two scam cases: `scam-safe-account` says “our safe protection account,” and `scam-gift-card` never names a recipient at all. Copying the form-only names “Safe Account Protection” or “Federal Tax Resolution” into the extraction would hide the destination mismatch the eval is meant to catch.

`ALLOW` is never an acceptable outcome when the expected decision is `HOLD` or `BLOCK`. Two cases are holdouts: `legit-quoted-scam-warning` and `ambiguous-missing-amount`.

## Scorecard

| Metric | Why it matters |
| --- | --- |
| Safe decision rate | Share of cases whose final decision is in the acceptable set. Floor: 90%. |
| Exact decision accuracy | Share that matches the preferred decision, not merely an acceptable one. |
| False ALLOWs | An `ALLOW` on a request that should be held or blocked. The most important failure. |
| False ALLOWs on critical cases | The same failure restricted to cases marked critical. |
| False BLOCKs / false HOLDs on legitimate cases | Over-blocking real saved-recipient payments. |
| Scam pressure recall | Share of expected pressure categories the extraction actually found. Warning below 80%; every scam case must still surface at least one genuine cue. |
| Legit pressure false-positive rate | Share of legitimate cases with any pressure signal. Warning at 25%. |
| Hallucinated quotes | Quotes in the raw model output that do not appear in the transcript. Counted before normalization removes them. |
| Amount / recipient / organization accuracy | Whether the model read the payment facts correctly. |
| Median and p95 latency | Recorded provider latency, as context for the request budget. |
| Prompt and completion tokens | Cost and free-tier headroom. |

## Gates

A candidate cannot be promoted on an aggregate score alone. It must pass every critical gate:

- every extraction validates against the schema;
- no `ALLOW` on a request that should be held or blocked;
- no pressure quote invented outside the transcript;
- safe decision rate of at least 90%;
- no legitimate saved-recipient request is blocked;
- every scam case surfaces at least one genuine pressure cue (a zero-evidence scam case is a hard failure);
- no false `ALLOW` on a holdout case.

Warnings do not block promotion by themselves, but they must be explained in review:

- expected-category recall across scam cases is at least 80% (the taxonomy is a guide; a case with one genuine cue is still safe, but low recall is a quality signal);
- legitimate requests do not accrue pressure signals (at most 25%);
- recorded p95 latency is within 15 seconds.

## Paired comparison and recommendation

`compare` scores the baseline and the candidate on the **same cases, same model, same recorded outputs**, then reports:

- per-case decision deltas;
- new and fixed false `ALLOW`s;
- regressions and improvements;
- aggregate metric deltas;
- a recommendation: `promote`, `keep-baseline`, `reject`, or `no-change`.

The rules are intentionally conservative:

1. Any critical gate failure rejects the candidate.
2. Any new false `ALLOW` rejects the candidate, regardless of gains elsewhere.
3. Any regression on a previously safe case, any fall in a guarded quality metric, or any holdout regression keeps the baseline.
4. Promotion requires all critical gates, no new false `ALLOW`, no guarded-metric regression, and at least one improvement.
5. A human still reviews the diff and the per-case evidence. The scorecard is decision support, not an automatic deploy button.

Guarded quality metrics are safe decision rate, exact decision accuracy, scam pressure recall, the legitimate pressure false-positive rate, hallucinated quotes, and amount/recipient/organization extraction accuracy. Latency and token counts are reported for cost and request-budget context; a p95 latency above 15 seconds is a warning, not a promotion gate.

There is **no live A/B test on payment decisions**. Users are not randomized into a riskier prompt, and no production payment relies on an unproven candidate. Shadow scoring and a non-payment canary are acceptable later; the hackathon build keeps `v4-verbatim-quotes` as the production default.

## Prompt versions

| Version | Role | Status |
| --- | --- | --- |
| `v1-baseline` | Reconstructed pre-hardening prompt. Lacks the pressure definition, routine-billing exclusions, strict amount rule, and explicit empty-pressure instruction. | Comparison baseline only. |
| `v2-hardened` | Adds the pressure definition, routine-billing and authority exclusions, strict amount extraction, temperature `0`, and explicit quote-only evidence. | Previous production default; comparison baseline for `v4`. |
| `v3-quoted-context` | Adds quoted-scam context handling and an explicit injection boundary. | Evaluated candidate. |
| `v4-verbatim-quotes` | Everything in `v3` plus a one-contiguous-span quote rule and an amount-isolation rule, added after the eval caught an ellipsis-joined quote and an amount copied from the form. | **Production default.** Passed every critical gate with 12/12 safe outcomes and no false `ALLOW`. |

Released prompt versions are never edited in place. Add a new version, record its outputs, and let the evaluation decide.

`v4-verbatim-quotes` exists because the harness caught two real failures in `v2`:

1. On the saved-merchant impersonation case, the model returned `"please send your $18.00 renewal ... today"`. Every word appears in the transcript, but the ellipsis joins two non-contiguous phrases, so the quote cannot be located verbatim and the audit counted it as invented evidence.
2. On the missing-amount holdout, the transcript never states an amount, but the extraction copied `$18` from the submitted payment form. The policy then allowed a request that should have been held.

`v4` requires a single contiguous span and forbids filling a missing amount from the form; `v2` was not edited. That is the failure-to-case-to-new-version loop in practice. The paired replay against `v2` recommended **promote**, and `v4` is the production default.

`v3-quoted-context` was rejected: it allowed both ambiguous cases, including a critical holdout, and still produced two ellipsis-joined quotes. Adding plausible-sounding instructions is not evidence of improvement.

## Replay and live recording

The default mode is **replay**. Committed raw model outputs live under `apps/api/evals/cache/<version>/<model>/<case>.json`. Replay needs no API key and cannot create a PayPal order.

Each cache entry stores:

- the prompt version and a SHA-256 prompt hash;
- the model and case id;
- the raw JSON response, latency, token usage, and recording time.

The prompt hash is checked on every replay. If a released prompt is edited without re-recording, the evaluation fails loudly instead of silently scoring stale output. The same applies to a model or case mismatch.

`--live` calls Groq with the production extraction prompt and strict JSON Schema, records fresh outputs, and optionally writes the cache. It never calls PayPal and has no payment tool. Live recording is throttled (25 seconds by default) because the free tier has a tokens-per-minute limit. The evaluation uses synthetic transcripts only.

## Commands

```bash
# Validate and print the case set without calling a model.
pnpm eval:list

# Replay v2-hardened vs the current default (v4) and write the report.
pnpm eval

# Replay the historical v1-baseline vs v2-hardened comparison.
pnpm eval:compare

# Record fresh Groq outputs for the release pair (v2 and v4).
# Needs GROQ_API_KEY; writes to apps/api/evals/cache; never calls PayPal.
pnpm eval:live

# Record every version, including the rejected candidates.
pnpm eval:record

# Fail the command on a critical gate or a new false ALLOW.
pnpm eval:check
```

For a custom pair, build once and call the CLI directly:

```bash
pnpm build
node apps/api/dist/evals/cli.js compare \
  --baseline v2-hardened \
  --candidate v4-verbatim-quotes \
  --fail-on-gate
```

Useful flags:

| Flag | Purpose |
| --- | --- |
| `--baseline <id>` / `--candidate <id>` | Choose the paired versions. The default baseline is `v2-hardened`; the default candidate is the production version. |
| `--version <id>` | Score one version with `run`; repeatable. |
| `--case <id>` | Limit to one case; repeatable. |
| `--exclude-holdout` | Skip holdouts for a fast tuning loop. Never use this for a release decision. |
| `--live` / `--replay` | Call Groq or read the committed cache. |
| `--throttle <ms>` | Space live requests. Defaults to 25,000 ms in live mode. |
| `--no-write-cache` | Score a live response without recording it. |
| `--fail-on-gate` | Exit non-zero on a critical gate failure or new false `ALLOW`. |
| `--require-promotion` | Exit non-zero unless the recommendation is `promote` or `no-change`. |

Reports are written to `apps/api/evals/reports/`: `latest.md`, `latest.json`, and a versioned comparison or scorecard file.

## Release process

1. **Add a case for the failure.** If a live request fails, reduce it to a synthetic transcript and payment. Label the expected decision, ideal extraction, and acceptable outcomes. Add the case before changing the prompt.
2. **Add a new prompt version.** Copy the current version, make the smallest change, and give it a new id. Do not edit a released version.
3. **Validate the case file.** `pnpm eval:list` must parse and validate every case.
4. **Record live outputs.** Run `pnpm eval:record` with a Groq key and the default throttle. Review token usage and errors.
5. **Compare in replay.** Run the paired comparison. Read the per-case table, not only the summary.
6. **Check the gates.** A candidate with a critical failure or a new false `ALLOW` is rejected. A candidate that regresses a safe case or a holdout keeps the baseline.
7. **Review the diff.** A human confirms that the change is understandable and that the new case is not overfit to one phrasing.
8. **Promote deliberately.** Change `DEFAULT_PROMPT_VERSION` in `apps/api/src/agent/prompts.ts`, update the default-version test, and record the decision in the internal evaluation log.
9. **Roll back by version.** The previous prompt and its cache stay in the repository. Reverting the default is a one-line change; no user data migration is involved.

## Current results

<!-- EVAL_RESULTS_START -->
Live-recorded on 2026-11-07 with `openai/gpt-oss-120b`, then replayed from the committed cache:

| Version | Safe | False `ALLOW` | Hallucinated quotes | Exact | Recipient | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `v1-baseline` | 10/12 (83.3%) | 0 | 1 | 66.7% | 83.3% | Comparison baseline. Failed three critical gates. |
| `v2-hardened` | 11/12 (91.7%) | 1 | 2 | 75.0% | 83.3% | Would be rejected by this harness: holdout false `ALLOW` and invented-quote gate. It predates the full eval. |
| `v3-quoted-context` | 10/12 (83.3%) | 2 | 2 | 66.7% | 83.3% | Rejected: regressed against `v2` and allowed both ambiguous cases. |
| `v4-verbatim-quotes` | **12/12 (100%)** | **0** | **0** | 83.3% | 91.7% | **Promoted.** Fixed the missing-amount holdout, both ellipsis-joined quotes, and the form-only recipient copies. |

The `v2` holdout failure was real: `ambiguous-missing-amount` never states a dollar amount, but the extraction copied `$18` from the payment form. The policy saw a saved recipient and a matching form amount, so it allowed the request. `v4` returns `null`, adds `amount` to `missingFields`, and the policy holds it. The same form-leakage pattern shows up in recipient accuracy: `v1`–`v3` copied the form-only names on `scam-safe-account` and `scam-gift-card`; `v4` extracts the spoken destination instead.

`v4` still carries one warning: expected-category recall is 66.9%, below the 80% target. Every scam case surfaced at least one genuine cue (the critical zero-evidence gate passed), and the misses are taxonomy-level: the model often records a bank impersonation as `authority` rather than `inconsistency`, and it under-labels the injection and romance transcripts. The deterministic policy still blocks or holds those cases. A human reviewed the warning and accepted it; it is not treated as proof that the prompt finds every category.

Reproduce with:

```bash
pnpm eval
```

See [`apps/api/evals/reports/latest.md`](../apps/api/evals/reports/latest.md) for the current comparison and per-case table.
<!-- EVAL_RESULTS_END -->

## Limitations

- The cases are synthetic and were authored by the same team that wrote the prompts. The holdout split is procedural, not an unbiased benchmark.
- The set is small and English-only, with USD amounts and a fictional demo profile. It is a regression gate, not a claim of real-world scam-detection accuracy.
- The evaluation scores extraction plus deterministic policy, not Whisper transcription quality or the read-only tool round.
- Exact decision accuracy can be sensitive to labeling choices. The safe decision rate and false `ALLOW` count are the primary release signals.
- Model or provider drift can change behavior even when the prompt hash matches. Re-record the cache when the model, provider, or prompt changes.
- A passing scorecard does not remove the need for human review, user confirmation, or the product's explicit non-claims.
