-- Migration: Add missing fields to auctions table
-- Run this in your Supabase SQL editor to add the missing columns

ALTER TABLE auctions 
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS seller_id TEXT,
ADD COLUMN IF NOT EXISTS token_identifier TEXT;

-- Add index for seller_id if needed
CREATE INDEX IF NOT EXISTS idx_auctions_seller ON auctions(guild_id, seller_id) WHERE seller_id IS NOT NULL;

