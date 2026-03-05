import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Subject } from "rxjs";
import { filter, map } from "rxjs/operators";
import { PrismaService } from "../prisma/prisma.service";
import { SessionStatus, TransactionStatus } from "@prisma/client";

export interface SessionEvent {
  sessionId: string;
  status: SessionStatus;
  transactionStatus?: TransactionStatus;
  message: string;
}

@Injectable()
export class PaymentSessionsService {
  private sessionEvents$ = new Subject<SessionEvent>();

  constructor(private prisma: PrismaService) {}

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
      throw new NotFoundException("Payment session not found");
    }

    return {
      id: session.id,
      walletAddress: session.walletAddress,
      expectedAmount: session.expectedAmount,
      currency: session.currency,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
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
      throw new NotFoundException("Payment session not found");
    }

    if (session.status !== "AWAITING_PAYMENT") {
      throw new BadRequestException(
        "Can only cancel sessions awaiting payment",
      );
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
      message: "Payment session cancelled by user",
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
        message: "Payment session has expired",
      });
    }

    return expiredSessions.length;
  }

  async confirmPayment(sessionId: string) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException("Payment session not found");
    }

    if (session.status !== "AWAITING_PAYMENT") {
      throw new BadRequestException("Session is not awaiting payment");
    }

    await this.prisma.$transaction([
      this.prisma.paymentSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.CONFIRMED },
      }),
      this.prisma.transaction.update({
        where: { id: session.purchaseId },
        data: { status: TransactionStatus.CONFIRMED },
      }),
    ]);

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.CONFIRMED,
      transactionStatus: TransactionStatus.CONFIRMED,
      message: "Payment confirmed successfully",
    });
  }
}
