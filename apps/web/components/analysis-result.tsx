"use client";

import type {
  AnalysisResult,
  CheckResult,
  Decision,
  DecisionReason,
  DemoMerchant,
  DemoProfile,
} from "@scambrake/contracts";
import { ArrowRight, ArrowUpRight, AlertTriangle, CheckCircle, FileAudio, MinusCircle, Refresh, ShieldCheck, XCircle } from "./icons";
import { CopyId } from "./copy-id";
import { TranscriptEvidence } from "./transcript-evidence";
import { formatDuration, formatMoney, formatTimestamp } from "@/lib/format";

const DECISION_COPY: Record<
  Decision,
  { title: string; subtitle: string; short: string }
> = {
  BLOCK: {
    title: "Payment stopped before checkout.",
    subtitle:
      "The server policy blocked this request. No PayPal order was created, and the AI has no capture tool.",
    short: "No PayPal order was created.",
  },
  HOLD: {
    title: "Paused for independent confirmation.",
    subtitle:
      "The server policy did not allow an automatic payment. No PayPal order exists yet. Verify the request through a channel you already trust.",
    short: "No PayPal order was created.",
  },
  ALLOW: {
    title: "Saved recipient. Saved amount. No pressure.",
    subtitle:
      "The server policy allows this request. If you choose, ScamBrake can now create a PayPal Sandbox order for the demo merchant.",
    short: "Checkout is available only after your click.",
  },
};

export function AnalysisResultView({
  analysis,
  profile,
  merchant,
  scenarioTitle,
  paypalConfigured,
  paying,
  payError,
  onPay,
  onReset,
  onReviewAnother,
  onTrySafe,
}: {
  analysis: AnalysisResult;
  profile: DemoProfile;
  merchant: DemoMerchant;
  scenarioTitle: string | null;
  paypalConfigured: boolean;
  paying: boolean;
  payError: string | null;
  onPay: () => void;
  onReset: () => void;
  onReviewAnother: () => void;
  onTrySafe: () => void;
}) {
  const decision = analysis.decision;
  const copy = DECISION_COPY[decision];
  const providerLabel =
    analysis.provider === "groq" ? "Groq live analysis" : "Demo analysis engine";
  const identity = analysis.extraction.claimedIdentity;
  const organization = analysis.extraction.claimedOrganization;
  const destination =
    analysis.extraction.requestedRecipientName ?? analysis.payment.recipientName;
  const destinationIdentifier =
    analysis.extraction.requestedRecipientIdentifier ?? analysis.payment.recipientIdentifier;

  return (
    <section id="result" className={`result-section decision-${decision.toLowerCase()}`} aria-live="polite">
      <div className="result-hero">
        <div className="result-topline">
          <span className="decision-stamp">{decision}</span>
          <span className="result-topline-meta">
            Deterministic policy <span className="dot-sep">·</span> {providerLabel}
          </span>
        </div>
        <h2>{copy.title}</h2>
        <p className="result-sub">{copy.subtitle}</p>
        <div className="result-payment">
          <strong>{formatMoney(analysis.payment.amount)} USD</strong>
          <ArrowRight width={18} height={18} />
          <span>{analysis.payment.recipientName}</span>
        </div>
        <div className="result-meta-row">
          <CopyId label="analysis" value={analysis.analysisId} />
          <span>{formatTimestamp(analysis.createdAt)}</span>
          {scenarioTitle && <span>{scenarioTitle}</span>}
          <span className="sandbox-chip">sandbox only</span>
        </div>
        {decision !== "ALLOW" && (
          <div className="no-order-line">
            <ShieldCheck width={15} height={15} />
            {copy.short}
          </div>
        )}
      </div>

      <div className="result-body">
        <div className="result-main">
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Evidence</span>
                <h3>What the request actually said</h3>
              </div>
              <span className="panel-count">
                {analysis.extraction.pressureSignals.length} cue
                {analysis.extraction.pressureSignals.length === 1 ? "" : "s"}
              </span>
            </div>
            <TranscriptEvidence
              transcript={analysis.extraction.transcript}
              signals={analysis.extraction.pressureSignals}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Decision</span>
                <h3>Why the policy returned {decision}</h3>
              </div>
            </div>
            <div className="reason-list">
              {analysis.reasons.map((reason, index) => (
                <ReasonRow
                  key={`${reason.code}-${index}`}
                  reason={reason}
                  ruleTitle={
                    reason.ruleId
                      ? profile.rules.find((rule) => rule.id === reason.ruleId)?.title
                      : undefined
                  }
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Trace</span>
                <h3>What the server actually did</h3>
              </div>
            </div>
            <ol className="step-list">
              {analysis.steps.map((step, index) => (
                <li key={step.key}>
                  <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="step-label">{step.label}</span>
                  <code>{formatDuration(step.durationMs)}</code>
                </li>
              ))}
            </ol>
            <p className="trace-note">
              These are measured server timings, not a simulated progress animation. The AI proposes
              evidence; the policy engine decides.
            </p>
          </section>
        </div>

        <aside className="result-side">
          <section className="panel">
            <span className="panel-kicker">Comparison</span>
            <h3>Who is asking vs. who gets paid</h3>
            <div className="compare-grid">
              <div className="compare-card">
                <span className="mini-label">Caller claimed</span>
                <strong>{identity ?? "Not stated"}</strong>
                <small>{organization ?? "No organization claimed"}</small>
              </div>
              <div className="compare-card">
                <span className="mini-label">Money would go to</span>
                <strong>{destination}</strong>
                <small>{destinationIdentifier ?? "No identifier supplied"}</small>
              </div>
            </div>
            <div className={`profile-match ${analysis.profileMatch ? "is-match" : "is-miss"}`}>
              <span className="profile-match-icon">
                {analysis.profileMatch ? (
                  <Check width={14} height={14} />
                ) : (
                  <XIcon width={14} height={14} />
                )}
              </span>
              <div>
                <strong>
                  {analysis.profileMatch
                    ? `Saved profile match: ${analysis.profileMatch.name}`
                    : "No saved profile match"}
                </strong>
                <small>
                  {analysis.profileMatch
                    ? `${analysis.profileMatch.type} · ${analysis.profileMatch.identifier ?? "no identifier"}`
                    : "A new recipient is held, not paid automatically."}
                </small>
              </div>
            </div>
            <p className="profile-note">
              Checked against the fictional demo profile for {profile.displayName}.
            </p>
          </section>

          <section className="panel">
            <span className="panel-kicker">Rule checks</span>
            <h3>Every deterministic check</h3>
            <div className="check-list">
              {analysis.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </section>
        </aside>
      </div>

      {decision === "ALLOW" ? (
        <CheckoutPanel
          analysis={analysis}
          merchant={merchant}
          paypalConfigured={paypalConfigured}
          paying={paying}
          payError={payError}
          onPay={onPay}
        />
      ) : (
        <SafetyPanel decision={decision} />
      )}

      <div className="result-actions">
        {decision === "BLOCK" && (
          <button type="button" className="btn btn-primary" onClick={onTrySafe}>
            Try the trusted $18 purchase
            <ArrowRight width={16} height={16} className="arrow" />
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onReviewAnother}>
          Review another request
        </button>
        <button type="button" className="btn btn-text" onClick={onReset}>
          <Refresh width={14} height={14} />
          Reset demo
        </button>
      </div>

      <p className="result-disclaimer">
        Fictional demo data. The model extracts evidence; the server policy decides. ScamBrake does
        not authenticate voices, detect deepfakes, or verify an arbitrary external payee.
      </p>
    </section>
  );
}

function ReasonRow({ reason, ruleTitle }: { reason: DecisionReason; ruleTitle?: string }) {
  const icon =
    reason.severity === "block" ? (
      <XCircle width={18} height={18} />
    ) : reason.severity === "hold" ? (
      <AlertTriangle width={18} height={18} />
    ) : (
      <CheckCircle width={18} height={18} />
    );
  return (
    <article className={`reason-row severity-${reason.severity}`}>
      <span className="reason-icon">{icon}</span>
      <div className="reason-content">
        <div className="reason-head">
          <h4>{reason.title}</h4>
          <span className="severity-pill">
            {reason.severity === "block" ? "block" : reason.severity === "hold" ? "hold" : "pass"}
          </span>
        </div>
        <p>{reason.detail}</p>
        {ruleTitle && <span className="rule-ref">Saved rule · {ruleTitle}</span>}
        {reason.evidenceQuotes.length > 0 && (
          <div className="reason-quotes">
            {reason.evidenceQuotes.slice(0, 3).map((quote, index) => (
              <span key={`${quote}-${index}`}>“{quote}”</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  const icon =
    check.status === "pass" ? (
      <CheckCircle width={16} height={16} />
    ) : check.status === "fail" ? (
      <XCircle width={16} height={16} />
    ) : (
      <MinusCircle width={16} height={16} />
    );
  return (
    <div className={`check-row check-${check.status}`}>
      <span className="check-icon">{icon}</span>
      <div>
        <strong>{check.label}</strong>
        <small>{check.detail}</small>
      </div>
    </div>
  );
}

function CheckoutPanel({
  analysis,
  merchant,
  paypalConfigured,
  paying,
  payError,
  onPay,
}: {
  analysis: AnalysisResult;
  merchant: DemoMerchant;
  paypalConfigured: boolean;
  paying: boolean;
  payError: string | null;
  onPay: () => void;
}) {
  const canPay = analysis.checkout.available && paypalConfigured && Boolean(analysis.ticket);
  return (
    <section className="checkout-panel">
      <div className="checkout-header">
        <div>
          <span className="panel-kicker">Next step</span>
          <h3>PayPal Sandbox checkout</h3>
        </div>
        <span className="sandbox-chip">sandbox</span>
      </div>
      <div className="checkout-merchant">
        <div>
          <span className="mini-label">Demo merchant</span>
          <strong>{merchant.name}</strong>
          <small>{merchant.identifier ?? "Sandbox seller"}</small>
        </div>
        <div className="checkout-amount">
          {formatMoney(merchant.amount)}
          <small>USD</small>
        </div>
      </div>
      <p className="checkout-note">{merchant.sandboxNote}</p>
      {canPay ? (
        <button type="button" className="paypal-button" onClick={onPay} disabled={paying}>
          {paying ? (
            <>
              <span className="spinner spinner-dark" />
              Creating Sandbox order…
            </>
          ) : (
            <>
              <span className="paypal-word">PayPal</span>
              <span>Pay {formatMoney(merchant.amount)}</span>
              <ArrowUpRight width={16} height={16} />
            </>
          )}
        </button>
      ) : (
        <div className="notice notice-amber">
          {!paypalConfigured
            ? "PayPal Sandbox credentials are not configured on this server, so checkout is unavailable. Analysis and policy still work."
            : (analysis.checkout.reason ?? "Checkout is not available for this request.")}
        </div>
      )}
      {payError && (
        <div className="notice notice-red" role="alert">
          {payError}
        </div>
      )}
      <p className="checkout-fine">
        The server fixes the merchant, amount, and currency. You approve at PayPal, then return to
        this app and press the final capture button. No capture happens without that click.
      </p>
    </section>
  );
}

function SafetyPanel({ decision }: { decision: Exclude<Decision, "ALLOW"> }) {
  return (
    <section className="safety-panel">
      <span className="safety-icon">
        <FileAudio width={22} height={22} />
      </span>
      <div>
        <span className="panel-kicker">Safer next step</span>
        <h3>
          {decision === "BLOCK"
            ? "Stop the conversation. Use a channel you already trust."
            : "Confirm independently before this moves."}
        </h3>
        <ul>
          <li>End the call or close the message. Do not send money based on this request.</li>
          <li>
            Contact the organization using the number printed on your card or inside its official
            app — not the number, link, or account details in this request.
          </li>
          <li>
            If money has already moved, call your bank immediately and explain what happened.
          </li>
          <li>
            ScamBrake cannot verify who is on the call or prove that a voice is authentic.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Check(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="m5 12.5 4.2 4.2L19 6.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" />
    </svg>
  );
}
