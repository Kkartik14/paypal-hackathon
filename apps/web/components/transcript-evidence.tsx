"use client";

import { useMemo } from "react";
import type { PressureSignal } from "@scambrake/contracts";

const CATEGORY_LABELS: Record<PressureSignal["category"], string> = {
  urgency: "Urgency",
  secrecy: "Secrecy",
  authority: "Authority",
  payment_instruction: "Payment redirection",
  threat: "Threat",
  inconsistency: "Channel mismatch",
  other: "Other cue",
};

interface Range {
  start: number;
  end: number;
  signal: PressureSignal;
}

export function TranscriptEvidence({
  transcript,
  signals,
}: {
  transcript: string;
  signals: PressureSignal[];
}) {
  const { nodes, matchedSignals, unmatchedSignals } = useMemo(() => {
    const lower = transcript.toLowerCase();
    const ranges: Range[] = [];

    for (const signal of signals) {
      const quote = signal.quote.trim();
      if (!quote) continue;
      let start = lower.indexOf(quote.toLowerCase());
      let end = start >= 0 ? start + quote.length : -1;

      if (start < 0) {
        const words = quote.split(/\s+/).filter(Boolean).map(escapeRegExp);
        if (words.length > 0) {
          const match = new RegExp(words.join("\\s+"), "i").exec(transcript);
          if (match) {
            start = match.index;
            end = match.index + match[0].length;
          }
        }
      }

      if (start >= 0 && end > start) {
        ranges.push({ start, end, signal });
      }
    }

    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: Range[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      kept.push(range);
      cursor = range.end;
    }

    const nodes: React.ReactNode[] = [];
    let position = 0;
    kept.forEach((range, index) => {
      if (range.start > position) {
        nodes.push(<span key={`text-${index}`}>{transcript.slice(position, range.start)}</span>);
      }
      nodes.push(
        <mark
          key={`mark-${index}`}
          className={`hl hl-${range.signal.category}`}
          title={`${CATEGORY_LABELS[range.signal.category]}: ${range.signal.explanation}`}
        >
          {transcript.slice(range.start, range.end)}
        </mark>,
      );
      position = range.end;
    });
    if (position < transcript.length) {
      nodes.push(<span key="text-tail">{transcript.slice(position)}</span>);
    }

    const matched = new Set(kept.map((range) => range.signal));
    return {
      nodes,
      matchedSignals: signals.filter((signal) => matched.has(signal)),
      unmatchedSignals: signals.filter((signal) => !matched.has(signal)),
    };
  }, [transcript, signals]);

  const counts = matchedSignals.reduce<Record<string, number>>((accumulator, signal) => {
    accumulator[signal.category] = (accumulator[signal.category] ?? 0) + 1;
    return accumulator;
  }, {});

  if (signals.length === 0) {
    return (
      <div className="empty-evidence">
        <p>No urgency, secrecy, authority, or payment-redirection cues were found in this request.</p>
      </div>
    );
  }

  return (
    <div className="evidence">
      <div className="evidence-legend" aria-label="Evidence categories">
        {Object.entries(counts).map(([category, count]) => (
          <span key={category} className={`legend-chip legend-${category}`}>
            <span className="legend-dot" />
            {CATEGORY_LABELS[category as PressureSignal["category"]]}
            <span className="legend-count">{count}</span>
          </span>
        ))}
      </div>
      <div className="transcript">{nodes}</div>
      {unmatchedSignals.length > 0 && (
        <div className="unmatched-quotes">
          <span className="mini-label">Also flagged by the analysis</span>
          {unmatchedSignals.map((signal, index) => (
            <blockquote key={`${signal.quote}-${index}`}>
              <span>“{signal.quote}”</span>
              <small>{signal.explanation}</small>
            </blockquote>
          ))}
        </div>
      )}
      <p className="transcript-footnote">
        Quoted spans are the model&apos;s evidence. The decision itself comes from the server policy.
      </p>
    </div>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
