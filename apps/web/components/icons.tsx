import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export function ArrowRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function ShieldCheck(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 4.5 6v5.2c0 4.8 3.2 8.3 7.5 9.8 4.3-1.5 7.5-5 7.5-9.8V6L12 3Z" />
      <path d="m8.7 12 2.2 2.2 4.4-4.6" />
    </svg>
  );
}

export function Shield(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 4.5 6v5.2c0 4.8 3.2 8.3 7.5 9.8 4.3-1.5 7.5-5 7.5-9.8V6L12 3Z" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function Lock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
      <path d="M12 14.5v2" />
    </svg>
  );
}

export function CheckCircle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.4 12.2 2.3 2.2 4.8-5" />
    </svg>
  );
}

export function XCircle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

export function MinusCircle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h7" />
    </svg>
  );
}

export function Play(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 6.5v11l9-5.5-9-5.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Pause(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 6.5v11M15.5 6.5v11" strokeWidth="2.4" />
    </svg>
  );
}

export function PhoneCall(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 4.5h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 6.7a2 2 0 0 1 2-2.2Z" />
    </svg>
  );
}

export function Spark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9 12 3.5Z" />
    </svg>
  );
}

export function AlertTriangle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4.5 21 20H3L12 4.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" strokeWidth="2.2" />
    </svg>
  );
}

export function Clock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function FileAudio(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13.5 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9l-5.5-5.5Z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 14.5v3M12 12.5v7M15 14v3" />
    </svg>
  );
}

export function Refresh(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 10a8 8 0 0 1 13.7-3.6L20 8" />
      <path d="M20 4.5V8h-3.5" />
      <path d="M19.5 14a8 8 0 0 1-13.7 3.6L4 16" />
      <path d="M4 19.5V16h3.5" />
    </svg>
  );
}

export function Copy(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12.5 4.2 4.2L19 6.8" />
    </svg>
  );
}
