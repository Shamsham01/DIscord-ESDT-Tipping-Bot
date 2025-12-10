-- Migration: Add house_earnings_tracked column to match_guilds table
-- Purpose: Track house earnings per-guild per-match (instead of per-match only)
-- Date: 2024

-- Add house_earnings_tracked column to match_guilds table
ALTER TABLE match_guilds
ADD COLUMN IF NOT EXISTS house_earnings_tracked BOOLEAN DEFAULT FALSE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_match_guilds_house_earnings_tracked 
ON match_guilds(match_id, guild_id, house_earnings_tracked) 
WHERE house_earnings_tracked = TRUE;

