-- Durable ESDT withdrawal reservations.
-- Applying this file creates tables and functions only. It does not move balances,
-- clear pending withdrawals, or compensate the 1 Nov 2026 incident.

CREATE TABLE IF NOT EXISTS esdt_withdrawals (
    withdrawal_id TEXT PRIMARY KEY,
    discord_interaction_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    token_ticker TEXT NOT NULL,
    amount_human TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    recipient_wallet TEXT NOT NULL,
    sender_wallet TEXT NOT NULL,
    memo TEXT,
    status TEXT NOT NULL,
    balance_before TEXT NOT NULL,
    balance_after TEXT NOT NULL,
    ledger_transaction_id TEXT NOT NULL,
    restoration_transaction_id TEXT,
    makex_operation_id TEXT,
    primary_tx_hash TEXT,
    blocking_tx_hash TEXT,
    untrusted_tx_hash TEXT,
    reservation_state TEXT,
    http_status INTEGER,
    error_code TEXT,
    error_message TEXT,
    fee_exempt BOOLEAN,
    usage_fee TEXT,
    usage_fee_hash TEXT,
    nonce TEXT,
    raw_result JSONB,
    processing_owner TEXT,
    processing_lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    restored_at TIMESTAMPTZ,
    CONSTRAINT esdt_withdrawals_status_check CHECK (
        status IN ('RESERVED', 'PENDING', 'CONFIRMED', 'FAILED', 'NEEDS_RECONCILIATION')
    ),
    CONSTRAINT esdt_withdrawals_amount_raw_check CHECK (amount_raw ~ '^[0-9]+$'),
    CONSTRAINT esdt_withdrawals_decimals_check CHECK (decimals >= 0 AND decimals <= 18)
);

CREATE UNIQUE INDEX IF NOT EXISTS esdt_withdrawals_interaction_uidx
    ON esdt_withdrawals (discord_interaction_id);

CREATE INDEX IF NOT EXISTS esdt_withdrawals_guild_user_idx
    ON esdt_withdrawals (guild_id, user_id);

CREATE INDEX IF NOT EXISTS esdt_withdrawals_open_idx
    ON esdt_withdrawals (updated_at)
    WHERE status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION');

CREATE INDEX IF NOT EXISTS esdt_withdrawals_tx_hash_idx
    ON esdt_withdrawals (primary_tx_hash)
    WHERE primary_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS esdt_withdrawals_operation_idx
    ON esdt_withdrawals (makex_operation_id)
    WHERE makex_operation_id IS NOT NULL;

ALTER TABLE esdt_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE esdt_withdrawals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE esdt_withdrawals TO service_role;

COMMENT ON TABLE esdt_withdrawals IS
    'One durable virtual-account reservation per Discord ESDT withdrawal. Service role only.';

CREATE OR REPLACE FUNCTION reserve_esdt_withdrawal(
    p_withdrawal_id text,
    p_discord_interaction_id text,
    p_guild_id text,
    p_user_id text,
    p_token_identifier text,
    p_token_ticker text,
    p_amount_human text,
    p_amount_raw text,
    p_decimals integer,
    p_recipient_wallet text,
    p_sender_wallet text,
    p_memo text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_account virtual_accounts%ROWTYPE;
    v_existing esdt_withdrawals%ROWTYPE;
    v_balances jsonb;
    v_key text;
    v_ticker text;
    v_ticker_key text;
    v_current numeric := 0;
    v_ticker_amount numeric := 0;
    v_amount numeric;
    v_reserved numeric := 0;
    v_new numeric;
    v_ledger_id text;
    v_now_ms bigint;
    k text;
BEGIN
    IF p_withdrawal_id !~ '^[A-Za-z0-9:_-]{8,200}$' THEN
        RAISE EXCEPTION 'invalid_withdrawal_id';
    END IF;
    IF p_discord_interaction_id !~ '^[0-9]{10,32}$' THEN
        RAISE EXCEPTION 'invalid_interaction_id';
    END IF;
    IF p_amount_human !~ '^[0-9]+(\.[0-9]+)?$' OR p_amount_raw !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF p_decimals < 0 OR p_decimals > 18 THEN
        RAISE EXCEPTION 'invalid_decimals';
    END IF;

    v_amount := p_amount_human::numeric;
    IF v_amount <= 0 OR (v_amount * power(10::numeric, p_decimals)) <> p_amount_raw::numeric THEN
        RAISE EXCEPTION 'amount_raw_mismatch';
    END IF;

    SELECT * INTO v_account
    FROM virtual_accounts
    WHERE guild_id = p_guild_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'virtual_account_not_found';
    END IF;

    SELECT * INTO v_existing
    FROM esdt_withdrawals
    WHERE discord_interaction_id = p_discord_interaction_id
       OR withdrawal_id = p_withdrawal_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.token_identifier IS DISTINCT FROM p_token_identifier
           OR v_existing.amount_raw IS DISTINCT FROM p_amount_raw
           OR lower(v_existing.recipient_wallet) IS DISTINCT FROM lower(p_recipient_wallet)
           OR lower(v_existing.sender_wallet) IS DISTINCT FROM lower(p_sender_wallet) THEN
            RAISE EXCEPTION 'idempotency_conflict';
        END IF;
        RETURN jsonb_build_object('created', false, 'insufficient', false, 'record', to_jsonb(v_existing));
    END IF;

    v_balances := COALESCE(v_account.balances, '{}'::jsonb);
    v_ticker := split_part(p_token_identifier, '-', 1);
    v_key := NULL;
    v_ticker_key := NULL;

    FOR k IN SELECT jsonb_object_keys(v_balances) LOOP
        IF lower(k) = lower(p_token_identifier) THEN
            v_key := k;
        ELSIF v_ticker <> '' AND lower(k) = lower(v_ticker) THEN
            v_ticker_key := k;
        END IF;
    END LOOP;

    IF v_key IS NOT NULL THEN
        v_current := COALESCE((v_balances->>v_key)::numeric, 0);
    END IF;
    IF v_ticker_key IS NOT NULL THEN
        v_ticker_amount := COALESCE((v_balances->>v_ticker_key)::numeric, 0);
        v_current := v_current + v_ticker_amount;
        v_balances := v_balances - v_ticker_key;
    END IF;

    v_key := p_token_identifier;

    SELECT COALESCE(SUM(r.reserved_amount::numeric), 0) INTO v_reserved
    FROM auction_bid_reservations r
    WHERE r.guild_id = p_guild_id
      AND r.user_id = p_user_id
      AND r.status = 'ACTIVE'
      AND lower(r.token_identifier) = lower(p_token_identifier);

    IF v_current - v_reserved < v_amount OR v_current < v_amount THEN
        RETURN jsonb_build_object(
            'created', false,
            'insufficient', true,
            'available', GREATEST(v_current - v_reserved, 0)::text,
            'record', NULL
        );
    END IF;

    v_new := v_current - v_amount;
    IF v_new < v_reserved THEN
        RETURN jsonb_build_object('created', false, 'insufficient', true, 'available', (v_current - v_reserved)::text, 'record', NULL);
    END IF;

    v_balances := jsonb_set(v_balances, ARRAY[v_key], to_jsonb(v_new::text));
    v_now_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;

    UPDATE virtual_accounts
    SET balances = v_balances,
        last_updated = v_now_ms,
        updated_at = NOW()
    WHERE guild_id = p_guild_id AND user_id = p_user_id;

    v_ledger_id := 'esdt-reserve:' || p_withdrawal_id;
    INSERT INTO virtual_account_transactions (
        guild_id, user_id, transaction_id, type, token, amount,
        balance_before, balance_after, tx_hash, source, timestamp, description
    ) VALUES (
        p_guild_id, p_user_id, v_ledger_id, 'deduction', p_token_identifier, p_amount_human,
        v_current::text, v_new::text, NULL, 'esdt_withdrawal', v_now_ms,
        'withdrawal reserved ' || p_withdrawal_id
    );

    INSERT INTO esdt_withdrawals (
        withdrawal_id, discord_interaction_id, guild_id, user_id, token_identifier, token_ticker,
        amount_human, amount_raw, decimals, recipient_wallet, sender_wallet, memo, status,
        balance_before, balance_after, ledger_transaction_id
    ) VALUES (
        p_withdrawal_id, p_discord_interaction_id, p_guild_id, p_user_id, p_token_identifier, p_token_ticker,
        p_amount_human, p_amount_raw, p_decimals, p_recipient_wallet, p_sender_wallet, p_memo, 'RESERVED',
        v_current::text, v_new::text, v_ledger_id
    )
    RETURNING * INTO v_existing;

    RETURN jsonb_build_object('created', true, 'insufficient', false, 'record', to_jsonb(v_existing));
END;
$$;

CREATE OR REPLACE FUNCTION claim_esdt_withdrawal_lease(
    p_withdrawal_id text,
    p_owner text,
    p_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_withdrawals%ROWTYPE;
BEGIN
    UPDATE esdt_withdrawals
    SET processing_owner = p_owner,
        processing_lease_until = clock_timestamp() + make_interval(secs => GREATEST(p_seconds, 1)),
        updated_at = clock_timestamp()
    WHERE withdrawal_id = p_withdrawal_id
      AND status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
      AND (
          processing_lease_until IS NULL
          OR processing_lease_until < clock_timestamp()
          OR processing_owner = p_owner
      )
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        SELECT * INTO v_row FROM esdt_withdrawals WHERE withdrawal_id = p_withdrawal_id;
        RETURN jsonb_build_object('acquired', false, 'record', CASE WHEN v_row.withdrawal_id IS NULL THEN NULL ELSE to_jsonb(v_row) END);
    END IF;

    RETURN jsonb_build_object('acquired', true, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION release_esdt_withdrawal_lease(
    p_withdrawal_id text,
    p_owner text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE esdt_withdrawals
    SET processing_owner = NULL,
        processing_lease_until = NULL,
        updated_at = clock_timestamp()
    WHERE withdrawal_id = p_withdrawal_id
      AND processing_owner = p_owner;
    RETURN jsonb_build_object('released', FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION confirm_esdt_withdrawal(
    p_withdrawal_id text,
    p_tx_hash text,
    p_operation_id text,
    p_http_status integer,
    p_fee_exempt boolean,
    p_usage_fee text,
    p_usage_fee_hash text,
    p_nonce text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_withdrawals%ROWTYPE;
BEGIN
    IF p_tx_hash IS NULL OR p_tx_hash !~ '^[0-9a-fA-F]{16,128}$' THEN
        RAISE EXCEPTION 'invalid_tx_hash';
    END IF;

    SELECT * INTO v_row FROM esdt_withdrawals WHERE withdrawal_id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'withdrawal_not_found';
    END IF;

    IF v_row.status = 'CONFIRMED' THEN
        IF v_row.primary_tx_hash IS NOT DISTINCT FROM p_tx_hash THEN
            RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
        END IF;
        RAISE EXCEPTION 'withdrawal_already_confirmed';
    END IF;

    IF v_row.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION') THEN
        RAISE EXCEPTION 'invalid_transition';
    END IF;

    UPDATE esdt_withdrawals
    SET status = 'CONFIRMED',
        primary_tx_hash = p_tx_hash,
        makex_operation_id = COALESCE(p_operation_id, makex_operation_id),
        http_status = COALESCE(p_http_status, http_status),
        fee_exempt = p_fee_exempt,
        usage_fee = p_usage_fee,
        usage_fee_hash = p_usage_fee_hash,
        nonce = COALESCE(p_nonce, nonce),
        error_code = NULL,
        error_message = NULL,
        confirmed_at = clock_timestamp(),
        updated_at = clock_timestamp(),
        processing_owner = NULL,
        processing_lease_until = NULL
    WHERE withdrawal_id = p_withdrawal_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION mark_esdt_withdrawal_unresolved(
    p_withdrawal_id text,
    p_status text,
    p_operation_id text,
    p_owned_tx_hash text,
    p_blocking_tx_hash text,
    p_untrusted_tx_hash text,
    p_reservation_state text,
    p_http_status integer,
    p_error_code text,
    p_error_message text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_withdrawals%ROWTYPE;
    v_status text;
BEGIN
    v_status := CASE WHEN p_status = 'NEEDS_RECONCILIATION' THEN 'NEEDS_RECONCILIATION' ELSE 'PENDING' END;

    SELECT * INTO v_row FROM esdt_withdrawals WHERE withdrawal_id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'withdrawal_not_found';
    END IF;
    IF v_row.status IN ('CONFIRMED', 'FAILED') THEN
        RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    IF v_row.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION') THEN
        RAISE EXCEPTION 'invalid_transition';
    END IF;

    UPDATE esdt_withdrawals
    SET status = v_status,
        primary_tx_hash = COALESCE(p_owned_tx_hash, primary_tx_hash),
        blocking_tx_hash = COALESCE(p_blocking_tx_hash, blocking_tx_hash),
        untrusted_tx_hash = COALESCE(p_untrusted_tx_hash, untrusted_tx_hash),
        makex_operation_id = COALESCE(p_operation_id, makex_operation_id),
        reservation_state = COALESCE(p_reservation_state, reservation_state),
        http_status = COALESCE(p_http_status, http_status),
        error_code = COALESCE(p_error_code, error_code),
        error_message = COALESCE(p_error_message, error_message),
        updated_at = clock_timestamp()
    WHERE withdrawal_id = p_withdrawal_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION fail_esdt_withdrawal(
    p_withdrawal_id text,
    p_authoritative boolean,
    p_error_code text,
    p_error_message text,
    p_http_status integer,
    p_operation_id text,
    p_owned_tx_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_withdrawals%ROWTYPE;
    v_account virtual_accounts%ROWTYPE;
    v_balances jsonb;
    v_key text;
    v_current numeric;
    v_new numeric;
    v_ledger_id text;
    v_now_ms bigint;
    k text;
BEGIN
    IF p_authoritative IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'authoritative_non_payment_required';
    END IF;

    SELECT * INTO v_row FROM esdt_withdrawals WHERE withdrawal_id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'withdrawal_not_found';
    END IF;
    IF v_row.status = 'FAILED' AND v_row.restored_at IS NOT NULL THEN
        RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    IF v_row.status = 'CONFIRMED' OR v_row.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION') THEN
        RAISE EXCEPTION 'invalid_transition';
    END IF;

    SELECT * INTO v_account
    FROM virtual_accounts
    WHERE guild_id = v_row.guild_id AND user_id = v_row.user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'virtual_account_not_found';
    END IF;

    v_balances := COALESCE(v_account.balances, '{}'::jsonb);
    v_key := NULL;
    FOR k IN SELECT jsonb_object_keys(v_balances) LOOP
        IF lower(k) = lower(v_row.token_identifier) THEN
            v_key := k;
            EXIT;
        END IF;
    END LOOP;
    IF v_key IS NULL THEN
        v_current := 0;
        v_key := v_row.token_identifier;
    ELSE
        v_current := COALESCE((v_balances->>v_key)::numeric, 0);
        IF v_key IS DISTINCT FROM v_row.token_identifier THEN
            v_balances := v_balances - v_key;
            v_key := v_row.token_identifier;
        END IF;
    END IF;

    v_new := v_current + v_row.amount_human::numeric;
    v_balances := jsonb_set(v_balances, ARRAY[v_key], to_jsonb(v_new::text));
    v_now_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    v_ledger_id := 'esdt-restore:' || p_withdrawal_id;

    UPDATE virtual_accounts
    SET balances = v_balances,
        last_updated = v_now_ms,
        updated_at = NOW()
    WHERE guild_id = v_row.guild_id AND user_id = v_row.user_id;

    INSERT INTO virtual_account_transactions (
        guild_id, user_id, transaction_id, type, token, amount,
        balance_before, balance_after, tx_hash, source, timestamp, description
    ) VALUES (
        v_row.guild_id, v_row.user_id, v_ledger_id, 'deposit', v_row.token_identifier, v_row.amount_human,
        v_current::text, v_new::text, NULL, 'esdt_withdrawal_restore', v_now_ms,
        'esdt withdrawal restored (authoritative non-payment) ' || p_withdrawal_id
    );

    UPDATE esdt_withdrawals
    SET status = 'FAILED',
        balance_after = v_new::text,
        restoration_transaction_id = v_ledger_id,
        restored_at = clock_timestamp(),
        failed_at = clock_timestamp(),
        updated_at = clock_timestamp(),
        error_code = COALESCE(p_error_code, error_code),
        error_message = COALESCE(p_error_message, error_message),
        http_status = COALESCE(p_http_status, http_status),
        makex_operation_id = COALESCE(p_operation_id, makex_operation_id),
        primary_tx_hash = COALESCE(p_owned_tx_hash, primary_tx_hash),
        processing_owner = NULL,
        processing_lease_until = NULL
    WHERE withdrawal_id = p_withdrawal_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION list_unresolved_esdt_withdrawals(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_rows jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT *
        FROM esdt_withdrawals
        WHERE status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
          AND (processing_lease_until IS NULL OR processing_lease_until < clock_timestamp())
        ORDER BY updated_at ASC
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 100), 1)
    ) w;
    RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION reserve_esdt_withdrawal(text, text, text, text, text, text, text, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_esdt_withdrawal_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_esdt_withdrawal_lease(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_esdt_withdrawal(text, text, text, integer, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_esdt_withdrawal_unresolved(text, text, text, text, text, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_esdt_withdrawal(text, boolean, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION list_unresolved_esdt_withdrawals(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION reserve_esdt_withdrawal(text, text, text, text, text, text, text, text, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_esdt_withdrawal_lease(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION release_esdt_withdrawal_lease(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_esdt_withdrawal(text, text, text, integer, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_esdt_withdrawal_unresolved(text, text, text, text, text, text, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION fail_esdt_withdrawal(text, boolean, text, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION list_unresolved_esdt_withdrawals(integer) TO service_role;

GRANT SELECT, UPDATE ON virtual_accounts TO service_role;
GRANT INSERT ON virtual_account_transactions TO service_role;
GRANT SELECT ON auction_bid_reservations TO service_role;
