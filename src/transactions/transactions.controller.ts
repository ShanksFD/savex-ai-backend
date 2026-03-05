import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { TransactionsService } from "./transactions.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { CurrentUser, Roles } from "../common/decorators";
import { RolesGuard } from "../common/guards";
import { Role } from "@prisma/client";

@Controller("transactions")
@UseGuards(AuthGuard("jwt"))
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post()
  create(@CurrentUser("id") userId: string, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser("id") userId: string) {
    return this.transactionsService.findAllByUser(userId);
  }

  @Get("admin/all")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  findAllAdmin() {
    return this.transactionsService.findAllAdmin();
  }

  @Get("admin/stats")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  getStats() {
    return this.transactionsService.getStats();
  }

  @Get("active-session")
  getActiveSession(@CurrentUser("id") userId: string) {
    return this.transactionsService.getActiveSession(userId);
  }

  @Get("my-stats")
  getMyStats(@CurrentUser("id") userId: string) {
    return this.transactionsService.getUserStats(userId);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.transactionsService.findOne(id, userId);
  }
}
