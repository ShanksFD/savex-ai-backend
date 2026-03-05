import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { accountSuspendedTemplate } from "../email/email.templates";

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  addedAmount: true,
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
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
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
      orderBy: { createdAt: "desc" },
    });

    return users.map((user) => {
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

    return updatedUser;
  }
}
