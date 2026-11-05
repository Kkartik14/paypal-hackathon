import "./env";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { AppConfig } from "./config/app.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(AppConfig);
  configureApp(app, config);

  await app.listen(config.port, "0.0.0.0");

  const logger = new Logger("Bootstrap");
  logger.log(
    `ScamBrake API listening on :${config.port} · AI=${config.aiProvider} · ` +
      `PayPal=${config.paypalConfigured ? "sandbox configured" : "not configured"} · ` +
      `origins=${config.webOrigins.join(",")}`,
  );
}

void bootstrap();
