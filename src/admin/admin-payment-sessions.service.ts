import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatus } from '@prisma/client';
import { UpdateSessionDto } from './dto/update-session.dto';

const ALLOWED_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  AWAITING_PAYMENT: [
    SessionStatus.PAYMENT_DETECTED,
    SessionStatus.UNDERPAID,
    SessionStatus.EXPIRED,
    SessionStatus.CANCELLED,
    SessionStatus.FAILED,
  ],
  PAYMENT_DETECTED: [
    SessionStatus.CONFIRMED,
    SessionStatus.UNDERPAID,
    SessionStatus.FAILED,
    SessionStatus.AWAITING_PAYMENT,
  ],
  UNDERPAID: [SessionStatus.AWAITING_PAYMENT, SessionStatus.FAILED],
  CONFIRMED: [SessionStatus.SWEEP_PENDING, SessionStatus.FAILED],
  SWEEP_PENDING: [SessionStatus.SWEEPING, SessionStatus.FAILED],
  SWEEPING: [SessionStatus.SETTLED, SessionStatus.FAILED],
  EXPIRED: [SessionStatus.AWAITING_PAYMENT],
  CANCELLED: [SessionStatus.AWAITING_PAYMENT],
  FAILED: [SessionStatus.AWAITING_PAYMENT, SessionStatus.SWEEP_PENDING],
  SETTLED: [],
};

@Injectable()
export class AdminPaymentSessionsService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [total, awaiting, confirmed, failed] = await Promise.all([
      this.prisma.paymentSession.count(),
      this.prisma.paymentSession.count({ where: { status: SessionStatus.AWAITING_PAYMENT } }),
      this.prisma.paymentSession.count({ where: { status: SessionStatus.CONFIRMED } }),
      this.prisma.paymentSession.count({ where: { status: SessionStatus.FAILED } }),
    ]);

    return { totalSessions: total, awaitingSessions: awaiting, confirmedSessions: confirmed, failedSessions: failed };
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    status?: SessionStatus;
    search?: string;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { id: { contains: params.search, mode: 'insensitive' } },
        { depositAddress: { contains: params.search, mode: 'insensitive' } },
        { paymentTxHash: { contains: params.search, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { email: { contains: params.search, mode: 'insensitive' } },
              { firstName: { contains: params.search, mode: 'insensitive' } },
              { lastName: { contains: params.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          transaction: {
            select: {
              id: true,
              paymentCurrency: true,
              usdAmount: true,
              status: true,
            },
          },
          quote: {
            select: {
              id: true,
              asset: true,
              assetPriceUsd: true,
              expectedAmountBaseUnits: true,
            },
          },
          sweepOps: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.paymentSession.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        transaction: {
          select: {
            id: true,
            paymentCurrency: true,
            usdAmount: true,
            tokenPrice: true,
            tokensAmount: true,
            bonusTokens: true,
            totalTokens: true,
            status: true,
          },
        },
        quote: true,
        sweepOps: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!session) {
      throw new NotFoundException('Payment session not found');
    }

    return session;
  }

  async update(id: string, dto: UpdateSessionDto) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('Payment session not found');
    }

    if (dto.status && dto.status !== session.status) {
      const allowed = ALLOWED_TRANSITIONS[session.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Invalid status transition: ${session.status} → ${dto.status} is not allowed`,
        );
      }
    }

    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.paymentTxHash !== undefined) data.paymentTxHash = dto.paymentTxHash;
    if (dto.confirmations !== undefined) data.confirmations = dto.confirmations;
    if (dto.receivedAmountBaseUnits !== undefined)
      data.receivedAmountBaseUnits = dto.receivedAmountBaseUnits;
    if (dto.metadata !== undefined) data.metadata = dto.metadata;

    return this.prisma.paymentSession.update({
      where: { id },
      data,
    });
  }
}
