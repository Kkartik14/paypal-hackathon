"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, ScenariosResponse, Scenario } from "@scambrake/contracts";
import { AnalysisResultView } from "@/components/analysis-result";
import { AudioPlayer } from "@/components/audio-player";
import { Brand } from "@/components/brand";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  FileAudio,
  Lock,
  PhoneCall,
  Refresh,
  Shield,
  ShieldCheck,
  Spark,
} from "@/components/icons";
import { ApiClientError, analyzeRequest, createOrder, getScenarios } from "@/lib/api";
import { fetchScenarioAudio, fileToAudioPayload, MAX_AUDIO_BYTES } from "@/lib/audio";
import { formatMoney } from "@/lib/format";

const PENDING_ORDER_KEY = "scambrake.pendingOrder";

interface FormState {
  amount: string;
  recipientName: string;
  recipientIdentifier: string;
  purpose: string;
}

const EMPTY_FORM: FormState = {
  amount: "",
  recipientName: "",
  recipientIdentifier: "",
  purpose: "",
};

function formFromScenario(scenario: Scenario): FormState {
  return {
    amount: String(scenario.payment.amount),
    recipientName: scenario.payment.recipientName,
    recipientIdentifier: scenario.payment.recipientIdentifier ?? "",
    purpose: scenario.payment.purpose ?? "",
  };
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. No PayPal order was created.";
}

export default function HomePage() {
  const [catalog, setCatalog] = useState<ScenariosResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [transcript, setTranscript] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"idle" | "analyzing" | "result">("idle");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const initialised = useRef(false);

  const selectedScenario =
    catalog?.scenarios.find((scenario) => scenario.id === selectedId) ?? null;
  const scenarioForResult =
    catalog?.scenarios.find((scenario) => scenario.id === analysis?.scenarioId) ?? null;

  useEffect(() => {
    let cancelled = false;
    getScenarios()
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
        if (!initialised.current) {
          initialised.current = true;
          const first = data.scenarios[0] ?? null;
          if (first) {
            setSelectedId(first.id);
            setForm(formFromScenario(first));
            setTranscript(first.transcript);
          }
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setCatalogError(messageFor(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stage === "result" || stage === "analyzing") {
      const timer = window.setTimeout(() => {
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [stage]);

  function applyScenario(scenario: Scenario) {
    setSelectedId(scenario.id);
    setForm(formFromScenario(scenario));
    setTranscript(scenario.transcript);
    setAudioFile(null);
    setAnalysis(null);
    setStage("idle");
    setError(null);
    setPayError(null);
    setPaying(false);
  }

  function startFromScratch() {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setTranscript("");
    setAudioFile(null);
    setAnalysis(null);
    setStage("idle");
    setError(null);
    setPayError(null);
    setPaying(false);
  }

  function reset() {
    const first = catalog?.scenarios[0] ?? null;
    if (first) {
      applyScenario(first);
    } else {
      startFromScratch();
    }
    sessionStorage.removeItem(PENDING_ORDER_KEY);
    window.setTimeout(() => {
      document.getElementById("review")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function reviewAnother() {
    setAnalysis(null);
    setStage("idle");
    setPayError(null);
    setPaying(false);
    window.setTimeout(() => {
      document.getElementById("review")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function trySafeScenario() {
    const safe = catalog?.scenarios.find((scenario) => scenario.kind === "safe") ?? null;
    if (safe) {
      applyScenario(safe);
      window.setTimeout(() => {
        document.getElementById("review")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage === "analyzing" || !catalog) return;

    setError(null);
    setPayError(null);

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a payment amount greater than zero.");
      scrollToError();
      return;
    }
    if (!form.recipientName.trim()) {
      setError("Enter the recipient named in the payment request.");
      scrollToError();
      return;
    }
    if (!transcript.trim() && !audioFile) {
      setError("Add the words you heard, or upload a short audio clip.");
      scrollToError();
      return;
    }

    setAnalysis(null);
    setStage("analyzing");

    let audio: { base64: string; mimeType: string } | null = null;
    try {
      if (audioFile) {
        audio = await fileToAudioPayload(audioFile);
      } else if (selectedScenario) {
        audio = await fetchScenarioAudio(selectedScenario.audioUrl);
      }
    } catch (audioError) {
      setStage("idle");
      setError(messageFor(audioError));
      scrollToError();
      return;
    }

    try {
      const result = await analyzeRequest({
        mode: selectedScenario ? "scenario" : "custom",
        scenarioId: selectedScenario?.id,
        transcript: transcript.trim() || undefined,
        audioBase64: audio?.base64,
        audioMimeType: audio?.mimeType,
        payment: {
          amount,
          currency: "USD",
          recipientName: form.recipientName.trim(),
          recipientIdentifier: form.recipientIdentifier.trim() || undefined,
          purpose: form.purpose.trim() || undefined,
        },
      });
      setAnalysis(result);
      setStage("result");
    } catch (requestError) {
      setStage("idle");
      setError(messageFor(requestError));
      scrollToError();
    }
  }

  async function handlePay() {
    if (!analysis?.ticket) {
      setPayError("This decision does not include a checkout ticket. Review the request again.");
      return;
    }
    setPaying(true);
    setPayError(null);
    try {
      const order = await createOrder(analysis.ticket);
      sessionStorage.setItem(
        PENDING_ORDER_KEY,
        JSON.stringify({
          orderId: order.orderId,
          ticket: analysis.ticket,
          analysisId: analysis.analysisId,
          amount: order.amount,
          merchantName: order.merchantName,
          approveUrl: order.approveUrl,
          createdAt: new Date().toISOString(),
        }),
      );
      window.location.assign(order.approveUrl);
    } catch (orderError) {
      setPaying(false);
      setPayError(messageFor(orderError));
    }
  }

  function onAudioChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setAudioFile(null);
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setAudioFile(null);
      setError("Audio must be 3 MB or smaller. Use a shorter clip or the transcript.");
      event.target.value = "";
      return;
    }
    setError(null);
    setAudioFile(file);
  }

  function scrollToError() {
    window.setTimeout(() => {
      document.getElementById("review-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  }

  const providerLabel =
    catalog?.provider === "groq" ? "Groq live analysis" : "Offline analysis engine";

  return (
    <>
      <a className="skip-link" href="#review">
        Skip to payment review
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="site-nav" aria-label="Primary">
            <a href="#review">Review</a>
            <a href="#how">Method</a>
            <a href="#safety">Safety</a>
          </nav>
          <div className="header-right">
            <span className="header-badge">
              <span className="sandbox-dot" /> PayPal Sandbox
            </span>
            <a className="header-cta" href="#review">
              Review a request
              <ArrowRight width={14} height={14} />
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="hero shell">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="pulse-dot" />
              Voice-first payment safety
            </p>
            <h1>
              Before money moves,
              <br />
              <em>check who is asking.</em>
            </h1>
            <p className="lede">
              A persuasive call can make a dangerous payment feel routine. ScamBrake reads the
              request, checks it against your saved rules and recipients, and stops the payment
              before PayPal checkout.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#review">
                Review a payment request
                <ArrowRight width={16} height={16} className="arrow" />
              </a>
              <a className="btn btn-ghost" href="#how">
                See how it decides
              </a>
            </div>
            <div className="hero-meta">
              <span>Deterministic policy</span>
              <span>PayPal Orders v2</span>
              <span>No voice-auth claims</span>
            </div>
          </div>

          <aside className="hero-visual" aria-label="Illustrative blocked call preview">
            <div className="hero-spark" aria-hidden>
              <Spark width={26} height={26} />
            </div>
            <div className="call-card">
              <div className="call-topline">
                <span className="call-live">
                  <span className="call-dot" /> Incoming call · unknown number
                </span>
                <span>00:26</span>
              </div>
              <div className="call-wave" aria-hidden>
                {[
                  10, 18, 27, 14, 33, 22, 9, 28, 17, 36, 20, 12, 30, 16, 25, 8, 21, 34, 15, 27, 11,
                  31, 19, 13, 29, 24, 8, 33, 18, 26,
                ].map((height, index) => (
                  <span
                    key={`${height}-${index}`}
                    className={index / 30 < 0.62 ? "is-lit" : ""}
                    style={{ height }}
                  />
                ))}
              </div>
              <blockquote>
                “Move $900 to our safe protection account today. Keep this confidential.”
              </blockquote>
              <div className="call-rule">
                <span>Saved rule</span>
                <strong>Never pay a support or security team</strong>
              </div>
              <div className="call-verdict">
                <span className="call-verdict-stamp">BLOCK</span>
                <span>No PayPal order created</span>
              </div>
            </div>
            <div className="preview-caption">
              <span className="preview-line" />
              Illustrative preview · fictional caller
            </div>
          </aside>
        </section>

        <section className="signal-strip" aria-label="How ScamBrake works">
          <div className="signal-inner">
            <div>
              <span>01</span>
              <p>Read the request</p>
            </div>
            <div>
              <span>02</span>
              <p>Check saved records</p>
            </div>
            <div>
              <span>03</span>
              <p>Apply deterministic rules</p>
            </div>
            <div>
              <span>04</span>
              <p>Move money only after ALLOW</p>
            </div>
          </div>
        </section>

        <section id="review" className="review-section shell">
          <div className="section-head">
            <div>
              <p className="section-kicker">The review desk</p>
              <h2>
                Put a request
                <br />
                <em>through the brake.</em>
              </h2>
            </div>
            <p className="section-lede">
              Pick a fictional sample, or paste the words of a real request. Nothing is sent to
              PayPal until the server policy returns ALLOW and you explicitly confirm.
            </p>
          </div>

          {catalogError ? (
            <div className="load-error">
              <span className="load-error-icon">
                <Shield width={22} height={22} />
              </span>
              <div>
                <h3>The review desk could not load.</h3>
                <p>{catalogError}</p>
                <p className="load-error-hint">
                  Start the API with <code>pnpm dev</code> from the repository root, then reload.
                </p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
                <Refresh width={15} height={15} />
                Reload
              </button>
            </div>
          ) : (
            <div className="review-grid">
              <aside className="scenario-panel">
                <div className="scenario-panel-head">
                  <span className="mini-label">Sample scenarios</span>
                  <span className="fictional-pill">fictional</span>
                </div>
                <div className="scenario-list">
                  {catalog?.scenarios.map((scenario) => {
                    const selected = scenario.id === selectedId;
                    return (
                      <button
                        key={scenario.id}
                        type="button"
                        className={`scenario-card ${selected ? "is-selected" : ""}`}
                        onClick={() => applyScenario(scenario)}
                        aria-pressed={selected}
                      >
                        <div className="scenario-top">
                          <span className={`scenario-tag ${scenario.kind}`}>
                            {scenario.kind === "unsafe" ? "Pressure test" : "Trusted path"}
                          </span>
                          <span className={`scenario-radio ${selected ? "is-on" : ""}`}>
                            {selected && <Check width={11} height={11} />}
                          </span>
                        </div>
                        <strong>{scenario.title}</strong>
                        <span className="scenario-sub">{scenario.subtitle}</span>
                        <span className="scenario-meta">
                          <PhoneCall width={12} height={12} />
                          voice clip + transcript
                        </span>
                      </button>
                    );
                  })}
                  {!catalog &&
                    [0, 1].map((index) => <div key={index} className="scenario-skeleton" />)}
                </div>
                <button type="button" className="scratch-link" onClick={startFromScratch}>
                  Start from scratch
                  <ArrowUpRight width={13} height={13} />
                </button>
                <p className="fixture-note">
                  Every person, bank, and merchant here is fictional. The profile is a saved
                  fixture, not a PayPal or bank directory.
                </p>
              </aside>

              <form className="review-card" onSubmit={handleSubmit}>
                <div className="form-head">
                  <div>
                    <p className="section-kicker">Payment request</p>
                    <h3>{selectedScenario ? selectedScenario.title : "Custom request"}</h3>
                  </div>
                  <span className={`provider-pill ${catalog?.provider === "groq" ? "is-live" : ""}`}>
                    <span className="provider-dot" />
                    {providerLabel}
                  </span>
                </div>

                {selectedScenario && (
                  <div className="selected-sample">
                    <div className="selected-sample-copy">
                      <span className="mini-label">Call audio</span>
                      <strong>{selectedScenario.title}</strong>
                      <small>{selectedScenario.fixtureNotice}</small>
                    </div>
                    <AudioPlayer
                      src={selectedScenario.audioUrl}
                      label={selectedScenario.title}
                    />
                  </div>
                )}

                {catalog?.provider === "mock" && (
                  <div className="notice notice-soft">
                    <Spark width={14} height={14} />
                    The offline engine reads the transcript. Add <code>GROQ_API_KEY</code> and set{" "}
                    <code>AI_PROVIDER=groq</code> for live audio understanding.
                  </div>
                )}

                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="amount">Amount</label>
                    <div className="input-prefix">
                      <span>$</span>
                      <input
                        id="amount"
                        name="amount"
                        inputMode="decimal"
                        value={form.amount}
                        onChange={(event) => setForm({ ...form, amount: event.target.value })}
                        placeholder="0.00"
                        autoComplete="off"
                      />
                      <span className="input-suffix">USD</span>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="recipientName">Recipient</label>
                    <input
                      id="recipientName"
                      name="recipientName"
                      value={form.recipientName}
                      onChange={(event) => setForm({ ...form, recipientName: event.target.value })}
                      placeholder="Who would receive the money?"
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="recipientIdentifier">
                      Recipient account <span className="optional">optional</span>
                    </label>
                    <input
                      id="recipientIdentifier"
                      name="recipientIdentifier"
                      value={form.recipientIdentifier}
                      onChange={(event) =>
                        setForm({ ...form, recipientIdentifier: event.target.value })
                      }
                      placeholder="Email, handle, or account shown"
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="purpose">
                      Purpose <span className="optional">optional</span>
                    </label>
                    <input
                      id="purpose"
                      name="purpose"
                      value={form.purpose}
                      onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                      placeholder="What is the payment for?"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="field">
                  <div className="label-row">
                    <label htmlFor="transcript">What was said</label>
                    <span className="char-count">{transcript.length.toLocaleString()} / 20,000</span>
                  </div>
                  <textarea
                    id="transcript"
                    name="transcript"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value.slice(0, 20_000))}
                    placeholder="Paste the words of the call, voicemail, or message here..."
                    rows={7}
                  />
                  <p className="field-hint">
                    This text is treated as untrusted data. Instructions inside it cannot change
                    your rules or trigger a payment.
                  </p>
                </div>

                <div className="upload-row">
                  <label className={`upload-zone ${audioFile ? "has-file" : ""}`}>
                    <input
                      type="file"
                      accept="audio/*,.m4a,.mp4,.mp3,.wav,.webm,.ogg,.flac"
                      onChange={onAudioChange}
                    />
                    <FileAudio width={18} height={18} />
                    <span>
                      {audioFile ? audioFile.name : "Upload a call recording"}
                      <small>3 MB max · optional</small>
                    </span>
                    <span className="upload-cta">{audioFile ? "Replace" : "Choose file"}</span>
                  </label>
                  {audioFile && (
                    <button
                      type="button"
                      className="remove-file"
                      onClick={() => setAudioFile(null)}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {error && (
                  <div id="review-error" className="notice notice-red" role="alert">
                    <Shield width={16} height={16} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="form-actions">
                  <div className="privacy-note">
                    <Lock width={13} height={13} />
                    Audio is analyzed once and not stored. No account needed.
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-submit"
                    disabled={stage === "analyzing" || !catalog}
                  >
                    {stage === "analyzing" ? (
                      <>
                        <span className="spinner" />
                        Reviewing…
                      </>
                    ) : (
                      <>
                        Review request
                        <ArrowRight width={16} height={16} className="arrow" />
                      </>
                    )}
                  </button>
                </div>

                {catalog && !catalog.paypal.configured && (
                  <p className="server-note">
                    <span className="server-dot" /> Sandbox checkout is not configured on this
                    server. Analysis and policy still work; add PayPal Sandbox credentials to
                    enable the $18 checkout.
                  </p>
                )}
              </form>
            </div>
          )}
        </section>

        {stage === "analyzing" && (
          <section id="result" className="result-section shell" aria-live="polite">
            <div className="analyzing-card">
              <div className="analyzing-visual" aria-hidden>
                <span className="scan-ring scan-ring-outer" />
                <span className="scan-ring scan-ring-inner" />
                <ShieldCheck width={34} height={34} />
              </div>
              <div className="analyzing-copy">
                <p className="section-kicker">Review in progress</p>
                <h2>Reading the request and applying your rules.</h2>
                <p>
                  {selectedScenario
                    ? `Reviewing “${selectedScenario.title}”.`
                    : "Reviewing the submitted request."}{" "}
                  The server is extracting evidence, checking saved records, and running
                  deterministic policy. No PayPal order exists yet.
                </p>
                <div className="analyzing-meta">
                  <span className="spinner" />
                  {catalog?.provider === "groq"
                    ? "Groq transcription and analysis usually take a few seconds."
                    : "The offline engine responds almost instantly."}
                </div>
                <div className="analyzing-note">
                  <Lock width={13} height={13} />
                  Raw audio is not retained. This screen shows real server state, not a simulated
                  timer.
                </div>
              </div>
            </div>
          </section>
        )}

        {stage === "result" && analysis && catalog && (
          <div className="shell">
            <AnalysisResultView
              analysis={analysis}
              profile={catalog.profile}
              merchant={catalog.merchant}
              scenarioTitle={scenarioForResult?.title ?? null}
              paypalConfigured={catalog.paypal.configured}
              paying={paying}
              payError={payError}
              onPay={handlePay}
              onReset={reset}
              onReviewAnother={reviewAnother}
              onTrySafe={trySafeScenario}
            />
          </div>
        )}

        <section id="how" className="how-section">
          <div className="shell">
            <div className="section-head how-head">
              <div>
                <p className="section-kicker">The method</p>
                <h2>
                  A model for the conversation.
                  <br />
                  <em>A rulebook for the money.</em>
                </h2>
              </div>
              <p className="section-lede">
                The AI is useful at reading messy human language. It is the wrong component to make
                an irreversible payment decision. ScamBrake splits those jobs on purpose.
              </p>
            </div>

            <div className="how-grid">
              <article>
                <span className="how-number">01</span>
                <h3>Read the request</h3>
                <p>
                  Groq transcribes the clip with Whisper and extracts the claimed identity,
                  payment destination, amount, purpose, and pressure cues as structured evidence.
                </p>
              </article>
              <article>
                <span className="how-number">02</span>
                <h3>Look up saved records</h3>
                <p>
                  Read-only tools retrieve the fictional user&apos;s saved recipients and payment
                  rules. The model cannot edit them, add a recipient, or call PayPal.
                </p>
              </article>
              <article>
                <span className="how-number">03</span>
                <h3>Apply deterministic rules</h3>
                <p>
                  Server code checks the support-payment rule, trusted recipients, per-recipient
                  and user limits, pressure language, and whether the submitted details match the
                  request.
                </p>
              </article>
              <article>
                <span className="how-number">04</span>
                <h3>Ticket, then checkout</h3>
                <p>
                  Only an ALLOW decision creates a short-lived signed ticket. The server fixes the
                  merchant, amount, and currency before creating the PayPal Sandbox order.
                </p>
              </article>
            </div>

            <div className="boundary-grid">
              <div className="boundary-card can">
                <span className="boundary-label">The AI can</span>
                <ul>
                  <li>Transcribe and quote the request</li>
                  <li>Surface urgency, secrecy, and redirection cues</li>
                  <li>Read saved rules and recipient records</li>
                  <li>Explain evidence in plain language</li>
                </ul>
              </div>
              <div className="boundary-card cannot">
                <span className="boundary-label">The AI cannot</span>
                <ul>
                  <li>Set the final ALLOW, HOLD, or BLOCK decision</li>
                  <li>Change a saved limit or add a trusted recipient</li>
                  <li>Hold PayPal credentials or call capture</li>
                  <li>Authenticate a voice or prove a deepfake</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="safety" className="safety-section shell">
          <div className="section-head">
            <div>
              <p className="section-kicker">Scope and honesty</p>
              <h2>
                What ScamBrake proves.
                <br />
                <em>And what it does not.</em>
              </h2>
            </div>
            <p className="section-lede">
              ScamBrake is a warning and a safer next step, not a fraud authority. The saved
              profile uses fictional fixtures, and payments stay in PayPal Sandbox.
            </p>
          </div>
          <div className="safety-grid">
            <article className="safety-card">
              <span className="safety-card-label">It does</span>
              <ul>
                <li>Compare a claimed sender and destination with a small, user-controlled saved profile.</li>
                <li>Show the exact transcript quotes behind every pressure cue.</li>
                <li>Block or hold before any PayPal order exists.</li>
                <li>Complete a real Orders v2 Sandbox create → approve → capture flow for the safe sample.</li>
              </ul>
            </article>
            <article className="safety-card is-muted">
              <span className="safety-card-label">It does not</span>
              <ul>
                <li>Verify who is on the call or whether a voice is synthetic.</li>
                <li>Check an arbitrary external payee against a bank or PayPal directory.</li>
                <li>Move real money or present Sandbox money as real.</li>
                <li>Produce a calibrated “fraud probability.”</li>
              </ul>
            </article>
          </div>
          <div className="dev-strip">
            <div>
              <span className="mini-label">Agent interface</span>
              <code>POST /mcp</code>
              <span>Stateless MCP over HTTP: analyze, saved recipients, PayPal order status.</span>
            </div>
            <span className="dev-strip-note">No capture tool is exposed.</span>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Brand linked={false} />
            <p>Before money moves, check who is asking.</p>
          </div>
          <div className="footer-meta">
            <span>PayPal AI Hackathon · Sandbox only</span>
            <span>MIT-licensed</span>
            <span>Fictional people, banks, and merchants</span>
          </div>
        </div>
      </footer>
    </>
  );
}
