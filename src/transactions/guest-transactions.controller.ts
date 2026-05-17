import { Body, Controller, Post } from "@nestjs/common";
import { TransactionsService } from "./transactions.service";
import { CreateGuestTransactionDto } from "./dto/create-guest-transaction.dto";

// Public controller: no JWT guard.
// Used by the anonymous Buy Now flow before the user has registered.
// The returned claimToken is the ONLY way to later attach this transaction
// to a user account — walletAddress is stored alongside for secondary verification
// at claim time but is never sufficient on its own.
@Controller("transactions/guest")
export class GuestTransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post()
  create(@Body() dto: CreateGuestTransactionDto) {
    return this.transactionsService.createGuest(dto);
  }
}
