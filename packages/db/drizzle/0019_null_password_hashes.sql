-- Password sign-in was removed (magic link and native PKCE only). Nothing reads
-- password_hash any more; clear it. The column is dropped in a later release.
UPDATE "users" SET "password_hash" = NULL WHERE "password_hash" IS NOT NULL;
