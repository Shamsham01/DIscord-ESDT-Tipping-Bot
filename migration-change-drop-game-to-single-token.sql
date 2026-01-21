-- Migration: Change DROP Game from multiple tokens to single token
-- Date: 2024
-- Description: Changes supported_tokens array to token_ticker single string
-- 
-- SAFE MIGRATION: This migration is safe for live/active games:
-- 1. Adds new column without removing old one (backward compatible)
-- 2. Migrates data from old column to new column
-- 3. Code handles both columns during transition period
-- 4. Old column can be dropped later after verification

-- Step 1: Add new column for single token ticker (safe - doesn't affect existing data)
ALTER TABLE drop_games 
ADD COLUMN IF NOT EXISTS token_ticker TEXT;

-- Step 2: Migrate existing data: take first token from array if exists
-- This is safe because:
-- - Only updates rows where token_ticker IS NULL (won't overwrite existing data)
-- - Preserves original supported_tokens array (still accessible)
-- - Active games will continue working with backward-compatible code
UPDATE drop_games 
SET token_ticker = (
  CASE 
    WHEN supported_tokens IS NOT NULL AND array_length(supported_tokens, 1) > 0 
    THEN supported_tokens[1]
    ELSE NULL
  END
)
WHERE token_ticker IS NULL 
  AND supported_tokens IS NOT NULL 
  AND array_length(supported_tokens, 1) > 0;

-- Step 3: Verify migration (optional - run this query to check)
-- SELECT guild_id, supported_tokens, token_ticker FROM drop_games WHERE status = 'ACTIVE';

-- Step 4: Drop the old column (ONLY after verifying migration worked correctly and code is deployed)
-- IMPORTANT: Uncomment this line ONLY after:
--   1. Verifying all active games have token_ticker populated
--   2. Deploying code that uses token_ticker
--   3. Confirming no errors in production
-- ALTER TABLE drop_games DROP COLUMN supported_tokens;
