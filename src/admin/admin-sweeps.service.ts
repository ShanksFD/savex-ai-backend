import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SweepStatus, SessionStatus } from '@prisma/client';

@Injectable()
export class AdminSweepsService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [total, pending, completed, failed] = await Promise.all([
      this.prisma.sweepOperation.count(),
      this.prisma.sweepOperation.count({ where: { status: SweepStatus.PENDING } }),
      this.prisma.sweepOperation.count({ where: { status: SweepStatus.COMPLETED } }),
      this.prisma.sweepOperation.count({ where: { status: SweepStatus.FAILED } }),
    ]);

    return { totalSweeps: total, pendingSweeps: pending, completedSweeps: completed, failedSweeps: failed };
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    status?: SweepStatus;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = params.status ? { status: params.status } : {};

    const [data, total] = await Promise.all([
      this.prisma.sweepOperation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          paymentSession: {
            include: {
              user: {
                select: { id: true, email: true, firstName: true, lastName: true },
              },
              transaction: {
                select: { id: true, paymentCurrency: true, usdAmount: true },
              },
            },
          },
        },
      }),
      this.prisma.sweepOperation.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const sweep = await this.prisma.sweepOperation.findUnique({
      where: { id },
      include: {
        paymentSession: {
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
                totalTokens: true,
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
          },
        },
      },
    });

    if (!sweep) {
      throw new NotFoundException('Sweep operation not found');
    }

    return sweep;
  }

  async retry(id: string) {
    const sweep = await this.prisma.sweepOperation.findUnique({
      where: { id },
      include: { paymentSession: true },
    });

    if (!sweep) {
      throw new NotFoundException('Sweep operation not found');
    }

    const updatedSweep = await this.prisma.sweepOperation.update({
      where: { id },
      data: {
        retryCount: sweep.retryCount + 1,
        error: null,
        status: SweepStatus.PENDING,
        sweepTxHash: null,
        gasTopupTxHash: null,
      },
    });

    if (sweep.paymentSession.status === SessionStatus.FAILED) {
      await this.prisma.paymentSession.update({
        where: { id: sweep.paymentSessionId },
        data: { status: SessionStatus.SWEEP_PENDING },
      });
    }

    return updatedSweep;
  }
}
