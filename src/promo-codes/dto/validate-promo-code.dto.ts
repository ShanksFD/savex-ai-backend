import { IsString, MaxLength } from 'class-validator';

export class ValidatePromoCodeDto {
  @IsString()
  @MaxLength(20)
  code: string;
}
