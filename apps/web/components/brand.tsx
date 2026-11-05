import Link from "next/link";

export function Brand({ linked = true }: { linked?: boolean }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden>
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M16 4.5 27 8.4v6.4c0 6.1-4.4 10.9-11 12.7C9.4 25.7 5 20.9 5 14.8V8.4L16 4.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M10.5 14.6h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12.8 19h6.4" stroke="#c8f169" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand-name">ScamBrake</span>
      <span className="brand-demo">demo</span>
    </>
  );

  if (!linked) {
    return <span className="brand">{content}</span>;
  }
  return (
    <Link className="brand" href="/" aria-label="ScamBrake home">
      {content}
    </Link>
  );
}
