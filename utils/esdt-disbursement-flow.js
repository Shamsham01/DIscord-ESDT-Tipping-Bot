'use strict';

const crypto = require('crypto');
const { canonicalizeEsdtAmount, addDecimalStrings, subtractDecimalStrings } = require('./esdt-amount');
const { coerceTransferClassification } = require('./esdt-transfer-outcome');

const OPEN_STATUSES = new Set(['RESERVED', 'PENDING', 'NEEDS_RECONCILIATION']);

const OPERATION_DEFAULTS = {
  mass_refund: {
    reservesBalance: true,
    replayable: true,
    expectFeeExempt: true,
    effectRequired: false,
    blockScope: 'other-interaction'
  },
  house_withdraw: {
    reservesBalance: false,
    replayable: true,
    expectFeeExempt: true,
    effectRequired: true,
    blockScope: 'guild-kind'
  },
  subscription: {
    reservesBalance: true,
    replayable: true,
    expectFeeExempt: true,
    effectRequired: true,
    blockScope: 'guild-kind'
  },
  pool_fee: {
    reservesBalance: true,
    replayable: true,
    expectFeeExempt: true,
    effectRequired: false,
    blockScope: 'guild-user-kind'
  },
  cross_guild: {
    reservesBalance: true,
    replayable: true,
    expectFeeExempt: true,
    effectRequired: false,
    blockScope: 'none'
  },
  admin_send: {
    reservesBalance: false,
    replayable: true,
    expectFeeExempt: false,
    effectRequired: false,
    blockScope: 'recipient'
  },
  nft_transfer: {
    reservesBalance: false,
    replayable: false,
    expectFeeExempt: false,
    effectRequired: false,
    blockScope: 'asset'
  }
};

function esdtDisbursementRecoveryEnabled(env = process.env) {
  return env.ESDT_DISBURSEMENT_RECOVERY_ENABLED === 'true';
}

function esdtDisbursementsEnabled(env = process.env) {
  return env.ESDT_DISBURSEMENTS_ENABLED === 'true';
}

function esdtNftDisbursementsEnabled(env = process.env) {
  return env.ESDT_NFT_DISBURSEMENTS_ENABLED === 'true';
}

function disbursementRolloutOpen(operationKind, env = process.env) {
  if (operationKind === 'nft_transfer') return esdtNftDisbursementsEnabled(env);
  return esdtDisbursementsEnabled(env);
}

function pausedDisbursementResult(operationKind) {
  const nft = operationKind === 'nft_transfer';
  return {
    kind: 'paused',
    reserved: false,
    sent: false,
    record: null,
    code: nft ? 'NFT_DISBURSEMENTS_PAUSED' : 'DISBURSEMENTS_PAUSED'
  };
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

function assertId(value, code) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(id)) {
    const error = new Error('A stable disbursement id is required');
    error.code = code || 'DISBURSEMENT_ID_REQUIRED';
    throw error;
  }
  return id;
}

function assertInteractionId(interactionId) {
  const id = String(interactionId || '').trim();
  if (!/^\d{10,32}$/.test(id)) {
    const error = new Error('A Discord interaction id is required to identify this payment');
    error.code = 'DISBURSEMENT_ID_REQUIRED';
    throw error;
  }
  return id;
}

function interactionDisbursementId(prefix, interactionId) {
  return assertId(`${prefix}_${assertInteractionId(interactionId)}`);
}

function massRefundDisbursementId(interactionId, userId, tokenIdentifier) {
  const readable = `mr_${assertInteractionId(interactionId)}_${userId}_${tokenIdentifier}`;
  if (/^[A-Za-z0-9:_-]{8,200}$/.test(readable)) return readable;
  return assetDisbursementId('mr', interactionId, userId, tokenIdentifier);
}

function poolFeeDisbursementId(poolId) {
  return assertId(`pf_${String(poolId || '').trim()}`);
}

function assetDisbursementId(prefix, interactionId, userId, assetKey) {
  const digest = crypto.createHash('sha256').update(`${userId}|${assetKey}`).digest('hex').slice(0, 24);
  return assertId(`${prefix}_${assertInteractionId(interactionId)}_${digest}`);
}

function hashedDisbursementId(prefix, key) {
  const digest = crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32);
  return assertId(`${prefix}_${digest}`);
}

function operationDefaults(kind) {
  const defaults = OPERATION_DEFAULTS[kind];
  if (!defaults) {
    const error = new Error(`Unknown disbursement kind: ${kind}`);
    error.code = 'invalid_operation_kind';
    throw error;
  }
  return defaults;
}

function namedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function matchesCode(error, code) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`.toLowerCase();
  return text.includes(String(code).toLowerCase());
}

function isOpen(row) {
  if (!row) return false;
  if (OPEN_STATUSES.has(row.status)) return true;
  return row.effectRequired === true && row.status === 'CONFIRMED' && !row.effectAppliedAt;
}

function blocks(existing, input) {
  if (!existing || existing.disbursementId === input.disbursementId) return false;
  if (input.blockScope === 'none') return false;
  if (input.blockScope === 'guild-kind') {
    return existing.guildId === input.guildId
      && existing.operationKind === input.operationKind
      && isOpen(existing);
  }
  if (input.blockScope === 'other-interaction') {
    return existing.guildId === input.guildId
      && existing.operationKind === input.operationKind
      && existing.discordInteractionId !== input.discordInteractionId
      && OPEN_STATUSES.has(existing.status);
  }
  if (input.blockScope === 'guild-user-kind') {
    return existing.guildId === input.guildId
      && existing.userId === input.userId
      && existing.operationKind === input.operationKind
      && OPEN_STATUSES.has(existing.status);
  }
  if (input.blockScope === 'recipient') {
    return existing.guildId === input.guildId
      && existing.operationKind === input.operationKind
      && existing.recipientWallet.toLowerCase() === input.recipientWallet.toLowerCase()
      && existing.tokenIdentifier.toLowerCase() === input.tokenIdentifier.toLowerCase()
      && existing.senderWallet.toLowerCase() === input.senderWallet.toLowerCase()
      && OPEN_STATUSES.has(existing.status);
  }
  if (input.blockScope === 'asset') {
    return existing.guildId === input.guildId
      && existing.userId === input.userId
      && existing.tokenIdentifier.toLowerCase() === input.tokenIdentifier.toLowerCase()
      && OPEN_STATUSES.has(existing.status);
  }
  return false;
}

function emptyHouse() {
  return {
    bettingSpending: {},
    bettingEarnings: {},
    bettingPNL: {},
    auctionSpending: {},
    auctionEarnings: {},
    auctionPNL: {},
    lotterySpending: {},
    lotteryEarnings: {},
    lotteryPNL: {},
    dropSpending: {},
    dropEarnings: {},
    dropPNL: {}
  };
}

class MemoryEsdtDisbursementRepository {
  constructor(state = {}) {
    this.accounts = new Map();
    this.disbursements = new Map();
    this.house = new Map();
    this.ledger = [];
    this._queue = Promise.resolve();
    if (state.accounts) {
      for (const account of state.accounts) this.accounts.set(account.key, clone(account));
    }
    if (state.disbursements) {
      for (const row of state.disbursements) this.disbursements.set(row.disbursementId, clone(row));
    }
    if (state.house) {
      for (const row of state.house) this.house.set(row.key, clone(row));
    }
    if (state.ledger) this.ledger = clone(state.ledger);
  }

  seedAccount({ guildId, userId, tokenIdentifier, balance, auctionReserved = '0' }) {
    const key = accountKey(guildId, userId);
    const existing = this.accounts.get(key) || { key, guildId, userId, balances: {}, auctionReserved: {} };
    existing.balances[tokenIdentifier] = String(balance);
    if (Number(auctionReserved) > 0) existing.auctionReserved[tokenIdentifier] = String(auctionReserved);
    this.accounts.set(key, existing);
  }

  exportState() {
    return {
      accounts: [...this.accounts.values()].map((account) => clone(account)),
      disbursements: [...this.disbursements.values()].map((row) => clone(row)),
      house: [...this.house.values()].map((row) => clone(row)),
      ledger: clone(this.ledger)
    };
  }

  static importState(state) {
    return new MemoryEsdtDisbursementRepository(state);
  }

  balanceOf(guildId, userId, tokenIdentifier) {
    const account = this.accounts.get(accountKey(guildId, userId));
    if (!account) return '0';
    return account.balances[tokenIdentifier] || '0';
  }

  houseSpending(guildId, tokenIdentifier, source) {
    const row = this.house.get(`${guildId}:${tokenIdentifier}`);
    if (!row) return '0';
    const field = `${source}Spending`;
    return (row.balances && row.balances[field] && row.balances[field][tokenIdentifier]) || '0';
  }

  // In-process stand-in for the reserve_esdt_disbursement advisory locks.
  // Two overlapping reserves observe the same block-scope outcome as Postgres.
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
      const existing = [...this.disbursements.values()].find((row) =>
        row.disbursementId === input.disbursementId || row.businessActionId === input.businessActionId
      );
      if (existing) {
        const same = existing.disbursementId === input.disbursementId
          && existing.operationKind === input.operationKind
          && existing.tokenIdentifier === input.tokenIdentifier
          && existing.amountRaw === input.amountRaw
          && existing.recipientWallet.toLowerCase() === input.recipientWallet.toLowerCase()
          && existing.senderWallet.toLowerCase() === input.senderWallet.toLowerCase()
          && String(existing.counterpartyGuildId || '').toLowerCase() === String(input.counterpartyGuildId || '').toLowerCase()
          && String(existing.counterpartyUserId || '') === String(input.counterpartyUserId || '');
        if (!same) throw namedError('idempotency_conflict', 'idempotency_conflict');
        return { created: false, insufficient: false, record: clone(existing) };
      }
      if ([...this.disbursements.values()].some((row) => blocks(row, input))) {
        throw namedError('unresolved_disbursement', 'unresolved_disbursement');
      }

      let balanceBefore = null;
      let balanceAfter = null;
      let ledgerId = null;
      if (input.reservesBalance === true) {
        const key = accountKey(input.guildId, input.userId);
        const account = this.accounts.get(key);
        if (!account) throw namedError('virtual_account_not_found', 'ACCOUNT_NOT_FOUND');
        this._mergeTicker(account, input.tokenIdentifier);
        const current = account.balances[input.tokenIdentifier] || '0';
        const reserved = account.auctionReserved[input.tokenIdentifier] || '0';
        const available = subtractDecimalStrings(current, reserved);
        const BigNumber = require('bignumber.js');
        if (new BigNumber(available).lt(input.amountHuman) || new BigNumber(current).lt(input.amountHuman)) {
          return { created: false, insufficient: true, available, record: null };
        }
        const next = subtractDecimalStrings(current, input.amountHuman);
        if (new BigNumber(next).lt(reserved)) {
          return { created: false, insufficient: true, available, record: null };
        }
        account.balances[input.tokenIdentifier] = next;
        balanceBefore = current;
        balanceAfter = next;
        ledgerId = `esdt-disburse-reserve:${input.disbursementId}`;
        this.ledger.push({
          id: ledgerId,
          guildId: input.guildId,
          userId: input.userId,
          type: 'deduction',
          token: input.tokenIdentifier,
          amount: input.amountHuman,
          balanceBefore: current,
          balanceAfter: next,
          description: `disbursement reserved ${input.disbursementId}`
        });
      }

      const now = new Date().toISOString();
      const record = {
        disbursementId: input.disbursementId,
        operationKind: input.operationKind,
        businessActionId: input.businessActionId,
        discordInteractionId: input.discordInteractionId || null,
        guildId: input.guildId,
        userId: input.userId,
        counterpartyGuildId: input.counterpartyGuildId || null,
        counterpartyUserId: input.counterpartyUserId || null,
        tokenIdentifier: input.tokenIdentifier,
        tokenTicker: input.tokenTicker,
        amountHuman: input.amountHuman,
        amountRaw: input.amountRaw,
        decimals: input.decimals,
        recipientWallet: input.recipientWallet,
        senderWallet: input.senderWallet,
        memo: input.memo || null,
        reservesBalance: input.reservesBalance === true,
        replayable: input.replayable !== false,
        expectFeeExempt: input.expectFeeExempt === true,
        effectRequired: input.effectRequired === true,
        effectPayload: clone(input.effectPayload || {}),
        blockScope: input.blockScope,
        status: 'RESERVED',
        balanceBefore,
        balanceAfter,
        ledgerTransactionId: ledgerId,
        restorationTransactionId: null,
        creditTransactionId: null,
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
        dispatchedAt: null,
        effectAppliedAt: null,
        processingOwner: null,
        processingFence: null,
        processingLeaseUntil: null,
        createdAt: now,
        updatedAt: now,
        confirmedAt: null,
        failedAt: null,
        restoredAt: null
      };
      this.disbursements.set(record.disbursementId, record);
      return { created: true, insufficient: false, record: clone(record) };
    });
  }

  async getById(disbursementId) {
    return this._lock(() => clone(this.disbursements.get(disbursementId) || null));
  }

  async claimLease(disbursementId, owner, seconds) {
    return this._lock(() => {
      const row = this.disbursements.get(disbursementId);
      if (!row || !OPEN_STATUSES.has(row.status)) return { acquired: false, record: clone(row) };
      const now = Date.now();
      const until = row.processingLeaseUntil ? Date.parse(row.processingLeaseUntil) : 0;
      if (until > now && row.processingOwner && row.processingOwner !== owner) {
        return { acquired: false, record: clone(row) };
      }
      row.processingOwner = owner;
      row.processingFence = `${now.toString(16)}-${Math.random().toString(16).slice(2)}`;
      row.processingLeaseUntil = new Date(now + seconds * 1000).toISOString();
      row.updatedAt = new Date().toISOString();
      return { acquired: true, fence: row.processingFence, record: clone(row) };
    });
  }

  async releaseLease(disbursementId, owner, fence) {
    return this._lock(() => {
      const row = this.disbursements.get(disbursementId);
      if (!row || row.processingOwner !== owner || row.processingFence !== fence) return { released: false };
      row.processingOwner = null;
      row.processingFence = null;
      row.processingLeaseUntil = null;
      row.updatedAt = new Date().toISOString();
      return { released: true };
    });
  }

  _requireLease(row, patch) {
    const until = row.processingLeaseUntil ? Date.parse(row.processingLeaseUntil) : 0;
    if (!patch || patch.processingOwner !== row.processingOwner || !patch.processingFence || patch.processingFence !== row.processingFence || until <= Date.now()) {
      throw namedError('lease_lost', 'lease_lost');
    }
  }

  async markDispatched(disbursementId, patch) {
    return this._lock(() => {
      const row = this.disbursements.get(disbursementId);
      if (!row) throw namedError('disbursement_not_found', 'disbursement_not_found');
      if (row.status === 'CONFIRMED' || row.status === 'FAILED') return { idempotent: true, record: clone(row) };
      this._requireLease(row, patch);
      if (!row.dispatchedAt) row.dispatchedAt = new Date().toISOString();
      row.updatedAt = row.dispatchedAt;
      return { idempotent: false, record: clone(row) };
    });
  }

  async confirm(disbursementId, patch) {
    return this._lock(() => {
      const row = this.disbursements.get(disbursementId);
      if (!row) throw namedError('disbursement_not_found', 'disbursement_not_found');
      if (row.status === 'CONFIRMED') {
        if (row.primaryTxHash === patch.ownedTxHash) return { idempotent: true, record: clone(row) };
        throw namedError('disbursement_already_confirmed', 'disbursement_already_confirmed');
      }
      if (!OPEN_STATUSES.has(row.status)) throw namedError('invalid_transition', 'invalid_transition');
      this._requireLease(row, patch);
      if (row.counterpartyGuildId && row.counterpartyUserId) {
        const key = accountKey(row.counterpartyGuildId, row.counterpartyUserId);
        const account = this.accounts.get(key);
        if (!account) throw namedError('counterparty_account_not_found', 'counterparty_account_not_found');
        const current = account.balances[row.tokenIdentifier] || '0';
        const credited = addDecimalStrings(current, row.amountHuman);
        account.balances[row.tokenIdentifier] = credited;
        const ledgerId = `esdt-disburse-credit:${row.disbursementId}`;
        if (!this.ledger.some((entry) => entry.id === ledgerId)) {
          this.ledger.push({
            id: ledgerId,
            guildId: row.counterpartyGuildId,
            userId: row.counterpartyUserId,
            type: 'deposit',
            token: row.tokenIdentifier,
            amount: row.amountHuman,
            balanceBefore: current,
            balanceAfter: credited,
            description: `disbursement credited ${row.disbursementId}`
          });
        }
        row.creditTransactionId = ledgerId;
      }
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
      row.processingFence = null;
      row.processingLeaseUntil = null;
      return { idempotent: false, record: clone(row) };
    });
  }

  async markUnresolved(disbursementId, patch) {
    return this._lock(() => {
      const row = this.disbursements.get(disbursementId);
      if (!row) throw namedError('disbursement_not_found', 'disbursement_not_found');
      if (row.status === 'CONFIRMED' || row.status === 'FAILED') return { idempotent: true, record: clone(row) };
      this._requireLease(row, patch);
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

  async failAndRestore(disbursementId, patch) {
    return this._lock(() => {
      if (patch.authoritativeNonPayment !== true) {
        throw namedError('authoritative_non_payment_required', 'authoritative_non_payment_required');
      }
      const row = this.disbursements.get(disbursementId);
      if (!row) throw namedError('disbursement_not_found', 'disbursement_not_found');
      if (row.status === 'FAILED' && (row.reservesBalance !== true || row.restoredAt)) {
        return { idempotent: true, record: clone(row) };
      }
      if (row.status === 'CONFIRMED' || (!OPEN_STATUSES.has(row.status) && row.status !== 'FAILED')) {
        throw namedError('invalid_transition', 'invalid_transition');
      }
      this._requireLease(row, patch);
      if (row.reservesBalance === true && !row.restoredAt) {
        const account = this.accounts.get(accountKey(row.guildId, row.userId));
        if (!account) throw namedError('virtual_account_not_found', 'virtual_account_not_found');
        const current = account.balances[row.tokenIdentifier] || '0';
        const restored = addDecimalStrings(current, row.amountHuman);
        account.balances[row.tokenIdentifier] = restored;
        const ledgerId = `esdt-disburse-restore:${row.disbursementId}`;
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
            description: `disbursement restored (authoritative non-payment) ${row.disbursementId}`
          });
        }
        row.balanceAfter = restored;
        row.restorationTransactionId = ledgerId;
        row.restoredAt = new Date().toISOString();
      }
      row.status = 'FAILED';
      row.failedAt = new Date().toISOString();
      row.updatedAt = row.failedAt;
      row.errorCode = patch.errorCode || row.errorCode;
      row.errorMessage = patch.errorMessage || patch.reason || row.errorMessage;
      row.httpStatus = patch.httpStatus != null ? patch.httpStatus : row.httpStatus;
      if (patch.operationId) row.makexOperationId = patch.operationId;
      if (patch.ownedTxHash) row.primaryTxHash = patch.ownedTxHash;
      row.processingOwner = null;
      row.processingFence = null;
      row.processingLeaseUntil = null;
      return { idempotent: false, record: clone(row) };
    });
  }

  async noteEffect(disbursementId) {
    return this._lock(() => {
      const row = this.disbursements.get(disbursementId);
      if (!row) throw namedError('disbursement_not_found', 'disbursement_not_found');
      if (row.status !== 'CONFIRMED') throw namedError('effect_not_ready', 'effect_not_ready');
      if (row.effectRequired !== true || row.effectAppliedAt) {
        return { claimed: false, idempotent: true, record: clone(row) };
      }
      if (row.operationKind === 'house_withdraw') {
        const source = row.effectPayload && row.effectPayload.source;
        if (!['betting', 'auction', 'lottery', 'drop'].includes(source)) {
          throw namedError('invalid_house_source', 'invalid_house_source');
        }
        const key = `${row.guildId}:${row.tokenIdentifier}`;
        const house = this.house.get(key) || { key, balances: emptyHouse() };
        const field = `${source}Spending`;
        const pnlField = `${source}PNL`;
        const earnField = `${source}Earnings`;
        const current = (house.balances[field] && house.balances[field][row.tokenIdentifier]) || '0';
        const earned = (house.balances[earnField] && house.balances[earnField][row.tokenIdentifier]) || '0';
        const next = addDecimalStrings(current, row.amountRaw);
        house.balances[field][row.tokenIdentifier] = next;
        house.balances[pnlField][row.tokenIdentifier] = subtractDecimalStrings(earned, next);
        this.house.set(key, house);
      }
      row.effectAppliedAt = new Date().toISOString();
      row.updatedAt = row.effectAppliedAt;
      return { claimed: true, idempotent: false, record: clone(row) };
    });
  }

  async listUnresolved({ limit = 20, now = Date.now() } = {}) {
    return this._lock(() => [...this.disbursements.values()]
      .filter((row) => OPEN_STATUSES.has(row.status))
      .filter((row) => !row.processingLeaseUntil || Date.parse(row.processingLeaseUntil) <= now)
      .slice(0, limit)
      .map((row) => clone(row)));
  }

  async listEffectsDue({ limit = 20 } = {}) {
    return this._lock(() => [...this.disbursements.values()]
      .filter((row) => row.effectRequired === true && row.status === 'CONFIRMED' && !row.effectAppliedAt)
      .slice(0, limit)
      .map((row) => clone(row)));
  }
}

function buildEsdtTransferOptions(record) {
  return {
    exactDecimal: true,
    decimals: record.decimals,
    amountRaw: record.amountRaw,
    idempotencyKey: record.disbursementId,
    withdrawalId: record.disbursementId,
    requireTransferIdentity: true,
    expectFeeExempt: record.expectFeeExempt === true,
    skipSubscriptionCheck: record.operationKind === 'subscription',
    expected: {
      sender: record.senderWallet,
      recipient: record.recipientWallet,
      tokenIdentifier: record.tokenIdentifier,
      amountHuman: record.amountHuman,
      amountRaw: record.amountRaw,
      decimals: record.decimals,
      idempotencyKey: record.disbursementId
    }
  };
}

function legacyAttemptFlags({ httpStatus = 0, txHash = null, requestStarted = false } = {}) {
  const status = Number(httpStatus) || 0;
  const hasHash = Boolean(txHash);
  const precheckRejection = requestStarted === true
    && status >= 400
    && status < 500
    && status !== 409
    && status !== 422
    && !hasHash;
  return {
    broadcastAttempted: requestStarted === true && !precheckRejection,
    authoritativeNonPayment: precheckRejection,
    beforeBroadcast: requestStarted !== true
  };
}

function unconfirmedLegacyTransfer(result) {
  if (result && result.beforeBroadcast === true && result.broadcastAttempted !== true) {
    const error = new Error((result && result.errorMessage) || 'Transfer failed before broadcast');
    error.beforeBroadcast = true;
    error.code = 'PRECHECK_FAILED';
    throw error;
  }
  if (result && result.authoritativeNonPayment === true && result.broadcastAttempted !== true) {
    return {
      outcome: 'failed',
      authoritativeNonPayment: true,
      errorCode: 'PRECHECK_REJECTED',
      errorMessage: result.errorMessage || 'MakeX rejected the transfer before broadcast.',
      httpStatus: result.httpStatus || 0
    };
  }
  return {
    outcome: 'needs_reconciliation',
    authoritativeNonPayment: false,
    ownedTxHash: null,
    untrustedTxHash: result && result.txHash ? result.txHash : null,
    blockingTxHash: null,
    errorCode: 'ENDPOINT_CONTRACT_UNSUPPORTED',
    errorMessage: 'MakeX did not return the Transfers PR #7 ESDT confirmation contract for this endpoint. The transfer was not confirmed and will not be retried automatically.',
    httpStatus: (result && result.httpStatus) || 0,
    operationId: null,
    reservationState: null
  };
}

function normalizeInput(input) {
  const defaults = operationDefaults(input.operationKind);
  const amount = canonicalizeEsdtAmount(String(input.amountHuman), Number(input.decimals));
  const disbursementId = assertId(input.disbursementId || input.businessActionId);
  return {
    ...defaults,
    ...input,
    disbursementId,
    businessActionId: assertId(input.businessActionId || disbursementId),
    amountHuman: amount.human,
    amountRaw: amount.raw,
    decimals: amount.decimals,
    tokenTicker: input.tokenTicker || tokenTickerOf(input.tokenIdentifier),
    reservesBalance: input.reservesBalance != null ? input.reservesBalance === true : defaults.reservesBalance,
    replayable: input.replayable != null ? input.replayable !== false : defaults.replayable,
    expectFeeExempt: input.expectFeeExempt != null ? input.expectFeeExempt === true : defaults.expectFeeExempt,
    effectRequired: input.effectRequired != null ? input.effectRequired === true : defaults.effectRequired,
    blockScope: input.blockScope || defaults.blockScope,
    effectPayload: input.effectPayload || {},
    discordInteractionId: input.interactionId || input.discordInteractionId || null
  };
}

async function executeEsdtDisbursement({ repo, send, input, workerId, env = process.env }) {
  const normalized = normalizeInput(input);
  if (!disbursementRolloutOpen(normalized.operationKind, env)) {
    return pausedDisbursementResult(normalized.operationKind);
  }
  let reserved;
  try {
    reserved = await repo.reserve(normalized);
  } catch (error) {
    if (matchesCode(error, 'unresolved_disbursement')) {
      return { kind: 'blocked', reserved: false, sent: false, record: null, error };
    }
    if (matchesCode(error, 'idempotency_conflict')) {
      return { kind: 'conflict', reserved: false, sent: false, record: null, error };
    }
    throw error;
  }
  if (reserved.insufficient) {
    return {
      kind: 'insufficient',
      reserved: false,
      sent: false,
      available: reserved.available,
      amountHuman: normalized.amountHuman,
      record: null
    };
  }

  let record = reserved.record;
  if (record.status === 'CONFIRMED' || record.status === 'FAILED') {
    return {
      kind: record.status === 'CONFIRMED' ? 'confirmed' : 'failed',
      record,
      sent: false,
      reserved: true
    };
  }
  if (record.replayable === false && record.dispatchedAt) {
    return { kind: 'needs_reconciliation', record, sent: false, reserved: true };
  }

  const owner = workerId || `worker-${process.pid}`;
  const lease = await repo.claimLease(record.disbursementId, owner, 150);
  if (!lease.acquired || !lease.fence) {
    return { kind: 'pending', record, sent: false, reserved: true };
  }
  const leasePatch = { processingOwner: owner, processingFence: lease.fence };

  try {
    record = (await repo.getById(record.disbursementId)) || record;
    if (record.status === 'CONFIRMED' || record.status === 'FAILED') {
      return {
        kind: record.status === 'CONFIRMED' ? 'confirmed' : 'failed',
        record,
        sent: false,
        reserved: true
      };
    }
    if (record.replayable === false && record.dispatchedAt) {
      return { kind: 'needs_reconciliation', record, sent: false, reserved: true };
    }

    const dispatched = await repo.markDispatched(record.disbursementId, leasePatch);
    record = dispatched.record;

    let classified;
    try {
      classified = coerceTransferClassification(await send(record));
    } catch (error) {
      if (error && error.beforeBroadcast === true && error.broadcastAttempted !== true) {
        const failed = await repo.failAndRestore(record.disbursementId, {
          ...leasePatch,
          authoritativeNonPayment: true,
          reason: error.message,
          errorCode: error.code || 'PRECHECK_FAILED',
          errorMessage: error.message
        });
        return { kind: 'failed', record: failed.record, sent: false, reserved: true };
      }
      const pending = await repo.markUnresolved(record.disbursementId, {
        ...leasePatch,
        status: 'PENDING',
        errorCode: 'SEND_EXCEPTION',
        errorMessage: error.message || String(error)
      });
      return { kind: 'pending', record: pending.record, sent: true, reserved: true };
    }

    if (classified && classified.outcome === 'confirmed' && record.replayable === false) {
      classified = {
        ...classified,
        outcome: 'needs_reconciliation',
        authoritativeNonPayment: false,
        untrustedTxHash: classified.ownedTxHash || classified.untrustedTxHash || null,
        ownedTxHash: null,
        errorCode: 'ENDPOINT_CONTRACT_UNSUPPORTED',
        errorMessage: 'This endpoint is not covered by the Transfers PR #7 confirmation contract. The balance was not settled from this response.'
      };
    }

    if (classified && classified.outcome === 'confirmed') {
      const confirmed = await repo.confirm(record.disbursementId, { ...classified, ...leasePatch });
      return { kind: 'confirmed', record: confirmed.record, sent: true, reserved: true };
    }

    if (classified && classified.outcome === 'failed' && classified.authoritativeNonPayment === true) {
      const failed = await repo.failAndRestore(record.disbursementId, {
        ...leasePatch,
        authoritativeNonPayment: true,
        reason: classified.errorMessage,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        httpStatus: classified.httpStatus,
        operationId: classified.operationId,
        ownedTxHash: classified.ownedTxHash
      });
      return { kind: 'failed', record: failed.record, sent: true, reserved: true };
    }

    const status = classified && classified.outcome === 'needs_reconciliation' ? 'NEEDS_RECONCILIATION' : 'PENDING';
    const updated = await repo.markUnresolved(record.disbursementId, {
      ...leasePatch,
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
      sent: true,
      reserved: true
    };
  } catch (error) {
    if (error && (error.code === 'lease_lost' || matchesCode(error, 'lease_lost'))) {
      const current = (await repo.getById(record.disbursementId)) || record;
      return { kind: 'pending', record: current, sent: false, reserved: true, leaseLost: true };
    }
    throw error;
  } finally {
    await repo.releaseLease(record.disbursementId, owner, lease.fence);
  }
}

async function resumeEsdtDisbursement({ repo, send, disbursementId, workerId, recoveryEnabled = false, env = process.env }) {
  const existing = await repo.getById(disbursementId);
  if (!existing) return { kind: 'missing', record: null, posted: false };
  if (existing.status === 'CONFIRMED' || existing.status === 'FAILED') {
    return {
      kind: existing.status === 'CONFIRMED' ? 'confirmed' : 'failed',
      record: existing,
      posted: false
    };
  }
  if (recoveryEnabled !== true) {
    return { kind: 'recovery_paused', record: existing, posted: false };
  }
  if (!disbursementRolloutOpen(existing.operationKind, env)) {
    return { kind: 'rollout_paused', record: existing, posted: false };
  }
  if (existing.replayable === false) {
    return { kind: 'not_replayable', record: existing, posted: false };
  }
  const outcome = await executeEsdtDisbursement({
    repo,
    send,
    workerId,
    env,
    input: {
      operationKind: existing.operationKind,
      disbursementId: existing.disbursementId,
      businessActionId: existing.businessActionId,
      interactionId: existing.discordInteractionId,
      guildId: existing.guildId,
      userId: existing.userId,
      counterpartyGuildId: existing.counterpartyGuildId,
      counterpartyUserId: existing.counterpartyUserId,
      tokenIdentifier: existing.tokenIdentifier,
      tokenTicker: existing.tokenTicker,
      amountHuman: existing.amountHuman,
      decimals: existing.decimals,
      recipientWallet: existing.recipientWallet,
      senderWallet: existing.senderWallet,
      memo: existing.memo,
      reservesBalance: existing.reservesBalance,
      replayable: existing.replayable,
      expectFeeExempt: existing.expectFeeExempt,
      effectRequired: existing.effectRequired,
      effectPayload: existing.effectPayload,
      blockScope: existing.blockScope
    }
  });
  return { ...outcome, posted: outcome.sent === true };
}

async function resumeUnresolvedEsdtDisbursements({ repo, send, workerId, limit = 20, recoveryEnabled = false, env = process.env }) {
  const rows = await repo.listUnresolved({ limit });
  if (recoveryEnabled !== true) {
    return {
      checked: rows.length,
      posted: 0,
      recovery: 'paused',
      results: rows.map((row) => ({ disbursementId: row.disbursementId, kind: 'recovery_paused' }))
    };
  }
  const results = [];
  let posted = 0;
  for (const row of rows) {
    try {
      const outcome = await resumeEsdtDisbursement({
        repo,
        send,
        disbursementId: row.disbursementId,
        workerId,
        recoveryEnabled: true,
        env
      });
      if (outcome.posted) posted += 1;
      results.push({ disbursementId: row.disbursementId, kind: outcome.kind });
    } catch (error) {
      results.push({ disbursementId: row.disbursementId, kind: 'error', error: error.message });
    }
  }
  return { checked: rows.length, posted, recovery: 'enabled', results };
}

module.exports = {
  OPERATION_DEFAULTS,
  esdtDisbursementRecoveryEnabled,
  esdtDisbursementsEnabled,
  esdtNftDisbursementsEnabled,
  disbursementRolloutOpen,
  interactionDisbursementId,
  massRefundDisbursementId,
  poolFeeDisbursementId,
  assetDisbursementId,
  hashedDisbursementId,
  MemoryEsdtDisbursementRepository,
  buildEsdtTransferOptions,
  legacyAttemptFlags,
  unconfirmedLegacyTransfer,
  executeEsdtDisbursement,
  resumeEsdtDisbursement,
  resumeUnresolvedEsdtDisbursements
};
