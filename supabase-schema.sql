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
    seller_id TEXT,
    -- Note: source is inferred from project_name (NULL = virtual_account, value = project_wallet)
    -- Note: token_ticker stores full token identifier (e.g., "REWARD-cf6eac")
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

-- ============================================
-- NFT VIRTUAL ACCOUNTS TABLES
-- ============================================

-- NFT balances in virtual accounts (one row per NFT per user)
CREATE TABLE IF NOT EXISTS virtual_account_nft_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    identifier TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    nft_name TEXT,
    nft_image_url TEXT,
    metadata JSONB DEFAULT '{}',
    staked BOOLEAN DEFAULT FALSE,
    staking_pool_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, collection, nonce)
);

CREATE INDEX IF NOT EXISTS idx_va_nft_balances_guild_user ON virtual_account_nft_balances(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_va_nft_balances_collection ON virtual_account_nft_balances(guild_id, collection);
CREATE INDEX IF NOT EXISTS idx_va_nft_balances_identifier ON virtual_account_nft_balances(identifier);
CREATE INDEX IF NOT EXISTS idx_va_nft_balances_staked ON virtual_account_nft_balances(guild_id, user_id, staked);
CREATE INDEX IF NOT EXISTS idx_va_nft_balances_staking_pool ON virtual_account_nft_balances(staking_pool_id) WHERE staking_pool_id IS NOT NULL;

-- NFT transaction history
CREATE TABLE IF NOT EXISTS virtual_account_nft_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    type TEXT NOT NULL,
    collection TEXT NOT NULL,
    identifier TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    nft_name TEXT,
    amount INTEGER DEFAULT 1, -- Amount for SFTs (default 1 for NFTs)
    token_type TEXT DEFAULT 'NFT', -- 'NFT' or 'SFT' - explicit classification, not inferred from amount
    from_user_id TEXT,
    to_user_id TEXT,
    price_token_identifier TEXT,
    price_amount TEXT,
    tx_hash TEXT,
    source TEXT,
    timestamp BIGINT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_va_nft_trans_guild_user ON virtual_account_nft_transactions(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_va_nft_trans_timestamp ON virtual_account_nft_transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_va_nft_trans_collection ON virtual_account_nft_transactions(guild_id, collection);

-- NFT marketplace listings
CREATE TABLE IF NOT EXISTS nft_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    seller_tag TEXT,
    buyer_id TEXT,
    collection TEXT NOT NULL,
    identifier TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    nft_name TEXT,
    nft_image_url TEXT,
    title TEXT NOT NULL,
    description TEXT,
    price_token_identifier TEXT NOT NULL,
    price_amount TEXT NOT NULL,
    listing_type TEXT NOT NULL DEFAULT 'fixed_price',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    message_id TEXT,
    thread_id TEXT,
    channel_id TEXT,
    created_at BIGINT NOT NULL,
    sold_at BIGINT,
    expires_at BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(listing_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_nft_listings_guild ON nft_listings(guild_id);
CREATE INDEX IF NOT EXISTS idx_nft_listings_status ON nft_listings(status);
CREATE INDEX IF NOT EXISTS idx_nft_listings_seller ON nft_listings(guild_id, seller_id);
CREATE INDEX IF NOT EXISTS idx_nft_listings_buyer ON nft_listings(guild_id, buyer_id) WHERE buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nft_listings_collection ON nft_listings(guild_id, collection);
CREATE INDEX IF NOT EXISTS idx_nft_listings_expires_at ON nft_listings(expires_at) WHERE expires_at IS NOT NULL;

-- NFT offers on listings
CREATE TABLE IF NOT EXISTS nft_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    offerer_id TEXT NOT NULL,
    offerer_tag TEXT,
    price_token_identifier TEXT NOT NULL,
    price_amount TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at BIGINT NOT NULL,
    accepted_at BIGINT,
    expires_at BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(offer_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_nft_offers_listing ON nft_offers(listing_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_nft_offers_offerer ON nft_offers(guild_id, offerer_id);
CREATE INDEX IF NOT EXISTS idx_nft_offers_status ON nft_offers(status);
CREATE INDEX IF NOT EXISTS idx_nft_offers_expires_at ON nft_offers(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- NFT STAKING POOLS TABLES
-- ============================================

-- Main staking pools table
CREATE TABLE IF NOT EXISTS staking_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_tag TEXT,
    
    -- Pool display info
    pool_name TEXT,
    
    -- Collection info
    collection_ticker TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    collection_image_url TEXT,
    
    -- Reward token info
    reward_token_identifier TEXT NOT NULL,
    reward_token_ticker TEXT NOT NULL,
    reward_token_decimals INTEGER NOT NULL DEFAULT 18,
    
    -- Pool configuration
    initial_supply_wei TEXT NOT NULL,
    current_supply_wei TEXT NOT NULL,
    reward_per_nft_per_day_wei TEXT NOT NULL,
    staking_total_limit INTEGER,
    staking_limit_per_user INTEGER,
    duration_months INTEGER,
    
    -- Trait filtering
    trait_filters JSONB DEFAULT NULL,
    
    -- Pool timing
    created_at BIGINT NOT NULL,
    expires_at BIGINT,
    next_reward_distribution_at BIGINT NOT NULL,
    last_reward_distribution_at BIGINT,
    
    -- Low supply warning
    low_supply_warning_at BIGINT,
    auto_close_at BIGINT,
    
    -- Discord embed info
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    thread_id TEXT,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    
    -- Statistics
    total_nfts_staked INTEGER DEFAULT 0,
    unique_stakers_count INTEGER DEFAULT 0,
    
    created_at_timestamp TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(pool_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_staking_pools_guild ON staking_pools(guild_id);
CREATE INDEX IF NOT EXISTS idx_staking_pools_status ON staking_pools(status);
CREATE INDEX IF NOT EXISTS idx_staking_pools_creator ON staking_pools(guild_id, creator_id);
CREATE INDEX IF NOT EXISTS idx_staking_pools_next_distribution ON staking_pools(next_reward_distribution_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_staking_pools_auto_close ON staking_pools(auto_close_at) WHERE auto_close_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staking_pools_collection ON staking_pools(guild_id, collection_ticker);
CREATE INDEX IF NOT EXISTS idx_staking_pools_trait_filters ON staking_pools USING GIN (trait_filters) WHERE trait_filters IS NOT NULL;

-- User staked NFTs
CREATE TABLE IF NOT EXISTS staking_pool_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    identifier TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    nft_name TEXT,
    nft_image_url TEXT,
    staked_at BIGINT NOT NULL,
    lock_until BIGINT,
    unstake_priority BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_id, guild_id, user_id, collection, nonce)
);

CREATE INDEX IF NOT EXISTS idx_staking_balances_pool ON staking_pool_balances(pool_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_staking_balances_user ON staking_pool_balances(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_staking_balances_collection ON staking_pool_balances(guild_id, collection);
CREATE INDEX IF NOT EXISTS idx_staking_balances_staked_at ON staking_pool_balances(staked_at);
CREATE INDEX IF NOT EXISTS idx_staking_balances_lock_until ON staking_pool_balances(lock_until) WHERE lock_until IS NOT NULL;

-- Reward distribution history
CREATE TABLE IF NOT EXISTS staking_pool_reward_distributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    distribution_id TEXT NOT NULL,
    total_rewards_paid_wei TEXT NOT NULL,
    total_rewards_paid_usd NUMERIC DEFAULT 0,
    nfts_staked_at_time INTEGER NOT NULL,
    unique_stakers_at_time INTEGER NOT NULL,
    distributed_at BIGINT NOT NULL,
    next_distribution_at BIGINT NOT NULL,
    thread_id TEXT,
    notification_message_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(distribution_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_distributions_pool ON staking_pool_reward_distributions(pool_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_reward_distributions_time ON staking_pool_reward_distributions(distributed_at DESC);

-- User reward claims
CREATE TABLE IF NOT EXISTS staking_pool_user_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    distribution_id TEXT NOT NULL,
    nfts_staked_count INTEGER NOT NULL,
    reward_amount_wei TEXT NOT NULL,
    reward_amount_usd NUMERIC DEFAULT 0,
    claimed BOOLEAN DEFAULT FALSE,
    claimed_at BIGINT,
    expired BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_id, guild_id, user_id, distribution_id)
);

CREATE INDEX IF NOT EXISTS idx_user_rewards_pool_user ON staking_pool_user_rewards(pool_id, guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_rewards_distribution ON staking_pool_user_rewards(distribution_id);
CREATE INDEX IF NOT EXISTS idx_user_rewards_claimed ON staking_pool_user_rewards(pool_id, guild_id, user_id, claimed) WHERE claimed = FALSE AND expired = FALSE;

-- Rate limiting
CREATE TABLE IF NOT EXISTS staking_pool_rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    last_action_at BIGINT NOT NULL,
    UNIQUE(pool_id, guild_id, user_id, action_type)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON staking_pool_rate_limits(guild_id, user_id, action_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON staking_pool_rate_limits(last_action_at);

-- NFT metadata cache
CREATE TABLE IF NOT EXISTS nft_metadata_cache (
    identifier TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    attributes JSONB,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nft_metadata_collection_nonce ON nft_metadata_cache(collection, nonce);
CREATE INDEX IF NOT EXISTS idx_nft_metadata_expires ON nft_metadata_cache(expires_at) WHERE expires_at IS NOT NULL;

