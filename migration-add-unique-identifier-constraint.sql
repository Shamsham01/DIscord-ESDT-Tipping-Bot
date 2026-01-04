-- Migration: Add unique constraint on (guild_id, user_id, identifier) to prevent duplicate NFT identifiers
-- 
-- IMPORTANT: This migration will fail if there are existing duplicate identifiers in the database.
-- Before running this migration, you must clean up any duplicate identifiers.
-- 
-- To find duplicates, run:
-- SELECT guild_id, user_id, identifier, COUNT(*) as count
-- FROM virtual_account_nft_balances
-- GROUP BY guild_id, user_id, identifier
-- HAVING COUNT(*) > 1;
--
-- To clean up duplicates (keeps the first record, removes others):
-- DELETE FROM virtual_account_nft_balances
-- WHERE id NOT IN (
--   SELECT DISTINCT ON (guild_id, user_id, identifier) id
--   FROM virtual_account_nft_balances
--   ORDER BY guild_id, user_id, identifier, created_at ASC
-- );

-- Add unique constraint on (guild_id, user_id, identifier)
-- This ensures each NFT identifier can only appear once per user per guild
ALTER TABLE virtual_account_nft_balances
ADD CONSTRAINT unique_guild_user_identifier UNIQUE (guild_id, user_id, identifier);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT unique_guild_user_identifier ON virtual_account_nft_balances IS 
'Ensures each NFT identifier is unique per user per guild, preventing duplicate NFT entries even if collection/nonce extraction is inconsistent.';

