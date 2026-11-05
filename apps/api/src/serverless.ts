import "./env";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import express, { type Express } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { AppConfig } from "./config/app.config";

/**
 * Vercel/serverless entry point. The compiled Express instance is reused
 * across warm invocations so Nest does not re-bootstrap on every request.
 */
const server: Express = express();
let ready: Promise<void> | null = null;

async function init(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    {
      bodyParser: false,
      logger: ["error", "warn", "log"],
    },
  );
  configureApp(app, app.get(AppConfig));
  await app.init();
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  ready ??= init();
  await ready;
  server(request, response);
}
