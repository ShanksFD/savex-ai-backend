export interface PaymentInfo {
  txHash: string;
  from: string;
  amountBaseUnits: string;
  blockNumber: number;
  confirmations: number;
}

export interface DerivedAddress {
  address: string;
  index: number;
}

export interface AssetConfig {
  symbol: string;
  contractAddress: string | null;
  decimals: number;
  isNative: boolean;
  minConfirmations: number;
}

export interface ChainConfig {
  chainId: number;
  network: string;
  rpcUrl: string;
  treasuryAddress: string;
  gasFundAddress: string;
}
