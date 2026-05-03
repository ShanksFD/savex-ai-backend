import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  @IsIn(['USDT', 'USDC', 'ETH'])
  paymentCurrency: string;

  @IsNumber()
  usdAmount: number;

  @IsOptional()
  @IsString()
  promoCode?: string;
}
