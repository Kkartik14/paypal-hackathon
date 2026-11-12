import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentRequest } from "@scambrake/contracts";
import { ApiException } from "../common/api.exception";
import { AppConfig } from "../config/app.config";
import { ContactsService } from "../contacts/contacts.service";
import { GroqAnalysisProvider, MockAnalysisProvider } from "./analysis-providers";

const SAFE_TEXT =
  "Hi, this is Kettle and Co. billing with a note about your monthly coffee subscription renewal. Your renewal is $18.00 for the November roast. It is the same saved payment method and amount as last month.";

const SAFE_PAYMENT: PaymentRequest = {
  amount: 18,
  currency: "USD",
  recipientName: "Kettle & Co.",
  recipientIdentifier: "billing@kettleandco.example",
  purpose: "Monthly coffee subscription renewal",
};

const EXTRACTION = {
  claimedIdentity: "Kettle and Co. billing",
  claimedOrganization: "Kettle & Co.",
  requestedAction: "Approve the $18.00 monthly coffee subscription renewal.",
  requestedRecipientName: "Kettle & Co.",
  requestedRecipientIdentifier: "billing@kettleandco.example",
  amount: 18,
  currency: "USD",
  purpose: "Monthly coffee subscription renewal",
  pressureSignals: [],
  missingFields: [],
  confidence: 0.93,
  summary: "A routine renewal from the saved merchant. No pressure cues were found.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    groqApiKey: "gsk_test_key",
    groqModel: "openai/gpt-oss-120b",
    groqTranscriptionModel: "whisper-large-v3-turbo",
    groqApiBase: "https://api.groq.com/openai/v1",
    ...overrides,
  } as unknown as AppConfig;
}

function buildProvider(overrides: Partial<AppConfig> = {}): GroqAnalysisProvider {
  return new GroqAnalysisProvider(buildConfig(overrides), new ContactsService());
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GroqAnalysisProvider", () => {
  it("transcribes audio, runs a read-only tool, and validates structured extraction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ text: SAFE_TEXT }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_payment_rules", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: { role: "assistant", content: "Lookup complete." },
              finish_reason: "stop",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: { role: "assistant", content: JSON.stringify(EXTRACTION) },
              finish_reason: "stop",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildProvider().analyze({
      payment: SAFE_PAYMENT,
      profile: new ContactsService().getProfile(),
      transcript: "This caller-supplied transcript must not replace the audio.",
      audio: {
        base64: Buffer.from("fake audio bytes").toString("base64"),
        mimeType: "audio/mp4",
      },
    });

    expect(result.toolCalls).toEqual(["get_payment_rules"]);
    expect(result.extraction.transcript).toBe(SAFE_TEXT);
    expect(result.extraction.amount).toBe(18);
    expect(result.extraction.requestedRecipientName).toBe("Kettle & Co.");

    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [transcriptionUrl, transcriptionInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(transcriptionUrl).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((transcriptionInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer gsk_test_key",
    );
    expect(transcriptionInit.body).toBeInstanceOf(FormData);
    const form = transcriptionInit.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("json");

    const [toolUrl, toolInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(toolUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    const toolBody = JSON.parse(String(toolInit.body)) as Record<string, unknown>;
    expect(toolBody.model).toBe("openai/gpt-oss-120b");
    expect(toolBody.tools).toEqual(expect.any(Array));
    expect(toolBody.parallel_tool_calls).toBe(false);
    expect(toolBody.response_format).toBeUndefined();

    const [, followUpInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const followUpBody = JSON.parse(String(followUpInit.body)) as {
      messages: Array<{ role: string; content?: string }>;
    };
    expect(followUpBody.messages.some((message) => message.role === "tool")).toBe(true);

    const [extractionUrl, extractionInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(extractionUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    const extractionBody = JSON.parse(String(extractionInit.body)) as {
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(extractionBody.response_format.type).toBe("json_schema");
    expect(extractionBody.response_format.json_schema.strict).toBe(true);
  });

  it("skips transcription when there is no audio", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: { role: "assistant", content: "No lookup needed." },
              finish_reason: "stop",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: { role: "assistant", content: JSON.stringify(EXTRACTION) },
              finish_reason: "stop",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildProvider().analyze({
      payment: SAFE_PAYMENT,
      profile: new ContactsService().getProfile(),
      transcript: SAFE_TEXT,
    });

    expect(result.extraction.transcript).toBe(SAFE_TEXT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
  });

  it("drops pressure quotes that do not appear in the transcript", async () => {
    const transcript =
      "This exact sentence is in the transcript. This is a routine renewal with no pressure.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: { role: "assistant", content: "No lookup needed." },
              finish_reason: "stop",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  ...EXTRACTION,
                  pressureSignals: [
                    {
                      quote: "This exact sentence is in the transcript.",
                      category: "urgency",
                      explanation: "A real quote from the request.",
                      startSeconds: null,
                    },
                    {
                      quote: "This sentence was never spoken.",
                      category: "threat",
                      explanation: "A hallucinated quote.",
                      startSeconds: null,
                    },
                  ],
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildProvider().analyze({
      payment: SAFE_PAYMENT,
      profile: new ContactsService().getProfile(),
      transcript,
    });

    expect(result.extraction.pressureSignals).toHaveLength(1);
    expect(result.extraction.pressureSignals[0]?.quote).toBe(
      "This exact sentence is in the transcript.",
    );
  });

  it("fails loudly when the Groq key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      buildProvider({ groqApiKey: null }).analyze({
        payment: SAFE_PAYMENT,
        profile: new ContactsService().getProfile(),
        transcript: SAFE_TEXT,
      }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a Groq rate limit to a clear retry error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ error: { message: "Rate limit reached", code: "rate_limit_exceeded" } }, 429),
      ),
    );

    const error = await buildProvider()
      .analyze({
        payment: SAFE_PAYMENT,
        profile: new ContactsService().getProfile(),
        transcript: SAFE_TEXT,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).code).toBe("AI_PROVIDER_BUSY");
    expect((error as ApiException).getStatus()).toBe(503);
  });
});

describe("MockAnalysisProvider", () => {
  it("uses the committed extraction fixture for a known scenario", async () => {
    const contacts = new ContactsService();
    const scenario = contacts.getScenario("trusted-purchase");
    const fixture = (await import("../fixtures/profile-data")).MOCK_SCENARIO_EXTRACTIONS["trusted-purchase"];
    expect(scenario).not.toBeNull();

    const result = await new MockAnalysisProvider().analyze({
      payment: SAFE_PAYMENT,
      profile: contacts.getProfile(),
      transcript: SAFE_TEXT,
      scenario,
      mockExtraction: fixture,
    });

    expect(result.extraction.transcript).toBe(fixture?.transcript);
    expect(result.toolCalls).toContain("get_payment_rules");
  });
});
