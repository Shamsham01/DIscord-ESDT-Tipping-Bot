'use strict';

const { canonicalizeEsdtAmount } = require('./esdt-amount');

const OWNED_HASH_CODES = new Set([
  'TRANSACTION_STATUS_INCONCLUSIVE',
  'TRANSACTION_FAILED',
  'LEDGER_WRITE_FAILED'
]);

const BROADCAST_STATES = new Set([
  'submitted',
  'pending',
  'unknown',
  'needs_reconciliation',
  'signed',
  'operation_submitted'
]);

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function firstString(...values) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractEsdtTransferApiFields(parsedResponse) {
  const body = asObject(parsedResponse);
  const data = asObject(body.data);
  const result = asObject(body.result);
  const nestedError = asObject(body.error);
  const transfer = Object.keys(asObject(body.transfer)).length
    ? asObject(body.transfer)
    : asObject(data.transfer);

  let txStatus = result.status || body.status || data.status || null;
  if (txStatus && typeof txStatus === 'object') {
    txStatus = txStatus.status || txStatus.value || String(txStatus);
  }

  const errorMessage = firstString(
    typeof body.error === 'string' ? body.error : nestedError.message,
    lower(body.status) === 'error' ? body.message : null,
    result.error,
    data.error
  );

  return {
    resultTxHash: firstString(result.txHash, result.transactionHash, result.hash),
    dataTxHash: firstString(data.txHash, data.transactionHash),
    topTxHash: firstString(body.txHash, body.transactionHash),
    blockingTxHash: firstString(body.blockingTxHash, data.blockingTxHash, result.blockingTxHash),
    blockingOperationId: firstString(body.blockingOperationId, data.blockingOperationId),
    txStatus,
    errorMessage,
    code: firstString(body.code, nestedError.code, data.code, result.code),
    operationId: firstString(body.operationId, data.operationId, result.operationId),
    idempotencyKey: firstString(body.idempotencyKey, data.idempotencyKey, result.idempotencyKey),
    state: firstString(body.state, data.state, result.state),
    reservationState: firstString(body.reservationState, data.reservationState, data.state, result.reservationState),
    transfer,
    walletAddress: firstString(body.walletAddress, data.walletAddress, transfer.sender),
    usageFeeHash: firstString(body.usageFeeHash, data.usageFeeHash, result.usageFeeHash),
    usageFee: body.usageFee != null ? body.usageFee : (data.usageFee != null ? data.usageFee : null),
    feeExempt: body.feeExempt != null ? body.feeExempt : (data.feeExempt != null ? data.feeExempt : null),
    retryable: body.retryable === true || data.retryable === true,
    broadcast: body.broadcast != null ? body.broadcast : (data.broadcast != null ? data.broadcast : null),
    hashScope: firstString(body.hashScope, data.hashScope, result.hashScope),
    verified: body.verified != null ? body.verified : (data.verified != null ? data.verified : null),
    nonce: result.nonce != null ? result.nonce : (data.nonce != null ? data.nonce : null),
    topStatus: body.status
  };
}

function addressesEqual(left, right) {
  return text(left).toLowerCase() === text(right).toLowerCase();
}

function integerEqual(left, right) {
  try {
    return BigInt(text(left)) === BigInt(text(right));
  } catch {
    return false;
  }
}

function identityMatches(expected, fields) {
  if (!expected) return { ok: true, mismatches: [] };
  const transfer = fields.transfer || {};
  const mismatches = [];
  const sender = transfer.sender || fields.walletAddress;
  const recipient = transfer.recipient || transfer.receiver;
  const token = transfer.tokenIdentifier || transfer.tokenTicker;
  const idempotencyKey = fields.idempotencyKey;

  if (expected.sender && sender && !addressesEqual(expected.sender, sender)) mismatches.push('sender');
  if (expected.recipient && recipient && !addressesEqual(expected.recipient, recipient)) mismatches.push('recipient');
  if (expected.tokenIdentifier && token && lower(expected.tokenIdentifier) !== lower(token)) mismatches.push('token');
  if (expected.idempotencyKey && idempotencyKey && idempotencyKey !== expected.idempotencyKey) {
    mismatches.push('idempotencyKey');
  }
  if (expected.amountRaw && transfer.amountRaw != null && !integerEqual(expected.amountRaw, transfer.amountRaw)) {
    mismatches.push('amountRaw');
  }
  if (expected.amountHuman != null && transfer.amount != null && transfer.amountRaw == null) {
    try {
      const decimals = Number(expected.decimals != null ? expected.decimals : transfer.decimals);
      const got = canonicalizeEsdtAmount(String(transfer.amount), decimals);
      const want = canonicalizeEsdtAmount(String(expected.amountHuman), decimals);
      if (got.raw !== want.raw) mismatches.push('amount');
    } catch {
      mismatches.push('amount');
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function transferIdentityPresent(fields, expected) {
  if (!expected) return false;
  const transfer = fields.transfer || {};
  const sender = transfer.sender || fields.walletAddress;
  const recipient = transfer.recipient || transfer.receiver;
  const token = transfer.tokenIdentifier || transfer.tokenTicker;
  const amount = transfer.amountRaw != null || transfer.amount != null;
  return Boolean(sender && recipient && token && amount);
}

function broadcastMightHaveHappened(fields) {
  if (fields.broadcast === true) return true;
  const state = lower(fields.reservationState || fields.state);
  return BROADCAST_STATES.has(state);
}

function baseResult(parts) {
  const fields = parts.fields || {};
  return {
    outcome: parts.outcome,
    authoritativeNonPayment: parts.authoritativeNonPayment === true,
    ownedTxHash: parts.ownedTxHash || null,
    blockingTxHash: parts.blockingTxHash || null,
    untrustedTxHash: parts.untrustedTxHash || null,
    operationId: fields.operationId || null,
    blockingOperationId: fields.blockingOperationId || null,
    errorCode: parts.errorCode || null,
    errorMessage: parts.errorMessage || null,
    httpStatus: parts.httpStatus || 0,
    reservationState: fields.reservationState || fields.state || null,
    feeExempt: parts.feeExempt != null ? parts.feeExempt : fields.feeExempt === true,
    usageFee: parts.usageFee != null ? String(parts.usageFee) : (fields.usageFee != null ? String(fields.usageFee) : null),
    usageFeeHash: fields.usageFeeHash || null,
    nonce: fields.nonce != null ? String(fields.nonce) : null,
    idempotencyKey: fields.idempotencyKey || null,
    mismatches: parts.identity ? parts.identity.mismatches : []
  };
}

/**
 * Classify a MakeX /execute/esdtTransfer response.
 * `chainStatus` is accepted and ignored. A hash that succeeded on-chain is not
 * proof of this withdrawal, including HTTP 503/504, timeouts, and TX_PENDING.
 */
function classifyEsdtTransferResponse({
  httpStatus = 0,
  parsedResponse = null,
  expected = null,
  requireTransferIdentity = false,
  expectFeeExempt = false,
  timedOut = false,
  networkError = null,
  chainStatus = null
} = {}) {
  void chainStatus;

  if (timedOut || networkError) {
    return baseResult({
      outcome: 'pending',
      authoritativeNonPayment: false,
      errorCode: timedOut ? 'TIMEOUT' : 'NETWORK',
      errorMessage: timedOut
        ? 'MakeX did not respond before the timeout. The withdrawal stays reserved pending verification.'
        : 'MakeX could not be reached. The withdrawal stays reserved pending verification.',
      httpStatus: Number(httpStatus) || 0
    });
  }

  const status = Number(httpStatus) || 0;
  const body = asObject(parsedResponse);
  const fields = extractEsdtTransferApiFields(body);
  const identity = identityMatches(expected, fields);
  const httpOk = status >= 200 && status < 300;
  const codeUpper = text(fields.code).toUpperCase();
  const message = fields.errorMessage || '';
  const leaseLost = /lost the wallet lease/i.test(message) || codeUpper === 'FENCING_LOST';
  const txPending = codeUpper === 'TX_PENDING' || lower(fields.txStatus) === 'tx_pending' || lower(fields.state) === 'tx_pending';
  const looseHash = fields.dataTxHash || fields.topTxHash || null;

  let blockingTxHash = fields.blockingTxHash;
  let ownedTxHash = null;
  let untrustedTxHash = null;

  if (!httpOk || txPending || leaseLost) {
    if (txPending && !blockingTxHash) {
      blockingTxHash = looseHash || fields.resultTxHash;
    } else if (OWNED_HASH_CODES.has(codeUpper) && !txPending && !leaseLost && !blockingTxHash) {
      ownedTxHash = fields.resultTxHash || looseHash;
    } else if (looseHash || fields.resultTxHash) {
      untrustedTxHash = fields.resultTxHash || looseHash;
    }
  } else {
    ownedTxHash = fields.resultTxHash || (lower(fields.hashScope) === 'operation' ? looseHash : null);
  }

  if (ownedTxHash && blockingTxHash && ownedTxHash === blockingTxHash) {
    untrustedTxHash = ownedTxHash;
    ownedTxHash = null;
  }

  const topStatus = lower(fields.topStatus);
  const resultStatus = lower(fields.txStatus);
  const successStatus = resultStatus === 'success' && topStatus !== 'error' && topStatus !== 'fail' && topStatus !== 'failed';
  const verifiedFlag = fields.verified;
  const stateConfirmed = lower(fields.state) === 'operation_confirmed';
  const verifiedConfirmation = httpOk
    && successStatus
    && Boolean(ownedTxHash)
    && identity.ok
    && verifiedFlag !== false
    && (verifiedFlag === true || stateConfirmed || (verifiedFlag == null && topStatus === 'success'));

  const feeProblem = expectFeeExempt && (
    text(fields.usageFeeHash) !== ''
    || fields.feeExempt === false
    || (fields.usageFee != null && text(fields.usageFee) !== '' && text(fields.usageFee) !== '0')
  );

  if (verifiedConfirmation) {
    if (requireTransferIdentity && !transferIdentityPresent(fields, expected)) {
      return baseResult({
        outcome: 'pending',
        authoritativeNonPayment: false,
        errorCode: 'CONFIRMATION_IDENTITY_MISSING',
        errorMessage: 'MakeX has not echoed the sender, recipient, token, and amount for this withdrawal. The balance stays reserved.',
        httpStatus: status,
        fields,
        ownedTxHash: null,
        untrustedTxHash: ownedTxHash,
        blockingTxHash,
        identity
      });
    }
    if (feeProblem) {
      return baseResult({
        outcome: 'needs_reconciliation',
        authoritativeNonPayment: false,
        errorCode: 'UNEXPECTED_USAGE_FEE',
        errorMessage: 'MakeX reported a usage fee for a whitelisted Community Fund withdrawal. The balance stays reserved.',
        httpStatus: status,
        fields,
        ownedTxHash,
        blockingTxHash,
        identity,
        feeExempt: false
      });
    }
    return baseResult({
      outcome: 'confirmed',
      authoritativeNonPayment: false,
      errorCode: null,
      errorMessage: null,
      httpStatus: status,
      fields,
      ownedTxHash,
      blockingTxHash,
      identity,
      feeExempt: expectFeeExempt ? true : fields.feeExempt === true,
      usageFee: expectFeeExempt ? '0' : (fields.usageFee != null ? String(fields.usageFee) : null)
    });
  }

  if (httpOk && !identity.ok) {
    return baseResult({
      outcome: 'needs_reconciliation',
      authoritativeNonPayment: false,
      errorCode: 'TRANSFER_IDENTITY_MISMATCH',
      errorMessage: `MakeX confirmation did not match this withdrawal (${identity.mismatches.join(', ')}).`,
      httpStatus: status,
      fields,
      ownedTxHash: null,
      untrustedTxHash: fields.resultTxHash || looseHash,
      blockingTxHash,
      identity
    });
  }

  if (status === 409) {
    return baseResult({
      outcome: 'needs_reconciliation',
      authoritativeNonPayment: false,
      errorCode: codeUpper || 'IDEMPOTENCY_CONFLICT',
      errorMessage: message || 'MakeX rejected the idempotency key. The balance stays reserved.',
      httpStatus: status,
      fields,
      ownedTxHash: null,
      untrustedTxHash: looseHash,
      blockingTxHash,
      identity
    });
  }

  const ambiguousHttp = status === 503 || status === 504 || status === 0 || (status >= 500 && status <= 599);
  if (leaseLost || txPending || ambiguousHttp || fields.retryable || broadcastMightHaveHappened(fields)) {
    const needsReconciliation = leaseLost
      || txPending
      || broadcastMightHaveHappened(fields)
      || codeUpper === 'TX_NEEDS_RECONCILIATION'
      || codeUpper === 'FENCING_LOST';
    return baseResult({
      outcome: needsReconciliation ? 'needs_reconciliation' : 'pending',
      authoritativeNonPayment: false,
      errorCode: codeUpper || (status ? `HTTP_${status}` : 'UNRESOLVED'),
      errorMessage: message || 'MakeX did not confirm this withdrawal.',
      httpStatus: status,
      fields,
      ownedTxHash: needsReconciliation ? null : ownedTxHash,
      blockingTxHash,
      untrustedTxHash,
      identity
    });
  }

  if (status === 422 && codeUpper === 'TRANSACTION_FAILED') {
    const matched = Boolean(ownedTxHash)
      && identity.ok
      && (!requireTransferIdentity || transferIdentityPresent(fields, expected));
    if (matched) {
      return baseResult({
        outcome: 'failed',
        authoritativeNonPayment: true,
        errorCode: codeUpper,
        errorMessage: message || 'MakeX reported that this withdrawal failed on-chain.',
        httpStatus: status,
        fields,
        ownedTxHash,
        blockingTxHash,
        identity
      });
    }
    return baseResult({
      outcome: 'needs_reconciliation',
      authoritativeNonPayment: false,
      errorCode: codeUpper,
      errorMessage: message || 'MakeX reported a failed transaction that could not be matched to this withdrawal.',
      httpStatus: status,
      fields,
      ownedTxHash: null,
      untrustedTxHash: looseHash,
      blockingTxHash,
      identity
    });
  }

  const preBroadcast = status >= 400
    && status < 500
    && status !== 422
    && !fields.retryable
    && fields.broadcast !== true
    && !broadcastMightHaveHappened(fields)
    && !ownedTxHash
    && !untrustedTxHash
    && !blockingTxHash;

  if (preBroadcast) {
    return baseResult({
      outcome: 'failed',
      authoritativeNonPayment: true,
      errorCode: codeUpper || `HTTP_${status}`,
      errorMessage: message || 'MakeX rejected the withdrawal before broadcast.',
      httpStatus: status,
      fields,
      identity
    });
  }

  return baseResult({
    outcome: 'needs_reconciliation',
    authoritativeNonPayment: false,
    errorCode: codeUpper || `HTTP_${status || 'UNKNOWN'}`,
    errorMessage: message || 'MakeX returned an unresolved withdrawal result.',
    httpStatus: status,
    fields,
    ownedTxHash: null,
    blockingTxHash,
    untrustedTxHash: untrustedTxHash || looseHash,
    identity
  });
}

function mapClassifiedTransferResult(classified, parsedResponse, httpStatus) {
  const pending = classified.outcome === 'pending' || classified.outcome === 'needs_reconciliation';
  return {
    success: classified.outcome === 'confirmed',
    txHash: classified.outcome === 'confirmed' ? classified.ownedTxHash : classified.ownedTxHash,
    errorMessage: classified.errorMessage,
    rawResponse: parsedResponse,
    httpStatus: httpStatus || classified.httpStatus || 0,
    pendingConfirmation: pending,
    outcome: classified.outcome,
    authoritativeNonPayment: classified.authoritativeNonPayment,
    operationId: classified.operationId,
    blockingTxHash: classified.blockingTxHash,
    untrustedTxHash: classified.untrustedTxHash,
    ownedTxHash: classified.ownedTxHash,
    feeExempt: classified.feeExempt,
    usageFee: classified.usageFee,
    usageFeeHash: classified.usageFeeHash,
    classified
  };
}

module.exports = {
  extractEsdtTransferApiFields,
  classifyEsdtTransferResponse,
  mapClassifiedTransferResult
};
