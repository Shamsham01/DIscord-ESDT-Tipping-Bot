CREATE TABLE IF NOT EXISTS guild_on_chain_subscriptions (
  guild_id TEXT PRIMARY KEY,
  subscribed_by_discord_id TEXT NOT NULL,
  plan_months INTEGER NOT NULL CHECK (plan_months IN (1, 3, 6, 12)),
  amount_usdc NUMERIC(18, 6) NOT NULL,
  subscription_start TIMESTAMPTZ NOT NULL,
  subscription_end TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_payment_tx_hash TEXT,
  expiry_reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_on_chain_subscriptions_end
  ON guild_on_chain_subscriptions (subscription_end);

CREATE INDEX IF NOT EXISTS idx_guild_on_chain_subscriptions_reminder
  ON guild_on_chain_subscriptions (expiry_reminder_sent_at, subscription_end);
