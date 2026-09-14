-- CreateEnum
CREATE TYPE "DocumentJobKind" AS ENUM ('REDACTION');

-- CreateEnum
CREATE TYPE "DocumentJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "derived_from_id" TEXT;

-- CreateTable
CREATE TABLE "document_jobs" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "kind" "DocumentJobKind" NOT NULL,
    "status" "DocumentJobStatus" NOT NULL DEFAULT 'PENDING',
    "parameters" JSONB NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "output_document_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_jobs_output_document_id_key" ON "document_jobs"("output_document_id");

-- CreateIndex
CREATE INDEX "document_jobs_status_created_at_idx" ON "document_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "document_jobs_document_id_idx" ON "document_jobs"("document_id");

-- CreateIndex
CREATE INDEX "documents_derived_from_id_idx" ON "documents"("derived_from_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_derived_from_id_fkey" FOREIGN KEY ("derived_from_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_jobs" ADD CONSTRAINT "document_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_jobs" ADD CONSTRAINT "document_jobs_output_document_id_fkey" FOREIGN KEY ("output_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
