import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "../common/api.exception";
import { AppConfig } from "../config/app.config";
import { TicketService, type DecisionTicketInput } from "./ticket.service";

const ticketInput: DecisionTicketInput = {
  analysisId: "an_test123",
  profileId: "profile-riya-sharma",
  recipientName: "Kettle & Co.",
  recipientIdentifier: "billing@kettleandco.example",
  amount: 18,
  currency: "USD",
  purpose: "Monthly coffee subscription renewal",
  merchantName: "Kettle & Co.",
  merchantIdentifier: "billing@kettleandco.example",
};

function build(secret: string): TicketService {
  process.env.DECISION_TICKET_SECRET = secret;
  process.env.DECISION_TICKET_TTL_SECONDS = "1200";
  return new TicketService(new AppConfig());
}

describe("TicketService", () => {
  const originalSecret = process.env.DECISION_TICKET_SECRET;
  const originalTtl = process.env.DECISION_TICKET_TTL_SECONDS;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalSecret === undefined) delete process.env.DECISION_TICKET_SECRET;
    else process.env.DECISION_TICKET_SECRET = originalSecret;
    if (originalTtl === undefined) delete process.env.DECISION_TICKET_TTL_SECONDS;
    else process.env.DECISION_TICKET_TTL_SECONDS = originalTtl;
  });

  it("issues and verifies a signed ticket", () => {
    const service = build("a".repeat(40));
    const { ticket, expiresAt } = service.issue(ticketInput);
    const payload = service.verify(ticket);

    expect(payload.analysisId).toBe("an_test123");
    expect(payload.amount).toBe(18);
    expect(payload.currency).toBe("USD");
    expect(payload.recipientName).toBe("Kettle & Co.");
    expect(payload.exp * 1000).toBe(expiresAt.getTime());
  });

  it("rejects a ticket with a tampered signature", () => {
    const service = build("b".repeat(40));
    const { ticket } = service.issue(ticketInput);
    const [encoded] = ticket.split(".");

    expect(() => service.verify(`${encoded}.deadbeef`)).toThrowError(
      expect.objectContaining({ code: "INVALID_DECISION_TICKET" }),
    );
  });

  it("rejects a ticket signed with a different secret", () => {
    const issuer = build("c".repeat(40));
    const { ticket } = issuer.issue(ticketInput);
    const verifier = build("d".repeat(40));

    expect(() => verifier.verify(ticket)).toThrowError(
      expect.objectContaining({ code: "INVALID_DECISION_TICKET" }),
    );
  });

  it("rejects an expired ticket", () => {
    const service = build("e".repeat(40));
    const { ticket } = service.issue(ticketInput);

    vi.advanceTimersByTime(1201 * 1000);

    try {
      service.verify(ticket);
      throw new Error("expected the ticket to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).code).toBe("DECISION_TICKET_EXPIRED");
    }
  });

  it("rejects malformed tickets", () => {
    const service = build("f".repeat(40));
    for (const value of ["", "not-a-ticket", "onlyonepart", "a.b.c"]) {
      expect(() => service.verify(value)).toThrowError(
        expect.objectContaining({ code: "INVALID_DECISION_TICKET" }),
      );
    }
  });
});
