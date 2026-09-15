-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "last_swept_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "documents_last_swept_at_idx" ON "documents"("last_swept_at");
