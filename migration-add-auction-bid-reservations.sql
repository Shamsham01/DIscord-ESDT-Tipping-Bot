-- Migration: Add auction_bid_reservations table for fund reservation
-- This ensures users cannot spend funds that are reserved for active bids
-- Date: 2025-01-20

-- Create table to track reserved funds for auction bids
CREATE TABLE IF NOT EXISTS auction_bid_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auction_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    reserved_amount TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, RELEASED, CONVERTED
    UNIQUE(auction_id, guild_id, user_id) -- One active reservation per user per auction
);

CREATE INDEX IF NOT EXISTS idx_auction_reservations_auction ON auction_bid_reservations(auction_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_auction_reservations_user ON auction_bid_reservations(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_auction_reservations_status ON auction_bid_reservations(status) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_auction_reservations_token ON auction_bid_reservations(guild_id, user_id, token_identifier) WHERE status = 'ACTIVE';
