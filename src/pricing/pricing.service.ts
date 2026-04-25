import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { parseEther, parseUnits } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';

export interface QuoteAmount {
  assetPriceUsd: string;
  expectedAmount: string;
  expectedAmountBaseUnits: string;
  tokenDecimals: number;
}

const MAX_PRICE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours — cron missed twice

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  readonly binanceUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.binanceUrl = this.configService.get<string>(
      'BINANCE_API_URL',
      'https://data-api.binance.vision',
    );
  }

  async getEthPriceUsd(): Promise<number> {
    const row = await this.prisma.tokenPrice.findUnique({ where: { symbol: 'ETH' } });

    if (row) {
      const ageMs = Date.now() - row.updatedAt.getTime();
      if (ageMs < MAX_PRICE_AGE_MS) {
        return Number(row.priceUsd);
      }
      this.logger.warn(`ETH price in DB is ${Math.round(ageMs / 60000)}m old, falling back to live fetch`);
    }

    return this.fetchAndStoreEthPrice();
  }

  async fetchAndStoreEthPrice(): Promise<number> {
    const url = `${this.binanceUrl}/api/v3/ticker/price?symbol=ETHUSDT`;
    const { data } = await axios.get(url, { timeout: 10_000 });
    const price = parseFloat(data?.price);

    if (!price || isNaN(price) || price <= 0) {
      throw new Error(`Invalid ETH price response: ${JSON.stringify(data)}`);
    }

    await this.prisma.tokenPrice.upsert({
      where: { symbol: 'ETH' },
      update: { priceUsd: price },
      create: { symbol: 'ETH', priceUsd: price },
    });

    this.logger.log(`ETH price stored: $${price}`);
    return price;
  }

  async getAssetPriceUsd(asset: string): Promise<number> {
    const upper = asset.toUpperCase();
    if (upper === 'ETH') {
      return this.getEthPriceUsd();
    }
    if (upper === 'USDT' || upper === 'USDC') {
      return 1.0;
    }
    throw new InternalServerErrorException(`Unsupported asset: ${asset}`);
  }

  async createQuoteAmount(usdAmount: number, asset: string): Promise<QuoteAmount> {
    const upper = asset.toUpperCase();
    const priceUsd = await this.getAssetPriceUsd(upper);

    if (upper === 'ETH') {
      const ethAmount = usdAmount / priceUsd;
      const ethString = ethAmount.toFixed(18);
      const weiString = parseEther(ethString).toString();

      return {
        assetPriceUsd: priceUsd.toString(),
        expectedAmount: ethString,
        expectedAmountBaseUnits: weiString,
        tokenDecimals: 18,
      };
    }

    const decimals = Number(
      upper === 'USDT'
        ? this.configService.get('USDT_DECIMALS', 6)
        : this.configService.get('USDC_DECIMALS', 6),
    );

    const tokenAmount = usdAmount / priceUsd;
    const tokenString = tokenAmount.toFixed(decimals);
    const baseUnits = parseUnits(tokenString, decimals).toString();

    return {
      assetPriceUsd: priceUsd.toString(),
      expectedAmount: tokenString,
      expectedAmountBaseUnits: baseUnits,
      tokenDecimals: decimals,
    };
  }
}
