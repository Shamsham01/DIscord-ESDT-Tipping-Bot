-- Atomic Virtual Account settlement for one confirmed NFT or SFT withdrawal.
-- This creates a function and adds missing inventory columns. It does not move
-- balances, replay a withdrawal, or send a blockchain transaction.

ALTER TABLE virtual_account_nft_balances
    ADD COLUMN IF NOT EXISTS amount INTEGER,
    ADD COLUMN IF NOT EXISTS token_type TEXT;

ALTER TABLE virtual_account_nft_transactions
    ADD COLUMN IF NOT EXISTS amount INTEGER,
    ADD COLUMN IF NOT EXISTS token_type TEXT;

CREATE OR REPLACE FUNCTION settle_nft_disbursement_withdrawal(
    p_disbursement_id text,
    p_owner text,
    p_fence text,
    p_tx_hash text,
    p_operation_id text,
    p_http_status integer,
    p_fee_exempt boolean,
    p_usage_fee text,
    p_usage_fee_hash text,
    p_chain_nonce text,
    p_guild_id text,
    p_user_id text,
    p_recipient text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row esdt_disbursements%ROWTYPE;
    v_balance virtual_account_nft_balances%ROWTYPE;
    v_assets jsonb;
    v_collection text;
    v_nonce integer;
    v_quantity integer;
    v_identifier text;
    v_current integer;
    v_now_ms bigint;
    v_ledger_id text;
    v_expected integer := 0;
    v_existing integer := 0;
    v_nonce_hex text;
    v_hex_index integer;
    v_hex_value integer;
    v_digit text;
    v_item jsonb;
    v_index integer;
BEGIN
    IF p_tx_hash IS NULL OR p_tx_hash !~ '^[0-9a-fA-F]{16,128}$' THEN
        RAISE EXCEPTION 'invalid_tx_hash';
    END IF;

    SELECT * INTO v_row
    FROM esdt_disbursements
    WHERE disbursement_id = p_disbursement_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'disbursement_not_found';
    END IF;
    IF v_row.operation_kind IS DISTINCT FROM 'nft_transfer' THEN
        RAISE EXCEPTION 'nft_settlement_mismatch';
    END IF;
    IF v_row.guild_id IS DISTINCT FROM p_guild_id
       OR v_row.user_id IS DISTINCT FROM p_user_id
       OR lower(v_row.recipient_wallet) IS DISTINCT FROM lower(p_recipient) THEN
        RAISE EXCEPTION 'nft_settlement_mismatch';
    END IF;

    IF left(v_row.token_identifier, 5) = 'bulk:' THEN
        v_assets := v_row.effect_payload->'assets';
        IF jsonb_typeof(v_assets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_assets) < 1 THEN
            RAISE EXCEPTION 'nft_settlement_mismatch';
        END IF;
    ELSE
        IF v_row.token_identifier !~ '^[A-Za-z0-9]+-[A-Za-z0-9]+-[0-9a-fA-F]{1,8}$' THEN
            RAISE EXCEPTION 'nft_settlement_mismatch';
        END IF;
        v_nonce_hex := lower(regexp_replace(v_row.token_identifier, '^.*-', ''));
        v_collection := regexp_replace(v_row.token_identifier, '-[0-9a-fA-F]+$', '');
        v_nonce := 0;
        FOR v_hex_index IN 1..length(v_nonce_hex) LOOP
            v_digit := substr(v_nonce_hex, v_hex_index, 1);
            v_hex_value := strpos('0123456789abcdef', v_digit) - 1;
            IF v_hex_value < 0 THEN
                RAISE EXCEPTION 'nft_settlement_mismatch';
            END IF;
            v_nonce := v_nonce * 16 + v_hex_value;
        END LOOP;
        IF v_row.amount_raw !~ '^[0-9]+$' OR v_row.amount_raw::numeric > 2147483647 THEN
            RAISE EXCEPTION 'nft_settlement_mismatch';
        END IF;
        v_quantity := v_row.amount_raw::integer;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'nft_settlement_mismatch';
        END IF;
        v_assets := jsonb_build_array(jsonb_build_object(
            'collection', v_collection,
            'nonce', v_nonce,
            'quantity', v_quantity,
            'identifier', v_row.token_identifier
        ));
        IF jsonb_typeof(v_row.effect_payload->'assets') = 'array'
           AND jsonb_array_length(v_row.effect_payload->'assets') > 0
           AND v_row.effect_payload->'assets' <> v_assets THEN
            IF jsonb_array_length(v_row.effect_payload->'assets') IS DISTINCT FROM 1
               OR (v_row.effect_payload->'assets'->0->>'collection') IS DISTINCT FROM v_collection
               OR (v_row.effect_payload->'assets'->0->>'nonce')::integer IS DISTINCT FROM v_nonce
               OR (v_row.effect_payload->'assets'->0->>'quantity')::integer IS DISTINCT FROM v_quantity THEN
                RAISE EXCEPTION 'nft_settlement_mismatch';
            END IF;
        END IF;
    END IF;

    SELECT COALESCE(sum((value->>'quantity')::integer), 0)::integer INTO v_quantity
    FROM jsonb_array_elements(v_assets);
    IF v_quantity::text IS DISTINCT FROM v_row.amount_raw THEN
        RAISE EXCEPTION 'nft_settlement_mismatch';
    END IF;

    SELECT count(*)::integer INTO v_expected FROM jsonb_array_elements(v_assets);
    SELECT count(*)::integer INTO v_existing
    FROM virtual_account_nft_transactions
    WHERE guild_id = v_row.guild_id
      AND user_id = v_row.user_id
      AND transaction_id LIKE 'nft-settle:' || p_disbursement_id || ':%';

    IF v_row.status = 'CONFIRMED' THEN
        IF v_row.primary_tx_hash IS NOT DISTINCT FROM p_tx_hash AND v_existing = v_expected THEN
            RETURN jsonb_build_object('idempotent', true, 'record', to_jsonb(v_row), 'settled', v_existing);
        END IF;
        RAISE EXCEPTION 'disbursement_already_confirmed';
    END IF;
    IF v_row.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION') THEN
        RAISE EXCEPTION 'invalid_transition';
    END IF;
    PERFORM esdt_disbursement_require_lease(v_row, p_owner, p_fence);

    v_index := 0;
    WHILE v_index < jsonb_array_length(v_assets) LOOP
        v_item := v_assets->v_index;
        v_index := v_index + 1;
        v_collection := v_item->>'collection';
        v_nonce := (v_item->>'nonce')::integer;
        v_quantity := (v_item->>'quantity')::integer;
        v_identifier := COALESCE(v_item->>'identifier', v_item->>'tokenIdentifier');
        IF v_collection IS NULL OR v_nonce IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_identifier IS NULL THEN
            RAISE EXCEPTION 'nft_settlement_mismatch';
        END IF;

        SELECT * INTO v_balance
        FROM virtual_account_nft_balances
        WHERE guild_id = v_row.guild_id
          AND user_id = v_row.user_id
          AND collection = v_collection
          AND nonce = v_nonce
        FOR UPDATE;
        IF NOT FOUND OR COALESCE(v_balance.staked, false) THEN
            RAISE EXCEPTION 'nft_balance_missing';
        END IF;
        v_current := COALESCE(v_balance.amount, 1);
        IF v_current < v_quantity THEN
            RAISE EXCEPTION 'nft_balance_insufficient';
        END IF;

        IF v_current = v_quantity THEN
            DELETE FROM virtual_account_nft_balances
            WHERE id = v_balance.id;
        ELSE
            UPDATE virtual_account_nft_balances
            SET amount = v_current - v_quantity,
                updated_at = clock_timestamp()
            WHERE id = v_balance.id;
        END IF;

        v_now_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
        v_ledger_id := 'nft-settle:' || p_disbursement_id || ':' || v_identifier;
        INSERT INTO virtual_account_nft_transactions (
            guild_id, user_id, transaction_id, type, collection, identifier, nonce,
            nft_name, amount, token_type, tx_hash, source, timestamp, description
        ) VALUES (
            v_row.guild_id, v_row.user_id, v_ledger_id, 'withdraw', v_collection, v_identifier, v_nonce,
            v_balance.nft_name, v_quantity, COALESCE(v_balance.token_type, 'NFT'), p_tx_hash,
            'nft_disbursement_settlement', v_now_ms,
            'withdrawal settled ' || p_disbursement_id
        );
    END LOOP;

    UPDATE esdt_disbursements
    SET status = 'CONFIRMED',
        primary_tx_hash = p_tx_hash,
        makex_operation_id = COALESCE(p_operation_id, makex_operation_id),
        http_status = COALESCE(p_http_status, http_status),
        fee_exempt = p_fee_exempt,
        usage_fee = p_usage_fee,
        usage_fee_hash = p_usage_fee_hash,
        nonce = COALESCE(p_chain_nonce, nonce),
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
    RETURN jsonb_build_object('idempotent', false, 'record', to_jsonb(v_row), 'settled', v_expected);
END;
$$;

REVOKE ALL ON FUNCTION settle_nft_disbursement_withdrawal(
    text, text, text, text, text, integer, boolean, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_nft_disbursement_withdrawal(
    text, text, text, text, text, integer, boolean, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION settle_nft_disbursement_withdrawal(
    text, text, text, text, text, integer, boolean, text, text, text, text, text, text
) IS
    'Confirms one NFT disbursement and debits that virtual-account NFT exactly once. A repeated call for the same transaction hash does not debit again.';
