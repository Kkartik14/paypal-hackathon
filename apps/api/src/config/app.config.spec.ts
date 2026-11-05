import { afterEach, describe, expect, it } from "vitest";
import { AppConfig } from "./app.config";

const TOUCHED = [
  "NODE_ENV",
  "DECISION_TICKET_SECRET",
  "PAYPAL_ENV",
  "PAYPAL_API_BASE",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "WEB_ORIGIN",
] as const;

const original = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof TOUCHED)[number], string>>): void {
  for (const key of TOUCHED) {
    if (!original.has(key)) original.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  original.clear();
});

describe("AppConfig", () => {
  it("refuses to use the development ticket secret in production", () => {
    setEnv({ NODE_ENV: "production" });
    expect(() => new AppConfig()).toThrow(/DECISION_TICKET_SECRET/);
  });

  it("accepts a strong ticket secret in production", () => {
    setEnv({
      NODE_ENV: "production",
      DECISION_TICKET_SECRET: "a".repeat(64),
      WEB_ORIGIN: "https://scambrake.example/",
    });
    const config = new AppConfig();
    expect(config.ticketSecretConfigured).toBe(true);
    expect(config.webOrigin).toBe("https://scambrake.example");
  });

  it("refuses live PayPal environments", () => {
    setEnv({ NODE_ENV: "development", PAYPAL_ENV: "live" });
    expect(() => new AppConfig()).toThrow(/PAYPAL_ENV/);
  });

  it("refuses live PayPal API hosts", () => {
    setEnv({ NODE_ENV: "development", PAYPAL_API_BASE: "https://api-m.paypal.com" });
    expect(() => new AppConfig()).toThrow(/PayPal Sandbox/);
  });

  it("allows the Sandbox API host", () => {
    setEnv({ NODE_ENV: "development", PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com" });
    const config = new AppConfig();
    expect(config.paypalApiBase).toBe("https://api-m.sandbox.paypal.com");
  });
});
