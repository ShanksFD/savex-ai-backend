import { IsEnum, IsOptional } from "class-validator";
import { InvestmentStyle } from "@prisma/client";

export class UpdateMeDto {
  @IsOptional()
  @IsEnum(InvestmentStyle)
  investmentStyle?: InvestmentStyle;
}
