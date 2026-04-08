-- CreateEnum
CREATE TYPE "InvestmentStyle" AS ENUM ('SAFE', 'GROWTH', 'EXPLORE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "investmentStyle" "InvestmentStyle" NOT NULL DEFAULT 'GROWTH';
