-- Per-transfer idempotency for on-chain ESDT credits (same tx can credit multiple tokens / legs).
-- Atomic balance updates with row lock + reserved-funds check (auction_bid_reservations).

CREATE TABLE IF NOT EXISTS virtual_account_esdt_deposit_legs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_hash TEXT NOT NULL,
    transfer_index INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    amount TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tx_hash, transfer_index)
);

CREATE INDEX IF NOT EXISTS idx_esdt_deposit_legs_guild_user
  ON virtual_account_esdt_deposit_legs (guild_id, user_id);

COMMENT ON TABLE virtual_account_esdt_deposit_legs IS
  'One row per credited ESDT transfer leg (MultiversX tx can include multiple FungibleESDT transfers).';

CREATE OR REPLACE FUNCTION apply_virtual_account_balance_delta(
  p_guild_id text,
  p_user_id text,
  p_token_identifier text,
  p_delta text,
  p_tx_hash text DEFAULT NULL,
  p_transfer_index int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_balances jsonb;
  v_key text;
  v_current numeric;
  v_new numeric;
  v_reserved numeric;
  v_leg_id uuid;
  k text;
BEGIN
  -- Idempotent on-chain deposit leg (only for positive credits with a tx hash)
  IF p_tx_hash IS NOT NULL AND length(trim(p_tx_hash)) > 0 AND (p_delta::numeric) > 0 THEN
    INSERT INTO virtual_account_esdt_deposit_legs (tx_hash, transfer_index, guild_id, user_id, token_identifier, amount)
    VALUES (p_tx_hash, COALESCE(p_transfer_index, 0), p_guild_id, p_user_id, p_token_identifier, p_delta)
    ON CONFLICT (tx_hash, transfer_index) DO NOTHING
    RETURNING id INTO v_leg_id;

    IF v_leg_id IS NULL THEN
      RETURN jsonb_build_object('skipped', true);
    END IF;
  END IF;

  SELECT * INTO v_record FROM virtual_accounts
  WHERE guild_id = p_guild_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'virtual_account_not_found';
  END IF;

  v_balances := COALESCE(v_record.balances, '{}'::jsonb);

  v_key := NULL;
  FOR k IN SELECT jsonb_object_keys(v_balances) LOOP
    IF lower(k) = lower(p_token_identifier) THEN
      v_key := k;
      EXIT;
    END IF;
  END LOOP;

  IF v_key IS NULL THEN
    v_current := 0;
    v_key := p_token_identifier;
  ELSE
    v_current := COALESCE((v_balances->>v_key)::numeric, 0);
    IF v_key IS DISTINCT FROM p_token_identifier THEN
      v_balances := v_balances - v_key;
      v_key := p_token_identifier;
    END IF;
  END IF;

  v_new := v_current + (p_delta::numeric);

  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(r.reserved_amount::numeric), 0) INTO v_reserved
  FROM auction_bid_reservations r
  WHERE r.guild_id = p_guild_id
    AND r.user_id = p_user_id
    AND r.status = 'ACTIVE'
    AND lower(r.token_identifier) = lower(p_token_identifier);

  IF v_new < v_reserved THEN
    RAISE EXCEPTION 'insufficient_available_balance_reserved' USING ERRCODE = 'P0001';
  END IF;

  v_balances := jsonb_set(v_balances, ARRAY[v_key], to_jsonb(v_new::text));

  UPDATE virtual_accounts
  SET balances = v_balances,
      last_updated = (extract(epoch from now()) * 1000)::bigint,
      updated_at = NOW()
  WHERE guild_id = p_guild_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'skipped', false,
    'new_balance', v_new::text,
    'balance_before', v_current::text,
    'canonical_key', v_key
  );
END;
$$;

COMMENT ON FUNCTION apply_virtual_account_balance_delta IS
  'Atomically applies a balance delta with row lock; optional deposit leg claim for on-chain credits.';

GRANT EXECUTE ON FUNCTION apply_virtual_account_balance_delta TO anon, authenticated, service_role;
