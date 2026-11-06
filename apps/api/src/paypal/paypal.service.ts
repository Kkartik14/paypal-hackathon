import { Injectable, Logger } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import { AppConfig } from "../config/app.config";

export interface CreatePaypalOrderInput {
  amount: number;
  currency: "USD";
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface PaypalOrderView {
  orderId: string;
  status: string;
  amount: number;
  currency: "USD";
  merchantName: string;
  customId: string | null;
  createTime: string | null;
  environment: "sandbox";
  capture: {
    id: string;
    status: string;
    amount: number;
    currency: "USD";
    createTime: string | null;
  } | null;
}

interface PaypalTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface PaypalOrderResponse {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    payee?: { email_address?: string };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
        create_time?: string;
      }>;
    };
  }>;
  create_time?: string;
  links?: Array<{ rel?: string; href?: string }>;
  name?: string;
  message?: string;
  details?: Array<{ issue?: string; description?: string }>;
}

@Injectable()
export class PaypalService {
  private readonly logger = new Logger(PaypalService.name);
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return this.config.paypalConfigured;
  }

  get sandboxBase(): string {
    return this.config.paypalApiBase;
  }

  async createOrder(input: CreatePaypalOrderInput): Promise<{ orderId: string; approveUrl: string }> {
    this.assertConfigured();

    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.customId,
          custom_id: input.customId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: input.amount.toFixed(2),
          },
          ...(this.config.paypalPayeeEmail
            ? { payee: { email_address: this.config.paypalPayeeEmail } }
            : {}),
        },
      ],
      application_context: {
        brand_name: "ScamBrake Demo",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    };

    const order = await this.request<PaypalOrderResponse>("/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PayPal-Request-Id": input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!order.id) {
      throw new ApiException(502, "PAYPAL_INVALID_RESPONSE", "PayPal did not return an order ID.");
    }

    const approveUrl = order.links?.find(
      (link) => link.rel === "approve" || link.rel === "payer-action",
    )?.href;
    if (!approveUrl) {
      throw new ApiException(
        502,
        "PAYPAL_APPROVAL_LINK_MISSING",
        "PayPal created the order but did not return an approval link. No capture was attempted.",
      );
    }
    this.assertSandboxApprovalUrl(approveUrl);

    return { orderId: order.id, approveUrl };
  }

  async getOrder(orderId: string): Promise<PaypalOrderView> {
    this.assertConfigured();
    const order = await this.request<PaypalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
    });
    return this.toView(order);
  }

  async captureOrder(orderId: string, idempotencyKey: string): Promise<PaypalOrderView> {
    this.assertConfigured();
    await this.request<PaypalOrderResponse>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PayPal-Request-Id": idempotencyKey,
        },
      },
    );

    // A capture response does not reliably include the purchase-unit amount,
    // payee, or custom_id. Re-read the canonical order so the receipt is
    // built from the same shape as every other order lookup.
    return this.getOrder(orderId);
  }

  private toView(order: PaypalOrderResponse): PaypalOrderView {
    if (!order.id || !order.status) {
      throw new ApiException(502, "PAYPAL_INVALID_RESPONSE", "PayPal returned an incomplete order.");
    }
    const unit = order.purchase_units?.[0];
    const amount = Number(unit?.amount?.value);
    const currency = unit?.amount?.currency_code;
    if (!Number.isFinite(amount) || currency !== "USD") {
      throw new ApiException(
        502,
        "PAYPAL_UNEXPECTED_ORDER",
        "PayPal returned an order with an unexpected amount or currency. No capture was attempted.",
      );
    }

    const rawCapture = unit?.payments?.captures?.[0];
    const captureAmount = Number(rawCapture?.amount?.value);
    const captureCurrency = rawCapture?.amount?.currency_code;
    const capture =
      rawCapture?.id && rawCapture.status && Number.isFinite(captureAmount) && captureCurrency === "USD"
        ? {
            id: rawCapture.id,
            status: rawCapture.status,
            amount: captureAmount,
            currency: "USD" as const,
            createTime: rawCapture.create_time ?? null,
          }
        : null;

    return {
      orderId: order.id,
      status: order.status,
      amount,
      currency: "USD",
      merchantName: unit?.payee?.email_address ?? "PayPal Sandbox seller",
      customId: unit?.custom_id ?? null,
      createTime: order.create_time ?? null,
      environment: "sandbox",
      capture,
    };
  }

  private assertConfigured(): void {
    if (!this.config.paypalConfigured) {
      throw new ApiException(
        503,
        "PAYPAL_NOT_CONFIGURED",
        "PayPal Sandbox credentials are not configured. No order was created. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
      );
    }
  }

  /** Prevents a malformed or substituted approval link from becoming an open redirect. */
  private assertSandboxApprovalUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ApiException(
        502,
        "PAYPAL_APPROVAL_LINK_INVALID",
        "PayPal returned an unreadable approval link. No capture was attempted.",
      );
    }
    const host = url.hostname.toLowerCase();
    const sandboxHost = host === "www.sandbox.paypal.com" || host.endsWith(".sandbox.paypal.com");
    const localHost =
      this.config.nodeEnv !== "production" && (host === "localhost" || host === "127.0.0.1");
    if ((!sandboxHost && !localHost) || (url.protocol !== "https:" && !localHost)) {
      throw new ApiException(
        502,
        "PAYPAL_APPROVAL_LINK_INVALID",
        "PayPal returned an approval link outside the PayPal Sandbox. No capture was attempted.",
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 30_000) {
      return this.tokenCache.token;
    }

    const credentials = Buffer.from(
      `${this.config.paypalClientId}:${this.config.paypalClientSecret}`,
      "utf8",
    ).toString("base64");

    let response: Response;
    try {
      response = await fetch(`${this.sandboxBase}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.warn(`PayPal token request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ApiException(
        504,
        "PAYPAL_UNAVAILABLE",
        "PayPal Sandbox could not be reached. No order was created.",
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn(`PayPal OAuth failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
      throw new ApiException(
        502,
        "PAYPAL_AUTH_FAILED",
        "PayPal Sandbox authentication failed. Check the server-side Sandbox credentials.",
      );
    }

    const payload = (await response.json().catch(() => null)) as PaypalTokenResponse | null;
    if (!payload?.access_token) {
      throw new ApiException(502, "PAYPAL_AUTH_FAILED", "PayPal did not return an access token.");
    }

    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 300;
    this.tokenCache = {
      token: payload.access_token,
      expiresAt: now + expiresIn * 1000,
    };
    return payload.access_token;
  }

  private async request<T>(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    retried = false,
  ): Promise<T> {
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${this.sandboxBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.warn(`PayPal request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ApiException(
        504,
        "PAYPAL_UNAVAILABLE",
        "PayPal Sandbox could not be reached. No capture was attempted.",
      );
    }

    if (response.status === 401 && !retried) {
      this.tokenCache = null;
      return this.request<T>(path, init, true);
    }

    const text = await response.text().catch(() => "");
    let payload: unknown = null;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const paypalError = (payload ?? {}) as PaypalOrderResponse;
      this.logger.warn(
        `PayPal HTTP ${response.status} on ${path}: ${paypalError.name ?? "error"} ${paypalError.message ?? text.slice(0, 200)}`,
      );
      const issue = paypalError.details?.[0]?.issue;
      throw new ApiException(
        502,
        "PAYPAL_REQUEST_FAILED",
        "PayPal Sandbox refused the request. No payment was captured. Check the order state and server logs.",
        issue ? { issue } : undefined,
      );
    }

    if (!payload || typeof payload !== "object") {
      throw new ApiException(502, "PAYPAL_INVALID_RESPONSE", "PayPal returned an unreadable response.");
    }
    return payload as T;
  }
}
