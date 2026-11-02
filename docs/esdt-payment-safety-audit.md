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
- A timeout, HTTP 503, foreign blocking hash, or unclassified response leaves the row pending or `NEEDS_RECONCILIATION`. Virtual funds are not restored. `beforeBroadcast` is used only when no request was attempted, or when MakeX itself reports an authoritative non-payment. A missing `classified` property after the request returns is not that report.
- `reserve_esdt_disbursement` takes a transaction advisory lock on the disbursement id and, when the block scope is not `none`, on that scope, before it locks a virtual account. Two payments that do not share a virtual account can no longer both pass the open-row check. A `hashtext` collision only makes extra callers wait.
- HTTP 422 `EXECUTION_FAILED` restores only when the four-field identity matches. The ledger id is `esdt-disburse-restore:<id>` and a second restore is a no-op.
- A lost or expired lease cannot confirm or restore.
- House spending is applied once inside `note_esdt_disbursement_effect` from `amount_raw`. The command does not also call `trackHouseSpending`.
- Subscription no longer polls the public MultiversX API and no longer deducts a second time after reserve. The plan row is written only after confirmation. A provisional MakeX whitelist is rolled back on an authoritative non-payment and kept while the payment is pending.
- A pool fee amount is snapshotted on the first reserve. A later price change does not alter that row. A confirmed fee is not refunded if the later virtual initial-supply step fails. The initial-supply refund is still only a virtual-account reversal.
- Cross-guild confirmation credits the destination account once with ledger id `esdt-disburse-credit:<id>`.
- `/send-esdt` rejects an amount whose `Number#toString` is scientific notation. The idempotency key is required before `fetch`.

## NFT, SFT, and bulk

`nftTransfer`, `sftTransfer`, and `multiNFTTransfer` are not in the Transfers PR #7 contract, and this bot does not assume Transfers PR #8 adds that contract. The bot does not treat a legacy hash as confirmation. It persists one non-replayable row, sends at most once, leaves `PENDING` or `NEEDS_RECONCILIATION`, does not remove the virtual NFT, and does not auto-retry. After the request is dispatched, the only authoritative non-payment is HTTP 400 with the allowlisted `TX_REJECTED` code and no transaction hash. HTTP 200-299 are successful statuses and are not that rejection. The Transfers PR #7 `TX_REJECTED` sample is HTTP 503, and every 5xx stays unresolved on this legacy path, as do HTTP 408, 429, timeouts, dropped connections, and retryable bodies. A hash at the top level, on `result`, on `data`, on `transaction`, or in a blocking field prevents restoration. A bare 4xx status is not that proof. `ESDT_NFT_DISBURSEMENTS_ENABLED` stays off unless it is exactly `true`. An unresolved NFT row cannot be broadcast again and is not restored from an ambiguous response.

This is a cross-repository dependency. Before the bot can confirm or replay those endpoints, MakeX must accept `x-makex-idempotency-key` and return the same HTTP 200 complete-success body used for `esdtTransfer`: `status: success`, `success: true`, `complete: true`, `result.txHash`, `result.status: success`, and echoed sender, receiver, token, and exact raw amount. A hash-only or human-amount body is not enough. Until that contract exists, mass refund of an NFT blocks server deletion on purpose. Do not enable `ESDT_NFT_DISBURSEMENTS_ENABLED` on that assumption.

Auction settlement uses a stable id derived from the guild, auction, and asset. If the NFT call is not an authoritative non-payment, the winning bid is not refunded and the auction is not marked finished. The closer then stops by recording `FAILED` so the one-minute loop does not send the NFT again. That status means “stop and reconcile”, and the Discord message says the bid was not refunded.

## Transfers PR #8

The bot still sends `x-makex-idempotency-key` from the persisted id (`wd_<interaction>` for withdrawals, the disbursement id for every other ESDT payment). PR #8 must keep accepting that header. Confirmation is still HTTP 200 plus `complete: true`, `success: true`, both statuses `success`, `result.txHash`, and an exact match of sender, receiver, token, and raw amount. This change does not adopt a new response shape.

## Flags

- `ESDT_WITHDRAWALS_PAUSED` still pauses new `/withdraw-esdt` requests unless it is exactly `false`. The persisted withdrawal id is unchanged.
- `ESDT_WITHDRAWAL_RECOVERY_ENABLED` still POSTs unresolved withdrawals only when it is exactly `true`.
- `ESDT_DISBURSEMENTS_ENABLED` must be exactly `true` before a new ESDT disbursement is reserved or sent. The default is fail closed. There is no fallback to the old unreserved `transferESDT` path.
- `ESDT_NFT_DISBURSEMENTS_ENABLED` must be exactly `true` before an NFT, SFT, bulk, or auction disbursement is reserved or sent. Turning on ESDT disbursements does not turn this on.
- `ESDT_DISBURSEMENT_RECOVERY_ENABLED` POSTs replayable unresolved disbursements only when it is exactly `true` and the matching rollout flag is also exactly `true`. Non-replayable NFT rows are never auto-posted. The local effect sweep (subscription upsert and house spending) is not a MakeX call and is not gated by these flags.
- Missing `SUPABASE_SERVICE_ROLE_KEY` or a missing migration still refuses before any MakeX call.

## Payment route matrix

| Route | State |
| --- | --- |
| `/withdraw-esdt` | Verified against the PR #7 complete-success body and the four-field identity check. Intentionally paused unless `ESDT_WITHDRAWALS_PAUSED=false`. Recovery paused unless `ESDT_WITHDRAWAL_RECOVERY_ENABLED=true`. |
| Mass refund ESDT, `/house-withdraw`, subscription, pool-creation fee, cross-guild ESDT, `/send-esdt` | Same confirmation contract, with durable ids and one reservation. Intentionally paused unless the migration is applied and `ESDT_DISBURSEMENTS_ENABLED=true`. Recovery also requires `ESDT_DISBURSEMENT_RECOVERY_ENABLED=true`. |
| NFT, SFT, bulk NFT, auction NFT settlement | Still dependent on a MakeX contract these endpoints do not return. Intentionally paused unless `ESDT_NFT_DISBURSEMENTS_ENABLED=true`. Even then the bot sends once, does not confirm, and does not replay. |

## Deployment

Do not deploy this as a production payment change, do not apply the migration to production from this change, and do not enable withdrawals. When an operator later chooses to roll it out, use this order:

1. Apply `supabase/migrations/20261102180000_esdt_disbursement_reservations.sql` with the service role. It creates `esdt_disbursements` and functions only, including the advisory locks inside `reserve_esdt_disbursement`. It does not update balances. The function signature is unchanged from the first version of this migration.
2. Set `SUPABASE_SERVICE_ROLE_KEY` on the bot. Without it, the new payment commands refuse before calling MakeX.
3. Leave `ESDT_WITHDRAWALS_PAUSED` unset or any value other than `false`.
4. Leave `ESDT_DISBURSEMENTS_ENABLED`, `ESDT_NFT_DISBURSEMENTS_ENABLED`, `ESDT_WITHDRAWAL_RECOVERY_ENABLED`, and `ESDT_DISBURSEMENT_RECOVERY_ENABLED` unset. New routes stay fail closed.
5. After the migration and a verified `esdtTransfer` response are both in place, set `ESDT_DISBURSEMENTS_ENABLED=true` for the ESDT routes only. Leave the NFT flag unset until `nftTransfer`, `sftTransfer`, and `multiNFTTransfer` return the contract above.
6. Do not replay the 1 Nov 2026 incident withdrawals. Use `scripts/esdt-withdrawal-incident-reconciliation.sql` for that incident. Use `scripts/esdt-disbursement-recovery.sql` only as a read-only list of open disbursements after this migration exists.

### Rollback

Unset `ESDT_DISBURSEMENTS_ENABLED` and `ESDT_NFT_DISBURSEMENTS_ENABLED`. New reservations and recovery POSTs stop. Confirmed payments are not reversed. Open rows stay reserved. Do not drop `esdt_disbursements` to roll back, and do not restore a balance because a response had no classifier or because a worker's lease expired.

### Recovery

A human may reconcile a row only with the durable row, the MakeX operation whose idempotency key equals that id, and a PR #7 body whose sender, recipient, token, and raw amount match. A transaction hash by itself is not evidence. Reserved funds stay reserved when the outcome is pending, `NEEDS_RECONCILIATION`, or unclassified. Restore only after authoritative non-payment, through `fail_esdt_disbursement`, which refuses a `CONFIRMED` row. Destination credits, house spending, and the subscription effect stamp are idempotent. If the chain payment is confirmed and the subscription upsert or house spending did not finish, the effect sweep retries that local bookkeeping and does not send the payment again. An expired lease cannot confirm or restore; the next worker must claim a new lease first.

Historical payments that were already unresolved stay untouched. Safe reconciliation needs the durable row (or, for payments made before this migration, the Discord interaction, the virtual ledger row, and a MakeX operation whose echoed sender, recipient, token, and raw amount match).

## Tests

`npm test` includes the existing withdrawal and contract tests plus `utils/esdt-disbursement.test.js` and `utils/esdt-disbursement.pg.test.js`. The Postgres tests create and drop a disposable database and open a second connection for overlapping transactions. They do not call MakeX or production. The cases cover separate interaction ids, retry of one key, an unclassified HTTP 200, an unexpected body, timeout, HTTP 408, HTTP 429, HTTP 503, a missing hash, a malformed success body, a later exact success after an interrupted client, a foreign hash, the wrong recipient or amount, a paused rollout, an expired lease, one restoration, a confirmed payment that cannot be restored, a whitelisted Community Fund request, and the subscription, pool-fee, house, admin-send, and non-replayable NFT paths. Legacy NFT classification accepts `TX_REJECTED` only as an HTTP 400 pre-broadcast rejection with no transaction hash. HTTP 200 with that code, and HTTP 400 with a nested `result.txHash`, `data.txHash`, transaction hash, or blocking hash, stay unresolved. The Postgres overlap covers house withdrawals, subscriptions, mass refunds, admin sends, NFT asset operations, and two transactions racing the same id.
