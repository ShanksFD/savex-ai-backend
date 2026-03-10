import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { QuotesService } from './quotes.service';

@Module({
  imports: [PricingModule],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
