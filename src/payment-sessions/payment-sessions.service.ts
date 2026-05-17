import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatus, TransactionStatus } from '@prisma/client';
import { ZohoService } from '../zoho/zoho.service';

// Caller identity for any session endpoint: an authenticated user OR a guest
// presenting their session-specific claimToken. Exactly one must be supplied.
export type SessionCaller =
  | { userId: string; claimToken?: undefined }
  | { userId?: undefined; claimToken: string };

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

  // Resolve a session for a caller — either an authenticated user OR a guest
  // presenting their claimToken. Throws if the caller has no right to see it.
  // Centralized to keep the authorization rules consistent across endpoints.
  private async resolveSessionForCaller(id: string, caller: SessionCaller) {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id },
    });
    if (!session) throw new NotFoundException('Payment session not found');

    if (caller.userId !== undefined) {
      if (session.userId !== caller.userId) {
        throw new ForbiddenException('Not authorized for this session');
      }
      return session;
    }

    // Guest path: claimToken must match AND session must still be unclaimed.
    if (!session.claimToken || session.claimToken !== caller.claimToken) {
      throw new UnauthorizedException('Invalid claim token');
    }
    if (session.claimedAt) {
      throw new ForbiddenException('Session already claimed');
    }
    return session;
  }

  async findOne(id: string, caller: SessionCaller) {
    const session = await this.resolveSessionForCaller(id, caller);
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: session.purchaseId },
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
    });

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
      transaction,
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

  async cancel(id: string, caller: SessionCaller) {
    const session = await this.resolveSessionForCaller(id, caller);

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

    const now = new Date();
    const isGuest = session.userId === null;

    await this.prisma.$transaction([
      this.prisma.paymentSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.SETTLED,
          sweptAt: now,
          // Stamp zohoSyncedAt now for guest sessions so we know verifyEmail
          // is the canonical Zoho trigger when this session is later claimed.
          // For authenticated sessions, we set it after a successful upsert below.
          ...(isGuest ? { zohoSyncedAt: null } : {}),
        },
      }),
      this.prisma.transaction.update({
        where: { id: session.purchaseId },
        data: { status: TransactionStatus.COMPLETED },
      }),
    ]);

    this.logger.log(
      `Session ${sessionId} -> SETTLED (${isGuest ? 'GUEST — Zoho deferred to verify' : 'AUTH'})`,
    );

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.SETTLED,
      transactionStatus: TransactionStatus.COMPLETED,
      message: 'Funds swept to treasury, payment complete',
    });

    // Guest sessions defer Zoho sync until the buyer registers and verifies
    // their email. This is the single trigger point for guest flows — avoids
    // duplicate contacts, premature balance updates, and orphan CRM records.
    if (isGuest) return;

    this.zohoService
      .upsertContact(session.userId as string)
      .then(async () => {
        await this.prisma.paymentSession.update({
          where: { id: sessionId },
          data: { zohoSyncedAt: new Date() },
        });
      })
      .catch((err) => {
        this.logger.error(
          `Zoho upsert failed for user ${session.userId} on settlement: ${err.message}`,
        );
        Sentry.captureException(err, {
          tags: { service: 'PaymentSessionsService', step: 'zohoUpsertOnSettle', sessionId },
        });
      });
  }

  async markFailed(sessionId: string, error: string) {
    await this.prisma.paymentSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.FAILED },
    });

    this.logger.error(`Session ${sessionId} -> FAILED: ${error}`);
    Sentry.captureException(new Error(`Session FAILED: ${error}`), {
      tags: { service: 'PaymentSessionsService', sessionId },
    });

    this.emitSessionEvent({
      sessionId,
      status: SessionStatus.FAILED,
      message: `Payment failed: ${error}`,
    });
  }

  async markPaymentMethod(
    id: string,
    caller: SessionCaller,
    paymentMethod: 'wallet' | 'manual',
    walletAddress?: string,
  ) {
    const session = await this.resolveSessionForCaller(id, caller);

    const existingMetadata =
      session.metadata && typeof session.metadata === 'object'
        ? (session.metadata as Record<string, unknown>)
        : {};

    const normalizedWallet = walletAddress?.toLowerCase();

    await this.prisma.paymentSession.update({
      where: { id },
      data: {
        metadata: {
          ...existingMetadata,
          paymentMethod,
          ...(normalizedWallet ? { walletAddress: normalizedWallet } : {}),
        },
        // For guest sessions, also promote walletAddress to the top-level column
        // if it wasn't already set at creation time. Only set when missing — we
        // never overwrite a previously-recorded guest wallet (which is the one
        // that will need to match at claim time).
        ...(normalizedWallet && !session.walletAddress
          ? { walletAddress: normalizedWallet }
          : {}),
      },
    });
  }

  // Link one or more settled guest sessions to a freshly-registered user.
  // Primary lookup is by claimToken (unique, server-generated, opaque).
  // walletAddress is a *secondary* verification: it must match the wallet
  // that paid. We never auto-link by wallet alone — a single wallet may
  // legitimately spawn multiple guest sessions; only the token proves ownership.
  async claimGuestSessions(
    userId: string,
    claimToken: string,
    walletAddress: string,
  ) {
    const normalizedWallet = walletAddress.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.paymentSession.findUnique({
        where: { claimToken },
      });

      if (!session) {
        throw new NotFoundException('Claim token not recognized');
      }
      if (session.claimedAt) {
        throw new ForbiddenException('Session already claimed');
      }
      if (session.userId) {
        // Shouldn't happen if claimedAt is null, but guard anyway.
        throw new ForbiddenException('Session is not a guest session');
      }
      if (
        !session.walletAddress ||
        session.walletAddress.toLowerCase() !== normalizedWallet
      ) {
        // Secondary check: mismatch means caller cannot prove this was their payment.
        throw new ForbiddenException('Wallet address does not match this session');
      }

      const claimedAt = new Date();

      const updatedSession = await tx.paymentSession.update({
        where: { id: session.id },
        data: { userId, claimedAt },
      });

      await tx.transaction.update({
        where: { id: session.purchaseId },
        data: { userId },
      });

      // Also link the Quote so user history queries surface this purchase.
      if (session.quoteId) {
        await tx.quote.update({
          where: { id: session.quoteId },
          data: { userId },
        });
      }

      this.logger.log(
        `Guest session ${session.id} claimed by user ${userId} (wallet=${normalizedWallet})`,
      );

      return updatedSession;
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

  // Issue a fresh claimToken to a guest who lost their original token.
  // The caller must prove ownership of the wallet used to pay by providing a
  // valid EIP-191 signature over a deterministic message.
  // Only settled, unclaimed sessions for that wallet are eligible.
  async recoverClaimToken(
    sessionId: string,
    walletAddress: string,
    message: string,
    signature: string,
  ): Promise<{ claimToken: string; sessionId: string }> {
    const normalizedWallet = walletAddress.toLowerCase();

    // Verify signature — proves the caller controls the wallet.
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature).toLowerCase();
    } catch {
      throw new BadRequestException('Invalid signature');
    }

    if (recovered !== normalizedWallet) {
      throw new ForbiddenException('Signature does not match wallet address');
    }

    const session = await this.prisma.paymentSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Payment session not found');
    if (session.walletAddress?.toLowerCase() !== normalizedWallet) {
      throw new ForbiddenException('Wallet address does not match this session');
    }
    if (session.claimedAt) {
      throw new ForbiddenException('Session already claimed');
    }
    if (
      !['SETTLED', 'SWEEPING', 'SWEEP_PENDING', 'CONFIRMED'].includes(
        session.status,
      )
    ) {
      throw new BadRequestException('Session is not yet settled');
    }

    const newClaimToken = crypto.randomBytes(32).toString('hex');

    await this.prisma.paymentSession.update({
      where: { id: session.id },
      data: { claimToken: newClaimToken },
    });

    this.logger.log(
      `Claim token recovered for session ${session.id} via wallet signature (wallet=${normalizedWallet})`,
    );

    return { claimToken: newClaimToken, sessionId: session.id };
  }
}
