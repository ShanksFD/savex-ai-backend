import { Module } from '@nestjs/common';
import { AdminSweepsController } from './admin-sweeps.controller';
import { AdminSweepsService } from './admin-sweeps.service';
import { AdminPaymentSessionsController } from './admin-payment-sessions.controller';
import { AdminPaymentSessionsService } from './admin-payment-sessions.service';
import { AdminPresaleController } from './admin-presale.controller';
import { AdminPresaleService } from './admin-presale.service';

@Module({
  controllers: [
    AdminSweepsController,
    AdminPaymentSessionsController,
    AdminPresaleController,
  ],
  providers: [
    AdminSweepsService,
    AdminPaymentSessionsService,
    AdminPresaleService,
  ],
})
export class AdminModule {}
