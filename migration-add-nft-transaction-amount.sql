-- Migration: Add amount column to virtual_account_nft_transactions table
-- This is needed to track the number of SFTs transferred in each transaction
-- Date: 2025-01-20

-- Add amount column (defaults to 1 for existing records, which are NFTs)
ALTER TABLE virtual_account_nft_transactions 
ADD COLUMN IF NOT EXISTS amount INTEGER DEFAULT 1;

-- Add comment explaining the column
COMMENT ON COLUMN virtual_account_nft_transactions.amount IS 'Amount of tokens transferred (1 for NFTs, >1 for SFTs)';

