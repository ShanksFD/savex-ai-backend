import { IsString, IsIn } from "class-validator";

export class UpdateTransactionStatusDto {
  @IsString()
  @IsIn(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"])
  status: string;
}
