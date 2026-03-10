-- Add retryCount to SweepOperation to cap infinite retry loops on pre-broadcast failures
ALTER TABLE "SweepOperation" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
