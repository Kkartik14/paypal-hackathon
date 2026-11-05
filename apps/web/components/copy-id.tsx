"use client";

import { useState } from "react";
import { Check, Copy } from "./icons";
import { shortenMiddle } from "@/lib/format";

export function CopyId({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="copy-id" onClick={copy} title={`Copy ${label} ${value}`}>
      <span className="copy-id-label">{label}</span>
      <code>{compact ? shortenMiddle(value, 7) : value}</code>
      {copied ? <Check width={12} height={12} /> : <Copy width={12} height={12} />}
    </button>
  );
}
