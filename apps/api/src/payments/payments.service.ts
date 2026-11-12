import { Injectable, Logger } from "@nestjs/common";
import type { CreateOrderResponse, Profile, OrderView } from "@scambrake/contracts";
import { ApiException } from "../common/api.exception";
import { AppConfig } from "../config/app.config";
import { ContactsService } from "../contacts/contacts.service";
import { PaypalOrderView, PaypalService } from "../paypal/paypal.service";
import { DecisionTicketPayload, TicketService } from "../policy/ticket.service";

const ORDER_ID_PATTERN = /^[A-Za-z0-9-]{6,40}$/;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly paypal: PaypalService,
    private readonly tickets: TicketService,
    private readonly contacts: ContactsService,
  ) {}

  async createOrder(ticket: string): Promise<CreateOrderResponse> {
    const payload = this.verifyTicketForCheckout(ticket);
    const merchant = this.contacts.getMerchant();
    const profile: Profile = this.contacts.getProfile();

    if (payload.profileId !== profile.id) {
      throw new ApiException(403, "TICKET_PROFILE_MISMATCH", "This decision belongs to a different saved profile.");
    }
    if (!this.contacts.isMerchant(payload.recipientName, payload.recipientIdentifier)) {
      throw new ApiException(
        409,
        "SANDBOX_MERCHANT_ONLY",
        `This checkout can only pay the saved Sandbox merchant, ${merchant.name}. No PayPal order was created.`,
      );
    }
    if (Math.abs(payload.amount - merchant.amount) > 0.005) {
      throw new ApiException(
        409,
        "SANDBOX_AMOUNT_FIXED",
        `The Sandbox checkout is fixed at $${merchant.amount.toFixed(2)} USD. No PayPal order was created.`,
      );
    }

    const order = await this.paypal.createOrder({
      amount: merchant.amount,
      currency: "USD",
      description: "ScamBrake Sandbox purchase",
      customId: payload.analysisId,
      returnUrl: `${this.config.webOrigin}/checkout/return`,
      cancelUrl: `${this.config.webOrigin}/?checkout=cancelled`,
      idempotencyKey: `scambrake-create-${payload.analysisId}`,
    });

    this.logger.log(
      `Created Sandbox order ${order.orderId} for analysis ${payload.analysisId} at $${merchant.amount.toFixed(2)}`,
    );

    return {
      orderId: order.orderId,
      approveUrl: order.approveUrl,
      amount: merchant.amount,
      currency: "USD",
      merchantName: merchant.name,
      environment: "sandbox",
    };
  }

  async getOrder(orderId: string): Promise<OrderView> {
    this.assertOrderId(orderId);
    const order = await this.paypal.getOrder(orderId);
    this.assertScamBrakeOrder(order);
    return this.toOrderView(order);
  }

  async captureOrder(orderId: string, ticket: string): Promise<OrderView> {
    this.assertOrderId(orderId);
    const payload = this.tickets.verify(ticket);
    const order = await this.paypal.getOrder(orderId);
    this.assertScamBrakeOrder(order);

    if (order.customId !== payload.analysisId) {
      throw new ApiException(
        403,
        "ORDER_TICKET_MISMATCH",
        "This decision ticket does not belong to that PayPal order. No capture was attempted.",
      );
    }
    if (Math.abs(order.amount - payload.amount) > 0.005 || order.currency !== payload.currency) {
      throw new ApiException(
        409,
        "ORDER_AMOUNT_MISMATCH",
        "The PayPal order amount does not match the approved decision. No capture was attempted.",
      );
    }

    if (order.status === "COMPLETED" && order.capture) {
      return this.toOrderView(order);
    }
    if (order.status !== "APPROVED") {
      throw new ApiException(
        409,
        "ORDER_NOT_APPROVED",
        `PayPal reports this order as ${order.status || "unknown"}. It must be buyer-approved before capture. No capture was attempted.`,
        { paypalStatus: order.status },
      );
    }

    const captured = await this.paypal.captureOrder(orderId, `scambrake-capture-${orderId}`);
    this.assertScamBrakeOrder(captured);
    if (captured.customId !== payload.analysisId) {
      throw new ApiException(502, "PAYPAL_UNEXPECTED_ORDER", "PayPal returned an unexpected order after capture.");
    }
    if (Math.abs(captured.amount - payload.amount) > 0.005 || captured.currency !== payload.currency) {
      throw new ApiException(502, "PAYPAL_UNEXPECTED_ORDER", "PayPal returned an unexpected amount after capture.");
    }
    if (!captured.capture) {
      throw new ApiException(
        502,
        "PAYPAL_CAPTURE_MISSING",
        "PayPal did not return a capture record. The UI will not mark this as paid.",
      );
    }

    this.logger.log(
      `Capture recorded for Sandbox order ${captured.orderId} capture=${captured.capture.id} status=${captured.capture.status}`,
    );
    return this.toOrderView(captured);
  }

  private verifyTicketForCheckout(ticket: string): DecisionTicketPayload {
    const payload = this.tickets.verify(ticket);
    if (!Number.isFinite(payload.amount) || payload.amount <= 0 || payload.currency !== "USD") {
      throw new ApiException(401, "INVALID_DECISION_TICKET", "The decision ticket has invalid payment fields.");
    }
    return payload;
  }

  private assertOrderId(orderId: string): void {
    if (!ORDER_ID_PATTERN.test(orderId)) {
      throw new ApiException(400, "INVALID_ORDER_ID", "That PayPal order ID is not valid.");
    }
  }

  private assertScamBrakeOrder(order: PaypalOrderView): void {
    if (!order.customId || !order.customId.startsWith("an_")) {
      throw new ApiException(
        404,
        "ORDER_NOT_FOUND",
        "That order was not created by a ScamBrake review.",
      );
    }
    const expectedPayee = this.config.paypalPayeeEmail;
    if (
      expectedPayee &&
      order.merchantName.toLowerCase() !== expectedPayee.toLowerCase()
    ) {
      throw new ApiException(
        409,
        "PAYPAL_PAYEE_MISMATCH",
        "PayPal reports a different Sandbox seller than the configured Sandbox payee. No capture was attempted.",
      );
    }
  }

  private toOrderView(order: PaypalOrderView): OrderView {
    const paypalPayee =
      order.merchantName && order.merchantName !== "PayPal Sandbox seller"
        ? order.merchantName
        : null;
    return {
      orderId: order.orderId,
      status: order.status,
      amount: order.amount,
      currency: "USD",
      merchantName: this.contacts.getMerchant().name,
      paypalPayee,
      customId: order.customId,
      createTime: order.createTime,
      environment: "sandbox",
      capture: order.capture,
    };
  }
}
