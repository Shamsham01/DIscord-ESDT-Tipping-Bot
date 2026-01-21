-- Migration: Change DROP Game from multiple tokens to single token
-- Date: 2024
-- Description: Changes supported_tokens array to token_ticker single string

-- Add new column for single token ticker
ALTER TABLE drop_games 
ADD COLUMN IF NOT EXISTS token_ticker TEXT;

-- Migrate existing data: take first token from array if exists
UPDATE drop_games 
SET token_ticker = (
  CASE 
    WHEN supported_tokens IS NOT NULL AND array_length(supported_tokens, 1) > 0 
    THEN supported_tokens[1]
    ELSE NULL
  END
)
WHERE token_ticker IS NULL;

-- Drop the old column (after verifying data migration)
-- ALTER TABLE drop_games DROP COLUMN supported_tokens;

-- Note: Uncomment the DROP COLUMN line above after verifying the migration worked correctly
