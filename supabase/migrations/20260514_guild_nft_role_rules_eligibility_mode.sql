-- How wallet vs VA inventory combine for NFT role eligibility
ALTER TABLE guild_nft_role_rules
ADD COLUMN IF NOT EXISTS eligibility_mode TEXT NOT NULL DEFAULT 'wallet_and_va'
CHECK (eligibility_mode IN ('wallet_and_va', 'wallet_only', 'va_only', 'wallet_or_va'));
