-- Migration: Drop house_nft_balance table
-- Reason: Community Fund NFTs are managed via virtual accounts, no need for separate house NFT balance tracking
-- Date: 2024

-- Drop the index first
DROP INDEX IF EXISTS idx_house_nft_balance_guild;

-- Drop the table
DROP TABLE IF EXISTS house_nft_balance;

