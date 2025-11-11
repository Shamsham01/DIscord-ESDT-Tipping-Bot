-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- SERVER DATA TABLES
-- ============================================

-- User wallets per guild
CREATE TABLE IF NOT EXISTS user_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_guild ON user_wallets(guild_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id);

-- Projects per guild
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    wallet_pem TEXT NOT NULL,
    supported_tokens TEXT[] DEFAULT '{}',
    user_input TEXT,
    registered_by TEXT NOT NULL,
    registered_at BIGINT NOT NULL,
    project_logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, project_name)
);

CREATE INDEX IF NOT EXISTS idx_projects_guild ON projects(guild_id);

-- Guild settings
CREATE TABLE IF NOT EXISTS guild_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL UNIQUE,
    community_fund_project TEXT,
    last_competition TEXT,
    created_at BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_settings_guild ON guild_settings(guild_id);

-- Community fund QR codes
CREATE TABLE IF NOT EXISTS community_fund_qr (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    qr_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, project_name)
);

CREATE INDEX IF NOT EXISTS idx_community_fund_qr_guild ON community_fund_qr(guild_id);

-- Token metadata cache
CREATE TABLE IF NOT EXISTS token_metadata (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    is_paused BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, token_identifier)
);

CREATE INDEX IF NOT EXISTS idx_token_metadata_guild ON token_metadata(guild_id);

-- House balance tracking
CREATE TABLE IF NOT EXISTS house_balance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    betting_earnings JSONB DEFAULT '{}',
    betting_spending JSONB DEFAULT '{}',
    betting_pnl JSONB DEFAULT '{}',
    auction_earnings JSONB DEFAULT '{}',
    auction_spending JSONB DEFAULT '{}',
    auction_pnl JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, token_identifier)
);

CREATE INDEX IF NOT EXISTS idx_house_balance_guild ON house_balance(guild_id);

-- ============================================
-- VIRTUAL ACCOUNTS TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS virtual_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    balances JSONB DEFAULT '{}',
    created_at BIGINT NOT NULL,
    last_updated BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_virtual_accounts_guild ON virtual_accounts(guild_id);
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_user ON virtual_accounts(user_id);

CREATE TABLE IF NOT EXISTS virtual_account_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    type TEXT NOT NULL,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    balance_before TEXT NOT NULL,
    balance_after TEXT NOT NULL,
    tx_hash TEXT,
    source TEXT,
    timestamp BIGINT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_virtual_transactions_guild_user ON virtual_account_transactions(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_virtual_transactions_timestamp ON virtual_account_transactions(timestamp DESC);

-- ============================================
-- RPS GAMES TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS rps_games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    challenger_id TEXT NOT NULL,
    challenger_tag TEXT,
    challenger_wallet TEXT NOT NULL,
    challenged_id TEXT NOT NULL,
    challenged_tag TEXT,
    challenged_wallet TEXT,
    amount TEXT NOT NULL,
    human_amount TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    token TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    joiner_transaction_hash TEXT,
    memo TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL,
    expires_at BIGINT,
    joined_at BIGINT,
    completed_at BIGINT,
    current_round INTEGER DEFAULT 1,
    winner TEXT,
    winner_id TEXT,
    winner_tag TEXT,
    loser_id TEXT,
    loser_tag TEXT,
    rounds JSONB DEFAULT '[]',
    UNIQUE(game_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_rps_games_guild ON rps_games(guild_id);
CREATE INDEX IF NOT EXISTS idx_rps_games_status ON rps_games(status);
CREATE INDEX IF NOT EXISTS idx_rps_games_created ON rps_games(created_at);

-- ============================================
-- FOOTBALL BETTING TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS football_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id TEXT NOT NULL UNIQUE,
    comp_code TEXT NOT NULL,
    comp_name TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    kickoff_iso TIMESTAMPTZ NOT NULL,
    token_data JSONB NOT NULL,
    required_amount_wei TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    ft_score JSONB DEFAULT '{"home": 0, "away": 0}',
    house_earnings_tracked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_football_matches_match_id ON football_matches(match_id);
CREATE INDEX IF NOT EXISTS idx_football_matches_status ON football_matches(status);
CREATE INDEX IF NOT EXISTS idx_football_matches_kickoff ON football_matches(kickoff_iso);

-- Match-guild relationship (many-to-many)
CREATE TABLE IF NOT EXISTS match_guilds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    message_id TEXT,
    thread_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_match_guilds_match ON match_guilds(match_id);
CREATE INDEX IF NOT EXISTS idx_match_guilds_guild ON match_guilds(guild_id);

-- Football bets
CREATE TABLE IF NOT EXISTS football_bets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bet_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    token_data JSONB NOT NULL,
    amount_wei TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    created_at_iso TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACCEPTED',
    prize_sent BOOLEAN DEFAULT FALSE,
    prize_amount TEXT,
    prize_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bet_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_football_bets_guild ON football_bets(guild_id);
CREATE INDEX IF NOT EXISTS idx_football_bets_match ON football_bets(match_id);
CREATE INDEX IF NOT EXISTS idx_football_bets_user ON football_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_football_bets_status ON football_bets(status);
CREATE INDEX IF NOT EXISTS idx_football_bets_prize_sent ON football_bets(match_id, guild_id, prize_sent) WHERE prize_sent = FALSE;

-- Leaderboard
CREATE TABLE IF NOT EXISTS leaderboard (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    total_earnings_wei TEXT DEFAULT '0',
    total_bets_wei TEXT DEFAULT '0',
    pnl_wei TEXT DEFAULT '0',
    last_win_iso TIMESTAMPTZ,
    token_earnings JSONB DEFAULT '{}',
    token_bets JSONB DEFAULT '{}',
    token_pnl JSONB DEFAULT '{}',
    is_house BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_guild ON leaderboard(guild_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_points ON leaderboard(guild_id, points DESC);

-- ============================================
-- AUCTIONS TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS auctions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auction_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_tag TEXT,
    project_name TEXT,
    collection TEXT,
    nft_name TEXT,
    nft_identifier TEXT,
    nft_nonce INTEGER,
    nft_image_url TEXT,
    title TEXT NOT NULL,
    description TEXT,
    duration BIGINT,
    end_time BIGINT NOT NULL,
    token_ticker TEXT NOT NULL,
    starting_amount TEXT NOT NULL,
    min_bid_increase TEXT,
    current_bid TEXT,
    highest_bidder_id TEXT,
    highest_bidder_tag TEXT,
    message_id TEXT,
    thread_id TEXT,
    channel_id TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(auction_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_auctions_guild ON auctions(guild_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_end_time ON auctions(end_time);

CREATE TABLE IF NOT EXISTS auction_bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auction_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    bidder_id TEXT NOT NULL,
    bidder_tag TEXT,
    bid_amount_wei TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(auction_id, guild_id, bidder_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_auction_bids_auction ON auction_bids(auction_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_id);

-- ============================================
-- LOTTERY TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS lotteries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lottery_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    winning_numbers_count INTEGER NOT NULL,
    total_pool_numbers INTEGER NOT NULL,
    token_identifier TEXT NOT NULL,
    token_ticker TEXT NOT NULL,
    drawing_frequency TEXT NOT NULL,
    house_commission_percent NUMERIC DEFAULT 0,
    ticket_price_wei TEXT NOT NULL,
    prize_pool_wei TEXT DEFAULT '0',
    prize_pool_usd NUMERIC DEFAULT 0,
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    next_draw_time BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'LIVE',
    has_winners BOOLEAN DEFAULT FALSE,
    winning_numbers JSONB,
    channel_id TEXT,
    message_id TEXT,
    thread_id TEXT,
    total_tickets INTEGER DEFAULT 0,
    unique_participants INTEGER DEFAULT 0,
    is_rollover BOOLEAN DEFAULT FALSE,
    original_lottery_id TEXT,
    rollover_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(lottery_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_lotteries_guild ON lotteries(guild_id);
CREATE INDEX IF NOT EXISTS idx_lotteries_status ON lotteries(status);
CREATE INDEX IF NOT EXISTS idx_lotteries_end_time ON lotteries(end_time);
CREATE INDEX IF NOT EXISTS idx_lotteries_next_draw_time ON lotteries(next_draw_time);

CREATE TABLE IF NOT EXISTS lottery_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id TEXT NOT NULL UNIQUE,
    guild_id TEXT NOT NULL,
    lottery_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_tag TEXT,
    numbers JSONB NOT NULL,
    token_identifier TEXT NOT NULL,
    token_ticker TEXT NOT NULL,
    ticket_price_wei TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'LIVE',
    is_winner BOOLEAN DEFAULT FALSE,
    matched_numbers INTEGER DEFAULT 0,
    created_at BIGINT NOT NULL,
    expired_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_lottery_tickets_guild ON lottery_tickets(guild_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_lottery ON lottery_tickets(lottery_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user ON lottery_tickets(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_status ON lottery_tickets(status);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_created ON lottery_tickets(created_at DESC);

CREATE TABLE IF NOT EXISTS lottery_winners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lottery_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_tag TEXT,
    ticket_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    token_ticker TEXT NOT NULL,
    prize_amount_wei TEXT NOT NULL,
    prize_amount_usd NUMERIC DEFAULT 0,
    winning_numbers JSONB NOT NULL,
    ticket_numbers JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lottery_winners_lottery ON lottery_winners(lottery_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_lottery_winners_user ON lottery_winners(user_id, guild_id);

-- Update house_balance table to add lottery fields
ALTER TABLE house_balance 
ADD COLUMN IF NOT EXISTS lottery_earnings JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS lottery_spending JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS lottery_pnl JSONB DEFAULT '{}';

-- ============================================
-- BLOCKCHAIN LISTENER TIMESTAMPS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS wallet_timestamps (
    wallet_address TEXT PRIMARY KEY,
    last_timestamp BIGINT NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_timestamps_address ON wallet_timestamps(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_timestamps_updated ON wallet_timestamps(last_updated DESC);

