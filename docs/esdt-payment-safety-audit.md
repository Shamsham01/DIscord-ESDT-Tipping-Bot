# ESDT payment safety audit

Reviewed base: `8c7f536` (merged PR #2). This change does not deploy, merge, move production balances, run a production migration, clear `ESDT_WITHDRAWALS_PAUSED`, or send a mainnet payment.

MakeX Transfers remains the only blockchain transaction service. The bot still does not manage nonces or broadcast transactions. `/withdraw-esdt` still persists `wd_<Discord interaction id>` and sends it as `x-makex-idempotency-key`. That header is internal. Discord users do not configure it. Do not remove it because the Make.com screen is being simplified.

The success contract is still Transfers PR #7 (`d7243201`, `tx/paymentContract.mjs`), captured in `test/fixtures/transfers-pr7-esdt-transfer.json`. A payment is confirmed only when that contract says the transfer is complete and the sender, recipient, token, and raw amount match. A non-2xx body, a foreign `data.blockingTxHash`, or a hash from another operation is not confirmation.

## Caller audit

| Caller | Stable id | Persisted before send | Retry | Timeout | Identity check | Fee exempt |
| --- | --- | --- | --- | --- | --- | --- |
| `/withdraw-esdt` | `wd_<interaction>` | `esdt_withdrawals` | Same id | Stays pending, no restore | Four fields | Yes, `skippedWhitelist` required |
| Mass refund ESDT | `mr_<interaction>_<user>_<token>` | `esdt_disbursements` | Same id | Reserved, no second debit | Four fields | Yes |
| `/house-withdraw` | `hw_<interaction>` | `esdt_disbursements` | Same id | Pending, house spend not applied | Four fields | Yes |
| Subscription | `sub_<interaction>` | `esdt_disbursements` | Same id | Reserved, plan not activated | Four fields | Yes, subscription check skipped |
| Pool-creation fee | `pf_<pool id>` | `esdt_disbursements` | Same id and snapshotted amount | Reserved, pool setup stops | Four fields | Yes |
| Cross-guild ESDT | `xg_<interaction>` | `esdt_disbursements` | Same id | Reserved, counterparty not credited | Four fields | Yes |
| `/send-esdt` | `send_<interaction>` | `esdt_disbursements` | Same id | Pending, not announced as paid | Four fields | No. Uses the named project, not the Community Fund |
| NFT, SFT, bulk NFT, auction NFT settlement | `nr_<interaction>_<hash>` or `auc_<hash>` | `esdt_disbursements` | Not replayed after the first dispatch | Needs reconciliation | Not confirmed | No |

`esdt_withdrawals` was not reused. Its interaction id is unique and the withdrawal recovery worker would POST other rows as fee-exempt withdrawals.

## What each ESDT path does

Reservation, lease, confirm, fail, and restore go through `reserve_esdt_disbursement` and the matching functions in `supabase/migrations/20261102180000_esdt_disbursement_reservations.sql`. The JavaScript state machine is `utils/esdt-disbursement-flow.js`. Classification stays in `utils/esdt-transfer-outcome.js`.

- Two identical refunds from two Discord interactions get two ids. A retry of one interaction reuses the first id and does not debit again.
- A second mass-refund interaction is refused while another mass refund for that guild is open.
- Server deletion stops when `unresolvedRefunds > 0`, including when the virtual balance is already zero because it was reserved.
- A timeout or foreign blocking hash leaves the row pending or `NEEDS_RECONCILIATION`. Virtual funds are not restored.
- HTTP 422 `EXECUTION_FAILED` restores only when the four-field identity matches. The ledger id is `esdt-disburse-restore:<id>` and a second restore is a no-op.
- A lost or expired lease cannot confirm or restore.
- House spending is applied once inside `note_esdt_disbursement_effect` from `amount_raw`. The command does not also call `trackHouseSpending`.
- Subscription no longer polls the public MultiversX API and no longer deducts a second time after reserve. The plan row is written only after confirmation. A provisional MakeX whitelist is rolled back on an authoritative non-payment and kept while the payment is pending.
- A pool fee amount is snapshotted on the first reserve. A later price change does not alter that row. A confirmed fee is not refunded if the later virtual initial-supply step fails. The initial-supply refund is still only a virtual-account reversal.
- Cross-guild confirmation credits the destination account once with ledger id `esdt-disburse-credit:<id>`.
- `/send-esdt` rejects an amount whose `Number#toString` is scientific notation. The idempotency key is required before `fetch`.

## NFT, SFT, and bulk

`nftTransfer`, `sftTransfer`, and `multiNFTTransfer` are not in the Transfers PR #7 contract. The bot does not treat a legacy hash as confirmation. It persists one non-replayable row, sends at most once, leaves `NEEDS_RECONCILIATION`, does not remove the virtual NFT, and does not auto-retry. A pre-broadcast 4xx with no hash is an authoritative non-payment. A timeout is not.

This is a cross-repository dependency. Those three MakeX endpoints need the same complete success contract and idempotency behaviour as `esdtTransfer` before the bot can confirm or replay them. Until then, mass refund of an NFT blocks server deletion on purpose.

Auction settlement uses a stable id derived from the guild, auction, and asset. If the NFT call is not an authoritative non-payment, the winning bid is not refunded and the auction is not marked finished. The closer then stops by recording `FAILED` so the one-minute loop does not send the NFT again. That status means “stop and reconcile”, and the Discord message says the bid was not refunded.

## Flags

- `ESDT_WITHDRAWALS_PAUSED` still pauses new `/withdraw-esdt` requests unless it is exactly `false`.
- `ESDT_WITHDRAWAL_RECOVERY_ENABLED` still POSTs unresolved withdrawals only when it is exactly `true`.
- `ESDT_DISBURSEMENT_RECOVERY_ENABLED` POSTs replayable unresolved disbursements only when it is exactly `true`. Non-replayable NFT rows are never auto-posted. The local effect sweep (subscription upsert and house spending) is not a MakeX call and is not gated by this flag.
- New disbursements are not gated by the withdrawal pause. They fail closed when `SUPABASE_SERVICE_ROLE_KEY` is missing or the migration is absent.

## Deployment

Do not deploy this as a production payment change until an operator does the following, in order:

1. Apply `supabase/migrations/20261102180000_esdt_disbursement_reservations.sql` with the service role. It creates `esdt_disbursements` and functions only. It does not update balances.
2. Set `SUPABASE_SERVICE_ROLE_KEY` on the bot. Without it, the new payment commands refuse before calling MakeX.
3. Leave `ESDT_WITHDRAWALS_PAUSED` unset or any value other than `false`.
4. Leave `ESDT_WITHDRAWAL_RECOVERY_ENABLED` and `ESDT_DISBURSEMENT_RECOVERY_ENABLED` unset.
5. Do not replay the 1 Nov 2026 incident withdrawals. Use `scripts/esdt-withdrawal-incident-reconciliation.sql` for that incident. Use `scripts/esdt-disbursement-recovery.sql` only as a read-only list of open disbursements after this migration exists.

Historical payments that were already unresolved stay untouched. Safe reconciliation needs the durable row (or, for payments made before this migration, the Discord interaction, the virtual ledger row, and a MakeX operation whose echoed sender, recipient, token, and raw amount match). A transaction hash by itself is not that evidence.

## Tests

`npm test` includes the existing withdrawal and contract tests plus `utils/esdt-disbursement.test.js` and `utils/esdt-disbursement.pg.test.js`. The Postgres tests create and drop a disposable database. They do not call MakeX or production. The cases cover separate interaction ids, retry of one key, timeout, a foreign hash, the wrong recipient or amount, a paused restart, an expired lease, concurrent reservation, one restoration, a whitelisted Community Fund request, and the subscription, pool-fee, house, admin-send, and non-replayable NFT paths.
