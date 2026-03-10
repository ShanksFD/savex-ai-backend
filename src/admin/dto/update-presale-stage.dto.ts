import { IsOptional, IsNumber, Min } from 'class-validator';

export class UpdatePresaleStageDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  target?: number;
}
