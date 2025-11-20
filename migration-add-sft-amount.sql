-- Migration: Add amount column to virtual_account_nft_balances for SFT support
-- Date: 2024-01-XX
-- Description: Adds amount column to support Semi-Fungible Tokens (SFTs) with aggregated amounts

-- Add amount column with default value 1 (for existing NFTs)
ALTER TABLE virtual_account_nft_balances 
ADD COLUMN IF NOT EXISTS amount BIGINT DEFAULT 1 NOT NULL;

-- Set existing records to amount = 1 (all current NFTs are unique)
UPDATE virtual_account_nft_balances 
SET amount = 1 
WHERE amount IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN virtual_account_nft_balances.amount IS 'Amount/quantity for SFTs. Default is 1 for NFTs.';

-- Add token_type column to track NFT vs SFT definitively
ALTER TABLE virtual_account_nft_balances 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT' CHECK (token_type IN ('NFT', 'SFT'));

-- Update existing records (all are NFTs)
UPDATE virtual_account_nft_balances 
SET token_type = 'NFT' 
WHERE token_type IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN virtual_account_nft_balances.token_type IS 'Token type: NFT or SFT. Used for reliable detection.';

-- Add amount column to nft_listings table for SFT support
ALTER TABLE nft_listings 
ADD COLUMN IF NOT EXISTS amount BIGINT DEFAULT 1 NOT NULL;

-- Set existing listings to amount = 1
UPDATE nft_listings 
SET amount = 1 
WHERE amount IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN nft_listings.amount IS 'Amount/quantity for SFT listings. Default is 1 for NFT listings.';

-- Add token_type column to nft_listings table
ALTER TABLE nft_listings 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT' CHECK (token_type IN ('NFT', 'SFT'));

-- Update existing listings (all are NFTs)
UPDATE nft_listings 
SET token_type = 'NFT' 
WHERE token_type IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN nft_listings.token_type IS 'Token type: NFT or SFT. Used for reliable detection.';

-- Add amount column to auctions table for SFT support
ALTER TABLE auctions 
ADD COLUMN IF NOT EXISTS amount BIGINT DEFAULT 1 NOT NULL;

-- Set existing auctions to amount = 1
UPDATE auctions 
SET amount = 1 
WHERE amount IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN auctions.amount IS 'Amount/quantity for SFT auctions. Default is 1 for NFT auctions.';

-- Add token_type column to auctions table
ALTER TABLE auctions 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT' CHECK (token_type IN ('NFT', 'SFT'));

-- Update existing auctions (all are NFTs)
UPDATE auctions 
SET token_type = 'NFT' 
WHERE token_type IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN auctions.token_type IS 'Token type: NFT or SFT. Used for reliable detection.';

