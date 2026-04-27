import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { EvmWebhookService } from './evm-webhook.service';

@Controller('webhooks/alchemy')
export class EvmWebhookController {
  private readonly logger = new Logger(EvmWebhookController.name);

  constructor(
    private configService: ConfigService,
    private evmWebhookService: EvmWebhookService,
  ) {}

  @Post('activity')
  @HttpCode(200)
  async handleActivity(
    @Body() payload: any,
    @Headers('x-alchemy-signature') signature: string,
  ) {
    const signingKey = this.configService.get<string>('ALCHEMY_WEBHOOK_SIGNING_KEY', '');

    if (signingKey) {
      const rawBody = JSON.stringify(payload);
      const expected = createHmac('sha256', signingKey).update(rawBody).digest('hex');
      if (signature !== expected) {
        this.logger.warn('Alchemy webhook signature mismatch — rejecting request');
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    const activities: any[] = payload?.event?.activity ?? [];
    this.logger.debug(`Alchemy webhook: ${activities.length} activity event(s)`);

    await this.evmWebhookService.handleActivities(activities);
    return { received: true };
  }
}
