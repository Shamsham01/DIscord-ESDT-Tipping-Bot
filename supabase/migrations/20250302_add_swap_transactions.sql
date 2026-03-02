-- Swap transactions table for AshSwap VA swap integration
-- Run via Supabase SQL editor or: supabase db push

CREATE TABLE IF NOT EXISTS swap_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  from_token TEXT NOT NULL,
  to_token TEXT NOT NULL,
  amount_sold TEXT NOT NULL,
  amount_received TEXT NOT NULL,
  slippage_percentage NUMERIC NOT NULL,
  transaction_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  deduction_transaction_id TEXT,
  addition_transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_swap_transactions_guild ON swap_transactions(guild_id);
CREATE INDEX IF NOT EXISTS idx_swap_transactions_user ON swap_transactions(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_swap_transactions_created ON swap_transactions(created_at DESC);
