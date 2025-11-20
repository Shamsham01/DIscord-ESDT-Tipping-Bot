-- Migration: Add buyer_id column to nft_listings table
-- Date: 2024-01-XX
-- Description: Adds buyer_id column to track who purchased each listing

-- Add buyer_id column (nullable for historical listings)
ALTER TABLE nft_listings 
ADD COLUMN IF NOT EXISTS buyer_id TEXT;

-- Add index for buyer queries
CREATE INDEX IF NOT EXISTS idx_nft_listings_buyer ON nft_listings(guild_id, buyer_id) WHERE buyer_id IS NOT NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN nft_listings.buyer_id IS 'Discord user ID of the buyer. NULL for listings that have not been sold yet.';

