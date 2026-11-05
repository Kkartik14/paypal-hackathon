import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { PolicyService } from "./policy.service";
import { TicketService } from "./ticket.service";

@Module({
  imports: [ContactsModule],
  providers: [PolicyService, TicketService],
  exports: [PolicyService, TicketService],
})
export class PolicyModule {}
