-- Read-only reconciliation for Discord ESDT withdrawal incident, 1 Nov 2026.
-- Hash: 228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7
-- MakeX operation: 4c2b2a44-4831-477d-9d80-b54e8f061123
--
-- This file is SELECT-only. It was not executed against production.
-- Do not add UPDATE, INSERT, DELETE, or compensation transactions here.
-- Do not change virtual-account balances from these results without a separate human review.
--
-- The historical bot wrote a deduction with description
-- 'withdrawal (pending blockchain confirmation)' and did not store the chain hash.
-- esdt_withdrawals does not contain those historical attempts. It exists only after
-- supabase/migrations/20261101120000_esdt_withdrawal_reservations.sql is applied.
--
-- Review window: 1 Nov 2026, 16:00:00–19:00:00 GMT (Europe/London, UTC+0 that day).
-- On-chain payment, public MultiversX API, not queried by this script:
--   time     2026-11-01 17:13:53 GMT (unix 1793553233)
--   nonce    1817
--   sender   erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs
--   receiver erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n
--   token    DROP-1fc8cc
--   raw      80000000000 (800 DROP, 8 decimals)
--   status   success
--   chain fee 0.000121 EGLD (not a MakeX usage fee)

-- ---------------------------------------------------------------------------
-- Bot database
-- ---------------------------------------------------------------------------

-- Ledger rows that mention the incident hash. Expected: none, because the
-- old withdraw path logged the hash and did not write tx_hash.
SELECT
    guild_id,
    user_id,
    transaction_id,
    type,
    token,
    amount,
    balance_before,
    balance_after,
    tx_hash,
    source,
    timestamp,
    to_timestamp(timestamp / 1000.0) AT TIME ZONE 'UTC' AS event_time_gmt,
    description
FROM virtual_account_transactions
WHERE lower(COALESCE(tx_hash, '')) = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7'
   OR description ILIKE '%228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7%'
ORDER BY timestamp;

-- Withdrawal deductions in the review window, including DROP and every other
-- token. These users may have been shown the shared hash. The ledger has no
-- recipient wallet, so this list is not proof of who was paid on-chain.
WITH window AS (
    SELECT
        (EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-11-01 16:00:00+00') * 1000)::bigint AS start_ms,
        (EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-11-01 19:00:00+00') * 1000)::bigint AS end_ms
)
SELECT
    t.guild_id,
    t.user_id,
    t.transaction_id,
    t.type,
    t.token,
    t.amount,
    t.balance_before,
    t.balance_after,
    t.tx_hash,
    t.source,
    to_timestamp(t.timestamp / 1000.0) AT TIME ZONE 'UTC' AS event_time_gmt,
    t.description
FROM virtual_account_transactions t
CROSS JOIN window w
WHERE t.timestamp BETWEEN w.start_ms AND w.end_ms
  AND t.type = 'deduction'
  AND t.description ILIKE '%withdrawal%'
ORDER BY t.timestamp, t.guild_id, t.user_id;

-- Later deposits that look like a restoration for the same guild, user, and token
-- as a withdrawal deduction in the window. A missing row means the debit is
-- still outstanding. It does not by itself prove the user was unpaid on-chain.
WITH window AS (
    SELECT
        (EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-11-01 16:00:00+00') * 1000)::bigint AS start_ms,
        (EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-11-01 19:00:00+00') * 1000)::bigint AS end_ms
),
deductions AS (
    SELECT t.*
    FROM virtual_account_transactions t
    CROSS JOIN window w
    WHERE t.timestamp BETWEEN w.start_ms AND w.end_ms
      AND t.type = 'deduction'
      AND t.description ILIKE '%withdrawal%'
)
SELECT
    d.guild_id,
    d.user_id,
    d.token,
    d.amount AS deducted_amount,
    to_timestamp(d.timestamp / 1000.0) AT TIME ZONE 'UTC' AS deducted_at_gmt,
    d.transaction_id AS deduction_id,
    d.balance_after AS balance_after_deduction,
    r.transaction_id AS restoration_id,
    r.amount AS restored_amount,
    r.type AS restoration_type,
    to_timestamp(r.timestamp / 1000.0) AT TIME ZONE 'UTC' AS restored_at_gmt,
    r.description AS restoration_description
FROM deductions d
LEFT JOIN virtual_account_transactions r
    ON r.guild_id = d.guild_id
   AND r.user_id = d.user_id
   AND lower(r.token) = lower(d.token)
   AND r.timestamp >= d.timestamp
   AND r.type = 'deposit'
   AND (
        r.description ILIKE '%ledger reversal%'
        OR r.description ILIKE '%restor%'
        OR r.description ILIKE '%esdt withdrawal restored%'
   )
ORDER BY d.timestamp, r.timestamp;

-- DROP deductions in the window. The single known on-chain payment is 800 DROP
-- (raw 80000000000, 8 decimals) to erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n.
-- Human amount text may be '800' or another decimal rendering. Confirm the
-- recipient from Discord logs before treating any row as that payment.
WITH window AS (
    SELECT
        (EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-11-01 16:00:00+00') * 1000)::bigint AS start_ms,
        (EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-11-01 19:00:00+00') * 1000)::bigint AS end_ms
)
SELECT
    guild_id,
    user_id,
    token,
    amount,
    balance_before,
    balance_after,
    to_timestamp(timestamp / 1000.0) AT TIME ZONE 'UTC' AS event_time_gmt,
    description
FROM virtual_account_transactions
CROSS JOIN window w
WHERE timestamp BETWEEN w.start_ms AND w.end_ms
  AND type = 'deduction'
  AND description ILIKE '%withdrawal%'
  AND (
        lower(token) LIKE 'drop%'
        OR amount IN ('800', '800.0', '800.00', '800.00000000')
      )
ORDER BY timestamp;

-- Skip this statement until the withdrawal migration has been applied.
-- Historical incident rows are not in this table. This query is for withdrawals
-- created after the migration, including any replay that must not be compensated.
SELECT
    withdrawal_id,
    discord_interaction_id,
    guild_id,
    user_id,
    token_identifier,
    amount_human,
    amount_raw,
    decimals,
    recipient_wallet,
    sender_wallet,
    status,
    balance_before,
    balance_after,
    ledger_transaction_id,
    restoration_transaction_id,
    makex_operation_id,
    primary_tx_hash,
    blocking_tx_hash,
    untrusted_tx_hash,
    reservation_state,
    http_status,
    error_code,
    error_message,
    fee_exempt,
    usage_fee,
    usage_fee_hash,
    created_at,
    confirmed_at,
    restored_at
FROM esdt_withdrawals
WHERE lower(COALESCE(primary_tx_hash, '')) = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7'
   OR lower(COALESCE(blocking_tx_hash, '')) = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7'
   OR lower(COALESCE(untrusted_tx_hash, '')) = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7'
   OR makex_operation_id = '4c2b2a44-4831-477d-9d80-b54e8f061123'
   OR lower(sender_wallet) = 'erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs'
ORDER BY created_at;

-- ---------------------------------------------------------------------------
-- MakeX database
-- Run only where makex_operations and makex_tx_reservations exist.
-- Do not run this section in the Discord bot project.
-- Column names below are assumptions for the reviewer. Confirm them against the
-- Transfers schema before running. The operation row does not identify the
-- Discord user. result_json was null on the reported row, so recipient, token,
-- and amount must be taken from the reservation or from bot logs.
-- fee_tx_hash null is the expected whitelist result.
-- ---------------------------------------------------------------------------

-- SELECT
--     id,
--     status,
--     http_status,
--     error_code,
--     error_message,
--     idempotency_key,
--     fee_tx_hash,
--     result_json,
--     created_at,
--     updated_at
-- FROM makex_operations
-- WHERE id = '4c2b2a44-4831-477d-9d80-b54e8f061123'
--    OR created_at BETWEEN TIMESTAMPTZ '2026-11-01 16:00:00+00' AND TIMESTAMPTZ '2026-11-01 19:00:00+00'
-- ORDER BY created_at;
--
-- SELECT
--     operation_id,
--     state,
--     tx_hash,
--     sender,
--     recipient,
--     token_identifier,
--     amount_raw,
--     nonce,
--     created_at,
--     updated_at
-- FROM makex_tx_reservations
-- WHERE operation_id = '4c2b2a44-4831-477d-9d80-b54e8f061123'
--    OR lower(tx_hash) = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7'
--    OR lower(sender) = 'erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs'
--       AND created_at BETWEEN TIMESTAMPTZ '2026-11-01 16:00:00+00' AND TIMESTAMPTZ '2026-11-01 19:00:00+00'
-- ORDER BY created_at;

-- Correction sketches for a later reviewed change. Not executable.
-- Group A: one virtual deduction whose Discord recipient, token DROP-1fc8cc,
-- and raw amount 80000000000 match the on-chain payment. Leave that debit.
-- Do not submit another transfer.
-- Group B: every other deducted user without a matching MakeX payment.
-- Credit only after evidence that no broadcast paid them, using a new
-- reviewed ledger id. Do not store the incident hash as their tx_hash.
-- Do not replay /withdraw-esdt for either group.
