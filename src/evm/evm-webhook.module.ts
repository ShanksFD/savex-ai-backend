import { Module } from '@nestjs/common';
import { EvmWebhookController } from './evm-webhook.controller';
import { EvmWebhookService } from './evm-webhook.service';
import { EvmModule } from './evm.module';
import { PaymentSessionsModule } from '../payment-sessions/payment-sessions.module';

@Module({
  imports: [EvmModule, PaymentSessionsModule],
  controllers: [EvmWebhookController],
  providers: [EvmWebhookService],
})
export class EvmWebhookModule {}
