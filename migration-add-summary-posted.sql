-- Add summary_posted column to track if distribution summary has been posted
ALTER TABLE staking_pool_reward_distributions 
ADD COLUMN IF NOT EXISTS summary_posted BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_reward_distributions_summary ON staking_pool_reward_distributions(summary_posted) WHERE summary_posted = FALSE;
