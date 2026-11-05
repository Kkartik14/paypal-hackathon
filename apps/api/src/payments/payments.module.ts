import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { PaypalModule } from "../paypal/paypal.module";
import { PolicyModule } from "../policy/policy.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [PaypalModule, PolicyModule, ContactsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
