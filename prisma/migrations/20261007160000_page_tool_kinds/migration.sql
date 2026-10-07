-- AlterEnum
-- Additive only: new job kinds for PDF/UA, compress, flatten and rotate.
-- PostgreSQL 12+ allows several ADD VALUE statements in one migration.

ALTER TYPE "DocumentJobKind" ADD VALUE 'PDFUA';
ALTER TYPE "DocumentJobKind" ADD VALUE 'COMPRESS';
ALTER TYPE "DocumentJobKind" ADD VALUE 'FLATTEN';
ALTER TYPE "DocumentJobKind" ADD VALUE 'ROTATE';
