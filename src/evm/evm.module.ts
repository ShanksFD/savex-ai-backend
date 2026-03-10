import { Module } from '@nestjs/common';
import { EvmPaymentService } from './evm.service';

@Module({
  providers: [EvmPaymentService],
  exports: [EvmPaymentService],
})
export class EvmModule {}
