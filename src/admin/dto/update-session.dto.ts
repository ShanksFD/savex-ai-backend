import { IsOptional, IsString, IsInt, IsEnum, Min } from 'class-validator';
import { SessionStatus } from '@prisma/client';

export class UpdateSessionDto {
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;

  @IsOptional()
  @IsString()
  paymentTxHash?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  confirmations?: number;

  @IsOptional()
  @IsString()
  receivedAmountBaseUnits?: string;

  @IsOptional()
  metadata?: any;
}
