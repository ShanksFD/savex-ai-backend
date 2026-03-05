import { Module } from '@nestjs/common';
import { PaymentSessionsService } from './payment-sessions.service';
import { PaymentSessionsController } from './payment-sessions.controller';
import { PaymentSessionsCron } from './payment-sessions.cron';

@Module({
  controllers: [PaymentSessionsController],
  providers: [PaymentSessionsService, PaymentSessionsCron],
  exports: [PaymentSessionsService],
})
export class PaymentSessionsModule {}
