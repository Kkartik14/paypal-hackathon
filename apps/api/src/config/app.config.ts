import { Injectable, Logger } from "@nestjs/common";
import type { AnalysisProvider } from "@scambrake/contracts";

const DEV_TICKET_SECRET = "scambrake-local-dev-only-ticket-secret-do-not-use-in-production";

@Injectable()
export class AppConfig {
  private readonly logger = new Logger(AppConfig.name);

  readonly nodeEnv: string;
  readonly port: number;
  readonly webOrigins: string[];
  readonly webOrigin: string;
  readonly aiProvider: AnalysisProvider;
  readonly geminiApiKey: string | null;
  readonly geminiModel: string;
  readonly paypalClientId: string | null;
  readonly paypalClientSecret: string | null;
  readonly paypalApiBase: string;
  readonly paypalPayeeEmail: string | null;
  readonly ticketSecret: string;
  readonly ticketSecretConfigured: boolean;
  readonly ticketTtlSeconds: number;
  readonly mcpApiKey: string | null;

  constructor() {
    this.nodeEnv = process.env.NODE_ENV ?? "development";
    this.port = numberFromEnv("PORT", 4000);
    this.webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000,http://127.0.0.1:3000")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    this.webOrigin = this.webOrigins[0] ?? "http://localhost:3000";

    const requestedProvider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
    if (requestedProvider && requestedProvider !== "gemini" && requestedProvider !== "mock") {
      throw new Error("AI_PROVIDER must be either 'gemini' or 'mock'.");
    }
    this.geminiApiKey = process.env.GEMINI_API_KEY?.trim() || null;
    this.aiProvider = requestedProvider === "gemini" || (!requestedProvider && this.geminiApiKey)
      ? "gemini"
      : "mock";
    this.geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

    this.paypalClientId = process.env.PAYPAL_CLIENT_ID?.trim() || null;
    this.paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() || null;
    this.paypalPayeeEmail = process.env.PAYPAL_PAYEE_EMAIL?.trim() || null;

    const paypalEnv = (process.env.PAYPAL_ENV ?? "sandbox").trim().toLowerCase();
    if (paypalEnv !== "sandbox") {
      throw new Error(
        "ScamBrake refuses to start payment processing unless PAYPAL_ENV is 'sandbox'. Live payments are not supported.",
      );
    }

    this.paypalApiBase = (process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
    this.assertSandboxApiBase(this.paypalApiBase);

    const secret = process.env.DECISION_TICKET_SECRET?.trim();
    this.ticketSecretConfigured = Boolean(secret && secret.length >= 32);
    if (secret && secret.length < 32) {
      throw new Error("DECISION_TICKET_SECRET must be at least 32 characters.");
    }
    if (!this.ticketSecretConfigured && this.nodeEnv === "production") {
      throw new Error(
        "DECISION_TICKET_SECRET (at least 32 characters) is required in production. Refusing to start with the development-only secret.",
      );
    }
    this.ticketSecret = this.ticketSecretConfigured ? (secret as string) : DEV_TICKET_SECRET;
    this.ticketTtlSeconds = numberFromEnv("DECISION_TICKET_TTL_SECONDS", 1200);

    this.mcpApiKey = process.env.MCP_API_KEY?.trim() || null;

    if (!this.ticketSecretConfigured) {
      this.logger.warn(
        "DECISION_TICKET_SECRET is not set. Using a development-only secret; configure one before deploying.",
      );
    }
    if (this.aiProvider === "gemini" && !this.geminiApiKey) {
      this.logger.warn("AI_PROVIDER=gemini but GEMINI_API_KEY is missing. Analysis requests will fail loudly.");
    }
    if (!this.paypalClientId || !this.paypalClientSecret) {
      this.logger.warn("PayPal Sandbox credentials are not configured. Checkout endpoints will return 503.");
    }
  }

  get aiConfigured(): boolean {
    return this.aiProvider === "mock" || Boolean(this.geminiApiKey);
  }

  get paypalConfigured(): boolean {
    return Boolean(this.paypalClientId && this.paypalClientSecret);
  }

  private assertSandboxApiBase(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("PAYPAL_API_BASE must be a valid HTTPS URL.");
    }
    const host = url.hostname.toLowerCase();
    const isSandbox = host === "api-m.sandbox.paypal.com" || host === "api.sandbox.paypal.com";
    const isLocalTest =
      this.nodeEnv !== "production" && (host === "localhost" || host === "127.0.0.1");
    if (!isSandbox && !isLocalTest) {
      throw new Error(
        "PAYPAL_API_BASE must point at the PayPal Sandbox (or localhost in development). Live PayPal hosts are refused.",
      );
    }
    if (url.protocol !== "https:" && !isLocalTest) {
      throw new Error("PAYPAL_API_BASE must use HTTPS.");
    }
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}
