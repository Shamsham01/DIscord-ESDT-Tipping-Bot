-- Migration: Add DROP Game tables and update house_balance
-- Date: 2024

-- ============================================
-- DROP GAME TABLES
-- ============================================

-- Drop games automation settings per guild
CREATE TABLE IF NOT EXISTS drop_games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    supported_tokens TEXT[] DEFAULT '{}',
    base_amount_wei TEXT NOT NULL,
    min_droppers INTEGER NOT NULL,
    collection_identifier TEXT,
    nft_collection_multiplier BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id)
);

CREATE INDEX IF NOT EXISTS idx_drop_games_guild ON drop_games(guild_id);
CREATE INDEX IF NOT EXISTS idx_drop_games_status ON drop_games(status);

-- Drop rounds - each hourly round
CREATE TABLE IF NOT EXISTS drop_rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    status TEXT NOT NULL DEFAULT 'LIVE',
    created_at BIGINT NOT NULL,
    closed_at BIGINT,
    draw_time BIGINT NOT NULL,
    min_droppers INTEGER NOT NULL,
    current_droppers INTEGER DEFAULT 0,
    winner_id TEXT,
    winner_tag TEXT,
    airdrop_status BOOLEAN DEFAULT FALSE,
    week_start BIGINT NOT NULL,
    week_end BIGINT NOT NULL,
    created_at_ts TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(round_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_drop_rounds_guild ON drop_rounds(guild_id);
CREATE INDEX IF NOT EXISTS idx_drop_rounds_status ON drop_rounds(status);
CREATE INDEX IF NOT EXISTS idx_drop_rounds_draw_time ON drop_rounds(draw_time);
CREATE INDEX IF NOT EXISTS idx_drop_rounds_week ON drop_rounds(guild_id, week_start, week_end);

-- Drop participants - users who entered each round
CREATE TABLE IF NOT EXISTS drop_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_tag TEXT,
    entered_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(round_id, guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_drop_participants_round ON drop_participants(round_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_drop_participants_user ON drop_participants(guild_id, user_id);

-- Drop leaderboard - weekly leaderboard tracking
CREATE TABLE IF NOT EXISTS drop_leaderboard (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_tag TEXT,
    points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    week_start BIGINT NOT NULL,
    week_end BIGINT NOT NULL,
    airdrop_status BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_drop_leaderboard_guild ON drop_leaderboard(guild_id);
CREATE INDEX IF NOT EXISTS idx_drop_leaderboard_week ON drop_leaderboard(guild_id, week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_drop_leaderboard_airdrop ON drop_leaderboard(guild_id, airdrop_status, week_end);

-- Update house_balance table to add drop category fields
ALTER TABLE house_balance 
ADD COLUMN IF NOT EXISTS drop_earnings JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS drop_spending JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS drop_pnl JSONB DEFAULT '{}';
