-- Migration: Add atomic bonus pot increment function
-- Purpose: Prevent race conditions when multiple concurrent requests top up the bonus pot
-- Date: 2024

-- Create PostgreSQL function to atomically increment bonus_pot_wei
-- This prevents race conditions by performing the increment at the database level
CREATE OR REPLACE FUNCTION increment_match_guild_bonus_pot(
    p_match_id TEXT,
    p_guild_id TEXT,
    p_increment_amount TEXT
)
RETURNS TABLE(bonus_pot_wei TEXT) AS $$
DECLARE
    v_new_bonus_pot TEXT;
BEGIN
    -- Atomically update and return the new bonus pot value
    -- Uses UPDATE ... RETURNING to ensure atomicity
    -- This prevents race conditions when multiple concurrent requests try to top up the pot
    UPDATE match_guilds
    SET bonus_pot_wei = (
        COALESCE(bonus_pot_wei::NUMERIC, 0) + p_increment_amount::NUMERIC
    )::TEXT
    WHERE match_id = p_match_id 
      AND guild_id = p_guild_id
    RETURNING bonus_pot_wei INTO v_new_bonus_pot;
    
    -- If no row was updated, the match-guild relationship doesn't exist
    IF v_new_bonus_pot IS NULL THEN
        RAISE EXCEPTION 'Match % is not associated with guild %', p_match_id, p_guild_id;
    END IF;
    
    -- Return the new bonus pot value
    RETURN QUERY SELECT v_new_bonus_pot;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users (Supabase uses anon/authenticated roles)
GRANT EXECUTE ON FUNCTION increment_match_guild_bonus_pot(TEXT, TEXT, TEXT) TO anon, authenticated;
