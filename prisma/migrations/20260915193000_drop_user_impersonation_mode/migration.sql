-- Remove USER from ImpersonationMode.
--
-- Written by hand rather than generated. `prisma migrate dev --create-only`
-- refuses to run non-interactively when a migration carries a warning, and
-- dropping an enum value is one; hand-writing it also puts the backfill in the
-- right place, which a generated migration would not have done.
--
-- Postgres cannot remove a value from an enum, so the type is recreated. Any row
-- still holding USER has to be moved off it BEFORE the cast, or the ALTER fails
-- on a value the new type does not contain. USER always meant the same thing as
-- SELF in practice -- "restrict me to my own documents" -- so SELF is where
-- those rows belong, and it is also the safe direction: the alternative, ADMIN,
-- would silently hand someone full access during a migration.
--
-- Production held no USER rows when this was written (all five users were SELF),
-- so the UPDATE is expected to affect nothing. It is here because "expected to"
-- is not "guaranteed to", and a failed cast mid-deploy is a bad way to find out.

UPDATE "users"
SET "current_impersonation_mode" = 'SELF'
WHERE "current_impersonation_mode" = 'USER';

ALTER TYPE "ImpersonationMode" RENAME TO "ImpersonationMode_old";

CREATE TYPE "ImpersonationMode" AS ENUM ('SELF', 'ADMIN');

-- The default has to go before the type changes and come back after: a default
-- of the old type cannot be cast in place.
ALTER TABLE "users" ALTER COLUMN "current_impersonation_mode" DROP DEFAULT;

ALTER TABLE "users"
  ALTER COLUMN "current_impersonation_mode" TYPE "ImpersonationMode"
  USING ("current_impersonation_mode"::text::"ImpersonationMode");

ALTER TABLE "users"
  ALTER COLUMN "current_impersonation_mode" SET DEFAULT 'SELF';

DROP TYPE "ImpersonationMode_old";
