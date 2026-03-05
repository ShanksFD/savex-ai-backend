-- RenameEnum
ALTER TYPE "PurchaseStatus" RENAME TO "TransactionStatus";

-- RenameTable
ALTER TABLE "Purchase" RENAME TO "Transaction";

-- RenameForeignKey
ALTER TABLE "Transaction" RENAME CONSTRAINT "Purchase_pkey" TO "Transaction_pkey";
ALTER TABLE "Transaction" RENAME CONSTRAINT "Purchase_userId_fkey" TO "Transaction_userId_fkey";
ALTER TABLE "Transaction" RENAME CONSTRAINT "Purchase_stageId_fkey" TO "Transaction_stageId_fkey";
ALTER TABLE "Transaction" RENAME CONSTRAINT "Purchase_promoCodeId_fkey" TO "Transaction_promoCodeId_fkey";

-- UpdateForeignKeyReference (PaymentSession still references the table via purchaseId column)
ALTER TABLE "PaymentSession" DROP CONSTRAINT "PaymentSession_purchaseId_fkey";
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
