import { ConfigService } from '@nestjs/config';
import { AssetConfig, ChainConfig } from './evm.interfaces';

export function getChainConfig(configService: ConfigService): ChainConfig {
  return {
    chainId: configService.get<number>('CHAIN_ID', 11155111),
    network: configService.get<string>('NETWORK', 'sepolia'),
    rpcUrl: configService.get<string>('ALCHEMY_RPC_URL', ''),
    treasuryAddress: configService.get<string>('TREASURY_ADDRESS', ''),
    gasFundAddress: configService.get<string>('GAS_FUND_ADDRESS', ''),
  };
}

export function getAssetConfig(
  asset: string,
  configService: ConfigService,
): AssetConfig {
  const upper = asset.toUpperCase();

  switch (upper) {
    case 'ETH':
      return {
        symbol: 'ETH',
        contractAddress: null,
        decimals: 18,
        isNative: true,
        minConfirmations: Number(configService.get<number>('MIN_CONFIRMATIONS_ETH', 2)),
      };
    case 'USDT':
      return {
        symbol: 'USDT',
        contractAddress: configService.get<string>('USDT_CONTRACT_ADDRESS', ''),
        decimals: Number(configService.get('USDT_DECIMALS', 6)),
        isNative: false,
        minConfirmations: Number(configService.get<number>('MIN_CONFIRMATIONS_ERC20', 2)),
      };
    case 'USDC':
      return {
        symbol: 'USDC',
        contractAddress: configService.get<string>('USDC_CONTRACT_ADDRESS', ''),
        decimals: Number(configService.get('USDC_DECIMALS', 6)),
        isNative: false,
        minConfirmations: Number(configService.get<number>('MIN_CONFIRMATIONS_ERC20', 2)),
      };
    default:
      throw new Error(`Unsupported asset: ${asset}`);
  }
}
