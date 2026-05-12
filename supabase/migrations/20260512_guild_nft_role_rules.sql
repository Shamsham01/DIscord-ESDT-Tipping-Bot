-- NFT role verification rules (wallet + VA dual check, admin channel notifications)
CREATE TABLE IF NOT EXISTS guild_nft_role_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    discord_role_id TEXT NOT NULL,
    notification_channel_id TEXT NOT NULL,
    collection_tickers TEXT[] NOT NULL DEFAULT '{}',
    match_mode TEXT NOT NULL DEFAULT 'any' CHECK (match_mode IN ('any', 'all')),
    min_count_per_collection INTEGER NOT NULL DEFAULT 1 CHECK (min_count_per_collection >= 1),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_nft_role_rules_guild ON guild_nft_role_rules (guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_nft_role_rules_guild_enabled ON guild_nft_role_rules (guild_id, enabled);
