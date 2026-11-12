"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { OrderView } from "@scambrake/contracts";
import { Brand } from "@/components/brand";
import { CopyId } from "@/components/copy-id";
import { ArrowRight, CheckCircle, Clock, Lock, Refresh, ShieldCheck, XCircle } from "@/components/icons";
import { ApiClientError, captureOrder, getOrder } from "@/lib/api";
import { formatMoney, formatTimestamp } from "@/lib/format";

const PENDING_ORDER_KEY = "scambrake.pendingOrder";

interface PendingOrder {
  orderId: string;
  ticket: string;
  analysisId: string;
  amount: number;
  merchantName: string;
  approveUrl: string;
  createdAt: string;
}

type Phase = "loading" | "ready" | "capturing" | "done" | "error" | "missing";

export default function CheckoutReturnPage() {
  return (
    <Suspense fallback={<ReturnShell><ReturnLoading /></ReturnShell>}>
      <ReturnClient />
    </Suspense>
  );
}

function ReturnClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [phase, setPhase] = useState<Phase>("loading");
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verifyOrder = useCallback(
    async (orderId: string) => {
      setPhase("loading");
      setError(null);
      try {
        const liveOrder = await getOrder(orderId);
        setOrder(liveOrder);
        setPhase("ready");
      } catch (requestError) {
        setError(messageFor(requestError));
        setPhase("error");
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const raw = sessionStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) {
      if (!cancelled) setPhase("missing");
      return;
    }

    let saved: PendingOrder;
    try {
      saved = JSON.parse(raw) as PendingOrder;
    } catch {
      if (!cancelled) setPhase("missing");
      return;
    }

    if (!token) {
      setError(
        "PayPal did not return an order token. No capture was attempted. Return to the review page and start checkout again.",
      );
      setPhase("error");
      return;
    }
    if (token !== saved.orderId) {
      setError(
        "The PayPal return token does not match the pending ScamBrake order. No capture was attempted.",
      );
      setPhase("error");
      return;
    }

    setPending(saved);
    verifyOrder(saved.orderId).catch(() => {
      if (!cancelled) setPhase("error");
    });

    return () => {
      cancelled = true;
    };
  }, [token, verifyOrder]);

  async function handleCapture() {
    if (!pending) return;
    setPhase("capturing");
    setError(null);
    try {
      const captured = await captureOrder(pending.orderId, pending.ticket);
      setOrder(captured);
      setPhase("done");
    } catch (captureError) {
      setError(messageFor(captureError));
      setPhase("ready");
    }
  }

  if (phase === "missing") {
    return (
      <ReturnShell>
        <div className="return-card return-state">
          <span className="return-state-icon is-amber">
            <Clock width={26} height={26} />
          </span>
          <p className="section-kicker">Checkout return</p>
          <h1>No pending Sandbox order found.</h1>
          <p>
            The decision ticket lives in this browser tab&apos;s session. Start the trusted
            purchase from the review page, then return here after PayPal approval.
          </p>
          <Link className="btn btn-primary" href="/#review">
            Back to the review desk
            <ArrowRight width={16} height={16} className="arrow" />
          </Link>
        </div>
      </ReturnShell>
    );
  }

  if (phase === "error") {
    return (
      <ReturnShell>
        <div className="return-card return-state">
          <span className="return-state-icon is-red">
            <XCircle width={26} height={26} />
          </span>
          <p className="section-kicker">No capture attempted</p>
          <h1>This return could not be verified.</h1>
          <p>{error ?? "The Sandbox order could not be read. No payment was captured."}</p>
          <div className="return-actions">
            {pending && (
              <button type="button" className="btn btn-ghost" onClick={() => verifyOrder(pending.orderId)}>
                <Refresh width={15} height={15} />
                Check again
              </button>
            )}
            <Link className="btn btn-primary" href="/#review">
              Review again
              <ArrowRight width={16} height={16} className="arrow" />
            </Link>
          </div>
        </div>
      </ReturnShell>
    );
  }

  if (phase === "loading" || !order) {
    return (
      <ReturnShell>
        <ReturnLoading />
      </ReturnShell>
    );
  }

  const captured = order.capture;
  const isCompleted = order.status === "COMPLETED" && captured?.status === "COMPLETED";
  const pendingCapture =
    order.status === "COMPLETED" && captured && captured.status !== "COMPLETED" ? captured : null;

  return (
    <ReturnShell>
      <div className="return-card">
        <div className="return-topline">
          <span className="sandbox-chip">PayPal Sandbox</span>
          <span className="mono">order {order.orderId}</span>
        </div>

        {isCompleted ? (
          <>
            <div className="receipt-hero">
              <span className="receipt-check">
                <CheckCircle width={30} height={30} />
              </span>
              <div>
                <p className="section-kicker">Server-confirmed receipt</p>
                <h1>Sandbox payment captured.</h1>
                <p>
                  ScamBrake read this result from PayPal&apos;s Orders API after your explicit
                  confirmation. No real money moved.
                </p>
              </div>
            </div>

            <dl className="receipt-grid">
              <div>
                <dt>Status</dt>
                <dd>
                  <code>{captured.status}</code>
                </dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {formatMoney(captured.amount)} <small>{captured.currency}</small>
                </dd>
              </div>
              <div>
                <dt>Merchant</dt>
                <dd>
                  {order.merchantName} <small>Sandbox merchant</small>
                </dd>
              </div>
              <div>
                <dt>Sandbox seller</dt>
                <dd>{order.paypalPayee ?? "PayPal Sandbox seller account"}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>
                  <span className="sandbox-chip">sandbox</span>
                </dd>
              </div>
              <div className="receipt-grid-wide">
                <dt>Order ID</dt>
                <dd>
                  <CopyId label="order" value={order.orderId} />
                </dd>
              </div>
              <div className="receipt-grid-wide">
                <dt>Capture ID</dt>
                <dd>
                  <CopyId label="capture" value={captured.id} />
                </dd>
              </div>
              <div className="receipt-grid-wide">
                <dt>Analysis</dt>
                <dd>
                  <CopyId label="analysis" value={pending?.analysisId ?? order.customId ?? "—"} />
                </dd>
              </div>
            </dl>

            <div className="receipt-proof">
              <ShieldCheck width={17} height={17} />
              <p>
                The backend re-read the order from PayPal and matched the amount, currency, Sandbox
                merchant, and analysis ID before capture. The browser redirect alone was never
                treated as proof of payment.
              </p>
            </div>

            <div className="return-actions">
              <Link className="btn btn-primary" href="/#review">
                Review another request
                <ArrowRight width={16} height={16} className="arrow" />
              </Link>
              <Link className="btn btn-ghost" href="/">
                Home
              </Link>
            </div>
          </>
        ) : pendingCapture ? (
          <>
            <div className="return-intro">
              <span className="return-state-icon is-amber">
                <Clock width={26} height={26} />
              </span>
              <div>
                <p className="section-kicker">Capture pending</p>
                <h1>PayPal accepted the capture, but it is not complete yet.</h1>
                <p>
                  PayPal reports the capture as <code>{pendingCapture.status}</code>. ScamBrake
                  will not label this as paid until PayPal reports <code>COMPLETED</code>. No real
                  money moved.
                </p>
              </div>
            </div>

            <div className="approve-lines">
              <div>
                <span>Order ID</span>
                <code>{order.orderId}</code>
              </div>
              <div>
                <span>Capture ID</span>
                <code>{pendingCapture.id}</code>
              </div>
              <div>
                <span>Status</span>
                <code>{pendingCapture.status}</code>
              </div>
              <div>
                <span>Amount</span>
                <span>
                  {formatMoney(pendingCapture.amount)} {pendingCapture.currency}
                </span>
              </div>
            </div>

            <div className="return-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => verifyOrder(order.orderId)}
              >
                <Refresh width={15} height={15} />
                Check again
              </button>
              <Link className="btn btn-ghost" href="/">
                Home
              </Link>
            </div>
          </>
        ) : order.status === "APPROVED" ? (
          <>
            <div className="return-intro">
              <span className="return-state-icon is-green">
                <CheckCircle width={26} height={26} />
              </span>
              <div>
                <p className="section-kicker">Buyer approved</p>
                <h1>One last step. Confirm the capture.</h1>
                <p>
                  PayPal reports this order as <code>APPROVED</code>. ScamBrake has not captured
                  anything yet. This button is the only capture trigger.
                </p>
              </div>
            </div>

            <div className="approve-summary">
              <div>
                <span className="mini-label">Sandbox merchant</span>
                <strong>{order.merchantName}</strong>
                <small>
                  {order.paypalPayee
                    ? `PayPal Sandbox seller: ${order.paypalPayee}`
                    : "PayPal Sandbox seller account"}
                </small>
              </div>
              <div className="approve-amount">
                {formatMoney(order.amount)}
                <small>{order.currency}</small>
              </div>
            </div>

            <div className="approve-lines">
              <div>
                <span>Order ID</span>
                <code>{order.orderId}</code>
              </div>
              <div>
                <span>Status</span>
                <code>{order.status}</code>
              </div>
              <div>
                <span>Created</span>
                <span>{order.createTime ? formatTimestamp(order.createTime) : "—"}</span>
              </div>
            </div>

            {error && (
              <div className="notice notice-red" role="alert">
                <XCircle width={16} height={16} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary capture-button"
              onClick={handleCapture}
              disabled={phase === "capturing"}
            >
              {phase === "capturing" ? (
                <>
                  <span className="spinner" />
                  Capturing in Sandbox…
                </>
              ) : (
                <>
                  <Lock width={15} height={15} />
                  Confirm and capture {formatMoney(order.amount)}
                  <ArrowRight width={16} height={16} className="arrow" />
                </>
              )}
            </button>
            <p className="capture-fine">
              The server checks the live PayPal order against the signed decision ticket before
              capture. Sandbox only — no real money moves.
            </p>
            <div className="return-actions">
              <Link className="btn btn-text" href="/">
                Cancel and return home
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="return-intro">
              <span className="return-state-icon is-amber">
                <Clock width={26} height={26} />
              </span>
              <div>
                <p className="section-kicker">Not approved yet</p>
                <h1>PayPal has not approved this order.</h1>
                <p>
                  The order status is <code>{order.status}</code>. No capture was attempted. If you
                  left PayPal before approving, open the approval page again.
                </p>
              </div>
            </div>
            <div className="approve-lines">
              <div>
                <span>Order ID</span>
                <code>{order.orderId}</code>
              </div>
              <div>
                <span>Status</span>
                <code>{order.status}</code>
              </div>
              <div>
                <span>Amount</span>
                <span>
                  {formatMoney(order.amount)} {order.currency}
                </span>
              </div>
            </div>
            <div className="return-actions">
              {pending?.approveUrl && (
                <a className="btn btn-primary" href={pending.approveUrl}>
                  Return to PayPal
                  <ArrowRight width={16} height={16} className="arrow" />
                </a>
              )}
              <Link className="btn btn-ghost" href="/#review">
                Back to review
              </Link>
            </div>
          </>
        )}

        <p className="return-disclaimer">
          The Sandbox checkout pays the ScamBrake Sandbox merchant, not the suspicious caller. The
          profile and merchant are fictional. PayPal remains the source of truth for order status.
        </p>
      </div>
    </ReturnShell>
  );
}

function ReturnShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="return-page">
      <header className="site-header return-header">
        <div className="header-inner">
          <Brand />
          <span className="header-badge">
            <span className="sandbox-dot" /> Sandbox checkout
          </span>
        </div>
      </header>
      <main className="return-main">{children}</main>
      <footer className="return-footer">
        <span>ScamBrake · PayPal AI Hackathon</span>
        <span>Fictional fixtures · no real money</span>
      </footer>
    </div>
  );
}

function ReturnLoading() {
  return (
    <div className="return-card return-state">
      <span className="return-state-icon is-green">
        <span className="spinner" />
      </span>
      <p className="section-kicker">Verifying with PayPal</p>
      <h1>Reading the live order state.</h1>
      <p>
        ScamBrake does not trust the browser redirect. It is fetching the order from PayPal&apos;s
        Orders API before showing a capture button.
      </p>
    </div>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. No capture was attempted.";
}
