import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatus, TransactionStatus } from '@prisma/client';
import { ZohoService } from '../zoho/zoho.service';

export interface SessionEvent {
  sessionId: string;
  status: SessionStatus;
  transactionStatus?: TransactionStatus;
  message: string;
  data?: Record<string, any>;
}

@Injectable()
export class PaymentSessionsService {
  private readonly logger = new Logger(PaymentSessionsService.name);
  private sessionEvents$ = new Subject<SessionEvent>();

  constructor(
    private prisma: PrismaService,
    private zohoService: ZohoService,
  ) {}

  async findOne(id: string, userId: string) {
    const session = await this.prisma.paymentSession.findFirst({
      where: { id, userId },
      include: {
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
      },
    });

    if (!session) {
      throw new NotFoundException('Payment session not found');
    }

    return {
      id: session.id,
      depositAddress: session.depositAddress,
      asset: session.asset,
      tokenContractAddress: session.tokenContractAddress,
      expectedAmount: session.expectedAmount,
      expectedAmountBaseUnits: session.expectedAmountBaseUnits,
      receivedAmountBaseUnits: session.receivedAmountBaseUnits,
      paymentTxHash: session.paymentTxHash,
      confirmations: session.confirmations,
      currency: session.currency,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      confirmedAt: session.confirmedAt?.toISOString() ?? null,
      sweptAt: session.sweptAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      transaction: session.transaction,
    };
  }

  getSessionStream(sessionId: string) {
    return this.sessionEvents$.pipe(
      filter((event) => event.sessionId === sessionId),
      map((event) => ({
        data: JSON.stringify({
          status: event.status,
          transactionStatus: event.transactionStatus,
          message: event.message,
          ...event.data,
          timestamp: new Date().toISOString(),
        }),
      })),
    );
  }

  emitSessionEvent(event: SessionEvent) {
    this.sessionEvents$.next(event);
  }

  async cancel(id: string, userId: string) {
    const session = await this.prisma.paymentSession.findFirst({
      where: { id, userId },
    });

    if (!session) {
      throw new NotFoundException('Payment session not found');
    }

    if (session.status !== 'AWAITING_PAYMENT') {
      throw new BadRequestException('Can only cancel sessions awaiting payment');
    }

    const [updatedSession] = await this.prisma.$transaction([
      this.prisma.paymentSession.update({
        where: { id },
        data: { status: SessionStatus.CANCELLED },
      }),
      this.prisma.transaction.update({
        where: { id: session.purchaseId },
        data: { status: TransactionStatus.CANCELLED },
      }),
    ]);

    this.emitSessionEvent({
      sessionId: id,
      status: SessionStatus.CANCELLED,
      transactionStatus: TransactionStatus.CANCELLED,
      message: 'Payment session cancelled by user',
    });

    return updatedSession;
  }

  async expireOverdueSessions() {
    const expiredSessions = await this.prisma.paymentSession.findMany({
      where: {
        status: SessionStatus.AWAITING_PAYMENT,
        expiresAt: { lt: new Date() },
      },
    });

    if (expiredSessions.length === 0) return 0;

    const sessionIds = expiredSessions.map((s) => s.id);
    const purchaseIds = expiredSessions.map((s) => s.purchaseId);

    await this.prisma.$transaction([
      this.prisma.paymentSession.updateMany({
        where: { id: { in: sessionIds } },
        data: { status: SessionStatus.EXPIRED },
      }),
      this.prisma.transaction.updateMany({
        where: { id: { in: purchaseIds } },
        data: { status: TransactionStatus.EXPIRED },
      }),
    ]);

    for (const session of expiredSessions) {
      this.emitSessionEvent({
        sessionId: session.id,
        status: SessionStatus.EXPIRED,
        transactionStatus: TransactionStatus.EXPIRED,
        message: 'Payment session has expired',
      });
    }

    return expiredSessions.length;
  }

  async markPaymentDetected(
    sessionId: string,
    txHash: string,
    receivedAmountBaseUnits: string,
    confirmations: number,
  ) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    if (
      session.status !== SessionStatus.AWAITING_PAYMENT &&
      session.status !== SessionStatus.PAYMENT_DETECTED
    ) {
      return;
    }

    await this.prisma.paymentSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.PAYMENT_DETECTED,
        paymentTxHash: txHash,
        receivedAmountBaseUnits,
        confirmations,
      },
    });

    this.logger.log(
      `Payment detected for session ${sessionId}: tx=${txHash} amount=${receivedAmountBaseUnits} confs=${confirmations}`,
    );

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.PAYMENT_DETECTED,
      message: 'Payment detected, waiting for confirmations',
      data: { txHash, receivedAmountBaseUnits, confirmations },
    });
  }

  async markUnderpaid(
    sessionId: string,
    txHash: string,
    receivedAmountBaseUnits: string,
  ) {
    await this.prisma.paymentSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.UNDERPAID,
        paymentTxHash: txHash,
        receivedAmountBaseUnits,
      },
    });

    this.logger.warn(
      `Underpaid session ${sessionId}: tx=${txHash} received=${receivedAmountBaseUnits}`,
    );

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.UNDERPAID,
      message: 'Payment received but amount is insufficient',
      data: { txHash, receivedAmountBaseUnits },
    });
  }

  async confirmPayment(
    sessionId: string,
    txHash: string,
    receivedAmountBaseUnits: string,
    confirmations: number,
  ) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    await this.prisma.$transaction([
      this.prisma.paymentSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.SWEEP_PENDING,
          paymentTxHash: txHash,
          receivedAmountBaseUnits,
          confirmations,
          confirmedAt: new Date(),
        },
      }),
      this.prisma.transaction.update({
        where: { id: session.purchaseId },
        data: { status: TransactionStatus.CONFIRMED },
      }),
    ]);

    this.logger.log(
      `Payment confirmed for session ${sessionId}: tx=${txHash} confs=${confirmations} -> SWEEP_PENDING`,
    );

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.SWEEP_PENDING,
      transactionStatus: TransactionStatus.CONFIRMED,
      message: 'Payment confirmed, awaiting sweep to treasury',
      data: { txHash, receivedAmountBaseUnits, confirmations },
    });
  }

  async markSweeping(sessionId: string) {
    await this.prisma.paymentSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.SWEEPING },
    });

    this.logger.log(`Session ${sessionId} -> SWEEPING`);

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.SWEEPING,
      message: 'Sweep transaction broadcast, awaiting confirmation',
    });
  }

  async markSettled(sessionId: string) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    await this.prisma.$transaction([
      this.prisma.paymentSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.SETTLED,
          sweptAt: new Date(),
        },
      }),
      this.prisma.transaction.update({
        where: { id: session.purchaseId },
        data: { status: TransactionStatus.COMPLETED },
      }),
    ]);

    this.logger.log(`Session ${sessionId} -> SETTLED`);

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.SETTLED,
      transactionStatus: TransactionStatus.COMPLETED,
      message: 'Funds swept to treasury, payment complete',
    });

    this.zohoService.upsertContact(session.userId);
  }

  async markFailed(sessionId: string, error: string) {
    await this.prisma.paymentSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.FAILED },
    });

    this.logger.error(`Session ${sessionId} -> FAILED: ${error}`);

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.FAILED,
      message: `Payment failed: ${error}`,
    });
  }

  async markPaymentMethod(
    id: string,
    userId: string,
    paymentMethod: 'wallet' | 'manual',
    walletAddress?: string,
  ) {
    const session = await this.prisma.paymentSession.findFirst({
      where: { id, userId },
    });

    if (!session) {
      throw new NotFoundException('Payment session not found');
    }

    const existingMetadata =
      session.metadata && typeof session.metadata === 'object'
        ? (session.metadata as Record<string, unknown>)
        : {};

    await this.prisma.paymentSession.update({
      where: { id },
      data: {
        metadata: {
          ...existingMetadata,
          paymentMethod,
          ...(walletAddress ? { walletAddress } : {}),
        },
      },
    });
  }

  async getActiveSessions() {
    return this.prisma.paymentSession.findMany({
      where: {
        status: {
          in: [SessionStatus.AWAITING_PAYMENT, SessionStatus.PAYMENT_DETECTED],
        },
      },
      include: {
        quote: {
          select: { expectedAmountBaseUnits: true, asset: true },
        },
      },
    });
  }

  async getSweepPendingSessions() {
    return this.prisma.paymentSession.findMany({
      where: {
        status: {
          in: [SessionStatus.SWEEP_PENDING, SessionStatus.SWEEPING],
        },
      },
      include: {
        sweepOps: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }
}
