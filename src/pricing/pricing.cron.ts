import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PricingService } from './pricing.service';

@Injectable()
export class PricingCron {
  private readonly logger = new Logger(PricingCron.name);

  constructor(private pricingService: PricingService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async refreshPrices() {
    try {
      const price = await this.pricingService.fetchAndStoreEthPrice();
      this.logger.log(`ETH price refreshed: $${price}`);
    } catch (error) {
      this.logger.error(`Failed to refresh ETH price: ${error.message}`);
      Sentry.captureException(error, { tags: { cron: 'refreshPrices' } });
    }
  }
}
