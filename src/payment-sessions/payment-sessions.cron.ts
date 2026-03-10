import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { SessionStatus, SweepStatus } from "@prisma/client";
import { PaymentSessionsService } from "./payment-sessions.service";
import { EvmPaymentService } from "../evm/evm.service";
import { QuotesService } from "../quotes/quotes.service";
import { PrismaService } from "../prisma/prisma.service";
import { getAssetConfig } from "../evm/evm.config";

@Injectable()
export class PaymentSessionsCron {
  private readonly logger = new Logger(PaymentSessionsCron.name);
  private checkingPayments = false;
  private processingSweeps = false;

  constructor(
    private paymentSessionsService: PaymentSessionsService,
    private evmService: EvmPaymentService,
    private quotesService: QuotesService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleExpiredSessions() {
    const expiredCount =
      await this.paymentSessionsService.expireOverdueSessions();
    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} payment session(s)`);
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkActivePayments() {
    if (this.checkingPayments) return;
    this.checkingPayments = true;

    try {
      const sessions = await this.paymentSessionsService.getActiveSessions();
      if (sessions.length === 0) return;

      this.logger.debug(
        `Checking ${sessions.length} active session(s) for payments`,
      );

      for (const session of sessions) {
        try {
          await this.checkSingleSession(session);
        } catch (error) {
          this.logger.error(
            `Error checking session ${session.id}: ${error.message}`,
          );
        }
      }
    } finally {
      this.checkingPayments = false;
    }
  }

  private async checkSingleSession(session: any) {
    if (
      new Date() > session.expiresAt &&
      session.status === SessionStatus.AWAITING_PAYMENT
    ) {
      return;
    }

    const asset = session.asset?.toUpperCase();
    if (!asset) return;

    const assetConfig = getAssetConfig(asset, this.configService);
    const minConfirmations = assetConfig.minConfirmations;

    // Fast path: if we already have a txHash, just check confirmations
    if (
      session.paymentTxHash &&
      session.status === SessionStatus.PAYMENT_DETECTED
    ) {
      const confirmations = await this.evmService.getConfirmations(
        session.paymentTxHash,
      );
      if (confirmations === -1) {
        // Tx mined but reverted — clear it and re-scan on next cycle
        this.logger.warn(
          `Payment tx ${session.paymentTxHash} reverted for session ${session.id}, re-scanning`,
        );
        await this.prisma.paymentSession.update({
          where: { id: session.id },
          data: {
            status: SessionStatus.AWAITING_PAYMENT,
            paymentTxHash: null,
            receivedAmountBaseUnits: null,
            confirmations: 0,
          },
        });
        return;
      }
      if (confirmations >= minConfirmations) {
        await this.paymentSessionsService.confirmPayment(
          session.id,
          session.paymentTxHash,
          session.receivedAmountBaseUnits,
          confirmations,
        );
      } else {
        await this.paymentSessionsService.markPaymentDetected(
          session.id,
          session.paymentTxHash,
          session.receivedAmountBaseUnits,
          confirmations,
        );
      }
      return;
    }

    // Scan for new payment
    const fromBlock = session.creationBlockNumber ?? 0;

    let paymentInfo;
    if (asset === "ETH") {
      paymentInfo = await this.evmService.checkNativePayment(
        session.depositAddress,
        fromBlock,
      );
    } else if (session.tokenContractAddress) {
      paymentInfo = await this.evmService.checkTokenPayment(
        session.depositAddress,
        session.tokenContractAddress,
        fromBlock,
      );
    }

    if (!paymentInfo) return;

    const expectedBaseUnits = BigInt(session.expectedAmountBaseUnits ?? "0");
    const receivedBaseUnits = BigInt(paymentInfo.amountBaseUnits);

    if (receivedBaseUnits < expectedBaseUnits) {
      if (session.status !== SessionStatus.UNDERPAID) {
        await this.paymentSessionsService.markUnderpaid(
          session.id,
          paymentInfo.txHash,
          paymentInfo.amountBaseUnits,
        );
      }
      return;
    }

    if (paymentInfo.confirmations >= minConfirmations) {
      await this.paymentSessionsService.confirmPayment(
        session.id,
        paymentInfo.txHash,
        paymentInfo.amountBaseUnits,
        paymentInfo.confirmations,
      );
    } else {
      await this.paymentSessionsService.markPaymentDetected(
        session.id,
        paymentInfo.txHash,
        paymentInfo.amountBaseUnits,
        paymentInfo.confirmations,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processSweeps() {
    const sweepEnabled = this.configService.get<string>(
      "SWEEP_ENABLED",
      "true",
    );
    if (sweepEnabled !== "true") return;
    if (this.processingSweeps) return;
    this.processingSweeps = true;

    try {
      const sessions =
        await this.paymentSessionsService.getSweepPendingSessions();
      if (sessions.length === 0) return;

      this.logger.debug(`Processing ${sessions.length} sweep(s)`);

      for (const session of sessions) {
        try {
          await this.processSingleSweep(session);
        } catch (error) {
          this.logger.error(
            `Sweep error for session ${session.id}: ${error.message}`,
          );
        }
      }
    } finally {
      this.processingSweeps = false;
    }
  }

  private async processSingleSweep(session: any) {
    const asset = session.asset?.toUpperCase();
    if (!asset) return;

    const minGas = BigInt(
      this.configService.get<string>(
        "SWEEP_MIN_ETH_RESERVE_WEI",
        "100000000000000",
      ),
    );

    const treasuryAddress = this.configService.get<string>(
      "TREASURY_ADDRESS",
      "",
    );
    if (!treasuryAddress) {
      this.logger.error("TREASURY_ADDRESS not configured, cannot sweep");
      return;
    }

    let sweepOp = session.sweepOps?.[0];

    if (!sweepOp) {
      sweepOp = await this.prisma.sweepOperation.create({
        data: {
          paymentSessionId: session.id,
          asset,
          amountBaseUnits: session.receivedAmountBaseUnits ?? "0",
          status: SweepStatus.PENDING,
        },
      });
    }

    // If we already have a sweep tx hash, check if it's confirmed or reverted
    if (sweepOp.sweepTxHash && session.status === SessionStatus.SWEEPING) {
      const confirmations = await this.evmService.getConfirmations(
        sweepOp.sweepTxHash,
      );
      if (confirmations === -1) {
        // Sweep tx reverted on-chain — mark as FAILED so an operator can investigate
        this.logger.error(
          `Sweep tx ${sweepOp.sweepTxHash} reverted for session ${session.id} — marking FAILED`,
        );
        await this.prisma.sweepOperation.update({
          where: { id: sweepOp.id },
          data: {
            status: SweepStatus.FAILED,
            error: "Sweep transaction reverted on-chain",
          },
        });
        await this.paymentSessionsService.markFailed(
          session.id,
          "Sweep transaction reverted on-chain",
        );
        return;
      }
      if (confirmations >= 1) {
        await this.prisma.sweepOperation.update({
          where: { id: sweepOp.id },
          data: { status: SweepStatus.COMPLETED },
        });
        await this.paymentSessionsService.markSettled(session.id);
        this.logger.log(
          `Sweep confirmed for session ${session.id}: tx=${sweepOp.sweepTxHash}`,
        );
      }
      return;
    }

    // If a sweep tx was already broadcast and marked FAILED (reverted), do not retry
    if (sweepOp.status === SweepStatus.FAILED && sweepOp.sweepTxHash) return;

    // If it failed before the sweep tx (e.g. gas top-up error), reset to PENDING for retry
    // Apply a retry cap to avoid infinite loops on permanently broken configs
    if (sweepOp.status === SweepStatus.FAILED && !sweepOp.sweepTxHash) {
      const maxRetries =
        parseInt(
          this.configService.get<string>("SWEEP_MAX_RETRIES", "2"),
          10,
        ) || 2;
      const retryCount: number = sweepOp.retryCount ?? 0;
      if (retryCount >= maxRetries) {
        this.logger.error(
          `Sweep op ${sweepOp.id} exceeded max retries (${maxRetries}) for session ${session.id} — marking session FAILED`,
        );
        await this.paymentSessionsService.markFailed(
          session.id,
          `Sweep failed after ${maxRetries} retries: ${sweepOp.error}`,
        );
        return;
      }
      sweepOp = await this.prisma.sweepOperation.update({
        where: { id: sweepOp.id },
        data: {
          status: SweepStatus.PENDING,
          error: null,
          retryCount: retryCount + 1,
        },
      });
      this.logger.log(
        `Reset failed sweep op ${sweepOp.id} to PENDING for retry (attempt ${retryCount + 1}/${maxRetries})`,
      );
    }

    const derivationIndex = session.derivationIndex;
    if (derivationIndex === null || derivationIndex === undefined) {
      this.logger.error(`No derivation index for session ${session.id}`);
      return;
    }

    if (asset === "ETH") {
      try {
        const txHash = await this.evmService.sweepNative(
          derivationIndex,
          treasuryAddress,
        );
        await this.prisma.sweepOperation.update({
          where: { id: sweepOp.id },
          data: { sweepTxHash: txHash, status: SweepStatus.SWEEPING },
        });
        await this.paymentSessionsService.markSweeping(session.id);
      } catch (error) {
        this.logger.error(
          `Sweep failed for session ${session.id}: ${error.message}`,
        );
        await this.prisma.sweepOperation.update({
          where: { id: sweepOp.id },
          data: { status: SweepStatus.FAILED, error: error.message },
        });
      }
      return;
    }

    // ── ERC-20 path ──────────────────────────────────────────────────────────

    const depositAddress = session.depositAddress;

    // Step 1: if gas not yet requested, check balance and top-up
    if (!sweepOp.gasTopupTxHash) {
      let balance: bigint;
      try {
        balance = await this.evmService.getBalance(depositAddress);
      } catch (error) {
        this.logger.warn(
          `Could not check balance for ${depositAddress}: ${error.message} — will retry next cycle`,
        );
        return;
      }

      if (balance < minGas) {
        try {
          const gasTopupTx = await this.evmService.topUpGas(depositAddress);
          await this.prisma.sweepOperation.update({
            where: { id: sweepOp.id },
            data: { gasTopupTxHash: gasTopupTx, status: SweepStatus.GAS_SENT },
          });
          this.logger.log(
            `Gas topup sent to ${depositAddress}: tx=${gasTopupTx}`,
          );
        } catch (error) {
          // Retriable — gas fund wallet may not be configured yet or may be empty.
          // Do NOT mark as FAILED so the next cron cycle retries automatically.
          this.logger.warn(
            `Gas topup failed for ${depositAddress}: ${error.message} — will retry next cycle. ` +
              `Ensure GAS_FUND_PRIVATE_KEY is set and funded with Sepolia ETH.`,
          );
        }
        return;
      }

      // Deposit address already has enough ETH — skip top-up and sweep directly
      this.logger.log(
        `Deposit address ${depositAddress} already has sufficient ETH (${balance} wei), skipping topup`,
      );
    }

    // Step 2: if gas was just sent, wait for at least 1 confirmation before sweeping
    if (sweepOp.status === SweepStatus.GAS_SENT && sweepOp.gasTopupTxHash) {
      const gasConfs = await this.evmService.getConfirmations(
        sweepOp.gasTopupTxHash,
      );
      if (gasConfs < 1) {
        this.logger.debug(
          `Gas topup pending confirmation for ${depositAddress} (tx=${sweepOp.gasTopupTxHash})`,
        );
        return;
      }
    }

    // Step 3: ensure deposit wallet actually has ETH gas before sweeping
    let balance: bigint;

    try {
      balance = await this.evmService.getBalance(depositAddress);
    } catch (error) {
      this.logger.warn(
        `Could not check ETH balance for ${depositAddress}: ${error.message}`,
      );
      return;
    }

    if (balance < minGas) {
      const hadGasTopup = !!sweepOp.gasTopupTxHash;
      this.logger.warn(
        `Deposit wallet ${depositAddress} has insufficient gas (${balance} wei).` +
          (hadGasTopup
            ? ` Gas topup was confirmed but ETH is gone — possible external drain. Check if the HD mnemonic is publicly known.`
            : ` Waiting for next cron cycle.`),
      );
      return;
    }

    // Step 3: sweep the ERC-20 token to treasury
    const tokenContractAddress = session.tokenContractAddress;
    if (!tokenContractAddress) {
      this.logger.error(`No token contract for session ${session.id}`);
      return;
    }

    try {
      const txHash = await this.evmService.sweepToken(
        derivationIndex,
        tokenContractAddress,
        treasuryAddress,
      );
      await this.prisma.sweepOperation.update({
        where: { id: sweepOp.id },
        data: { sweepTxHash: txHash, status: SweepStatus.SWEEPING },
      });
      await this.paymentSessionsService.markSweeping(session.id);
    } catch (error) {
      this.logger.error(
        `Sweep failed for session ${session.id}: ${error.message}`,
      );
      await this.prisma.sweepOperation.update({
        where: { id: sweepOp.id },
        data: { status: SweepStatus.FAILED, error: error.message },
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireQuotes() {
    await this.quotesService.expireQuotes();
  }
}
