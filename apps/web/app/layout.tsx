import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScamBrake — Check who is asking before money moves",
  description:
    "A voice-first payment safety agent that reads a social-engineering request, checks it against saved rules, and stops suspicious PayPal payments before checkout.",
  applicationName: "ScamBrake",
  keywords: ["payment safety", "scam prevention", "PayPal Sandbox", "voice agent", "Gemini"],
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f4f1e8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
