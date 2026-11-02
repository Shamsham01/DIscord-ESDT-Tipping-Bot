'use strict';

const {
  canonicalizeEsdtAmount,
  addDecimalStrings,
  subtractDecimalStrings
} = require('./esdt-amount');

const OPEN_STATUSES = new Set(['RESERVED', 'PENDING', 'NEEDS_RECONCILIATION']);

function esdtWithdrawalsArePaused(env = process.env) {
  return env.ESDT_WITHDRAWALS_PAUSED !== 'false';
}

function createWithdrawalId(interactionId) {
  const id = String(interactionId || '').trim();
  if (!/^\d{10,32}$/.test(id)) {
    const error = new Error('A Discord interaction id is required to identify a new withdrawal');
    error.code = 'WITHDRAWAL_ID_REQUIRED';
    throw error;
  }
  return `wd_${id}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function accountKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function tokenTickerOf(tokenIdentifier) {
  return String(tokenIdentifier || '').split('-')[0];
}

class MemoryEsdtWithdrawalRepository {
  constructor(state = {}) {
    this.accounts = new Map();
    this.withdrawals = new Map();
    this.ledger = [];
    this._queue = Promise.resolve();
    if (state.accounts) {
      for (const account of state.accounts) this.accounts.set(account.key, clone(account));
    }
    if (state.withdrawals) {
      for (const row of state.withdrawals) this.withdrawals.set(row.withdrawalId, clone(row));
    }
    if (state.ledger) this.ledger = clone(state.ledger);
  }

  seedAccount({ guildId, userId, tokenIdentifier, balance, auctionReserved = '0' }) {
    const key = accountKey(guildId, userId);
    const existing = this.accounts.get(key) || { key, guildId, userId, balances: {}, auctionReserved: {} };
    existing.balances[tokenIdentifier] = String(balance);
    if (new (require('bignumber.js'))(auctionReserved).gt(0)) {
      existing.auctionReserved[tokenIdentifier] = String(auctionReserved);
    }
    this.accounts.set(key, existing);
  }

  exportState() {
    return {
      accounts: [...this.accounts.values()].map((account) => clone(account)),
      withdrawals: [...this.withdrawals.values()].map((row) => clone(row)),
      ledger: clone(this.ledger)
    };
  }

  static importState(state) {
    return new MemoryEsdtWithdrawalRepository(state);
  }

  balanceOf(guildId, userId, tokenIdentifier) {
    const account = this.accounts.get(accountKey(guildId, userId));
    if (!account) return '0';
    return account.balances[tokenIdentifier] || '0';
  }

  _lock(fn) {
    const run = this._queue.then(() => fn());
    this._queue = run.then(() => undefined, () => undefined);
    return run;
  }

  _mergeTicker(account, tokenIdentifier) {
    const ticker = tokenTickerOf(tokenIdentifier);
    if (!ticker || ticker === tokenIdentifier) return;
    const legacy = account.balances[ticker];
    if (legacy == null) return;
    const BigNumber = require('bignumber.js');
    if (!new BigNumber(legacy).gt(0)) return;
    const current = account.balances[tokenIdentifier] || '0';
    account.balances[tokenIdentifier] = addDecimalStrings(current, legacy);
    delete account.balances[ticker];
  }

  async reserve(input) {
    return this._lock(() => {
      const key = accountKey(input.guildId, input.userId);
      const account = this.accounts.get(key);
      if (!account) {
        const error = new Error('virtual_account_not_found');
        error.code = 'ACCOUNT_NOT_FOUND';
        throw error;
      }
      this._mergeTicker(account, input.tokenIdentifier);

      const existing = [...this.withdrawals.values()].find((row) =>
        row.withdrawalId === input.withdrawalId || row.discordInteractionId === input.discordInteractionId
      );
      if (existing) {
        const same = existing.tokenIdentifier === input.tokenIdentifier
          && existing.amountRaw === input.amountRaw
          && existing.recipientWallet.toLowerCase() === input.recipientWallet.toLowerCase()
          && existing.senderWallet.toLowerCase() === input.senderWallet.toLowerCase();
        if (!same) {
          const error = new Error('idempotency_conflict');
          error.code = 'IDEMPOTENCY_CONFLICT';
          throw error;
        }
        return { created: false, insufficient: false, record: clone(existing) };
      }

      const current = account.balances[input.tokenIdentifier] || '0';
      const reserved = account.auctionReserved[input.tokenIdentifier] || '0';
      const available = subtractDecimalStrings(current, reserved);
      const BigNumber = require('bignumber.js');
      if (new BigNumber(available).lt(input.amountHuman)) {
        return { created: false, insufficient: true, available, record: null };
      }

      const balanceAfter = subtractDecimalStrings(current, input.amountHuman);
      if (new BigNumber(balanceAfter).lt(reserved)) {
        return { created: false, insufficient: true, available, record: null };
      }
      account.balances[input.tokenIdentifier] = balanceAfter;

      const now = new Date().toISOString();
      const ledgerId = `esdt-reserve:${input.withdrawalId}`;
      const record = {
        withdrawalId: input.withdrawalId,
        discordInteractionId: input.discordInteractionId,
        guildId: input.guildId,
        userId: input.userId,
        tokenIdentifier: input.tokenIdentifier,
        tokenTicker: input.tokenTicker,
        amountHuman: input.amountHuman,
        amountRaw: input.amountRaw,
        decimals: input.decimals,
        recipientWallet: input.recipientWallet,
        senderWallet: input.senderWallet,
        memo: input.memo || null,
        status: 'RESERVED',
        balanceBefore: current,
        balanceAfter,
        ledgerTransactionId: ledgerId,
        restorationTransactionId: null,
        makexOperationId: null,
        primaryTxHash: null,
        blockingTxHash: null,
        untrustedTxHash: null,
        reservationState: null,
        httpStatus: null,
        errorCode: null,
        errorMessage: null,
        feeExempt: null,
        usageFee: null,
        usageFeeHash: null,
        nonce: null,
        processingOwner: null,
        processingLeaseUntil: null,
        createdAt: now,
        updatedAt: now,
        confirmedAt: null,
        failedAt: null,
        restoredAt: null
      };
      this.withdrawals.set(record.withdrawalId, record);
      this.ledger.push({
        id: ledgerId,
        guildId: input.guildId,
        userId: input.userId,
        type: 'deduction',
        token: input.tokenIdentifier,
        amount: input.amountHuman,
        balanceBefore: current,
        balanceAfter,
        description: `withdrawal reserved ${input.withdrawalId}`
      });
      return { created: true, insufficient: false, record: clone(record) };
    });
  }

  async getById(withdrawalId) {
    return this._lock(() => clone(this.withdrawals.get(withdrawalId) || null));
  }

  async claimLease(withdrawalId, owner, seconds) {
    return this._lock(() => {
      const row = this.withdrawals.get(withdrawalId);
      if (!row || !OPEN_STATUSES.has(row.status)) return { acquired: false, record: clone(row) };
      const now = Date.now();
      const until = row.processingLeaseUntil ? Date.parse(row.processingLeaseUntil) : 0;
      if (until > now && row.processingOwner && row.processingOwner !== owner) {
        return { acquired: false, record: clone(row) };
      }
      row.processingOwner = owner;
      row.processingLeaseUntil = new Date(now + seconds * 1000).toISOString();
      row.updatedAt = new Date().toISOString();
      return { acquired: true, record: clone(row) };
    });
  }

  async releaseLease(withdrawalId, owner) {
    return this._lock(() => {
      const row = this.withdrawals.get(withdrawalId);
      if (!row || row.processingOwner !== owner) return { released: false };
      row.processingOwner = null;
      row.processingLeaseUntil = null;
      row.updatedAt = new Date().toISOString();
      return { released: true };
    });
  }

  async confirm(withdrawalId, patch) {
    return this._lock(() => {
      const row = this.withdrawals.get(withdrawalId);
      if (!row) throw new Error('withdrawal_not_found');
      if (row.status === 'CONFIRMED') {
        if (row.primaryTxHash === patch.ownedTxHash) return { idempotent: true, record: clone(row) };
        throw new Error('withdrawal_already_confirmed');
      }
      if (!OPEN_STATUSES.has(row.status)) throw new Error('invalid_transition');
      row.status = 'CONFIRMED';
      row.primaryTxHash = patch.ownedTxHash;
      row.makexOperationId = patch.operationId || row.makexOperationId;
      row.httpStatus = patch.httpStatus || 200;
      row.feeExempt = patch.feeExempt === true;
      row.usageFee = patch.usageFee != null ? String(patch.usageFee) : row.usageFee;
      row.usageFeeHash = patch.usageFeeHash || null;
      row.nonce = patch.nonce != null ? String(patch.nonce) : row.nonce;
      row.errorCode = null;
      row.errorMessage = null;
      row.confirmedAt = new Date().toISOString();
      row.updatedAt = row.confirmedAt;
      row.processingOwner = null;
      row.processingLeaseUntil = null;
      return { idempotent: false, record: clone(row) };
    });
  }

  async markUnresolved(withdrawalId, patch) {
    return this._lock(() => {
      const row = this.withdrawals.get(withdrawalId);
      if (!row) throw new Error('withdrawal_not_found');
      if (row.status === 'CONFIRMED' || row.status === 'FAILED') return { idempotent: true, record: clone(row) };
      if (!OPEN_STATUSES.has(row.status) && row.status !== 'RESERVED') throw new Error('invalid_transition');
      row.status = patch.status === 'NEEDS_RECONCILIATION' ? 'NEEDS_RECONCILIATION' : 'PENDING';
      if (patch.ownedTxHash) row.primaryTxHash = patch.ownedTxHash;
      if (patch.blockingTxHash) row.blockingTxHash = patch.blockingTxHash;
      if (patch.untrustedTxHash) row.untrustedTxHash = patch.untrustedTxHash;
      if (patch.operationId) row.makexOperationId = patch.operationId;
      if (patch.reservationState) row.reservationState = patch.reservationState;
      row.httpStatus = patch.httpStatus != null ? patch.httpStatus : row.httpStatus;
      row.errorCode = patch.errorCode || row.errorCode;
      row.errorMessage = patch.errorMessage || row.errorMessage;
      row.updatedAt = new Date().toISOString();
      return { idempotent: false, record: clone(row) };
    });
  }

  async failAndRestore(withdrawalId, patch) {
    return this._lock(() => {
      if (patch.authoritativeNonPayment !== true) {
        throw new Error('refusing to restore without authoritative non-payment');
      }
      const row = this.withdrawals.get(withdrawalId);
      if (!row) throw new Error('withdrawal_not_found');
      if (row.status === 'FAILED' && row.restoredAt) return { idempotent: true, record: clone(row) };
      if (row.status === 'CONFIRMED' || !OPEN_STATUSES.has(row.status)) {
        throw new Error('invalid_transition');
      }
      const key = accountKey(row.guildId, row.userId);
      const account = this.accounts.get(key);
      const current = account.balances[row.tokenIdentifier] || '0';
      const restored = addDecimalStrings(current, row.amountHuman);
      account.balances[row.tokenIdentifier] = restored;
      const ledgerId = `esdt-restore:${row.withdrawalId}`;
      if (!this.ledger.some((entry) => entry.id === ledgerId)) {
        this.ledger.push({
          id: ledgerId,
          guildId: row.guildId,
          userId: row.userId,
          type: 'deposit',
          token: row.tokenIdentifier,
          amount: row.amountHuman,
          balanceBefore: current,
          balanceAfter: restored,
          description: `esdt withdrawal restored (authoritative non-payment) ${row.withdrawalId}`
        });
      }
      row.status = 'FAILED';
      row.balanceAfter = restored;
      row.restorationTransactionId = ledgerId;
      row.restoredAt = new Date().toISOString();
      row.failedAt = row.restoredAt;
      row.updatedAt = row.restoredAt;
      row.errorCode = patch.errorCode || row.errorCode;
      row.errorMessage = patch.errorMessage || patch.reason || row.errorMessage;
      row.httpStatus = patch.httpStatus != null ? patch.httpStatus : row.httpStatus;
      if (patch.operationId) row.makexOperationId = patch.operationId;
      if (patch.ownedTxHash) row.primaryTxHash = patch.ownedTxHash;
      row.processingOwner = null;
      row.processingLeaseUntil = null;
      return { idempotent: false, record: clone(row) };
    });
  }

  async listUnresolved({ limit = 20, now = Date.now() } = {}) {
    return this._lock(() => {
      return [...this.withdrawals.values()]
        .filter((row) => OPEN_STATUSES.has(row.status))
        .filter((row) => !row.processingLeaseUntil || Date.parse(row.processingLeaseUntil) <= now)
        .slice(0, limit)
        .map((row) => clone(row));
    });
  }
}

function buildWithdrawalView(record) {
  const ticker = record.tokenTicker || tokenTickerOf(record.tokenIdentifier);
  const amountLabel = `${record.amountHuman} ${ticker}`;
  if (record.status === 'CONFIRMED') {
    return {
      kind: 'confirmed',
      content: '✅ **Withdrawal completed successfully!**',
      title: '💰 Withdrawal Successful!',
      description: `Successfully withdrew **${amountLabel}** to your wallet`,
      color: 0x00FF00,
      fields: [
        { name: 'Token', value: record.tokenIdentifier, inline: true },
        { name: 'Amount Withdrawn', value: amountLabel, inline: true },
        { name: 'Remaining Balance', value: `${record.balanceAfter} ${ticker}`, inline: true },
        { name: 'Recipient Wallet', value: `\`${record.recipientWallet}\``, inline: false },
        { name: 'Transaction Hash', value: record.primaryTxHash, inline: false },
        { name: 'Withdrawal ID', value: `\`${record.withdrawalId}\``, inline: false },
        { name: 'Status', value: '✅ Success', inline: true }
      ]
    };
  }

  if (record.status === 'FAILED') {
    return {
      kind: 'failed',
      content: record.restoredAt
        ? '❌ **Withdrawal failed.** MakeX confirmed this payment did not occur. Your reserved balance has been restored.'
        : '❌ **Withdrawal failed.**',
      title: '❌ Withdrawal Failed',
      description: 'MakeX reported an authoritative non-payment for this withdrawal.',
      color: 0xFF0000,
      fields: [
        { name: 'Token', value: record.tokenIdentifier, inline: true },
        { name: 'Amount', value: amountLabel, inline: true },
        { name: 'Remaining Balance', value: `${record.balanceAfter} ${ticker}`, inline: true },
        { name: 'Recipient Wallet', value: `\`${record.recipientWallet}\``, inline: false },
        { name: 'Withdrawal ID', value: `\`${record.withdrawalId}\``, inline: false },
        { name: 'Status', value: '❌ Failed', inline: true }
      ]
    };
  }

  const pendingKind = record.status === 'NEEDS_RECONCILIATION' ? 'needs_reconciliation' : 'pending';
  const fields = [
    { name: 'Withdrawal ID', value: `\`${record.withdrawalId}\``, inline: false },
    { name: 'Status', value: 'Pending verification', inline: true },
    { name: 'Balance', value: 'Reserved', inline: true }
  ];
  if (record.primaryTxHash) {
    fields.push({ name: 'Transaction Hash', value: record.primaryTxHash, inline: false });
  }
  fields.push({
    name: 'What to do',
    value: 'Do not create another withdrawal while reconciliation is pending.',
    inline: false
  });
  return {
    kind: pendingKind,
    content: '⏳ **Withdrawal pending verification.** Your balance is reserved. Do not create another withdrawal while reconciliation is pending.',
    title: '⏳ Withdrawal Pending Verification',
    description: `**${amountLabel}** is reserved for withdrawal \`${record.withdrawalId}\`. MakeX has not verified this payment.`,
    color: 0xFFA500,
    fields
  };
}

function pausedView() {
  return {
    kind: 'paused',
    content: '⏸️ **ESDT withdrawals are paused** while the 1 Nov 2026 duplicate-hash incident is reconciled. Your balance was not changed. Do not retry until an admin reopens withdrawals.',
    title: '⏸️ Withdrawals Paused',
    description: 'New ESDT withdrawals are fail-closed. Pending withdrawals stay reserved.',
    color: 0xFFA500,
    fields: []
  };
}

async function executeEsdtWithdrawal({ repo, send, input, workerId }) {
  if (input.paused && input.allowWhilePaused !== true) {
    return { kind: 'paused', reserved: false, view: pausedView(), record: null };
  }

  const amount = canonicalizeEsdtAmount(input.amountHuman, Number(input.decimals));
  const withdrawalId = input.withdrawalId || createWithdrawalId(input.interactionId);
  const reserved = await repo.reserve({
    withdrawalId,
    discordInteractionId: input.interactionId,
    guildId: input.guildId,
    userId: input.userId,
    tokenIdentifier: input.tokenIdentifier,
    tokenTicker: input.tokenTicker || tokenTickerOf(input.tokenIdentifier),
    amountHuman: amount.human,
    amountRaw: amount.raw,
    decimals: amount.decimals,
    recipientWallet: input.recipientWallet,
    senderWallet: input.senderWallet,
    memo: input.memo || null
  });

  if (reserved.insufficient) {
    return {
      kind: 'insufficient',
      reserved: false,
      available: reserved.available,
      amountHuman: amount.human,
      record: null,
      view: null
    };
  }

  let record = reserved.record;
  if (record.status === 'CONFIRMED' || record.status === 'FAILED') {
    return { kind: record.status === 'CONFIRMED' ? 'confirmed' : 'failed', record, view: buildWithdrawalView(record), reserved: !reserved.created ? false : true };
  }

  const owner = workerId || `worker-${process.pid}`;
  const lease = await repo.claimLease(record.withdrawalId, owner, 150);
  if (!lease.acquired) {
    return { kind: 'pending', record, view: buildWithdrawalView(record), reserved: true };
  }

  try {
    record = (await repo.getById(record.withdrawalId)) || record;
    if (record.status === 'CONFIRMED' || record.status === 'FAILED') {
      return {
        kind: record.status === 'CONFIRMED' ? 'confirmed' : 'failed',
        record,
        view: buildWithdrawalView(record),
        reserved: true
      };
    }

    let classified;
    try {
      classified = await send(record);
    } catch (error) {
      if (error && error.beforeBroadcast) {
        const failed = await repo.failAndRestore(record.withdrawalId, {
          authoritativeNonPayment: true,
          reason: error.message,
          errorCode: error.code || 'PRECHECK_FAILED',
          errorMessage: error.message
        });
        return { kind: 'failed', record: failed.record, view: buildWithdrawalView(failed.record), reserved: true };
      }
      const pending = await repo.markUnresolved(record.withdrawalId, {
        status: 'PENDING',
        errorCode: 'SEND_EXCEPTION',
        errorMessage: error.message || String(error)
      });
      return { kind: 'pending', record: pending.record, view: buildWithdrawalView(pending.record), reserved: true };
    }

    if (classified && classified.outcome === 'confirmed') {
      const confirmed = await repo.confirm(record.withdrawalId, classified);
      return { kind: 'confirmed', record: confirmed.record, view: buildWithdrawalView(confirmed.record), reserved: true };
    }

    if (classified && classified.outcome === 'failed' && classified.authoritativeNonPayment === true) {
      const failed = await repo.failAndRestore(record.withdrawalId, {
        authoritativeNonPayment: true,
        reason: classified.errorMessage,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        httpStatus: classified.httpStatus,
        operationId: classified.operationId,
        ownedTxHash: classified.ownedTxHash
      });
      return { kind: 'failed', record: failed.record, view: buildWithdrawalView(failed.record), reserved: true };
    }

    const status = classified && classified.outcome === 'needs_reconciliation' ? 'NEEDS_RECONCILIATION' : 'PENDING';
    const updated = await repo.markUnresolved(record.withdrawalId, {
      status,
      operationId: classified && classified.operationId,
      ownedTxHash: classified && classified.ownedTxHash,
      blockingTxHash: classified && classified.blockingTxHash,
      untrustedTxHash: classified && classified.untrustedTxHash,
      reservationState: classified && classified.reservationState,
      httpStatus: classified && classified.httpStatus,
      errorCode: classified && classified.errorCode,
      errorMessage: classified && classified.errorMessage
    });
    return {
      kind: status === 'NEEDS_RECONCILIATION' ? 'needs_reconciliation' : 'pending',
      record: updated.record,
      view: buildWithdrawalView(updated.record),
      reserved: true
    };
  } finally {
    await repo.releaseLease(withdrawalId, owner);
  }
}

async function resumeEsdtWithdrawal({ repo, send, withdrawalId, workerId }) {
  const existing = await repo.getById(withdrawalId);
  if (!existing) return { kind: 'missing', record: null, view: null };
  if (existing.status === 'CONFIRMED' || existing.status === 'FAILED') {
    return {
      kind: existing.status === 'CONFIRMED' ? 'confirmed' : 'failed',
      record: existing,
      view: buildWithdrawalView(existing)
    };
  }
  return executeEsdtWithdrawal({
    repo,
    send,
    workerId,
    input: {
      interactionId: existing.discordInteractionId,
      withdrawalId: existing.withdrawalId,
      guildId: existing.guildId,
      userId: existing.userId,
      tokenIdentifier: existing.tokenIdentifier,
      tokenTicker: existing.tokenTicker,
      amountHuman: existing.amountHuman,
      decimals: existing.decimals,
      recipientWallet: existing.recipientWallet,
      senderWallet: existing.senderWallet,
      memo: existing.memo,
      paused: true,
      allowWhilePaused: true
    }
  });
}

async function resumeUnresolvedEsdtWithdrawals({ repo, send, workerId, limit = 20 }) {
  const rows = await repo.listUnresolved({ limit });
  const results = [];
  for (const row of rows) {
    try {
      const outcome = await resumeEsdtWithdrawal({
        repo,
        send,
        withdrawalId: row.withdrawalId,
        workerId
      });
      results.push({ withdrawalId: row.withdrawalId, kind: outcome.kind });
    } catch (error) {
      results.push({ withdrawalId: row.withdrawalId, kind: 'error', error: error.message });
    }
  }
  return { checked: rows.length, results };
}

module.exports = {
  esdtWithdrawalsArePaused,
  createWithdrawalId,
  MemoryEsdtWithdrawalRepository,
  buildWithdrawalView,
  executeEsdtWithdrawal,
  resumeEsdtWithdrawal,
  resumeUnresolvedEsdtWithdrawals
};
