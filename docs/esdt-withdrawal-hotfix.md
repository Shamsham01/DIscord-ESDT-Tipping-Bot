# ESDT withdrawal integrity hotfix

Issue: Shamsham01/DIscord-ESDT-Tipping-Bot#1
Branch: `cursor/esdt-withdrawal-hotfix-4047`
Incident window: 1 Nov 2026, 17:13:53 GMT (Europe/London)

This hotfix is the Discord bot half of a coordinated change. MakeX Transfers remains the blockchain transaction service. This repository does not broadcast transactions, manage nonces, or calculate MakeX usage fees. The Transfers repository is not modified here.

New `/withdraw-esdt` requests stay paused until an operator sets `ESDT_WITHDRAWALS_PAUSED=false`. Automated recovery also stays paused until `ESDT_WITHDRAWAL_RECOVERY_ENABLED=true`. Leave both unset until Transfers PR #7 (`d7243201`) is the deployed API and a human has reviewed the incident SQL. Recovery inspects unresolved rows and does not POST to MakeX while it is paused.

## Root cause

`/withdraw-esdt` deducted the virtual-account balance, then called MakeX `POST /execute/esdtTransfer`. The bot did not send `x-makex-idempotency-key`. MakeX therefore keyed the call from a request-body fingerprint.

`finalizeEsdtTransferResult` treated any non-2xx body that contained `data.txHash` or `result.txHash` as a candidate payment. It polled the public MultiversX API and, if that hash was an on-chain success, returned success for the current withdrawal. It did not check that the hash belonged to this operation, or that sender, recipient, token, and raw amount matched.

MakeX `sendTransferError` puts a blocking reservation hash in `data.txHash` on HTTP 503. That includes `TX_PENDING` and `FENCING_LOST` (“Lost the wallet lease during confirmation.”) while the reservation state is `SUBMITTED`. Two different Discord withdrawals can therefore display one hash that belongs to a different payment.

The reported hash is one real on-chain success. It is not proof of every Discord withdrawal that displayed it.

The pre-debit used `deductFundsFromAccount` before the HTTP call. The only concurrency guard was an in-memory `withdrawalLocks` map. The outer `catch` restored the virtual balance on any thrown error, including the 60-second abort, even if MakeX had already broadcast. The ledger row was written as type `deduction` with description `withdrawal (pending blockchain confirmation)`. The successful hash was logged and shown in Discord. It was not written back to `virtual_account_transactions.tx_hash`.

The amount path used `parseFloat` and sent `amount` as a JSON number, so an 18-decimal quantity could differ from the raw value MakeX was asked to send.

## What changed

- A MakeX response confirms a withdrawal only when HTTP is 2xx, the top-level and result statuses are success, the hash is the operation’s owned `result.txHash`, the echoed transfer identity matches, and verification is not explicitly false. Withdrawals also require sender, recipient, token, and amount.
- HTTP 503, 504, timeout, `TX_PENDING`, and a lost wallet lease stay `PENDING` or `NEEDS_RECONCILIATION`. A blocking or untrusted hash is stored separately and is not shown as this withdrawal’s hash.
- The virtual balance is restored only after an authoritative non-payment: a matched HTTP 422 `TRANSACTION_FAILED`, or a pre-broadcast 4xx with no hash and no reservation state that implies broadcast. Restoration uses ledger id `esdt-restore:<withdrawal id>` and is idempotent.
- Each new Discord interaction gets withdrawal id `wd_<interaction id>`. That id is persisted before the MakeX call and sent as `x-makex-idempotency-key` and in the body. A retry or process restart reuses it. A second slash command is a different withdrawal.
- Reservation, confirmation, unresolved marking, and restoration are Postgres functions that lock `virtual_accounts` with `FOR UPDATE`. Two bot processes cannot reserve or settle the same row at once. A 150-second lease stops two workers from re-posting the same open withdrawal. The lease is not the financial lock.
- Amounts on the withdrawal path are decimal strings. `canonicalizeEsdtAmount` rejects JavaScript numbers and checks `amount_human * 10^decimals = amount_raw`. The reserved human amount is the same string sent to MakeX, with `amountRaw` and `tokenDecimals` beside it.
- A confirmed Discord embed shows token, exact amount, recipient, verified hash, withdrawal id, remaining balance, and success. A pending embed shows the withdrawal id, pending status, the owned hash only when one exists, that the balance is reserved, and an instruction not to create another withdrawal. “Withdrawal completed successfully” is rendered only from a `CONFIRMED` record.
- Other Community Fund ESDT callers no longer turn a foreign hash into success or restore a balance after an ambiguous result. They do not yet use this state machine. See follow-ups.

`esdt_withdrawals` is readable and writable by `service_role` only. Row level security is enabled and there are no anon policies. The functions are `SECURITY INVOKER` with `search_path = public`, and `EXECUTE` is granted only to `service_role`. The bot must have `SUPABASE_SERVICE_ROLE_KEY`. Without it, `/withdraw-esdt` replies and does not deduct.

## MakeX API contract

This matches Transfers PR #7 at `d7243201`, `tx/paymentContract.mjs`. The bot does not confirm a withdrawal from a legacy body that lacks `complete: true` or puts identity only on a human `amount`.

Confirmed payment, HTTP 200:

```json
{
  "operationId": "uuid",
  "status": "success",
  "complete": true,
  "success": true,
  "replayed": false,
  "skippedWhitelist": true,
  "usageFeeHash": null,
  "result": {
    "txHash": "64-hex",
    "nonce": 1817,
    "status": "success",
    "sender": "erd1...",
    "receiver": "erd1...",
    "tokenIdentifier": "DROP-1fc8cc",
    "amount": "80000000000"
  }
}
```

`result.amount` is the raw base-unit integer. There is no top-level `transfer` object. A withdrawal is confirmed only when HTTP is 200, `status` is `success`, `success` is true, `complete` is true, `result.status` is `success`, `result.txHash` is present, and sender, receiver, token, and raw amount match the reserved withdrawal exactly. `skippedWhitelist` must be true for a Community Fund withdrawal. A missing or false `skippedWhitelist`, or a non-null `usageFeeHash`, stays `NEEDS_RECONCILIATION` and does not restore the balance.

Pending, including a lost lease after broadcast, is HTTP 503 with `complete: false`. `result.txHash` on that body is this operation's signed hash and is not confirmation. Another operation's hash is only `data.blockingTxHash`. HTTP 422 `EXECUTION_FAILED` restores the virtual balance only when that same four-field identity matches. `TX_REJECTED` with no payment hash is the pre-broadcast non-payment. HTTP 409 `PAYMENT_ID_REQUIRED` or `IDEMPOTENCY_CONFLICT` does not restore and is not a payment.

Settlement of `confirm_esdt_withdrawal`, `mark_esdt_withdrawal_unresolved`, and `fail_esdt_withdrawal` requires the current `processing_owner`, `processing_fence`, and an unexpired lease. A worker whose lease was replaced cannot confirm or restore. The request still sends `amount` as a decimal string plus `amountRaw`, `tokenDecimals`, and `x-makex-idempotency-key`. The API remains responsible for checking `amountRaw` against token metadata before broadcast.

The Transfers hotfix needs to honour this contract. This bot will not confirm a withdrawal from the legacy HTTP 200 body that only contains `result.txHash`.

Request, `POST /execute/esdtTransfer`:

- Header `x-makex-idempotency-key`: `wd_` plus the Discord interaction snowflake. Maximum 200 characters.
- Body `idempotencyKey` and `withdrawalId`: the same id.
- Body `amount`: JSON string, not a number, on this path.
- Body `amountRaw`: integer string.
- Body `tokenDecimals`: 0–18.
- Body `tokenTicker`: the full ESDT identifier, unchanged.
- Body `expectFeeExempt`: `true` for Community Fund withdrawals. The bot does not calculate the fee. A whitelisted Community Fund pays no usage fee, so `usageFeeHash` stays null and `fee_tx_hash` stays null.

Same key retries the same payment. A different key is a different payment even when token, wallet, and amount match. The same key with different payment parameters is HTTP 409 `IDEMPOTENCY_CONFLICT`. The bot treats 409 as needs reconciliation and does not restore. `chainStatus` is ignored. An on-chain success for a referenced hash is not confirmation.

## Rollout

Do not merge this PR as the production deploy. Order:

1. Deploy the Transfers API change that echoes transfer identity, accepts the string amount and `amountRaw`, and honours `x-makex-idempotency-key`. Confirm a whitelisted Community Fund still returns no usage fee.
2. Review and apply `supabase/migrations/20261101120000_esdt_withdrawal_reservations.sql` with the service role. The migration creates `esdt_withdrawals` and functions. It does not update balances, clear rows, or insert compensation.
3. Deploy this bot with `SUPABASE_SERVICE_ROLE_KEY` set. Leave `ESDT_WITHDRAWALS_PAUSED` unset, or set it to any value other than `false`. Leave `ESDT_WITHDRAWAL_RECOVERY_ENABLED` unset. New withdrawals are refused before a reservation. The ready loop only lists unresolved rows. It does not POST them to MakeX.
4. After the API contract is live and the incident queries below have been reviewed, set `ESDT_WITHDRAWAL_RECOVERY_ENABLED=true` to retry existing reservations, then `ESDT_WITHDRAWALS_PAUSED=false` for new withdrawals.

The inspector runs on ready and every 120 seconds. While recovery is paused it only counts unresolved rows. After `ESDT_WITHDRAWAL_RECOVERY_ENABLED=true`, a crashed worker’s lease expires after 150 seconds and the next pass retries the same id. It does not create a second withdrawal row. A stale fence cannot confirm or restore.

## Rollback

Redeploy the previous bot build. Do not `DROP` `esdt_withdrawals` while any row is `RESERVED`, `PENDING`, or `NEEDS_RECONCILIATION`. Do not credit those balances from the old restore path. The previous bot does not read this table, so a reserved balance stays deducted until this build resumes the row or a human posts a reviewed ledger adjustment. Unsetting the pause flag is not a rollback.

## Incident reconciliation

No production database was queried or updated for this report. The on-chain facts below are from the public MultiversX API. The MakeX facts are the incident record already attached to issue #1.

Transaction `228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7`:

| Field | Value |
| --- | --- |
| Status | success |
| Time | 1 Nov 2026, 17:13:53 GMT |
| Nonce | 1817 |
| Sender | `erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs` |
| Receiver | `erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n` (herotag `egldvp.elrond`) |
| Token | `DROP-1fc8cc` |
| Raw amount | `80000000000` (800 DROP at 8 decimals) |
| Network fee | 0.000121 EGLD |

That network fee is the chain fee. It is not a MakeX usage fee. MakeX operation `4c2b2a44-4831-477d-9d80-b54e8f061123` was HTTP 503, `OPERATION_FAILED`, reservation `SUBMITTED`, error “Lost the wallet lease during confirmation.” `fee_tx_hash` was null, which matches a whitelisted Community Fund.

This hash pays one recipient one amount of one token. Every other Discord withdrawal that displayed it was not this payment. The bot ledger from that day will not contain the hash, because the old code only logged it. `esdt_withdrawals` will be empty for those historical attempts; the table does not exist until this migration is applied.

Read-only queries are in `scripts/esdt-withdrawal-incident-reconciliation.sql`. Run the bot-database section in the bot project. Run the commented MakeX section only in the MakeX project. Do not execute the commented correction sketches.

### Proposed correction plan (human review only)

Do not replay payments. Do not credit balances from this PR.

1. Run the read-only SQL. Export the deduction rows whose description is `withdrawal (pending blockchain confirmation)` in the review window, plus any later deposit whose description is a ledger reversal for the same guild, user, and token.
2. Partition those rows with Discord logs and embeds, because the ledger has no recipient wallet.
3. Group A: one deduction that matches sender, recipient `erd1japd...`, token `DROP-1fc8cc`, and raw amount `80000000000`. That user may already have been paid by the hash above. Leave the virtual debit in place. Do not send another 800 DROP.
4. Group B: every other user who was shown this hash, or whose virtual balance was deducted, without a MakeX operation whose echoed identity matches their wallet, token, and raw amount. The operation row alone does not identify them: `result_json` was null. Compare `makex_operations` and `makex_tx_reservations` for the Community Fund sender around 17:13 GMT.
5. Restore a Group B balance only with a reviewed ledger adjustment after there is evidence the broadcast did not pay that user. If a broadcast might have occurred, leave the debit reserved.
6. Do not use this hash as the transaction hash on any Group B adjustment.

## Follow-ups

Mass refund, house withdraw, subscription payment, and pool-creation fee now fail closed on a non-success MakeX result. They still do not reserve through `esdt_withdrawals`. A mass refund that sees an ambiguous result does not deduct, and a later rerun can submit a second payment if the first one landed. Those paths also still omit the idempotency key. They should move onto this state machine after the withdrawal hotfix is stable.

## Tests

`npm test` runs the withdrawal cases, `utils/esdt-transfer-contract.test.js` against `test/fixtures/transfers-pr7-esdt-transfer.json` (the JSON from Transfers PR #7), `utils/esdt-withdrawal.pg.test.js` against a disposable Postgres database loaded with this migration and the existing `virtual_accounts` / `virtual_account_transactions` columns, and the NFT role schedule test. The Postgres file is not pointed at production. The withdrawal cases cover confirmed payment, a wrong hash, HTTP 503 with an unrelated blocking hash, a lease lost after broadcast, timeout then later success on the same id, two identical withdrawals with different ids, retry of one id, restart during pending, recovery left paused, concurrent withdrawals, 18-decimal arithmetic, one restoration after a matched failure, a whitelisted Community Fund withdrawal, a stalled response body, and a stale lease that cannot confirm or restore.
