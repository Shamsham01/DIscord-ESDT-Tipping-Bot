-- Migration: Remove tx_hash column from auction_bids table
-- All bids are now virtual account bids, no blockchain transactions needed
-- Date: 2025-01-20

-- Drop the tx_hash column entirely
ALTER TABLE auction_bids 
DROP COLUMN IF EXISTS tx_hash;

