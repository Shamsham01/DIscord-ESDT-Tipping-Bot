-- Alternative Migration: Repurpose existing columns instead of adding new ones
-- WARNING: This approach has trade-offs and requires code changes
-- 
-- This migration:
-- 1. Uses project_name to infer source (NULL = virtual_account, value = project_wallet)
-- 2. Stores full token identifier in token_ticker (breaking existing display)
-- 3. Adds only seller_id column (still needed)

-- Step 1: Add only seller_id column (still needed)
ALTER TABLE auctions 
ADD COLUMN IF NOT EXISTS seller_id TEXT;

CREATE INDEX IF NOT EXISTS idx_auctions_seller ON auctions(guild_id, seller_id) WHERE seller_id IS NOT NULL;

-- Step 2: Update existing token_ticker values to full identifiers if they're not already
-- This is a data migration - you'll need to update existing records manually
-- Example: UPDATE auctions SET token_ticker = 'REWARD-cf6eac' WHERE token_ticker = 'REWARD';

-- Note: This approach requires code changes to:
-- - Infer source from project_name (NULL check)
-- - Extract ticker from token_ticker (split by '-')
-- - Handle backward compatibility with existing data

