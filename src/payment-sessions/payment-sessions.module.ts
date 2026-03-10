import { Module } from '@nestjs/common';
import { PaymentSessionsService } from './payment-sessions.service';
import { PaymentSessionsController } from './payment-sessions.controller';
import { PaymentSessionsCron } from './payment-sessions.cron';
import { EvmModule } from '../evm/evm.module';
import { QuotesModule } from '../quotes/quotes.module';

@Module({
  imports: [EvmModule, QuotesModule],
  controllers: [PaymentSessionsController],
  providers: [PaymentSessionsService, PaymentSessionsCron],
  exports: [PaymentSessionsService],
})
export class PaymentSessionsModule {}
