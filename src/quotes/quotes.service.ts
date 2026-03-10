import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { QuoteStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private prisma: PrismaService,
    private pricingService: PricingService,
    private configService: ConfigService,
  ) {}

  async createQuote(
    userId: string,
    params: { usdAmount: number; asset: string; chain?: string },
  ) {
    const { usdAmount, asset, chain = 'ethereum' } = params;

    const quoteAmount = await this.pricingService.createQuoteAmount(usdAmount, asset);

    const durationMinutes = this.configService.get<number>(
      'PAYMENT_QUOTE_DURATION_MINUTES',
      15,
    );
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    const quote = await this.prisma.quote.create({
      data: {
        userId,
        usdAmount: new Prisma.Decimal(usdAmount),
        asset: asset.toUpperCase(),
        chain,
        assetPriceUsd: new Prisma.Decimal(quoteAmount.assetPriceUsd),
        expectedAmount: quoteAmount.expectedAmount,
        expectedAmountBaseUnits: quoteAmount.expectedAmountBaseUnits,
        tokenDecimals: quoteAmount.tokenDecimals,
        expiresAt,
        status: QuoteStatus.ACTIVE,
      },
    });

    this.logger.log(
      `Quote created: id=${quote.id} asset=${asset} usd=${usdAmount} expected=${quoteAmount.expectedAmount} baseUnits=${quoteAmount.expectedAmountBaseUnits}`,
    );

    return quote;
  }

  async markUsed(
    quoteId: string,
    transactionId: string,
    txClient: Prisma.TransactionClient,
  ) {
    const quote = await txClient.quote.findUnique({ where: { id: quoteId } });

    if (!quote) {
      throw new NotFoundException(`Quote ${quoteId} not found`);
    }
    if (quote.status !== QuoteStatus.ACTIVE) {
      throw new BadRequestException(`Quote ${quoteId} is not active (status: ${quote.status})`);
    }
    if (new Date() > quote.expiresAt) {
      throw new BadRequestException(`Quote ${quoteId} has expired`);
    }

    return txClient.quote.update({
      where: { id: quoteId },
      data: {
        status: QuoteStatus.USED,
        transactionId,
      },
    });
  }

  async expireQuotes(): Promise<number> {
    const result = await this.prisma.quote.updateMany({
      where: {
        status: QuoteStatus.ACTIVE,
        expiresAt: { lt: new Date() },
      },
      data: { status: QuoteStatus.EXPIRED },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} quote(s)`);
    }

    return result.count;
  }

  async findOne(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote) {
      throw new NotFoundException(`Quote ${quoteId} not found`);
    }
    return quote;
  }
}
