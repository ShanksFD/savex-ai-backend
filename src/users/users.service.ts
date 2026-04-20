import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import * as bcrypt from "bcrypt";
import { Prisma, Role } from "@prisma/client";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateMeDto } from "./dto/update-me.dto";
import { accountSuspendedTemplate } from "../email/email.templates";
import { ZohoService } from "../zoho/zoho.service";

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  addedAmount: true,
  investmentStyle: true,
  status: true,
  isEmailVerified: true,
  role: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private zohoService: ZohoService,
  ) {}

  async getMe(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }

  async findAll(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      investedFilter?: string;
      sortBy?: string;
    } = {},
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = { role: Role.USER };

    if (params.search) {
      where.OR = [
        { email: { contains: params.search, mode: "insensitive" } },
        { firstName: { contains: params.search, mode: "insensitive" } },
        { lastName: { contains: params.search, mode: "insensitive" } },
        { phone: { contains: params.search, mode: "insensitive" } },
      ];
    }

    if (params.investedFilter && params.investedFilter !== "All") {
      if (params.investedFilter === "Invested") {
        where.transactions = {
          some: {
            status: { in: ["CONFIRMED", "COMPLETED"] },
          },
        };
      } else if (params.investedFilter === "Not Invested") {
        where.transactions = {
          none: {
            status: { in: ["CONFIRMED", "COMPLETED"] },
          },
        };
      }
    }

    let orderBy: Prisma.UserOrderByWithRelationInput = { createdAt: "desc" };
    switch (params.sortBy) {
      case "oldest":
        orderBy = { createdAt: "asc" };
        break;
      case "name_asc":
        orderBy = { firstName: "asc" };
        break;
      case "name_desc":
        orderBy = { firstName: "desc" };
        break;
      case "newest":
      default:
        // Calculated/relational fields like totalInvested and totalSVX fallback to newest
        orderBy = { createdAt: "desc" };
        break;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...USER_SELECT,
          transactions: {
            select: {
              usdAmount: true,
              totalTokens: true,
              status: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = users.map((user) => {
      const confirmedTx = user.transactions.filter(
        (t) => t.status === "CONFIRMED" || t.status === "COMPLETED",
      );
      const totalInvested = confirmedTx.reduce(
        (sum, t) => sum + t.usdAmount,
        0,
      );
      const totalTokens = confirmedTx.reduce(
        (sum, t) => sum + t.totalTokens,
        0,
      );
      const transactionCount = user.transactions.length;

      const { transactions, ...rest } = user;

      return {
        ...rest,
        totalInvested,
        totalTokens,
        transactionCount,
        isInvested: totalInvested > 0,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        transactions: {
          select: {
            id: true,
            usdAmount: true,
            totalTokens: true,
            tokensAmount: true,
            bonusTokens: true,
            tokenPrice: true,
            paymentCurrency: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const confirmedTx = user.transactions.filter(
      (t) => t.status === "CONFIRMED" || t.status === "COMPLETED",
    );
    const totalInvested = confirmedTx.reduce((sum, t) => sum + t.usdAmount, 0);
    const totalTokens = confirmedTx.reduce((sum, t) => sum + t.totalTokens, 0);

    return {
      ...user,
      totalInvested,
      totalTokens,
      isInvested: totalInvested > 0,
    };
  }

  async getAdminStats() {
    const totalUsers = await this.prisma.user.count();

    const transactions = await this.prisma.transaction.findMany({
      where: { status: { in: ["CONFIRMED", "COMPLETED"] } },
      select: { usdAmount: true, totalTokens: true, userId: true },
    });

    const totalRaised = transactions.reduce((sum, t) => sum + t.usdAmount, 0);
    const investedUserIds = new Set(transactions.map((t) => t.userId));
    const investedUsers = investedUserIds.size;

    const activePromos = await this.prisma.promoCode.count({
      where: { isActive: true },
    });

    return {
      totalUsers,
      investedUsers,
      totalRaised,
      activePromos,
    };
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const data: any = { ...dto };

    // Handle suspension
    if (dto.status === "SUSPENDED" && user.status !== "SUSPENDED") {
      data.suspendedAt = new Date();
      data.tokenVersion = { increment: 1 }; // Invalidate all existing tokens
    }

    // Handle un-suspension
    if (dto.status === "ACTIVE" && user.status === "SUSPENDED") {
      data.suspendedAt = null;
      data.suspendedReason = null;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });

    // Send suspension notification email
    if (dto.status === "SUSPENDED" && user.status !== "SUSPENDED") {
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
      const template = accountSuspendedTemplate(name, dto.suspendedReason);
      await this.emailService.sendEmail(
        user.email,
        template.subject,
        template.html,
      );
    }

    if (
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.addedAmount !== undefined
    ) {
      this.zohoService.upsertContact(id);
    }

    return updatedUser;
  }
}
