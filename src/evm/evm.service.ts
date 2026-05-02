import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  JsonRpcProvider,
  HDNodeWallet,
  Mnemonic,
  Wallet,
  Contract,
  parseUnits,
  formatUnits,
} from 'ethers';
import { PaymentInfo, DerivedAddress } from './evm.interfaces';
import { getChainConfig, getAssetConfig } from './evm.config';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

@Injectable()
export class EvmPaymentService implements OnModuleInit {
  private readonly logger = new Logger(EvmPaymentService.name);
  private provider: JsonRpcProvider;
  private hdNode: HDNodeWallet;
  private gasFundWallet: Wallet;
  private treasuryAddress: string;
  private derivationPath: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const chainConfig = getChainConfig(this.configService);
    if (!chainConfig.rpcUrl) {
      this.logger.warn('ALCHEMY_RPC_URL not configured -- EVM service will not function');
      return;
    }

    this.provider = new JsonRpcProvider(chainConfig.rpcUrl);
    this.treasuryAddress = chainConfig.treasuryAddress;
    this.derivationPath = this.configService.get<string>(
      'HD_DERIVATION_PATH',
      "m/44'/60'/0'/0",
    );

    const mnemonic = this.configService.get<string>('HD_MASTER_MNEMONIC', '');
    if (mnemonic) {
      this.hdNode = HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(mnemonic),
        this.derivationPath,
      );
    }

    const gasFundKey = this.configService.get<string>('GAS_FUND_PRIVATE_KEY', '');
    if (gasFundKey && gasFundKey !== '0x' + '0'.repeat(64)) {
      this.gasFundWallet = new Wallet(gasFundKey, this.provider);
    }

    this.logger.log(
      `EVM service initialized for ${chainConfig.network} (chainId: ${chainConfig.chainId})`,
    );
  }

  deriveDepositAddress(index: number): DerivedAddress {
    if (!this.hdNode) {
      throw new Error('HD wallet not configured');
    }
    const child = this.hdNode.deriveChild(index);
    return { address: child.address, index };
  }

  private getSignerForIndex(index: number): Wallet {
    if (!this.hdNode) throw new Error('HD wallet not configured');
    const child = this.hdNode.deriveChild(index);
    return new Wallet(child.privateKey, this.provider);
  }

  async getCurrentBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async checkNativePayment(
    address: string,
    fromBlock: number,
    latestBlock?: number,
  ): Promise<PaymentInfo | null> {
    try {
      // Quick signal: if balance is zero, no payment received
      const balance = await this.provider.getBalance(address);
      if (balance === 0n) return null;

      if (latestBlock === undefined) latestBlock = await this.provider.getBlockNumber();
      // Limit scan to last 200 blocks (~40 min on Ethereum) to avoid excessive RPC calls
      const startBlock = Math.max(fromBlock, latestBlock - 200);

      for (let blockNum = latestBlock; blockNum >= startBlock; blockNum--) {
        const block = await this.provider.getBlock(blockNum, true);
        if (!block || !block.prefetchedTransactions) continue;

        for (const tx of block.prefetchedTransactions) {
          if (tx.to?.toLowerCase() === address.toLowerCase() && tx.value > 0n) {
            const confirmations = latestBlock - blockNum;
            return {
              txHash: tx.hash,
              from: tx.from,
              amountBaseUnits: tx.value.toString(),
              blockNumber: blockNum,
              confirmations,
            };
          }
        }
      }

      // Balance > 0 but tx not found in recent blocks -- return balance-based info
      // This handles the case where the tx was mined before our scan window
      this.logger.warn(
        `Balance detected at ${address} (${balance.toString()} wei) but no tx found in last 200 blocks`,
      );
      return null;
    } catch (error) {
      this.logger.error(`checkNativePayment failed for ${address}: ${error.message}`);
      Sentry.captureException(error, { tags: { method: 'checkNativePayment', address } });
      return null;
    }
  }

  async checkTokenPayment(
    address: string,
    tokenContractAddress: string,
    fromBlock: number,
    latestBlock?: number,
  ): Promise<PaymentInfo | null> {
    const MAX_BLOCK_RANGE = 2000;

    try {
      const contract = new Contract(tokenContractAddress, ERC20_ABI, this.provider);
      const filter = contract.filters.Transfer(null, address);
      if (latestBlock === undefined) latestBlock = await this.provider.getBlockNumber();
      const startBlock = Math.max(fromBlock, latestBlock - 5000);

      // Chunk queries into windows of MAX_BLOCK_RANGE blocks (Alchemy free tier limit)
      const allEvents: any[] = [];

      for (let from = startBlock; from <= latestBlock; from += MAX_BLOCK_RANGE) {
        const to = Math.min(from + MAX_BLOCK_RANGE - 1, latestBlock);
        this.logger.debug(`Scanning token Transfer events: blocks ${from}–${to}`);

        const chunkEvents = await contract.queryFilter(filter, from, to);
        allEvents.push(...chunkEvents);
      }

      if (allEvents.length === 0) return null;

      // Sort by blockNumber, then logIndex for deterministic ordering
      allEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.index ?? 0) - (b.index ?? 0);
      });

      const lastEvent = allEvents[allEvents.length - 1];
      const txReceipt = await lastEvent.getTransactionReceipt();
      const confirmations = latestBlock - lastEvent.blockNumber;

      const decoded = contract.interface.decodeEventLog(
        'Transfer',
        lastEvent.data,
        lastEvent.topics,
      );
      const amount: bigint = decoded[2];

      return {
        txHash: txReceipt.hash,
        from: decoded[0] as string,
        amountBaseUnits: amount.toString(),
        blockNumber: lastEvent.blockNumber,
        confirmations,
      };
    } catch (error) {
      this.logger.error(
        `checkTokenPayment failed for ${address} / ${tokenContractAddress}: ${error.message}`,
      );
      Sentry.captureException(error, { tags: { method: 'checkTokenPayment', address, tokenContractAddress } });
      return null;
    }
  }

  /**
   * Returns the number of confirmations for a tx.
   * Returns -1 if the tx was mined but REVERTED (receipt.status === 0).
   * Returns 0 if the tx is still pending or not found.
   */
  async getConfirmations(txHash: string): Promise<number> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.blockNumber === null) return 0;
      if (receipt.status === 0) {
        this.logger.warn(`Transaction ${txHash} was mined but reverted (status=0)`);
        return -1;
      }
      const latestBlock = await this.provider.getBlockNumber();
      return latestBlock - receipt.blockNumber;
    } catch (error) {
      this.logger.error(`getConfirmations failed for ${txHash}: ${error.message}`);
      Sentry.captureException(error, { tags: { method: 'getConfirmations', txHash } });
      return 0;
    }
  }

  async sweepNative(fromIndex: number, toAddress: string): Promise<string> {
    try {
      const signer = this.getSignerForIndex(fromIndex);
      const balance = await this.provider.getBalance(signer.address);

      const gasPrice = (await this.provider.getFeeData()).gasPrice ?? parseUnits('20', 'gwei');
      const gasLimit = 21000n;
      const gasCost = gasPrice * gasLimit;

      const sweepAmount = balance - gasCost;
      if (sweepAmount <= 0n) {
        throw new Error(
          `Insufficient balance to sweep: balance=${formatUnits(balance, 18)} ETH, gasCost=${formatUnits(gasCost, 18)} ETH`,
        );
      }

      this.logger.log(
        `Sweeping ${formatUnits(sweepAmount, 18)} ETH from ${signer.address} to ${toAddress}`,
      );

      const tx = await signer.sendTransaction({
        to: toAddress,
        value: sweepAmount,
        gasLimit,
        gasPrice,
      });

      this.logger.log(`Sweep ETH tx sent: ${tx.hash}`);
      return tx.hash;
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'sweepNative', fromIndex, toAddress } });
      throw error;
    }
  }

  async sweepToken(
    fromIndex: number,
    tokenContractAddress: string,
    toAddress: string,
  ): Promise<string> {
    try {
      const signer = this.getSignerForIndex(fromIndex);
      const contract = new Contract(tokenContractAddress, ERC20_ABI, signer);
      const balance: bigint = await contract.balanceOf(signer.address);

      if (balance === 0n) {
        throw new Error(`No token balance to sweep at ${signer.address}`);
      }

      const assetConfig = getAssetConfig(
        tokenContractAddress === this.configService.get('USDT_CONTRACT_ADDRESS') ? 'USDT' : 'USDC',
        this.configService,
      );
      this.logger.log(
        `Sweeping ${formatUnits(balance, assetConfig.decimals)} ${assetConfig.symbol} from ${signer.address} to ${toAddress}`,
      );

      const tx = await contract.transfer(toAddress, balance);
      this.logger.log(`Sweep token tx sent: ${tx.hash}`);
      return tx.hash;
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'sweepToken', fromIndex, tokenContractAddress, toAddress } });
      throw error;
    }
  }

  async topUpGas(toAddress: string, amountWei?: string): Promise<string> {
    try {
      if (!this.gasFundWallet) {
        throw new Error('Gas fund wallet not configured');
      }

      const amount = amountWei
        ? BigInt(amountWei)
        : BigInt(this.configService.get<string>('GAS_TOPUP_AMOUNT_WEI', '500000000000000'));

      this.logger.log(
        `Topping up ${formatUnits(amount, 18)} ETH to ${toAddress} from gas fund`,
      );

      const tx = await this.gasFundWallet.sendTransaction({
        to: toAddress,
        value: amount,
      });

      this.logger.log(`Gas topup tx sent: ${tx.hash}`);
      return tx.hash;
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'topUpGas', toAddress } });
      throw error;
    }
  }

  async getBalance(address: string): Promise<bigint> {
    try {
      return await this.provider.getBalance(address);
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'getBalance', address } });
      throw error;
    }
  }

  getAssetConfig(asset: string) {
    return getAssetConfig(asset, this.configService);
  }
}
