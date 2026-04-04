import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PresaleService } from '../presale/presale.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { QuotesService } from '../quotes/quotes.service';
import { EvmPaymentService } from '../evm/evm.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private prisma: PrismaService,
    private presaleService: PresaleService,
    private promoCodesService: PromoCodesService,
    private quotesService: QuotesService,
    private evmService: EvmPaymentService,
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

    // Step 1: Create quote (fail fast if pricing unavailable)
    const quote = await this.quotesService.createQuote(userId, {
      usdAmount: dto.usdAmount,
      asset: dto.paymentCurrency,
      chain: 'ethereum',
    });

    // Step 2: Get asset config for token contract address
    const assetConfig = this.evmService.getAssetConfig(dto.paymentCurrency);

    // Step 3: Get current block number for payment scanning later
    let creationBlockNumber: number | null = null;
    try {
      creationBlockNumber = await this.evmService.getCurrentBlockNumber();
    } catch (error) {
      this.logger.warn(`Could not fetch block number: ${error.message}`);
    }

    const sessionDuration = this.configService.get<number>(
      'PAYMENT_SESSION_DURATION_MINUTES',
      60,
    );
    const expiresAt = new Date(Date.now() + sessionDuration * 60 * 1000);

    const customTransactionId =
      'TXN' +
      Date.now() +
      Math.random().toString(36).substring(2, 6).toUpperCase();

    // Step 4: Atomic DB transaction -- claims index, creates records, marks quote USED
    const result = await this.prisma.$transaction(async (tx) => {
      // Claim next derivation index with row-level lock
      const [counter] = await tx.$queryRawUnsafe<{ nextIndex: number }[]>(
        `UPDATE "DerivationCounter" SET "nextIndex" = "nextIndex" + 1 WHERE id = 1 RETURNING "nextIndex" - 1 AS "nextIndex"`,
      );

      if (!counter) {
        throw new InternalServerErrorException(
          'DerivationCounter not initialized. Run seed or migration.',
        );
      }

      const derivationIndex = counter.nextIndex;
      const derived = this.evmService.deriveDepositAddress(derivationIndex);

      const transaction = await tx.transaction.create({
        data: {
          id: customTransactionId,
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
          quoteId: quote.id,
          depositAddress: derived.address,
          derivationIndex,
          asset: dto.paymentCurrency.toUpperCase(),
          tokenContractAddress: assetConfig.contractAddress,
          expectedAmount: new Prisma.Decimal(quote.expectedAmount),
          expectedAmountBaseUnits: quote.expectedAmountBaseUnits,
          currency: dto.paymentCurrency,
          expiresAt,
          creationBlockNumber,
        },
      });

      // Mark quote as USED inside this same transaction
      await this.quotesService.markUsed(quote.id, transaction.id, tx);

      if (promoCodeRecord) {
        await tx.promoCode.update({
          where: { code: promoCodeRecord.code },
          data: { usedCount: { increment: 1 } },
        });
      }

      return { transaction, session, derivationIndex, depositAddress: derived.address };
    });

    this.logger.log(
      `Transaction ${result.transaction.id} created with session ${result.session.id}, deposit: ${result.depositAddress} (index: ${result.derivationIndex})`,
    );

    return {
      transactionId: result.transaction.id,
      sessionId: result.session.id,
      depositAddress: result.depositAddress,
      paymentCurrency: dto.paymentCurrency,
      expectedAmount: quote.expectedAmount,
      expectedAmountBaseUnits: quote.expectedAmountBaseUnits,
      expiresAt: expiresAt.toISOString(),
      status: 'AWAITING_PAYMENT',
      quoteId: quote.id,
      summary: {
        usdAmount: dto.usdAmount,
        tokenPrice: currentStage.price,
        tokensAmount,
        bonusTokens,
        totalTokens,
      },
    };
  }

  async findAllByUser(
    userId: string,
    params: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
    } = {},
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (params.status) {
      where.status = params.status as TransactionStatus;
    }

    if (params.search) {
      const search = params.search;
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { paymentCurrency: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          stage: { select: { stage: true, price: true } },
          promoCode: { select: { code: true, value: true } },
          session: {
            select: {
              id: true,
              status: true,
              expiresAt: true,
              depositAddress: true,
              confirmations: true,
              metadata: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
      throw new BadRequestException('Transaction not found');
    }

    return transaction;
  }

  async findAllAdmin(
    params: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
    } = {},
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.status) {
      where.status = params.status as TransactionStatus;
    }

    if (params.search) {
      const search = params.search;
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { paymentCurrency: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          stage: { select: { stage: true, price: true } },
          promoCode: { select: { code: true, value: true } },
          session: {
            select: { id: true, status: true, depositAddress: true, confirmations: true, metadata: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getStats() {
    const [
      totalTransactions,
      totalAmount,
      totalTokens,
      completedTransactions,
      pendingTransactions,
    ] = await Promise.all([
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({
        _sum: { usdAmount: true },
        where: { status: { in: ['COMPLETED', 'CONFIRMED'] } },
      }),
      this.prisma.transaction.aggregate({
        _sum: { totalTokens: true },
        where: { status: { in: ['COMPLETED', 'CONFIRMED'] } },
      }),
      this.prisma.transaction.count({
        where: { status: { in: ['COMPLETED', 'CONFIRMED'] } },
      }),
      this.prisma.transaction.count({
        where: { status: 'PENDING' },
      }),
    ]);

    return {
      totalTransactions,
      totalUsdRaised: totalAmount._sum.usdAmount || 0,
      totalTokensSold: totalTokens._sum.totalTokens || 0,
      completedTransactions,
      pendingTransactions,
    };
  }

  async getActiveSession(userId: string) {
    const activeTransaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        status: 'PENDING',
        session: {
          status: { in: ['AWAITING_PAYMENT', 'PAYMENT_DETECTED'] },
        },
      },
      include: {
        session: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
            depositAddress: true,
            asset: true,
            expectedAmountBaseUnits: true,
            confirmations: true,
          },
        },
        quote: {
          select: {
            id: true,
            expectedAmount: true,
            expectedAmountBaseUnits: true,
            asset: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeTransaction || !activeTransaction.session) {
      return null;
    }

    if (new Date(activeTransaction.session.expiresAt) < new Date()) {
      return null;
    }

    return {
      sessionId: activeTransaction.session.id,
      transactionId: activeTransaction.id,
      usdAmount: activeTransaction.usdAmount,
      paymentCurrency: activeTransaction.paymentCurrency,
      depositAddress: activeTransaction.session.depositAddress,
      expectedAmount: activeTransaction.quote?.expectedAmount,
      expectedAmountBaseUnits: activeTransaction.session.expectedAmountBaseUnits,
      status: activeTransaction.session.status,
      confirmations: activeTransaction.session.confirmations,
      expiresAt: activeTransaction.session.expiresAt,
    };
  }

  async getUserStats(userId: string) {
    const [
      transactionCount,
      totalAmount,
      totalTokens,
      pendingTransactions,
      completedTransactions,
      user,
    ] = await Promise.all([
      this.prisma.transaction.count({ where: { userId } }),
      this.prisma.transaction.aggregate({
        where: { userId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _sum: { usdAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _sum: { totalTokens: true },
      }),
      this.prisma.transaction.count({ where: { userId, status: 'PENDING' } }),
      this.prisma.transaction.count({
        where: { userId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { addedAmount: true } }),
    ]);

    return {
      transactionCount,
      totalInvested: totalAmount._sum.usdAmount || 0,
      totalTokens: (totalTokens._sum.totalTokens || 0) + (user?.addedAmount || 0),
      pendingTransactions,
      completedTransactions,
    };
  }

  async updateStatus(id: string, status: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return this.prisma.transaction.update({
      where: { id },
      data: { status: status as TransactionStatus },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        stage: { select: { stage: true, price: true } },
        session: { select: { id: true, status: true } },
      },
    });
  }
}
