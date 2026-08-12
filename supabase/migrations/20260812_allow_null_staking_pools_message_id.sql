-- Embed cleanup marks message_id NULL after deleting Discord messages for CLOSED pools.
-- Other game tables already allow NULL; staking_pools was the only NOT NULL holdout.
ALTER TABLE public.staking_pools
  ALTER COLUMN message_id DROP NOT NULL;
