-- Guest purchase sessions: allow PaymentSession / Transaction / Quote to exist without a User
-- until the buyer completes registration via the post-payment claim flow.

-- 1. Drop existing FK constraints that enforce NOT NULL userId at the DB level.
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_userId_fkey";
ALTER TABLE "PaymentSession" DROP CONSTRAINT IF EXISTS "PaymentSession_userId_fkey";
ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_userId_fkey";

-- 2. Make userId nullable on the three tables.
ALTER TABLE "Transaction" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PaymentSession" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "userId" DROP NOT NULL;

-- 3. Re-add the FKs with SET NULL on delete (user removal should not orphan-cascade-delete
--    historical transactions; existing behavior was RESTRICT so a delete would simply fail).
--    We keep RESTRICT semantics to preserve historical guarantees: a User row cannot be
--    deleted while it still owns transactions/sessions/quotes.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentSession"
  ADD CONSTRAINT "PaymentSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Add guest-flow columns to PaymentSession.
--    - walletAddress: connected Reown wallet at purchase time (lowercase hex).
--    - guestEmail: optional pre-pay email (used only for follow-up / pre-fill).
--    - claimToken: 32-byte opaque token (hex). Primary ownership proof for guest sessions.
--    - claimedAt: non-null once the session has been linked to a registered userId.
--    - zohoSyncedAt: marks that markSettled / verifyEmail has already pushed to Zoho,
--      so the verification-time backfill never double-fires for a given session.
ALTER TABLE "PaymentSession" ADD COLUMN "walletAddress" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "guestEmail" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "PaymentSession" ADD COLUMN "zohoSyncedAt" TIMESTAMP(3);

-- 5. Unique constraint on claimToken (also serves as the lookup index).
CREATE UNIQUE INDEX "PaymentSession_claimToken_key" ON "PaymentSession"("claimToken");
CREATE INDEX "PaymentSession_walletAddress_idx" ON "PaymentSession"("walletAddress");
