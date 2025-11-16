-- Simplified Migration: Only add seller_id column
-- Repurpose existing columns:
-- - project_name: NULL = virtual_account, has value = project_wallet (source is inferred)
-- - token_ticker: stores full token identifier (e.g., "REWARD-cf6eac")

ALTER TABLE auctions 
ADD COLUMN IF NOT EXISTS seller_id TEXT;

CREATE INDEX IF NOT EXISTS idx_auctions_seller ON auctions(guild_id, seller_id) WHERE seller_id IS NOT NULL;

-- Note: No need to add source or token_identifier columns - they're inferred/repurposed

