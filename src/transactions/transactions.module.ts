import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PresaleModule } from '../presale/presale.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { QuotesModule } from '../quotes/quotes.module';
import { EvmModule } from '../evm/evm.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PresaleModule, PromoCodesModule, QuotesModule, EvmModule, SettingsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
