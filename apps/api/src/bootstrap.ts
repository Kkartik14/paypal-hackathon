import type { NestExpressApplication } from "@nestjs/platform-express";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { AppConfig } from "./config/app.config";

/**
 * Shared HTTP configuration for the long-running server and the serverless
 * entry point. Keeping this in one place prevents the two deployment shapes
 * from drifting on CORS, body limits, prefixing, or error formatting.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(json({ limit: "6mb" }));
  app.use(urlencoded({ extended: true, limit: "1mb" }));
  app.setGlobalPrefix("api", { exclude: ["mcp"] });
  app.enableCors({
    origin: config.webOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "Mcp-Session-Id",
      "MCP-Protocol-Version",
    ],
    exposedHeaders: ["MCP-Protocol-Version"],
    maxAge: 86_400,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
