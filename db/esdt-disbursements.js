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
    disbursementId: row.disbursement_id,
    operationKind: row.operation_kind,
    businessActionId: row.business_action_id,
    discordInteractionId: row.discord_interaction_id,
    guildId: row.guild_id,
    userId: row.user_id,
    counterpartyGuildId: row.counterparty_guild_id,
    counterpartyUserId: row.counterparty_user_id,
    tokenIdentifier: row.token_identifier,
    tokenTicker: row.token_ticker,
    amountHuman: row.amount_human,
    amountRaw: row.amount_raw,
    decimals: row.decimals,
    recipientWallet: row.recipient_wallet,
    senderWallet: row.sender_wallet,
    memo: row.memo,
    reservesBalance: row.reserves_balance === true,
    replayable: row.replayable !== false,
    expectFeeExempt: row.expect_fee_exempt === true,
    effectRequired: row.effect_required === true,
    effectPayload: row.effect_payload || {},
    blockScope: row.block_scope,
    status: row.status,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    ledgerTransactionId: row.ledger_transaction_id,
    restorationTransactionId: row.restoration_transaction_id,
    creditTransactionId: row.credit_transaction_id,
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
    dispatchedAt: row.dispatched_at,
    effectAppliedAt: row.effect_applied_at,
    processingOwner: row.processing_owner,
    processingFence: row.processing_fence,
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
  const data = await rpc('reserve_esdt_disbursement', {
    p_disbursement_id: input.disbursementId,
    p_operation_kind: input.operationKind,
    p_business_action_id: input.businessActionId,
    p_discord_interaction_id: input.discordInteractionId || null,
    p_guild_id: input.guildId,
    p_user_id: input.userId,
    p_counterparty_guild_id: input.counterpartyGuildId || null,
    p_counterparty_user_id: input.counterpartyUserId || null,
    p_token_identifier: input.tokenIdentifier,
    p_token_ticker: input.tokenTicker,
    p_amount_human: input.amountHuman,
    p_amount_raw: input.amountRaw,
    p_decimals: input.decimals,
    p_recipient_wallet: input.recipientWallet,
    p_sender_wallet: input.senderWallet,
    p_memo: input.memo || null,
    p_reserves_balance: input.reservesBalance === true,
    p_replayable: input.replayable !== false,
    p_expect_fee_exempt: input.expectFeeExempt === true,
    p_effect_required: input.effectRequired === true,
    p_effect_payload: input.effectPayload || {},
    p_block_scope: input.blockScope
  });
  return {
    created: data.created === true,
    insufficient: data.insufficient === true,
    available: data.available || null,
    record: mapRecord(data.record)
  };
}

async function getById(disbursementId) {
  const { data, error } = await client()
    .from('esdt_disbursements')
    .select('*')
    .eq('disbursement_id', disbursementId)
    .maybeSingle();
  if (error) throw error;
  return mapRecord(data);
}

async function claimLease(disbursementId, owner, seconds) {
  const data = await rpc('claim_esdt_disbursement_lease', {
    p_disbursement_id: disbursementId,
    p_owner: owner,
    p_seconds: seconds
  });
  return {
    acquired: data.acquired === true,
    fence: data.fence || null,
    record: mapRecord(data.record)
  };
}

async function releaseLease(disbursementId, owner, fence) {
  await rpc('release_esdt_disbursement_lease', {
    p_disbursement_id: disbursementId,
    p_owner: owner,
    p_fence: fence
  });
  return { released: true };
}

async function markDispatched(disbursementId, patch) {
  const data = await rpc('mark_esdt_disbursement_dispatched', {
    p_disbursement_id: disbursementId,
    p_owner: patch.processingOwner,
    p_fence: patch.processingFence
  });
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function settleNftWithdrawal(disbursementId, patch) {
  const data = await rpc('settle_nft_disbursement_withdrawal', {
    p_disbursement_id: disbursementId,
    p_owner: patch.processingOwner,
    p_fence: patch.processingFence,
    p_tx_hash: patch.ownedTxHash,
    p_operation_id: patch.operationId || null,
    p_http_status: patch.httpStatus || null,
    p_fee_exempt: patch.feeExempt === true,
    p_usage_fee: patch.usageFee != null ? String(patch.usageFee) : null,
    p_usage_fee_hash: patch.usageFeeHash || null,
    p_chain_nonce: patch.nonce != null ? String(patch.nonce) : null,
    p_guild_id: patch.guildId,
    p_user_id: patch.userId,
    p_recipient: patch.recipientWallet
  });
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function confirm(disbursementId, patch) {
  const data = await rpc('confirm_esdt_disbursement', {
    p_disbursement_id: disbursementId,
    p_owner: patch.processingOwner,
    p_fence: patch.processingFence,
    p_tx_hash: patch.ownedTxHash,
    p_operation_id: patch.operationId || null,
    p_http_status: patch.httpStatus || null,
    p_fee_exempt: patch.feeExempt === true,
    p_usage_fee: patch.usageFee != null ? String(patch.usageFee) : null,
    p_usage_fee_hash: patch.usageFeeHash || null,
    p_nonce: patch.nonce != null ? String(patch.nonce) : null
  });
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function markUnresolved(disbursementId, patch) {
  const data = await rpc('mark_esdt_disbursement_unresolved', {
    p_disbursement_id: disbursementId,
    p_owner: patch.processingOwner,
    p_fence: patch.processingFence,
    p_status: patch.status,
    p_operation_id: patch.operationId || null,
    p_owned_tx_hash: patch.ownedTxHash || null,
    p_blocking_tx_hash: patch.blockingTxHash || null,
    p_untrusted_tx_hash: patch.untrustedTxHash || null,
    p_reservation_state: patch.reservationState || null,
    p_http_status: patch.httpStatus || null,
    p_error_code: patch.errorCode || null,
    p_error_message: patch.errorMessage || null
  });
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function failAndRestore(disbursementId, patch) {
  const data = await rpc('fail_esdt_disbursement', {
    p_disbursement_id: disbursementId,
    p_owner: patch.processingOwner,
    p_fence: patch.processingFence,
    p_authoritative: patch.authoritativeNonPayment === true,
    p_error_code: patch.errorCode || null,
    p_error_message: patch.errorMessage || patch.reason || null,
    p_http_status: patch.httpStatus || null,
    p_operation_id: patch.operationId || null,
    p_owned_tx_hash: patch.ownedTxHash || null
  });
  return { idempotent: data.idempotent === true, record: mapRecord(data.record) };
}

async function noteEffect(disbursementId) {
  const data = await rpc('note_esdt_disbursement_effect', {
    p_disbursement_id: disbursementId
  });
  return {
    claimed: data.claimed === true,
    idempotent: data.idempotent === true,
    record: mapRecord(data.record)
  };
}

async function listUnresolved({ limit = 20 } = {}) {
  const data = await rpc('list_unresolved_esdt_disbursements', { p_limit: limit });
  return (Array.isArray(data) ? data : []).map(mapRecord);
}

async function listEffectsDue({ limit = 20 } = {}) {
  const data = await rpc('list_esdt_disbursement_effects', { p_limit: limit });
  return (Array.isArray(data) ? data : []).map(mapRecord);
}

async function assertNftEntitlement(record) {
  const assets = String(record.tokenIdentifier || '').startsWith('bulk:')
    ? ((record.effectPayload && record.effectPayload.assets) || [])
    : [singleNftAsset(record)];
  for (const asset of assets) {
    const { data, error } = await client()
      .from('virtual_account_nft_balances')
      .select('amount,staked')
      .eq('guild_id', record.guildId)
      .eq('user_id', record.userId)
      .eq('collection', asset.collection)
      .eq('nonce', Number(asset.nonce))
      .maybeSingle();
    if (error) throw error;
    if (!data || data.staked === true || Number(data.amount == null ? 1 : data.amount) < Number(asset.quantity)) {
      const missing = new Error('nft_balance_insufficient');
      missing.code = 'nft_balance_insufficient';
      throw missing;
    }
  }
  return { ok: true };
}

function singleNftAsset(record) {
  const parts = String(record.tokenIdentifier || '').split('-');
  const nonceHex = parts.pop();
  if (!/^[0-9a-fA-F]+$/.test(nonceHex || '')) {
    const error = new Error('nft_settlement_mismatch');
    error.code = 'nft_settlement_mismatch';
    throw error;
  }
  return {
    collection: parts.join('-'),
    nonce: Number.parseInt(nonceHex, 16),
    quantity: Number(record.amountRaw)
  };
}

module.exports = {
  isConfigured,
  reserve,
  getById,
  claimLease,
  releaseLease,
  markDispatched,
  confirm,
  settleNftWithdrawal,
  assertNftEntitlement,
  markUnresolved,
  failAndRestore,
  noteEffect,
  listUnresolved,
  listEffectsDue
};
