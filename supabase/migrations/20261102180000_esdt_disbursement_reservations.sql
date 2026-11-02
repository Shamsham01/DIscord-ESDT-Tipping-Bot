-- Durable identities for ESDT payments other than /withdraw-esdt.
-- Applying this file creates a table and functions only. It does not move balances,
-- replay historical withdrawals, or send a blockchain transaction.

CREATE TABLE IF NOT EXISTS esdt_disbursements (
    disbursement_id TEXT PRIMARY KEY,
    operation_kind TEXT NOT NULL,
    business_action_id TEXT NOT NULL,
    discord_interaction_id TEXT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    counterparty_guild_id TEXT,
    counterparty_user_id TEXT,
    token_identifier TEXT NOT NULL,
    token_ticker TEXT NOT NULL,
    amount_human TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    recipient_wallet TEXT NOT NULL,
    sender_wallet TEXT NOT NULL,
    memo TEXT,
    reserves_balance BOOLEAN NOT NULL DEFAULT FALSE,
    replayable BOOLEAN NOT NULL DEFAULT TRUE,
    expect_fee_exempt BOOLEAN NOT NULL DEFAULT FALSE,
    effect_required BOOLEAN NOT NULL DEFAULT FALSE,
    effect_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    block_scope TEXT NOT NULL DEFAULT 'none',
    status TEXT NOT NULL,
    balance_before TEXT,
    balance_after TEXT,
    ledger_transaction_id TEXT,
    restoration_transaction_id TEXT,
    credit_transaction_id TEXT,
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
    dispatched_at TIMESTAMPTZ,
    effect_applied_at TIMESTAMPTZ,
    processing_owner TEXT,
    processing_fence TEXT,
    processing_lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    restored_at TIMESTAMPTZ,
    CONSTRAINT esdt_disbursements_status_check CHECK (
        status IN ('RESERVED', 'PENDING', 'CONFIRMED', 'FAILED', 'NEEDS_RECONCILIATION')
    ),
    CONSTRAINT esdt_disbursements_kind_check CHECK (
        operation_kind IN (
            'mass_refund', 'house_withdraw', 'subscription', 'pool_fee',
            'cross_guild', 'admin_send', 'nft_transfer'
        )
    ),
    CONSTRAINT esdt_disbursements_block_check CHECK (
        block_scope IN ('none', 'guild-kind', 'other-interaction', 'guild-user-kind', 'recipient', 'asset')
    ),
    CONSTRAINT esdt_disbursements_amount_raw_check CHECK (amount_raw ~ '^[0-9]+$'),
    CONSTRAINT esdt_disbursements_decimals_check CHECK (decimals >= 0 AND decimals <= 18),
    CONSTRAINT esdt_disbursements_id_check CHECK (disbursement_id ~ '^[A-Za-z0-9:_-]{8,200}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS esdt_disbursements_business_action_uidx
    ON esdt_disbursements (business_action_id);

CREATE INDEX IF NOT EXISTS esdt_disbursements_open_idx
    ON esdt_disbursements (guild_id, operation_kind, updated_at)
    WHERE status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION');

CREATE INDEX IF NOT EXISTS esdt_disbursements_effect_idx
    ON esdt_disbursements (updated_at)
    WHERE effect_required IS TRUE AND status = 'CONFIRMED' AND effect_applied_at IS NULL;

ALTER TABLE esdt_disbursements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE esdt_disbursements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE esdt_disbursements TO service_role;

COMMENT ON TABLE esdt_disbursements IS
    'One durable MakeX identity per Community Fund or project ESDT payment that is not a /withdraw-esdt row. Service role only.';

CREATE OR REPLACE FUNCTION esdt_disbursement_is_open(
    p_status text,
    p_effect_required boolean,
    p_effect_applied_at timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
        OR (p_effect_required IS TRUE AND p_status = 'CONFIRMED' AND p_effect_applied_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION reserve_esdt_disbursement(
    p_disbursement_id text,
    p_operation_kind text,
    p_business_action_id text,
    p_discord_interaction_id text,
    p_guild_id text,
    p_user_id text,
    p_counterparty_guild_id text,
    p_counterparty_user_id text,
    p_token_identifier text,
    p_token_ticker text,
    p_amount_human text,
    p_amount_raw text,
    p_decimals integer,
    p_recipient_wallet text,
    p_sender_wallet text,
    p_memo text,
    p_reserves_balance boolean,
    p_replayable boolean,
    p_expect_fee_exempt boolean,
    p_effect_required boolean,
    p_effect_payload jsonb,
    p_block_scope text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_account virtual_accounts%ROWTYPE;
    v_existing esdt_disbursements%ROWTYPE;
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
    IF p_disbursement_id !~ '^[A-Za-z0-9:_-]{8,200}$' OR p_business_action_id !~ '^[A-Za-z0-9:_-]{8,200}$' THEN
        RAISE EXCEPTION 'invalid_disbursement_id';
    END IF;
    IF p_discord_interaction_id IS NOT NULL AND p_discord_interaction_id !~ '^[0-9]{10,32}$' THEN
        RAISE EXCEPTION 'invalid_interaction_id';
    END IF;
    IF p_operation_kind NOT IN (
        'mass_refund', 'house_withdraw', 'subscription', 'pool_fee',
        'cross_guild', 'admin_send', 'nft_transfer'
    ) THEN
        RAISE EXCEPTION 'invalid_operation_kind';
    END IF;
    IF p_block_scope NOT IN ('none', 'guild-kind', 'other-interaction', 'guild-user-kind', 'recipient', 'asset') THEN
        RAISE EXCEPTION 'invalid_block_scope';
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

    -- Serialize the disbursement id, and the business block scope, before any
    -- virtual-account row lock. Two requests that do not share a virtual
    -- account would otherwise both pass the later IF EXISTS checks.
    -- hashtext collisions only add extra waiting; they do not allow a second pay.
    PERFORM pg_advisory_xact_lock(hashtext('esdt-disburse-id'), hashtext(p_disbursement_id));
    IF p_business_action_id IS DISTINCT FROM p_disbursement_id THEN
        PERFORM pg_advisory_xact_lock(hashtext('esdt-disburse-biz'), hashtext(p_business_action_id));
    END IF;
    IF p_block_scope IS DISTINCT FROM 'none' THEN
        PERFORM pg_advisory_xact_lock(
            hashtext('esdt-disburse-scope'),
            hashtext(
                CASE p_block_scope
                    WHEN 'guild-kind' THEN p_guild_id || '|' || p_operation_kind
                    WHEN 'other-interaction' THEN p_guild_id || '|' || p_operation_kind
                    WHEN 'guild-user-kind' THEN p_guild_id || '|' || p_user_id || '|' || p_operation_kind
                    WHEN 'recipient' THEN p_guild_id || '|' || p_operation_kind || '|'
                        || lower(p_sender_wallet) || '|' || lower(p_recipient_wallet) || '|'
                        || lower(p_token_identifier)
                    WHEN 'asset' THEN p_guild_id || '|' || p_user_id || '|' || lower(p_token_identifier)
                    ELSE p_guild_id || '|' || p_block_scope
                END
            )
        );
    END IF;

    IF p_reserves_balance IS TRUE THEN
        SELECT * INTO v_account
        FROM virtual_accounts
        WHERE guild_id = p_guild_id AND user_id = p_user_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'virtual_account_not_found';
        END IF;
    END IF;

    SELECT * INTO v_existing
    FROM esdt_disbursements
    WHERE disbursement_id = p_disbursement_id
       OR business_action_id = p_business_action_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.disbursement_id IS DISTINCT FROM p_disbursement_id
           OR v_existing.operation_kind IS DISTINCT FROM p_operation_kind
           OR v_existing.token_identifier IS DISTINCT FROM p_token_identifier
           OR v_existing.amount_raw IS DISTINCT FROM p_amount_raw
           OR lower(v_existing.recipient_wallet) IS DISTINCT FROM lower(p_recipient_wallet)
           OR lower(v_existing.sender_wallet) IS DISTINCT FROM lower(p_sender_wallet)
           OR lower(COALESCE(v_existing.counterparty_guild_id, '')) IS DISTINCT FROM lower(COALESCE(p_counterparty_guild_id, ''))
           OR COALESCE(v_existing.counterparty_user_id, '') IS DISTINCT FROM COALESCE(p_counterparty_user_id, '') THEN
            RAISE EXCEPTION 'idempotency_conflict';
        END IF;
        RETURN jsonb_build_object('created', false, 'insufficient', false, 'record', to_jsonb(v_existing));
    END IF;

    IF p_block_scope = 'guild-kind' AND EXISTS (
        SELECT 1 FROM esdt_disbursements d
        WHERE d.guild_id = p_guild_id
          AND d.operation_kind = p_operation_kind
          AND esdt_disbursement_is_open(d.status, d.effect_required, d.effect_applied_at)
    ) THEN
        RAISE EXCEPTION 'unresolved_disbursement';
    END IF;

    IF p_block_scope = 'other-interaction' AND EXISTS (
        SELECT 1 FROM esdt_disbursements d
        WHERE d.guild_id = p_guild_id
          AND d.operation_kind = p_operation_kind
          AND d.discord_interaction_id IS DISTINCT FROM p_discord_interaction_id
          AND d.status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
    ) THEN
        RAISE EXCEPTION 'unresolved_disbursement';
    END IF;

    IF p_block_scope = 'guild-user-kind' AND EXISTS (
        SELECT 1 FROM esdt_disbursements d
        WHERE d.guild_id = p_guild_id
          AND d.user_id = p_user_id
          AND d.operation_kind = p_operation_kind
          AND d.status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
    ) THEN
        RAISE EXCEPTION 'unresolved_disbursement';
    END IF;

    IF p_block_scope = 'recipient' AND EXISTS (
        SELECT 1 FROM esdt_disbursements d
        WHERE d.guild_id = p_guild_id
          AND d.operation_kind = p_operation_kind
          AND lower(d.recipient_wallet) = lower(p_recipient_wallet)
          AND lower(d.token_identifier) = lower(p_token_identifier)
          AND lower(d.sender_wallet) = lower(p_sender_wallet)
          AND d.status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
    ) THEN
        RAISE EXCEPTION 'unresolved_disbursement';
    END IF;

    IF p_block_scope = 'asset' AND EXISTS (
        SELECT 1 FROM esdt_disbursements d
        WHERE d.guild_id = p_guild_id
          AND d.user_id = p_user_id
          AND lower(d.token_identifier) = lower(p_token_identifier)
          AND d.status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
    ) THEN
        RAISE EXCEPTION 'unresolved_disbursement';
    END IF;

    v_ledger_id := NULL;
    IF p_reserves_balance IS TRUE THEN
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
            RETURN jsonb_build_object(
                'created', false,
                'insufficient', true,
                'available', (v_current - v_reserved)::text,
                'record', NULL
            );
        END IF;
        v_balances := jsonb_set(v_balances, ARRAY[v_key], to_jsonb(v_new::text));
        v_now_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
        UPDATE virtual_accounts
        SET balances = v_balances,
            last_updated = v_now_ms,
            updated_at = NOW()
        WHERE guild_id = p_guild_id AND user_id = p_user_id;
        v_ledger_id := 'esdt-disburse-reserve:' || p_disbursement_id;
        INSERT INTO virtual_account_transactions (
            guild_id, user_id, transaction_id, type, token, amount,
            balance_before, balance_after, tx_hash, source, timestamp, description
        ) VALUES (
            p_guild_id, p_user_id, v_ledger_id, 'deduction', p_token_identifier, p_amount_human,
            v_current::text, v_new::text, NULL, 'esdt_disbursement', v_now_ms,
            'disbursement reserved ' || p_disbursement_id
        );
    END IF;

    INSERT INTO esdt_disbursements (
        disbursement_id, operation_kind, business_action_id, discord_interaction_id,
        guild_id, user_id, counterparty_guild_id, counterparty_user_id,
        token_identifier, token_ticker, amount_human, amount_raw, decimals,
        recipient_wallet, sender_wallet, memo, reserves_balance, replayable,
        expect_fee_exempt, effect_required, effect_payload, block_scope, status,
        balance_before, balance_after, ledger_transaction_id
    ) VALUES (
        p_disbursement_id, p_operation_kind, p_business_action_id, p_discord_interaction_id,
        p_guild_id, p_user_id, p_counterparty_guild_id, p_counterparty_user_id,
        p_token_identifier, p_token_ticker, p_amount_human, p_amount_raw, p_decimals,
        p_recipient_wallet, p_sender_wallet, p_memo, COALESCE(p_reserves_balance, FALSE),
        COALESCE(p_replayable, TRUE), COALESCE(p_expect_fee_exempt, FALSE),
        COALESCE(p_effect_required, FALSE), COALESCE(p_effect_payload, '{}'::jsonb),
        p_block_scope, 'RESERVED',
        CASE WHEN p_reserves_balance IS TRUE THEN v_current::text ELSE NULL END,
        CASE WHEN p_reserves_balance IS TRUE THEN v_new::text ELSE NULL END,
        v_ledger_id
    )
    RETURNING * INTO v_existing;

    RETURN jsonb_build_object('created', true, 'insufficient', false, 'record', to_jsonb(v_existing));
END;
$$;

CREATE OR REPLACE FUNCTION claim_esdt_disbursement_lease(
    p_disbursement_id text,
    p_owner text,
    p_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_disbursements%ROWTYPE;
BEGIN
    UPDATE esdt_disbursements
    SET processing_owner = p_owner,
        processing_fence = gen_random_uuid()::text,
        processing_lease_until = clock_timestamp() + make_interval(secs => GREATEST(p_seconds, 1)),
        updated_at = clock_timestamp()
    WHERE disbursement_id = p_disbursement_id
      AND status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
      AND (
          processing_lease_until IS NULL
          OR processing_lease_until < clock_timestamp()
          OR processing_owner = p_owner
      )
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id;
        RETURN jsonb_build_object(
            'acquired', false,
            'record', CASE WHEN v_row.disbursement_id IS NULL THEN NULL ELSE to_jsonb(v_row) END
        );
    END IF;
    RETURN jsonb_build_object('acquired', true, 'fence', v_row.processing_fence, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION release_esdt_disbursement_lease(
    p_disbursement_id text,
    p_owner text,
    p_fence text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_released integer;
BEGIN
    UPDATE esdt_disbursements
    SET processing_owner = NULL,
        processing_fence = NULL,
        processing_lease_until = NULL,
        updated_at = clock_timestamp()
    WHERE disbursement_id = p_disbursement_id
      AND processing_owner = p_owner
      AND processing_fence = p_fence;
    GET DIAGNOSTICS v_released = ROW_COUNT;
    RETURN jsonb_build_object('released', v_released > 0);
END;
$$;

CREATE OR REPLACE FUNCTION esdt_disbursement_require_lease(
    p_row esdt_disbursements,
    p_owner text,
    p_fence text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF p_row.processing_owner IS DISTINCT FROM p_owner
       OR p_row.processing_fence IS DISTINCT FROM p_fence
       OR p_fence IS NULL
       OR p_row.processing_lease_until IS NULL
       OR p_row.processing_lease_until <= clock_timestamp() THEN
        RAISE EXCEPTION 'lease_lost';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mark_esdt_disbursement_dispatched(
    p_disbursement_id text,
    p_owner text,
    p_fence text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_disbursements%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'disbursement_not_found';
    END IF;
    IF v_row.status IN ('CONFIRMED', 'FAILED') THEN
        RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    PERFORM esdt_disbursement_require_lease(v_row, p_owner, p_fence);
    UPDATE esdt_disbursements
    SET dispatched_at = COALESCE(dispatched_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE disbursement_id = p_disbursement_id
      AND processing_owner = p_owner
      AND processing_fence = p_fence
      AND processing_lease_until > clock_timestamp()
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lease_lost';
    END IF;
    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION confirm_esdt_disbursement(
    p_disbursement_id text,
    p_owner text,
    p_fence text,
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
    v_row esdt_disbursements%ROWTYPE;
    v_account virtual_accounts%ROWTYPE;
    v_balances jsonb;
    v_key text;
    v_current numeric;
    v_new numeric;
    v_ledger_id text;
    v_now_ms bigint;
    k text;
BEGIN
    IF p_tx_hash IS NULL OR p_tx_hash !~ '^[0-9a-fA-F]{16,128}$' THEN
        RAISE EXCEPTION 'invalid_tx_hash';
    END IF;

    SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'disbursement_not_found';
    END IF;
    IF v_row.status = 'CONFIRMED' THEN
        IF v_row.primary_tx_hash IS NOT DISTINCT FROM p_tx_hash THEN
            RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
        END IF;
        RAISE EXCEPTION 'disbursement_already_confirmed';
    END IF;
    IF v_row.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION') THEN
        RAISE EXCEPTION 'invalid_transition';
    END IF;
    PERFORM esdt_disbursement_require_lease(v_row, p_owner, p_fence);

    IF v_row.counterparty_guild_id IS NOT NULL AND v_row.counterparty_user_id IS NOT NULL THEN
        SELECT * INTO v_account
        FROM virtual_accounts
        WHERE guild_id = v_row.counterparty_guild_id AND user_id = v_row.counterparty_user_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'counterparty_account_not_found';
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
        v_ledger_id := 'esdt-disburse-credit:' || p_disbursement_id;
        UPDATE virtual_accounts
        SET balances = v_balances,
            last_updated = v_now_ms,
            updated_at = NOW()
        WHERE guild_id = v_row.counterparty_guild_id AND user_id = v_row.counterparty_user_id;
        INSERT INTO virtual_account_transactions (
            guild_id, user_id, transaction_id, type, token, amount,
            balance_before, balance_after, tx_hash, source, timestamp, description
        ) VALUES (
            v_row.counterparty_guild_id, v_row.counterparty_user_id, v_ledger_id, 'deposit',
            v_row.token_identifier, v_row.amount_human,
            v_current::text, v_new::text, p_tx_hash, 'esdt_disbursement_credit', v_now_ms,
            'disbursement credited ' || p_disbursement_id
        );
    END IF;

    UPDATE esdt_disbursements
    SET status = 'CONFIRMED',
        primary_tx_hash = p_tx_hash,
        credit_transaction_id = COALESCE(v_ledger_id, credit_transaction_id),
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
        processing_fence = NULL,
        processing_lease_until = NULL
    WHERE disbursement_id = p_disbursement_id
      AND processing_owner = p_owner
      AND processing_fence = p_fence
      AND processing_lease_until > clock_timestamp()
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'lease_lost';
    END IF;
    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION mark_esdt_disbursement_unresolved(
    p_disbursement_id text,
    p_owner text,
    p_fence text,
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
    v_row esdt_disbursements%ROWTYPE;
    v_status text;
BEGIN
    v_status := CASE WHEN p_status = 'NEEDS_RECONCILIATION' THEN 'NEEDS_RECONCILIATION' ELSE 'PENDING' END;
    SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'disbursement_not_found';
    END IF;
    IF v_row.status IN ('CONFIRMED', 'FAILED') THEN
        RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    PERFORM esdt_disbursement_require_lease(v_row, p_owner, p_fence);
    UPDATE esdt_disbursements
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
    WHERE disbursement_id = p_disbursement_id
      AND processing_owner = p_owner
      AND processing_fence = p_fence
      AND processing_lease_until > clock_timestamp()
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lease_lost';
    END IF;
    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION fail_esdt_disbursement(
    p_disbursement_id text,
    p_owner text,
    p_fence text,
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
    v_row esdt_disbursements%ROWTYPE;
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
    SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'disbursement_not_found';
    END IF;
    IF v_row.status = 'FAILED' AND (v_row.reserves_balance IS NOT TRUE OR v_row.restored_at IS NOT NULL) THEN
        RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    IF v_row.status = 'CONFIRMED' OR v_row.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION', 'FAILED') THEN
        RAISE EXCEPTION 'invalid_transition';
    END IF;
    PERFORM esdt_disbursement_require_lease(v_row, p_owner, p_fence);

    v_new := NULL;
    v_ledger_id := NULL;
    IF v_row.reserves_balance IS TRUE AND v_row.restored_at IS NULL THEN
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
        v_ledger_id := 'esdt-disburse-restore:' || p_disbursement_id;
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
            v_current::text, v_new::text, NULL, 'esdt_disbursement_restore', v_now_ms,
            'disbursement restored (authoritative non-payment) ' || p_disbursement_id
        );
    END IF;

    UPDATE esdt_disbursements
    SET status = 'FAILED',
        balance_after = COALESCE(v_new::text, balance_after),
        restoration_transaction_id = COALESCE(v_ledger_id, restoration_transaction_id),
        restored_at = CASE WHEN v_row.reserves_balance IS TRUE THEN clock_timestamp() ELSE restored_at END,
        failed_at = clock_timestamp(),
        updated_at = clock_timestamp(),
        error_code = COALESCE(p_error_code, error_code),
        error_message = COALESCE(p_error_message, error_message),
        http_status = COALESCE(p_http_status, http_status),
        makex_operation_id = COALESCE(p_operation_id, makex_operation_id),
        primary_tx_hash = COALESCE(p_owned_tx_hash, primary_tx_hash),
        processing_owner = NULL,
        processing_fence = NULL,
        processing_lease_until = NULL
    WHERE disbursement_id = p_disbursement_id
      AND processing_owner = p_owner
      AND processing_fence = p_fence
      AND processing_lease_until > clock_timestamp()
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lease_lost';
    END IF;
    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION note_esdt_disbursement_effect(p_disbursement_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_disbursements%ROWTYPE;
    v_house house_balance%ROWTYPE;
    v_source text;
    v_spending jsonb;
    v_earnings jsonb;
    v_pnl jsonb;
    v_current numeric;
    v_earn numeric;
    v_new numeric;
BEGIN
    SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'disbursement_not_found';
    END IF;
    IF v_row.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'effect_not_ready';
    END IF;
    IF v_row.effect_required IS NOT TRUE THEN
        RETURN jsonb_build_object('claimed', false, 'idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    IF v_row.effect_applied_at IS NOT NULL THEN
        RETURN jsonb_build_object('claimed', false, 'idempotent', true, 'record', to_jsonb(v_row));
    END IF;

    IF v_row.operation_kind = 'house_withdraw' THEN
        v_source := COALESCE(v_row.effect_payload->>'source', '');
        IF v_source NOT IN ('betting', 'auction', 'lottery', 'drop') THEN
            RAISE EXCEPTION 'invalid_house_source';
        END IF;
        SELECT * INTO v_house
        FROM house_balance
        WHERE guild_id = v_row.guild_id AND token_identifier = v_row.token_identifier
        FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO house_balance (guild_id, token_identifier)
            VALUES (v_row.guild_id, v_row.token_identifier)
            RETURNING * INTO v_house;
        END IF;
        IF v_source = 'betting' THEN
            v_spending := COALESCE(v_house.betting_spending, '{}'::jsonb);
            v_earnings := COALESCE(v_house.betting_earnings, '{}'::jsonb);
        ELSIF v_source = 'auction' THEN
            v_spending := COALESCE(v_house.auction_spending, '{}'::jsonb);
            v_earnings := COALESCE(v_house.auction_earnings, '{}'::jsonb);
        ELSIF v_source = 'lottery' THEN
            v_spending := COALESCE(v_house.lottery_spending, '{}'::jsonb);
            v_earnings := COALESCE(v_house.lottery_earnings, '{}'::jsonb);
        ELSE
            v_spending := COALESCE(v_house.drop_spending, '{}'::jsonb);
            v_earnings := COALESCE(v_house.drop_earnings, '{}'::jsonb);
        END IF;
        v_current := COALESCE((v_spending->>v_row.token_identifier)::numeric, 0);
        v_earn := COALESCE((v_earnings->>v_row.token_identifier)::numeric, 0);
        v_new := v_current + v_row.amount_raw::numeric;
        v_spending := jsonb_set(v_spending, ARRAY[v_row.token_identifier], to_jsonb(v_new::text));
        v_pnl := jsonb_build_object(v_row.token_identifier, (v_earn - v_new)::text);
        IF v_source = 'betting' THEN
            UPDATE house_balance
            SET betting_spending = v_spending,
                betting_pnl = COALESCE(betting_pnl, '{}'::jsonb) || v_pnl,
                updated_at = NOW()
            WHERE guild_id = v_row.guild_id AND token_identifier = v_row.token_identifier;
        ELSIF v_source = 'auction' THEN
            UPDATE house_balance
            SET auction_spending = v_spending,
                auction_pnl = COALESCE(auction_pnl, '{}'::jsonb) || v_pnl,
                updated_at = NOW()
            WHERE guild_id = v_row.guild_id AND token_identifier = v_row.token_identifier;
        ELSIF v_source = 'lottery' THEN
            UPDATE house_balance
            SET lottery_spending = v_spending,
                lottery_pnl = COALESCE(lottery_pnl, '{}'::jsonb) || v_pnl,
                updated_at = NOW()
            WHERE guild_id = v_row.guild_id AND token_identifier = v_row.token_identifier;
        ELSE
            UPDATE house_balance
            SET drop_spending = v_spending,
                drop_pnl = COALESCE(drop_pnl, '{}'::jsonb) || v_pnl,
                updated_at = NOW()
            WHERE guild_id = v_row.guild_id AND token_identifier = v_row.token_identifier;
        END IF;
    END IF;

    UPDATE esdt_disbursements
    SET effect_applied_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE disbursement_id = p_disbursement_id
      AND effect_applied_at IS NULL
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        SELECT * INTO v_row FROM esdt_disbursements WHERE disbursement_id = p_disbursement_id;
        RETURN jsonb_build_object('claimed', false, 'idempotent', true, 'record', to_jsonb(v_row));
    END IF;
    RETURN jsonb_build_object('claimed', true, 'idempotent', false, 'record', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION list_unresolved_esdt_disbursements(p_limit integer)
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
        FROM esdt_disbursements
        WHERE status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
          AND (processing_lease_until IS NULL OR processing_lease_until < clock_timestamp())
        ORDER BY updated_at ASC
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 100), 1)
    ) w;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION list_esdt_disbursement_effects(p_limit integer)
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
        FROM esdt_disbursements
        WHERE effect_required IS TRUE
          AND status = 'CONFIRMED'
          AND effect_applied_at IS NULL
        ORDER BY updated_at ASC
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 100), 1)
    ) w;
    RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION esdt_disbursement_is_open(text, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reserve_esdt_disbursement(text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, boolean, boolean, boolean, boolean, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_esdt_disbursement_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_esdt_disbursement_lease(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION esdt_disbursement_require_lease(esdt_disbursements, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_esdt_disbursement_dispatched(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_esdt_disbursement(text, text, text, text, text, integer, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_esdt_disbursement_unresolved(text, text, text, text, text, text, text, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_esdt_disbursement(text, text, text, boolean, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION note_esdt_disbursement_effect(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION list_unresolved_esdt_disbursements(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION list_esdt_disbursement_effects(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION esdt_disbursement_is_open(text, boolean, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION reserve_esdt_disbursement(text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, boolean, boolean, boolean, boolean, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_esdt_disbursement_lease(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION release_esdt_disbursement_lease(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION esdt_disbursement_require_lease(esdt_disbursements, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_esdt_disbursement_dispatched(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_esdt_disbursement(text, text, text, text, text, integer, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_esdt_disbursement_unresolved(text, text, text, text, text, text, text, text, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION fail_esdt_disbursement(text, text, text, boolean, text, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION note_esdt_disbursement_effect(text) TO service_role;
GRANT EXECUTE ON FUNCTION list_unresolved_esdt_disbursements(integer) TO service_role;
GRANT EXECUTE ON FUNCTION list_esdt_disbursement_effects(integer) TO service_role;

GRANT SELECT, UPDATE ON virtual_accounts TO service_role;
GRANT INSERT ON virtual_account_transactions TO service_role;
GRANT SELECT ON auction_bid_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE ON house_balance TO service_role;
