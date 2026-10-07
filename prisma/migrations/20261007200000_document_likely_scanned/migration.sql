-- AlterTable
-- Additive only: existing rows default to false (no OCR suggestion).
ALTER TABLE "documents" ADD COLUMN "likely_scanned" BOOLEAN NOT NULL DEFAULT false;
