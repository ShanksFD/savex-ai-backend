import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { parseEther, parseUnits } from 'ethers';

export interface QuoteAmount {
  assetPriceUsd: string;
  expectedAmount: string;
  expectedAmountBaseUnits: string;
  tokenDecimals: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private ethPriceCache: { price: number; fetchedAt: number } | null = null;
  private readonly cacheTtlMs = 30_000;

  private readonly coingeckoUrl: string;

  constructor(private configService: ConfigService) {
    this.coingeckoUrl = this.configService.get<string>(
      'COINGECKO_API_URL',
      'https://api.coingecko.com/api/v3',
    );
  }

  async getEthPriceUsd(): Promise<number> {
    const now = Date.now();
    if (this.ethPriceCache && now - this.ethPriceCache.fetchedAt < this.cacheTtlMs) {
      return this.ethPriceCache.price;
    }

    try {
      const url = `${this.coingeckoUrl}/simple/price?ids=ethereum&vs_currencies=usd`;
      const { data } = await axios.get(url, { timeout: 10_000 });
      const price = data?.ethereum?.usd;

      if (!price || typeof price !== 'number' || price <= 0) {
        throw new Error(`Invalid ETH price response: ${JSON.stringify(data)}`);
      }

      this.ethPriceCache = { price, fetchedAt: now };
      this.logger.log(`ETH price fetched: $${price}`);
      return price;
    } catch (error) {
      if (this.ethPriceCache) {
        this.logger.warn(
          `CoinGecko fetch failed, using stale price: $${this.ethPriceCache.price}`,
        );
        return this.ethPriceCache.price;
      }
      this.logger.error(`CoinGecko fetch failed with no cached price: ${error.message}`);
      throw new InternalServerErrorException('Unable to fetch ETH price');
    }
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
