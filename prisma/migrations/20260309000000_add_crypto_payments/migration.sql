-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'USED');

-- CreateEnum
CREATE TYPE "SweepStatus" AS ENUM ('PENDING', 'GAS_SENT', 'SWEEPING', 'COMPLETED', 'FAILED');

-- AlterEnum (add new values to SessionStatus)
ALTER TYPE "SessionStatus" ADD VALUE 'UNDERPAID';
ALTER TYPE "SessionStatus" ADD VALUE 'SWEEP_PENDING';
ALTER TYPE "SessionStatus" ADD VALUE 'SWEEPING';
ALTER TYPE "SessionStatus" ADD VALUE 'SETTLED';
ALTER TYPE "SessionStatus" ADD VALUE 'FAILED';

-- CreateTable: Quote
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "usdAmount" DECIMAL(65,30) NOT NULL,
    "asset" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'ethereum',
    "assetPriceUsd" DECIMAL(65,30) NOT NULL,
    "expectedAmount" TEXT NOT NULL,
    "expectedAmountBaseUnits" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DerivationCounter
CREATE TABLE "DerivationCounter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DerivationCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SweepOperation
CREATE TABLE "SweepOperation" (
    "id" TEXT NOT NULL,
    "paymentSessionId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amountBaseUnits" TEXT NOT NULL,
    "status" "SweepStatus" NOT NULL DEFAULT 'PENDING',
    "sweepTxHash" TEXT,
    "gasTopupTxHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SweepOperation_pkey" PRIMARY KEY ("id")
);

-- AlterTable: PaymentSession
-- Rename walletAddress to depositAddress
ALTER TABLE "PaymentSession" RENAME COLUMN "walletAddress" TO "depositAddress";

-- Change expectedAmount from DOUBLE PRECISION to DECIMAL
ALTER TABLE "PaymentSession" ALTER COLUMN "expectedAmount" SET DATA TYPE DECIMAL(65,30);

-- Add new columns
ALTER TABLE "PaymentSession" ADD COLUMN "quoteId" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "derivationIndex" INTEGER;
ALTER TABLE "PaymentSession" ADD COLUMN "asset" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "tokenContractAddress" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "expectedAmountBaseUnits" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "receivedAmountBaseUnits" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "paymentTxHash" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "confirmations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentSession" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "PaymentSession" ADD COLUMN "sweptAt" TIMESTAMP(3);
ALTER TABLE "PaymentSession" ADD COLUMN "creationBlockNumber" INTEGER;
ALTER TABLE "PaymentSession" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_transactionId_key" ON "Quote"("transactionId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SweepOperation" ADD CONSTRAINT "SweepOperation_paymentSessionId_fkey" FOREIGN KEY ("paymentSessionId") REFERENCES "PaymentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the DerivationCounter with initial row
INSERT INTO "DerivationCounter" ("id", "nextIndex") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING;
