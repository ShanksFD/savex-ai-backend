import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  Max,
} from "class-validator";

export class CreateTransactionDto {
  @IsString()
  @IsIn(["USDT", "USDC", "ETH"])
  paymentCurrency: string;

  @IsNumber()
  @Min(100)
  @Max(50000)
  usdAmount: number;

  @IsOptional()
  @IsString()
  promoCode?: string;
}
