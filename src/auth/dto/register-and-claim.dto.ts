import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  Matches,
} from 'class-validator';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CLAIM_TOKEN_REGEX = /^[a-f0-9]{64}$/;

export class RegisterAndClaimDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // 32-byte hex token issued by POST /transactions/guest. Primary ownership proof.
  @IsString()
  @Matches(CLAIM_TOKEN_REGEX, { message: 'claimToken must be a 64-char hex string' })
  claimToken: string;

  // Wallet that paid. Must match the one stored on the guest session — used as
  // a secondary verification check on top of the claim token.
  @IsString()
  @Matches(EVM_ADDRESS_REGEX, { message: 'walletAddress must be a valid EVM address' })
  walletAddress: string;
}
