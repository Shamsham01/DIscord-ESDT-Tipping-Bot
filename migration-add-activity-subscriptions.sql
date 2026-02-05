-- Migration: Add activity subscriptions tables
-- Run this in your Supabase SQL editor

-- Table to store which guilds subscribe to which activity types
CREATE TABLE IF NOT EXISTS activity_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('auction', 'listing', 'lottery')),
    channel_id TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, activity_type, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_guild_type ON activity_subscriptions(guild_id, activity_type) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_subscriptions_type ON activity_subscriptions(activity_type) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON activity_subscriptions(enabled) WHERE enabled = TRUE;

-- Table to track forwarded messages (for cleanup)
CREATE TABLE IF NOT EXISTS forwarded_activity_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_guild_id TEXT NOT NULL,
    destination_guild_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    destination_message_id TEXT NOT NULL,
    destination_channel_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(destination_guild_id, destination_message_id)
);

CREATE INDEX IF NOT EXISTS idx_forwarded_source_activity ON forwarded_activity_messages(source_guild_id, activity_type, activity_id);
CREATE INDEX IF NOT EXISTS idx_forwarded_destination ON forwarded_activity_messages(destination_guild_id, destination_channel_id);
