import { IsNumber, Min } from 'class-validator';

export class UpdatePaymentLimitsDto {
  @IsNumber()
  @Min(1)
  minPayment: number;

  @IsNumber()
  @Min(1)
  maxPayment: number;
}
