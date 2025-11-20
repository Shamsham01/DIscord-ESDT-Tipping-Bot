-- Migration: Add token_type column to virtual_account_nft_transactions table
-- This stores explicit NFT vs SFT classification, not inferred from amount
-- Date: 2025-01-20

-- Add token_type column (defaults to 'NFT' for existing records)
ALTER TABLE virtual_account_nft_transactions 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT';

-- Add constraint to ensure only valid values
ALTER TABLE virtual_account_nft_transactions 
ADD CONSTRAINT check_token_type CHECK (token_type IN ('NFT', 'SFT'));

-- Add comment explaining the column
COMMENT ON COLUMN virtual_account_nft_transactions.token_type IS 'Explicit token type: NFT or SFT. Not inferred from amount (1 SFT is still SFT)';

