import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentSessionsService } from './payment-sessions.service';

@Injectable()
export class PaymentSessionsCron {
  private readonly logger = new Logger(PaymentSessionsCron.name);

  constructor(private paymentSessionsService: PaymentSessionsService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleExpiredSessions() {
    const expiredCount =
      await this.paymentSessionsService.expireOverdueSessions();

    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} payment session(s)`);
    }
  }
}
