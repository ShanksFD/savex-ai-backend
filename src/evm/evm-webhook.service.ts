import { Injectable, Logger } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentSessionsService } from '../payment-sessions/payment-sessions.service';
import { EvmPaymentService } from './evm.service';
import { getAssetConfig } from './evm.config';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EvmWebhookService {
  private readonly logger = new Logger(EvmWebhookService.name);

  constructor(
    private prisma: PrismaService,
    private paymentSessionsService: PaymentSessionsService,
    private evmService: EvmPaymentService,
    private configService: ConfigService,
  ) {}

  async handleActivities(activities: any[]) {
    for (const activity of activities) {
      await this.processActivity(activity).catch((err) =>
        this.logger.error(`Failed to process webhook activity: ${err.message}`, err.stack),
      );
    }
  }

  private async processActivity(activity: any) {
    const toAddress: string = activity?.toAddress?.toLowerCase();
    if (!toAddress) return;

    // Find an active session waiting on this deposit address
    const session = await this.prisma.paymentSession.findFirst({
      where: {
        depositAddress: { equals: toAddress, mode: 'insensitive' },
        status: { in: [SessionStatus.AWAITING_PAYMENT, SessionStatus.UNDERPAID] },
      },
    });

    if (!session) return;

    this.logger.log(
      `Webhook: activity detected on deposit address ${toAddress} for session ${session.id}`,
    );

    const asset = session.asset?.toUpperCase();
    if (!asset) return;

    const assetConfig = getAssetConfig(asset, this.configService);
    const latestBlock = await this.evmService.getCurrentBlockNumber();

    let paymentInfo;
    if (asset === 'ETH') {
      paymentInfo = await this.evmService.checkNativePayment(
        session.depositAddress,
        session.creationBlockNumber ?? 0,
        latestBlock,
      );
    } else if (session.tokenContractAddress) {
      paymentInfo = await this.evmService.checkTokenPayment(
        session.depositAddress,
        session.tokenContractAddress,
        session.lastScannedBlock
          ? session.lastScannedBlock + 1
          : (session.creationBlockNumber ?? 0),
        latestBlock,
      );
    }

    if (!paymentInfo) return;

    // Update lastScannedBlock so the cron skips already-seen blocks
    await this.prisma.paymentSession.update({
      where: { id: session.id },
      data: { lastScannedBlock: latestBlock },
    });

    const expectedBaseUnits = BigInt(session.expectedAmountBaseUnits ?? '0');
    const receivedBaseUnits = BigInt(paymentInfo.amountBaseUnits);

    if (receivedBaseUnits < expectedBaseUnits) {
      await this.paymentSessionsService.markUnderpaid(
        session.id,
        paymentInfo.txHash,
        paymentInfo.amountBaseUnits,
      );
      return;
    }

    if (paymentInfo.confirmations >= assetConfig.minConfirmations) {
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
}
