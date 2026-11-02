-- Read-only inspection for esdt_disbursements.
-- Do not run the commented statements. They are examples of what a human review
-- would change after evidence is collected. This file does not move balances.

SELECT disbursement_id,
       operation_kind,
       status,
       guild_id,
       user_id,
       counterparty_guild_id,
       counterparty_user_id,
       token_identifier,
       amount_human,
       amount_raw,
       decimals,
       recipient_wallet,
       sender_wallet,
       primary_tx_hash,
       blocking_tx_hash,
       untrusted_tx_hash,
       reservation_state,
       http_status,
       error_code,
       replayable,
       reserves_balance,
       restored_at,
       effect_required,
       effect_applied_at,
       dispatched_at,
       created_at,
       updated_at
FROM esdt_disbursements
WHERE status IN ('RESERVED', 'PENDING', 'NEEDS_RECONCILIATION')
   OR (effect_required IS TRUE AND status = 'CONFIRMED' AND effect_applied_at IS NULL)
ORDER BY updated_at;

-- Evidence required before any balance change:
-- 1. The row above.
-- 2. The MakeX operation whose idempotency key equals disbursement_id.
-- 3. A Transfers PR #7 body whose sender, recipient, token, and raw amount match the row.
-- 4. The virtual_account_transactions rows esdt-disburse-reserve:<id>,
--    esdt-disburse-restore:<id>, and esdt-disburse-credit:<id>.
-- Restore virtual funds only when that evidence shows the transfer was not paid.
-- A missing classifier, a timeout, or an HTTP 5xx is not that evidence.
-- Do not POST the row again unless ESDT_DISBURSEMENT_RECOVERY_ENABLED=true,
-- the matching rollout flag is exactly true (ESDT_DISBURSEMENTS_ENABLED, or
-- ESDT_NFT_DISBURSEMENTS_ENABLED for nft_transfer), and replayable is true.
-- NFT rows are not replayable. Unsetting a rollout flag does not restore funds.
