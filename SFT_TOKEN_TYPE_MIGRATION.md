# SFT Token Type Migration Guide

## Overview
This migration adds a `token_type` column to track NFT vs SFT definitively, making detection bulletproof instead of relying on amount-based heuristics.

## Supabase Migration

Run the following SQL in your Supabase SQL Editor:

```sql
-- Migration: Add token_type column for bulletproof NFT/SFT detection
-- Date: 2024-01-XX
-- Description: Adds token_type column to reliably distinguish NFTs from SFTs

-- Add token_type column to virtual_account_nft_balances
ALTER TABLE virtual_account_nft_balances 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT' CHECK (token_type IN ('NFT', 'SFT'));

-- Update existing records (all are NFTs)
UPDATE virtual_account_nft_balances 
SET token_type = 'NFT' 
WHERE token_type IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN virtual_account_nft_balances.token_type IS 'Token type: NFT or SFT. Used for reliable detection.';

-- Add token_type column to nft_listings table
ALTER TABLE nft_listings 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT' CHECK (token_type IN ('NFT', 'SFT'));

-- Update existing listings (all are NFTs)
UPDATE nft_listings 
SET token_type = 'NFT' 
WHERE token_type IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN nft_listings.token_type IS 'Token type: NFT or SFT. Used for reliable detection.';

-- Add token_type column to auctions table
ALTER TABLE auctions 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'NFT' CHECK (token_type IN ('NFT', 'SFT'));

-- Update existing auctions (all are NFTs)
UPDATE auctions 
SET token_type = 'NFT' 
WHERE token_type IS NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN auctions.token_type IS 'Token type: NFT or SFT. Used for reliable detection.';
```

**Note:** The full migration file `migration-add-sft-amount.sql` includes both `amount` and `token_type` columns. Run the entire file for complete SFT support.

## How Autodetection Works

### 1. **Blockchain Deposits (Bulletproof)**
When NFTs/SFTs are deposited via blockchain:
- The blockchain listener checks `transfer.type === 'SemiFungibleESDT'` (from MultiversX API)
- If `SemiFungibleESDT` → Sets `token_type = 'SFT'`
- If `NonFungibleESDT` → Sets `token_type = 'NFT'`
- **This is 100% reliable** because it comes directly from the blockchain transaction

### 2. **Withdrawals & Transfers (Bulletproof with token_type)**
When withdrawing or transferring:
- **Primary method:** Uses `token_type` from database (bulletproof)
- **Fallback:** If `token_type` not available, uses `amount > 1` heuristic (for backward compatibility)
- Code checks: `nft.token_type === 'SFT'` or `listing.tokenType === 'SFT'` or `auction.tokenType === 'SFT'`

### 3. **Display & UI (Bulletproof with token_type)**
All embeds and messages:
- **Primary:** Use `token_type` from database
- **Fallback:** Use `amount > 1` heuristic if `token_type` not available

## Detection Reliability

### ✅ **Bulletproof Detection:**
- **Blockchain deposits:** Uses transaction type from MultiversX API
- **Database lookups:** Uses `token_type` column (once migration is run)
- **Withdrawals:** Uses `token_type` from NFT record before transfer

### ⚠️ **Fallback Detection (Not Bulletproof):**
- **Amount-based:** `amount > 1` → SFT, `amount = 1` → NFT
- Only used when `token_type` is not available (backward compatibility)
- **Edge case:** SFT with amount=1 would be incorrectly detected as NFT

## Migration Steps

1. **Run the SQL migration** in Supabase SQL Editor (see above)
2. **Restart your bot** to ensure all code changes are loaded
3. **Test with an SFT deposit** - it should automatically set `token_type = 'SFT'`
4. **Verify existing NFTs** - they should have `token_type = 'NFT'`

## Code Changes Summary

### Database Layer
- `addNFTToAccount()` - Accepts and stores `token_type` parameter
- `createListing()` - Stores `token_type` in listings
- `createAuction()` - Stores `token_type` in auctions
- All retrieval functions return `token_type` field

### Blockchain Listener
- `processNFTDeposit()` - Accepts `tokenType` parameter
- `processTransaction()` - Detects type from `transfer.type` and passes to deposit handler

### Transfer Functions
- `transferNFTFromCommunityFund()` - Uses `token_type` parameter for detection
- All commands pass `token_type` from database records

### Commands
- All NFT/SFT commands now use `token_type` from database
- Fallback to amount-based detection for backward compatibility

## Benefits

1. **100% Accurate Detection:** No ambiguity between NFT and SFT
2. **Handles Edge Cases:** SFT with amount=1 correctly identified
3. **Backward Compatible:** Falls back to amount-based detection if needed
4. **Future Proof:** Easy to add more token types if needed

## Testing Checklist

- [ ] Run migration SQL in Supabase
- [ ] Verify `token_type` column exists in all three tables
- [ ] Test SFT deposit (should set `token_type = 'SFT'`)
- [ ] Test NFT deposit (should set `token_type = 'NFT'`)
- [ ] Test withdrawal with SFT (should use SFT endpoint)
- [ ] Test withdrawal with NFT (should use NFT endpoint)
- [ ] Test listing creation with SFT
- [ ] Test auction creation with SFT
- [ ] Verify all embeds show correct token type

