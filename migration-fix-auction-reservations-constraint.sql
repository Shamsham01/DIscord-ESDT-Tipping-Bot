-- Migration: Fix auction_bid_reservations unique constraint
-- The constraint should only apply to ACTIVE reservations, not all reservations
-- This allows users to have multiple reservations over time (historical ones)
-- but only one ACTIVE reservation per auction at a time
-- Date: 2025-01-20
--
-- RECOMMENDED MIGRATION - Safe for your table size (8 KB, 3 rows)
-- This migration creates the new index FIRST, then drops the old one
-- This ensures there's no window without a constraint
-- Execution time: < 1 second

-- Step 1: Create the new partial unique index FIRST
-- This ensures we have the constraint before dropping the old one
-- (No gap in constraint coverage)
CREATE UNIQUE INDEX IF NOT EXISTS idx_auction_reservations_active_unique 
ON auction_bid_reservations(auction_id, guild_id, user_id) 
WHERE status = 'ACTIVE';

-- Step 2: Drop the old constraint that applies to all reservations
-- This is very fast (just metadata change, takes milliseconds)
ALTER TABLE auction_bid_reservations 
DROP CONSTRAINT IF EXISTS auction_bid_reservations_auction_id_guild_id_user_id_key;

-- Step 3: Drop the old unique index (it exists as: auction_bid_reservations_auction_id_guild_id_user_id_key)
DROP INDEX IF EXISTS auction_bid_reservations_auction_id_guild_id_user_id_key;
DROP INDEX IF EXISTS auction_bid_reservations_auction_id_guild_id_user_id_idx;
