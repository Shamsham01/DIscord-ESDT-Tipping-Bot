-- Persist Discord message IDs for NFT offer notifications (thread + seller DM) so embeds can be updated on accept/reject.
-- Apply via Supabase SQL editor or: supabase db push

ALTER TABLE public.nft_offers
  ADD COLUMN IF NOT EXISTS thread_message_id TEXT,
  ADD COLUMN IF NOT EXISTS dm_message_id TEXT;
