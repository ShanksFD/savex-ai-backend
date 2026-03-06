import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { TransactionsService } from "./transactions.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { UpdateTransactionStatusDto } from "./dto/update-transaction-status.dto";
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
  findAll(
    @CurrentUser("id") userId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.transactionsService.findAllByUser(userId, {
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      status,
      search,
    });
  }

  @Get("admin/all")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  findAllAdmin(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.transactionsService.findAllAdmin({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      status,
      search,
    });
  }

  @Get("admin/stats")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  getStats() {
    return this.transactionsService.getStats();
  }

  @Patch("admin/:id/status")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateTransactionStatusDto,
  ) {
    return this.transactionsService.updateStatus(id, dto.status);
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
