import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { ApiException } from "../common/api.exception";
import { clientKey, RateLimitService } from "../common/rate-limit.service";
import { AppConfig } from "../config/app.config";
import { McpService } from "./mcp.service";

const MCP_PROTOCOL_VERSION = "2025-06-18";

@Controller("mcp")
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcp: McpService,
    private readonly config: AppConfig,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  async post(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    this.assertAuthorized(request);
    if (!this.rateLimit.consume(`mcp:${clientKey(request)}`, 60, 10 * 60 * 1000)) {
      throw new ApiException(429, "RATE_LIMITED", "Too many MCP requests. Wait a few minutes and try again.");
    }

    try {
      const result = await this.mcp.handleBody(body);
      response.setHeader("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
      response.setHeader("Cache-Control", "no-store");
      if (result === null) {
        response.status(202).end();
        return;
      }
      response.status(200).json(result);
    } catch (error) {
      this.logger.error(
        `MCP request failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      response.status(200).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Internal error." },
      });
    }
  }

  @Get()
  get(@Res() response: Response): void {
    response.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "This stateless MCP endpoint accepts JSON-RPC over POST only. Server-sent events are not offered.",
      },
    });
  }

  @Delete()
  delete(@Res() response: Response): void {
    response.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "There are no MCP sessions to delete; this endpoint is stateless.",
      },
    });
  }

  private assertAuthorized(request: Request): void {
    if (!this.config.mcpApiKey) return;
    const header = request.headers.authorization;
    const bearer = typeof header === "string" && header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    const xApiKey = request.headers["x-api-key"];
    const provided = bearer || (typeof xApiKey === "string" ? xApiKey : "");
    if (!safeEqual(provided, this.config.mcpApiKey)) {
      throw new ApiException(
        401,
        "MCP_UNAUTHORIZED",
        "Provide the configured MCP API key as a Bearer token or x-api-key header.",
      );
    }
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
