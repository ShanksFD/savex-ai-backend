-- CreateTable
CREATE TABLE "TokenPrice" (
    "symbol" TEXT NOT NULL,
    "priceUsd" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenPrice_pkey" PRIMARY KEY ("symbol")
);
