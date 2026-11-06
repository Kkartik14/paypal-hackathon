import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/app.config";
import { PaypalService } from "./paypal.service";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildConfig(): AppConfig {
  return {
    nodeEnv: "test",
    paypalConfigured: true,
    paypalClientId: "client-id",
    paypalClientSecret: "client-secret",
    paypalApiBase: "https://api-m.sandbox.paypal.com",
    paypalPayeeEmail: "merchant@example.com",
  } as unknown as AppConfig;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaypalService.captureOrder", () => {
  it("re-reads the order because a capture response omits the purchase-unit amount", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token", expires_in: 3600 }))
      // A real capture response can contain the capture only, without the
      // purchase-unit amount, payee, or custom_id.
      .mockResolvedValueOnce(jsonResponse({ id: "ORDER", status: "COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "ORDER",
          status: "COMPLETED",
          create_time: "2026-11-06T19:54:07Z",
          purchase_units: [
            {
              custom_id: "an_test",
              amount: { currency_code: "USD", value: "18.00" },
              payee: { email_address: "merchant@example.com" },
              payments: {
                captures: [
                  {
                    id: "CAPTURE",
                    status: "COMPLETED",
                    amount: { currency_code: "USD", value: "18.00" },
                    create_time: "2026-11-06T19:54:07Z",
                  },
                ],
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new PaypalService(buildConfig()).captureOrder("ORDER", "idempotency-key");

    expect(result.status).toBe("COMPLETED");
    expect(result.customId).toBe("an_test");
    expect(result.capture).toEqual({
      id: "CAPTURE",
      status: "COMPLETED",
      amount: 18,
      currency: "USD",
      createTime: "2026-11-06T19:54:07Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v2/checkout/orders/ORDER/capture");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/v2/checkout/orders/ORDER");
  });
});
