-- Review-only correction for Discord withdrawal
-- nr_1568347763505373234_32717ded09f1771d208c3666.
--
-- The NFT was already delivered by transaction
-- 1676b1d838b6f53d1061a1632e8d76d5258230ed636bdad267090fe0666474f2.
-- This script does not broadcast, does not call MakeX, and does not change
-- any other asset. It rolls back unless the operator replaces the final
-- ROLLBACK with COMMIT after the precondition notices match.

BEGIN;

DO $$
DECLARE
    v_disbursement esdt_disbursements%ROWTYPE;
    v_balance virtual_account_nft_balances%ROWTYPE;
    v_prior integer;
BEGIN
    SELECT * INTO v_disbursement
    FROM esdt_disbursements
    WHERE disbursement_id = 'nr_1568347763505373234_32717ded09f1771d208c3666'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'precondition failed: disbursement row is missing';
    END IF;
    IF v_disbursement.operation_kind IS DISTINCT FROM 'nft_transfer' THEN
        RAISE EXCEPTION 'precondition failed: operation_kind is %', v_disbursement.operation_kind;
    END IF;
    IF v_disbursement.status NOT IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION') THEN
        RAISE EXCEPTION 'precondition failed: status is %', v_disbursement.status;
    END IF;
    -- Refuse to overwrite a different payment identity or known transaction hash.
    IF v_disbursement.makex_operation_id IS NOT NULL
       AND v_disbursement.makex_operation_id <> '13588ddf-a8ae-4bfb-96b1-db7096ca8761' THEN
        RAISE EXCEPTION 'precondition failed: different MakeX operation ID';
    END IF;
    IF (v_disbursement.primary_tx_hash IS NOT NULL
         AND lower(v_disbursement.primary_tx_hash) <> '1676b1d838b6f53d1061a1632e8d76d5258230ed636bdad267090fe0666474f2')
       OR (v_disbursement.untrusted_tx_hash IS NOT NULL
         AND lower(v_disbursement.untrusted_tx_hash) <> '1676b1d838b6f53d1061a1632e8d76d5258230ed636bdad267090fe0666474f2') THEN
        RAISE EXCEPTION 'precondition failed: recorded transaction hash differs';
    END IF;
    IF v_disbursement.token_identifier IS DISTINCT FROM 'EMP-897b49-105c'
       OR v_disbursement.amount_raw IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'precondition failed: token % amount %', v_disbursement.token_identifier, v_disbursement.amount_raw;
    END IF;
    IF lower(v_disbursement.recipient_wallet) IS DISTINCT FROM lower('erd1x048mkeu4h4a5g8xzr7ap0jaau0k8grvd7wqukca90mrgd8pxs8qqundyh')
       OR lower(v_disbursement.sender_wallet) IS DISTINCT FROM lower('erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs') THEN
        RAISE EXCEPTION 'precondition failed: sender or recipient does not match the confirmed transfer';
    END IF;

    SELECT count(*)::integer INTO v_prior
    FROM virtual_account_nft_transactions
    WHERE guild_id = v_disbursement.guild_id
      AND user_id = v_disbursement.user_id
      AND (
          tx_hash = '1676b1d838b6f53d1061a1632e8d76d5258230ed636bdad267090fe0666474f2'
          OR transaction_id LIKE 'nft-settle:nr_1568347763505373234_32717ded09f1771d208c3666:%'
      );
    IF v_prior <> 0 THEN
        RAISE EXCEPTION 'precondition failed: % settlement rows already exist', v_prior;
    END IF;

    SELECT * INTO v_balance
    FROM virtual_account_nft_balances
    WHERE guild_id = v_disbursement.guild_id
      AND user_id = v_disbursement.user_id
      AND collection = 'EMP-897b49'
      AND nonce = 4188
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_balance.amount, 1) IS DISTINCT FROM 1 OR COALESCE(v_balance.staked, false) THEN
        RAISE EXCEPTION 'precondition failed: EMP-897b49 nonce 4188 is not an unstaked quantity of 1';
    END IF;

    RAISE NOTICE 'preconditions passed for guild % user % balance id %',
        v_disbursement.guild_id, v_disbursement.user_id, v_balance.id;
END $$;

-- Settlement runs in this transaction. ROLLBACK below discards it.
-- Replace ROLLBACK with COMMIT only after the notices show one inventory
-- deletion, one audit insert, and the disbursement moving to CONFIRMED.
WITH leased AS (
    SELECT claim_esdt_disbursement_lease(
        'nr_1568347763505373234_32717ded09f1771d208c3666',
        'incident-reconcile',
        300
    ) AS lease
), settled AS (
    SELECT settle_nft_disbursement_withdrawal(
        'nr_1568347763505373234_32717ded09f1771d208c3666',
        'incident-reconcile',
        leased.lease->>'fence',
        '1676b1d838b6f53d1061a1632e8d76d5258230ed636bdad267090fe0666474f2',
        '13588ddf-a8ae-4bfb-96b1-db7096ca8761',
        200,
        true,
        '0',
        NULL,
        '1825',
        (leased.lease->'record'->>'guild_id'),
        (leased.lease->'record'->>'user_id'),
        'erd1x048mkeu4h4a5g8xzr7ap0jaau0k8grvd7wqukca90mrgd8pxs8qqundyh'
    ) AS result
    FROM leased
)
SELECT
    settled.result->>'idempotent' AS idempotent,
    settled.result->'record'->>'status' AS disbursement_status,
    (settled.result->>'settled')::integer AS audit_rows
FROM settled;

ROLLBACK;
