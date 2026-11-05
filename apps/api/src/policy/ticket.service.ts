import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiException } from "../common/api.exception";
import { AppConfig } from "../config/app.config";

export interface DecisionTicketInput {
  analysisId: string;
  profileId: string;
  recipientName: string;
  recipientIdentifier: string | null;
  amount: number;
  currency: "USD";
  purpose: string | null;
  merchantName: string;
  merchantIdentifier: string | null;
}

export interface DecisionTicketPayload extends DecisionTicketInput {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
}

@Injectable()
export class TicketService {
  constructor(private readonly config: AppConfig) {}

  issue(input: DecisionTicketInput): { ticket: string; expiresAt: Date } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + this.config.ticketTtlSeconds) * 1000);
    const payload: DecisionTicketPayload = {
      ...input,
      v: 1,
      iat: now,
      exp: now + this.config.ticketTtlSeconds,
      nonce: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encoded);
    return { ticket: `${encoded}.${signature}`, expiresAt };
  }

  verify(ticket: string): DecisionTicketPayload {
    const parts = ticket.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ApiException(401, "INVALID_DECISION_TICKET", "The decision ticket is not valid.");
    }
    const [encoded, signature] = parts;

    const expected = this.sign(encoded);
    const providedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new ApiException(401, "INVALID_DECISION_TICKET", "The decision ticket is not valid.");
    }

    let payload: DecisionTicketPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DecisionTicketPayload;
    } catch {
      throw new ApiException(401, "INVALID_DECISION_TICKET", "The decision ticket is not valid.");
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.v !== 1 || typeof payload.exp !== "number") {
      throw new ApiException(401, "INVALID_DECISION_TICKET", "The decision ticket is not valid.");
    }
    if (payload.exp < now) {
      throw new ApiException(
        410,
        "DECISION_TICKET_EXPIRED",
        "This decision has expired. Review the request again before paying.",
      );
    }
    if (payload.iat > now + 60) {
      throw new ApiException(401, "INVALID_DECISION_TICKET", "The decision ticket is not valid.");
    }
    return payload;
  }

  private sign(encodedPayload: string): string {
    return createHmac("sha256", this.config.ticketSecret).update(encodedPayload).digest("base64url");
  }
}
