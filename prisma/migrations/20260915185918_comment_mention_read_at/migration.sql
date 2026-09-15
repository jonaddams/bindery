-- AlterTable
ALTER TABLE "comment_mentions" ADD COLUMN     "read_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "comment_mentions_mentioned_user_id_read_at_idx" ON "comment_mentions"("mentioned_user_id", "read_at");
