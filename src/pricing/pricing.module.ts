import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingCron } from './pricing.cron';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PricingService, PricingCron],
  exports: [PricingService],
})
export class PricingModule {}
