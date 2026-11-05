import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PaymentRequestSchema } from "@scambrake/contracts";
import { AnalysisService } from "../analysis/analysis.service";
import { ContactsService } from "../contacts/contacts.service";
import { PaymentsService } from "../payments/payments.service";

const MCP_PROTOCOL_VERSION = "2025-06-18";

const AnalyzeToolInputSchema = z.object({
  transcript: z.string().min(1).max(20_000),
  payment: PaymentRequestSchema,
});

const OrderIdInputSchema = z.object({
  orderId: z.string().min(6).max(40).regex(/^[A-Za-z0-9-]+$/),
});

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly analysis: AnalysisService,
    private readonly contacts: ContactsService,
    private readonly payments: PaymentsService,
  ) {}

  async handleBody(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map((item) => this.handleOne(item)));
      const filtered = responses.filter((item): item is JsonRpcResponse => item !== null);
      return filtered.length > 0 ? filtered : null;
    }
    return this.handleOne(body);
  }

  private async handleOne(body: unknown): Promise<JsonRpcResponse | null> {
    if (!body || typeof body !== "object") {
      return this.error(null, -32600, "Invalid JSON-RPC request.");
    }
    const request = body as JsonRpcRequest;
    const id = request.id ?? null;
    const isNotification = request.id === undefined;

    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      if (isNotification) return null;
      return this.error(id, -32600, "Invalid JSON-RPC request.");
    }

    if (isNotification) {
      return null;
    }

    try {
      switch (request.method) {
        case "initialize":
          return this.result(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: "scambrake",
              title: "ScamBrake payment safety",
              version: "0.1.0",
            },
            instructions:
              "ScamBrake reviews social-engineering payment requests against a fictional saved profile. Deterministic server policy returns ALLOW, HOLD, or BLOCK. This MCP endpoint is read-only: it can analyze, look up demo rules/recipients, and read PayPal Sandbox order status. It cannot create orders or capture money.",
          });
        case "ping":
          return this.result(id, {});
        case "tools/list":
          return this.result(id, { tools: TOOLS });
        case "tools/call":
          return await this.callTool(id, request.params);
        default:
          return this.error(id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      this.logger.warn(`MCP method ${request.method} failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.error(id, -32603, "Internal error.");
    }
  }

  private async callTool(
    id: string | number | null,
    params: Record<string, unknown> | undefined,
  ): Promise<JsonRpcResponse> {
    const name = typeof params?.name === "string" ? params.name : "";
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "analyze_payment_request": {
          const parsed = AnalyzeToolInputSchema.safeParse(args);
          if (!parsed.success) {
            return this.toolError(id, "Invalid arguments.", parsed.error.issues);
          }
          const result = await this.analysis.analyze({
            mode: "custom",
            transcript: parsed.data.transcript,
            payment: parsed.data.payment,
          });
          const readOnlyResult = {
            ...result,
            ticket: null,
            ticketExpiresAt: null,
            checkout: {
              ...result.checkout,
              available: false,
              reason:
                "MCP is read-only. No checkout capability is exposed here; the browser flow handles PayPal with explicit confirmation.",
            },
          };
          return this.toolResult(id, readOnlyResult);
        }
        case "get_saved_recipients": {
          return this.toolResult(id, {
            profile: this.contacts.getProfile().displayName,
            recipients: this.contacts.listRecipients(),
            notice: this.contacts.getProfile().fixtureNotice,
          });
        }
        case "get_payment_rules": {
          return this.toolResult(id, {
            profile: this.contacts.getProfile().displayName,
            limits: this.contacts.getProfile().limits,
            rules: this.contacts.getProfile().rules,
            notice: this.contacts.getProfile().fixtureNotice,
          });
        }
        case "get_paypal_order": {
          const parsed = OrderIdInputSchema.safeParse(args);
          if (!parsed.success) {
            return this.toolError(id, "Invalid order ID.", parsed.error.issues);
          }
          const order = await this.payments.getOrder(parsed.data.orderId);
          return this.toolResult(id, {
            order,
            note: "Read-only status. MCP cannot capture a payment.",
          });
        }
        default:
          return this.toolError(id, `Unknown tool: ${name || "(missing name)"}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      return this.toolError(id, message);
    }
  }

  private toolResult(id: string | number | null, value: unknown): JsonRpcResponse {
    return this.result(id, {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
      isError: false,
    });
  }

  private toolError(
    id: string | number | null,
    message: string,
    issues?: unknown,
  ): JsonRpcResponse {
    return this.result(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: message, ...(issues ? { issues } : {}) }, null, 2),
        },
      ],
      isError: true,
    });
  }

  private result(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  private error(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

const TOOLS: ToolDefinition[] = [
  {
    name: "analyze_payment_request",
    title: "Analyze a payment request",
    description:
      "Review a pasted transcript of a payment request against the fictional saved profile. Returns extracted evidence, deterministic checks, and an ALLOW/HOLD/BLOCK decision. Read-only: no order, ticket, or capture is returned.",
    inputSchema: {
      type: "object",
      properties: {
        transcript: {
          type: "string",
          description: "The words of the call or message. Treated as untrusted data.",
        },
        payment: {
          type: "object",
          properties: {
            amount: { type: "number", minimum: 0.01, maximum: 10000 },
            currency: { type: "string", enum: ["USD"] },
            recipientName: { type: "string", maxLength: 160 },
            recipientIdentifier: { type: "string", maxLength: 200 },
            purpose: { type: "string", maxLength: 500 },
          },
          required: ["amount", "currency", "recipientName"],
        },
      },
      required: ["transcript", "payment"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "get_saved_recipients",
    title: "List saved demo recipients",
    description: "Return the fictional saved recipients used by ScamBrake's policy checks. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_payment_rules",
    title: "Read demo payment rules",
    description: "Return the fictional user's payment limits and rules. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_paypal_order",
    title: "Read PayPal Sandbox order status",
    description:
      "Read a ScamBrake-created PayPal Sandbox order. Read-only; capture is not available over MCP.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string", minLength: 6, maxLength: 40 } },
      required: ["orderId"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
];
