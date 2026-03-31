-- Offerer DM with Cancel button — store message id to update when seller accepts/rejects or offer expires.
ALTER TABLE public.nft_offers
  ADD COLUMN IF NOT EXISTS offerer_dm_message_id TEXT;
