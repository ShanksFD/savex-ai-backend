import { Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { PresaleService } from "../presale/presale.service";
import { PromoCodesService } from "../promo-codes/promo-codes.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";

const PAYMENT_WALLETS: Record<string, string> = {
  USDT: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  USDC: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  ETH: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
};

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private presaleService: PresaleService,
    private promoCodesService: PromoCodesService,
    private configService: ConfigService,
  ) {}

  async create(userId: string, dto: CreateTransactionDto) {
    const currentStage = await this.presaleService.getCurrentStage();

    let promoCodeRecord: { code: string; value: number } | null = null;
    if (dto.promoCode) {
      promoCodeRecord = await this.promoCodesService.validate(dto.promoCode);
    }

    const tokensAmount = dto.usdAmount / currentStage.price;

    const stageBonusTokens = (tokensAmount * currentStage.bonus) / 100;

    const promoBonusTokens = promoCodeRecord
      ? (tokensAmount * promoCodeRecord.value) / 100
      : 0;

    const bonusTokens = stageBonusTokens + promoBonusTokens;
    const totalTokens = tokensAmount + bonusTokens;

    const promoCodeEntity = promoCodeRecord
      ? await this.prisma.promoCode.findUnique({
          where: { code: promoCodeRecord.code },
        })
      : null;

    const sessionDuration = this.configService.get<number>(
      "PAYMENT_SESSION_DURATION_MINUTES",
      60,
    );
    const expiresAt = new Date(Date.now() + sessionDuration * 60 * 1000);

    const walletAddress =
      PAYMENT_WALLETS[dto.paymentCurrency] || PAYMENT_WALLETS.USDT;

    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          stageId: currentStage.id,
          promoCodeId: promoCodeEntity?.id || null,
          paymentCurrency: dto.paymentCurrency,
          usdAmount: dto.usdAmount,
          tokenPrice: currentStage.price,
          tokensAmount,
          bonusTokens,
          totalTokens,
        },
      });

      const session = await tx.paymentSession.create({
        data: {
          purchaseId: transaction.id,
          userId,
          walletAddress,
          expectedAmount: dto.usdAmount,
          currency: dto.paymentCurrency,
          expiresAt,
        },
      });

      if (promoCodeRecord) {
        await tx.promoCode.update({
          where: { code: promoCodeRecord.code },
          data: { usedCount: { increment: 1 } },
        });
      }

      return { transaction, session };
    });

    return {
      transactionId: result.transaction.id,
      sessionId: result.session.id,
      redirectUrl: `/payment/${result.session.id}`,
      summary: {
        paymentCurrency: dto.paymentCurrency,
        usdAmount: dto.usdAmount,
        tokenPrice: currentStage.price,
        tokensAmount,
        bonusTokens,
        totalTokens,
        walletAddress,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async findAllByUser(userId: string) {
    return this.prisma.transaction.findMany({
      where: { userId },
      include: {
        stage: { select: { stage: true, price: true } },
        promoCode: { select: { code: true, value: true } },
        session: {
          select: { id: true, status: true, expiresAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, userId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: {
        stage: true,
        promoCode: { select: { code: true, value: true } },
        session: true,
      },
    });

    if (!transaction) {
      throw new BadRequestException("Transaction not found");
    }

    return transaction;
  }

  async findAllAdmin() {
    return this.prisma.transaction.findMany({
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        stage: { select: { stage: true, price: true } },
        session: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getStats() {
    const [totalTransactions, totalAmount, totalTokens] = await Promise.all([
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({ _sum: { usdAmount: true } }),
      this.prisma.transaction.aggregate({ _sum: { totalTokens: true } }),
    ]);

    return {
      totalTransactions,
      totalUsdRaised: totalAmount._sum.usdAmount || 0,
      totalTokensSold: totalTokens._sum.totalTokens || 0,
    };
  }

  async getActiveSession(userId: string) {
    const activeTransaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        status: "PENDING",
        session: { status: "AWAITING_PAYMENT" },
      },
      include: {
        session: { select: { id: true, status: true, expiresAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!activeTransaction || !activeTransaction.session) {
      return null;
    }

    // Check if the session is actually expired by time
    if (new Date(activeTransaction.session.expiresAt) < new Date()) {
      return null;
    }

    return {
      sessionId: activeTransaction.session.id,
      transactionId: activeTransaction.id,
      usdAmount: activeTransaction.usdAmount,
      paymentCurrency: activeTransaction.paymentCurrency,
      expiresAt: activeTransaction.session.expiresAt,
    };
  }

  async getUserStats(userId: string) {
    const [transactionCount, totalAmount, totalTokens] = await Promise.all([
      this.prisma.transaction.count({
        where: { userId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, status: { in: ["CONFIRMED", "COMPLETED"] } },
        _sum: { usdAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, status: { in: ["CONFIRMED", "COMPLETED"] } },
        _sum: { totalTokens: true },
      }),
    ]);

    return {
      transactionCount,
      totalInvested: totalAmount._sum.usdAmount || 0,
      totalTokens: totalTokens._sum.totalTokens || 0,
    };
  }
}
