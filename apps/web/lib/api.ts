import type { z } from "zod";
import {
  AnalysisResultSchema,
  CreateOrderResponseSchema,
  DemoScenariosResponseSchema,
  OrderViewSchema,
  type AnalysisResult,
  type AnalyzeRequest,
  type CreateOrderResponse,
  type DemoScenariosResponse,
  type OrderView,
} from "@scambrake/contracts";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api"
).replace(/\/+$/, "");

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  options: RequestInit,
  schema: S,
): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw new ApiClientError(
      "NETWORK_ERROR",
      "Could not reach the ScamBrake API. Check that the API is running and NEXT_PUBLIC_API_BASE_URL points at it.",
      0,
      error instanceof Error ? error.message : undefined,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const maybeError = payload as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | null;
    throw new ApiClientError(
      maybeError?.error?.code ?? "REQUEST_FAILED",
      maybeError?.error?.message ?? `The API returned HTTP ${response.status}.`,
      response.status,
      maybeError?.error?.details,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    console.error("ScamBrake API contract mismatch", parsed.error.flatten());
    throw new ApiClientError(
      "INVALID_API_RESPONSE",
      "The API returned an unexpected response. No payment was created.",
      response.status,
    );
  }
  return parsed.data;
}

export function getDemoScenarios(): Promise<DemoScenariosResponse> {
  return request("/v1/demo/scenarios", { method: "GET" }, DemoScenariosResponseSchema);
}

export function analyzeRequest(input: AnalyzeRequest): Promise<AnalysisResult> {
  return request(
    "/v1/analysis",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    AnalysisResultSchema,
  );
}

export function createOrder(ticket: string): Promise<CreateOrderResponse> {
  return request(
    "/v1/orders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    },
    CreateOrderResponseSchema,
  );
}

export function getOrder(orderId: string): Promise<OrderView> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}`, { method: "GET" }, OrderViewSchema);
}

export function captureOrder(orderId: string, ticket: string): Promise<OrderView> {
  return request(
    `/v1/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    },
    OrderViewSchema,
  );
}
