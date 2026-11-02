'use strict';

const { getSupabaseServiceClient, isSupabaseServiceRoleConfigured } = require('../supabase-service-client');

function isConfigured() {
  return isSupabaseServiceRoleConfigured();
}

function client() {
  return getSupabaseServiceClient();
}

function mapRecord(row) {
  if (!row) return null;
  return {
    withdrawalId: row.withdrawal_id,
    discordInteractionId: row.discord_interaction_id,
    guildId: row.guild_id,
    userId: row.user_id,
    tokenIdentifier: row.token_identifier,
    tokenTicker: row.token_ticker,
    amountHuman: row.amount_human,
    amountRaw: row.amount_raw,
    decimals: row.decimals,
    recipientWallet: row.recipient_wallet,
    senderWallet: row.sender_wallet,
    memo: row.memo,
    status: row.status,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    ledgerTransactionId: row.ledger_transaction_id,
    restorationTransactionId: row.restoration_transaction_id,
    makexOperationId: row.makex_operation_id,
    primaryTxHash: row.primary_tx_hash,
    blockingTxHash: row.blocking_tx_hash,
    untrustedTxHash: row.untrusted_tx_hash,
    reservationState: row.reservation_state,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    feeExempt: row.fee_exempt,
    usageFee: row.usage_fee,
    usageFeeHash: row.usage_fee_hash,
    nonce: row.nonce,
    processingOwner: row.processing_owner,
    processingLeaseUntil: row.processing_lease_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    failedAt: row.failed_at,
    restoredAt: row.restored_at
  };
}

async function rpc(name, args) {
  const { data, error } = await client().rpc(name, args);
  if (error) {
    const wrapped = new Error(error.message || String(error));
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

async function reserve(input) {
  const data = await rpc('reserve_esdt_withdrawal', {
    p_withdrawal_id: input.withdrawalId,
    p_discord_interaction_id: input.discordInteractionId,
    p_guild_id: input.guildId,
    p_user_id: input.userId,
    p_token_identifier: input.tokenIdentifier,
    p_token_ticker: input.tokenTicker,
    p_amount_human: input.amountHuman,
    p_amount_raw: input.amountRaw,
    p_decimals: input.decimals,
    p_recipient_wallet: input.recipientWallet,
    p_sender_wallet: input.senderWallet,
    p_memo: input.memo || null
  }));
  return {
    created: data.created === true,
    insufficient: data.insufficient === true,
    available: data.available || null,
    record: mapRecord(data.record)
  };
}

async function getById(withdrawalId) {
  const { data, error } = await client()
    .from('esdt_withdrawals')
    .select('*')
    .eq('withdrawal_id', withdrawalId)
    .maybeSingle();
  if (error) throw error;
  return mapRecord(data);
}

async function claimLease(withdrawalId, owner, seconds) {
  const data = await rpc('claim_esdt_withdrawal_lease', {
    p_withdrawal_id: withdrawalId,
    p_owner: owner,
    p_seconds: seconds
  }));
  return { acquired: data.acquired === true, record: mapRecord(data.record) };
}

async function releaseLease(withdrawalId, owner) {
  await rpc('release_esdt_withdrawal_lease', {
    p_withdrawal_id: withdrawalId,
    p_owner: owner
  }));
  return { released: true };
}

async function confirm(withdrawalId, patch) {
  const data = await rpc('confirm_esdt_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_tx_hash: patch.ownedTxHash,
    p_operation_id: patch.operationId || null,
    p_http_status: patch.httpStatus || null,
    p_fee_exempt: patch.feeExempt === true,
    p_usage_fee: patch.usageFee != null ? String(patch.usageFee) : null,
    p_usage_fee_hash: patch.usageFeeHash || null,
    p_nonce: patch.nonce != null ? String(patch.nonce) : null
  }));
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function markUnresolved(withdrawalId, patch) {
  const data = await rpc('mark_esdt_withdrawal_unresolved', {
    p_withdrawal_id: withdrawalId,
    p_status: patch.status,
    p_operation_id: patch.operationId || null,
    p_owned_tx_hash: patch.ownedTxHash || null,
    p_blocking_tx_hash: patch.blockingTxHash || null,
    p_untrusted_tx_hash: patch.untrustedTxHash || null,
    p_reservation_state: patch.reservationState || null,
    p_http_status: patch.httpStatus || null,
    p_error_code: patch.errorCode || null,
    p_error_message: patch.errorMessage || null
  }));
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function failAndRestore(withdrawalId, patch) {
  const data = await rpc('fail_esdt_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_authoritative: patch.authoritativeNonPayment === true,
    p_error_code: patch.errorCode || null,
    p_error_message: patch.errorMessage || patch.reason || null,
    p_http_status: patch.httpStatus || null,
    p_operation_id: patch.operationId || null,
    p_owned_tx_hash: patch.ownedTxHash || null
  }));
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function listUnresolved({ limit = 20 } = {}) {
  const data = await rpc('list_unresolved_esdt_withdrawals', { p_limit: limit });
  return (Array.isArray(data) ? data : []).map(mapRecord);
}

module.exports = {
  isConfigured,
  reserve,
  getById,
  claimLease,
  releaseLease,
  confirm,
  markUnresolved,
  failAndRestore,
  listUnresolved
};
