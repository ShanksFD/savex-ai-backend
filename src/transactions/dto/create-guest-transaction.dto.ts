import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsEmail,
  Matches,
  MaxLength,
} from 'class-validator';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export class CreateGuestTransactionDto {
  @IsString()
  @IsIn(['USDT', 'USDC', 'ETH'])
  paymentCurrency: string;

  @IsNumber()
  usdAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string;

  // Connected Reown wallet — primary identity at purchase time.
  @IsString()
  @Matches(EVM_ADDRESS_REGEX, { message: 'walletAddress must be a valid EVM address' })
  walletAddress: string;

  // Optional pre-pay email. Captured purely for follow-up / pre-fill — does not
  // trigger any Zoho contact creation by itself; Zoho sync waits for verifyEmail.
  @IsOptional()
  @IsEmail()
  email?: string;
}
