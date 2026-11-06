'use strict';

const OWNED_PENDING_CODES = new Set([
  'FENCING_LOST',
  'TX_PENDING',
  'TX_INCONCLUSIVE',
  'TX_NEEDS_RECONCILIATION',
  'TRANSACTION_STATUS_INCONCLUSIVE',
  'NONCE_BUSY',
  'OPERATION_IN_PROGRESS',
  'BATCH_INCOMPLETE',
  'LEDGER_WRITE_FAILED'
]);

const EXECUTION_FAILURE_CODES = new Set(['EXECUTION_FAILED', 'TRANSACTION_FAILED']);

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

/**
 * Transfers PR #7 (d7243201) puts identity on `result`.
 * `result.amount` is the raw base-unit integer, not a human decimal.
 * An explicit `transfer` object is accepted only when that object itself
 * carries `amountRaw`. A human `amount` is never treated as the raw amount.
 */
function normalizeAssets(value) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => ({
    tokenIdentifier: text(item && (item.tokenIdentifier || item.identifier)) || null,
    amountRaw: item && item.amountRaw != null
      ? text(item.amountRaw)
      : (item && item.amount != null ? text(item.amount) : null)
  }));
}

function normalizeTransfer(body, data, result) {
  const explicit = Object.keys(asObject(body.transfer)).length
    ? asObject(body.transfer)
    : asObject(data.transfer);
  const assets = normalizeAssets(result.assets) || normalizeAssets(explicit.assets);
  if (explicit.amountRaw != null && text(explicit.amountRaw) !== '') {
    return {
      sender: explicit.sender || null,
      recipient: explicit.recipient || explicit.receiver || null,
      receiver: explicit.receiver || explicit.recipient || null,
      tokenIdentifier: explicit.tokenIdentifier || explicit.tokenTicker || null,
      amountRaw: text(explicit.amountRaw),
      assets
    };
  }
  return {
    sender: result.sender || null,
    recipient: result.receiver || result.recipient || null,
    receiver: result.receiver || result.recipient || null,
    tokenIdentifier: result.tokenIdentifier || result.tokenTicker || null,
    amountRaw: result.amountRaw != null
      ? text(result.amountRaw)
      : (result.amount != null ? text(result.amount) : null),
    assets
  };
}

function extractEsdtTransferApiFields(parsedResponse) {
  const body = asObject(parsedResponse);
  const data = asObject(body.data);
  const result = asObject(body.result);
  const nestedError = asObject(body.error);
  const transfer = normalizeTransfer(body, data, result);

  let resultStatus = result.status || null;
  if (resultStatus && typeof resultStatus === 'object') {
    resultStatus = resultStatus.status || resultStatus.value || String(resultStatus);
  }

  const errorMessage = firstString(
    typeof body.error === 'string' ? body.error : nestedError.message,
    body.message,
    result.error,
    data.error
  );

  return {
    resultTxHash: firstString(result.txHash, result.transactionHash, result.hash),
    dataTxHash: firstString(data.txHash, data.transactionHash),
    topTxHash: firstString(body.txHash, body.transactionHash),
    blockingTxHash: firstString(body.blockingTxHash, data.blockingTxHash, result.blockingTxHash),
    blockingOperationId: firstString(body.blockingOperationId, data.blockingOperationId),
    resultStatus,
    errorMessage,
    code: firstString(body.code, nestedError.code, data.code, result.code),
    operationId: firstString(body.operationId, data.operationId, result.operationId),
    idempotencyKey: firstString(body.idempotencyKey, data.idempotencyKey, result.idempotencyKey),
    state: firstString(body.state, data.state, result.state),
    reservationState: firstString(body.reservationState, data.reservationState, data.state, result.reservationState),
    transfer,
    usageFeeHash: firstString(body.usageFeeHash, data.usageFeeHash, result.usageFeeHash),
    usageFee: body.usageFee != null ? body.usageFee : (data.usageFee != null ? data.usageFee : null),
    skippedWhitelist: body.skippedWhitelist === true,
    retryable: body.retryable === true || data.retryable === true,
    complete: body.complete === true,
    successFlag: body.success === true,
    assets: transfer.assets || null,
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

function assetListMatches(expectedAssets, actualAssets) {
  if (!Array.isArray(actualAssets) || actualAssets.length !== expectedAssets.length) return false;
  return expectedAssets.every((expectedAsset, index) => {
    const actual = actualAssets[index] || {};
    const expectedToken = text(expectedAsset.tokenIdentifier || expectedAsset.identifier);
    const actualToken = text(actual.tokenIdentifier);
    const expectedAmount = expectedAsset.amountRaw != null ? expectedAsset.amountRaw : expectedAsset.amount;
    const actualAmount = actual.amountRaw != null ? actual.amountRaw : actual.amount;
    return expectedToken !== '' && lower(expectedToken) === lower(actualToken) && integerEqual(expectedAmount, actualAmount);
  });
}

function exactTransferIdentity(expected, fields) {
  const transfer = fields.transfer || {};
  const sender = text(transfer.sender);
  const recipient = text(transfer.recipient || transfer.receiver);
  const token = text(transfer.tokenIdentifier);
  const amountRaw = transfer.amountRaw;
  const mismatches = [];
  if (!expected || !text(expected.sender) || !sender || !addressesEqual(expected.sender, sender)) mismatches.push('sender');
  if (!expected || !text(expected.recipient) || !recipient || !addressesEqual(expected.recipient, recipient)) mismatches.push('recipient');
  const assetIdentity = expected && Array.isArray(expected.assets) && expected.assets.length > 0;
  if (assetIdentity) {
    if (!assetListMatches(expected.assets, fields.assets)) mismatches.push('assets');
  } else {
    if (!expected || !text(expected.tokenIdentifier) || !token || lower(expected.tokenIdentifier) !== lower(token)) mismatches.push('token');
    if (!expected || text(expected.amountRaw) === '' || text(amountRaw) === '' || !integerEqual(expected.amountRaw, amountRaw)) {
      mismatches.push('amountRaw');
    }
  }
  const missing = !sender || !recipient || (assetIdentity
    ? !Array.isArray(fields.assets) || fields.assets.length === 0
    : (!token || text(amountRaw) === ''));
  return { ok: mismatches.length === 0, mismatches, missing };
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
    feeExempt: parts.feeExempt === true,
    skippedWhitelist: fields.skippedWhitelist === true,
    usageFee: parts.usageFee != null ? String(parts.usageFee) : (fields.usageFee != null ? String(fields.usageFee) : null),
    usageFeeHash: fields.usageFeeHash || null,
    nonce: fields.nonce != null ? String(fields.nonce) : null,
    idempotencyKey: fields.idempotencyKey || null,
    mismatches: parts.identity ? parts.identity.mismatches : [],
    complete: fields.complete === true
  };
}

function classifyHashes(fields) {
  const blockingTxHash = fields.blockingTxHash || null;
  let ownedTxHash = null;
  let untrustedTxHash = null;
  if (fields.resultTxHash && fields.resultTxHash !== blockingTxHash) {
    ownedTxHash = fields.resultTxHash;
  }
  const looseHash = fields.dataTxHash || fields.topTxHash || null;
  if (looseHash && looseHash !== ownedTxHash) {
    if (blockingTxHash && looseHash === blockingTxHash) {
      // Already recorded as the other operation's hash.
    } else {
      untrustedTxHash = looseHash;
    }
  }
  return { ownedTxHash, blockingTxHash, untrustedTxHash };
}

function contractSuccess(status, fields) {
  return status === 200
    && fields.complete === true
    && fields.successFlag === true
    && lower(fields.topStatus) === 'success'
    && lower(fields.resultStatus) === 'success'
    && Boolean(fields.resultTxHash);
}

function whitelistProblem(fields) {
  if (fields.skippedWhitelist !== true) return 'WHITELIST_NOT_CONFIRMED';
  if (text(fields.usageFeeHash) !== '') return 'UNEXPECTED_USAGE_FEE';
  if (fields.usageFee != null && text(fields.usageFee) !== '' && text(fields.usageFee) !== '0') return 'UNEXPECTED_USAGE_FEE';
  return null;
}

/**
 * Classify a MakeX /execute/esdtTransfer response.
 * Confirmation requires the Transfers PR #7 success body. Transfers PR #8 must
 * keep that body and the `x-makex-idempotency-key` header. The required body is
 * HTTP 200, status success, success true, complete true, and result.txHash.
 * When identity is required, sender, receiver, token, and exact raw amount
 * must match. `chainStatus` is ignored. A blocking hash is never this payment.
 * nftTransfer, sftTransfer, and multiNFTTransfer are not classified here until
 * those endpoints return this same contract.
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
  const fields = extractEsdtTransferApiFields(parsedResponse);
  const identity = exactTransferIdentity(expected, fields);
  const hashes = classifyHashes(fields);
  const codeUpper = text(fields.code).toUpperCase();
  const message = fields.errorMessage || '';
  const leaseLost = /lost the wallet lease/i.test(message) || codeUpper === 'FENCING_LOST';

  if (contractSuccess(status, fields)) {
    if (hashes.blockingTxHash && hashes.blockingTxHash === fields.resultTxHash) {
      return baseResult({
        outcome: 'needs_reconciliation',
        authoritativeNonPayment: false,
        errorCode: 'BLOCKING_HASH',
        errorMessage: 'MakeX returned a blocking transaction hash. It is not this withdrawal.',
        httpStatus: status,
        fields,
        ownedTxHash: null,
        blockingTxHash: hashes.blockingTxHash,
        untrustedTxHash: fields.resultTxHash,
        identity
      });
    }
    if (requireTransferIdentity && !identity.ok) {
      return baseResult({
        outcome: 'needs_reconciliation',
        authoritativeNonPayment: false,
        errorCode: identity.missing ? 'CONFIRMATION_IDENTITY_MISSING' : 'TRANSFER_IDENTITY_MISMATCH',
        errorMessage: identity.missing
          ? 'MakeX did not echo the sender, recipient, token, and raw amount for this withdrawal. The balance stays reserved.'
          : `MakeX confirmation did not match this withdrawal (${identity.mismatches.join(', ')}).`,
        httpStatus: status,
        fields,
        ownedTxHash: null,
        untrustedTxHash: fields.resultTxHash,
        blockingTxHash: hashes.blockingTxHash,
        identity
      });
    }
    if (expectFeeExempt) {
      const feeCode = whitelistProblem(fields);
      if (feeCode) {
        return baseResult({
          outcome: 'needs_reconciliation',
          authoritativeNonPayment: false,
          errorCode: feeCode,
          errorMessage: feeCode === 'WHITELIST_NOT_CONFIRMED'
            ? 'MakeX did not confirm skippedWhitelist for this Community Fund withdrawal. The balance stays reserved.'
            : 'MakeX reported a usage fee for a whitelisted Community Fund withdrawal. The balance stays reserved.',
          httpStatus: status,
          fields,
          ownedTxHash: hashes.ownedTxHash,
          blockingTxHash: hashes.blockingTxHash,
          identity,
          feeExempt: false
        });
      }
    }
    return baseResult({
      outcome: 'confirmed',
      authoritativeNonPayment: false,
      httpStatus: status,
      fields,
      ownedTxHash: hashes.ownedTxHash,
      blockingTxHash: hashes.blockingTxHash,
      identity,
      feeExempt: expectFeeExempt ? true : fields.skippedWhitelist === true,
      usageFee: expectFeeExempt ? '0' : (fields.usageFee != null ? String(fields.usageFee) : null)
    });
  }

  if (status === 409) {
    return baseResult({
      outcome: 'needs_reconciliation',
      authoritativeNonPayment: false,
      errorCode: codeUpper || 'IDEMPOTENCY_CONFLICT',
      errorMessage: message || 'MakeX rejected this idempotency key. The balance stays reserved. This response is not a payment.',
      httpStatus: status,
      fields,
      ownedTxHash: null,
      untrustedTxHash: hashes.untrustedTxHash || hashes.ownedTxHash,
      blockingTxHash: hashes.blockingTxHash,
      identity
    });
  }

  if (status === 422 && EXECUTION_FAILURE_CODES.has(codeUpper)) {
    const matched = identity.ok
      && Boolean(hashes.ownedTxHash)
      && fields.complete !== true
      && fields.retryable !== true
      && lower(fields.resultStatus) !== 'success';
    if (requireTransferIdentity && matched) {
      return baseResult({
        outcome: 'failed',
        authoritativeNonPayment: true,
        errorCode: codeUpper,
        errorMessage: message || 'MakeX reported that this withdrawal failed on-chain.',
        httpStatus: status,
        fields,
        ownedTxHash: hashes.ownedTxHash,
        blockingTxHash: hashes.blockingTxHash,
        identity
      });
    }
    return baseResult({
      outcome: 'needs_reconciliation',
      authoritativeNonPayment: false,
      errorCode: codeUpper,
      errorMessage: message || 'MakeX reported a failed transaction that did not match this withdrawal.',
      httpStatus: status,
      fields,
      ownedTxHash: null,
      untrustedTxHash: hashes.ownedTxHash || hashes.untrustedTxHash,
      blockingTxHash: hashes.blockingTxHash,
      identity
    });
  }

  const rejectedBeforeBroadcast = codeUpper === 'TX_REJECTED'
    && fields.complete !== true
    && fields.retryable !== true
    && !hashes.ownedTxHash
    && !hashes.untrustedTxHash
    && !hashes.blockingTxHash
    && !fields.resultTxHash
    && !fields.dataTxHash
    && !fields.topTxHash;

  if (rejectedBeforeBroadcast) {
    return baseResult({
      outcome: 'failed',
      authoritativeNonPayment: true,
      errorCode: 'TX_REJECTED',
      errorMessage: message || 'MakeX rejected the withdrawal before broadcast.',
      httpStatus: status,
      fields,
      identity
    });
  }

  const unresolved = leaseLost
    || OWNED_PENDING_CODES.has(codeUpper)
    || fields.retryable
    || fields.complete === false
    || status === 503
    || status === 504
    || status === 0
    || status >= 500;
  if (unresolved) {
    const needsReconciliation = leaseLost
      || Boolean(hashes.blockingTxHash)
      || codeUpper === 'TX_NEEDS_RECONCILIATION'
      || codeUpper === 'FENCING_LOST'
      || codeUpper === 'TX_PENDING';
    return baseResult({
      outcome: needsReconciliation ? 'needs_reconciliation' : 'pending',
      authoritativeNonPayment: false,
      errorCode: codeUpper || (status ? `HTTP_${status}` : 'UNRESOLVED'),
      errorMessage: message || 'MakeX did not confirm this withdrawal.',
      httpStatus: status,
      fields,
      ownedTxHash: hashes.ownedTxHash,
      blockingTxHash: hashes.blockingTxHash,
      untrustedTxHash: hashes.untrustedTxHash,
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
    blockingTxHash: hashes.blockingTxHash,
    untrustedTxHash: hashes.untrustedTxHash || hashes.ownedTxHash,
    identity
  });
}

const CLASSIFIED_OUTCOMES = new Set(['confirmed', 'pending', 'needs_reconciliation', 'failed']);

/**
 * A response that arrived after the request was attempted, but that this
 * client cannot classify. It is never proof that nothing was broadcast.
 */
function unclassifiedTransferResult(result) {
  const source = result && typeof result === 'object' ? result : {};
  const hash = source.txHash || source.untrustedTxHash || null;
  const classified = baseResult({
    outcome: 'needs_reconciliation',
    authoritativeNonPayment: false,
    errorCode: 'UNCLASSIFIED_RESPONSE',
    errorMessage: 'MakeX returned a response that could not be classified. Reserved funds were not restored.',
    httpStatus: Number(source.httpStatus) || 0,
    ownedTxHash: null,
    blockingTxHash: source.blockingTxHash || null,
    untrustedTxHash: hash || null,
    fields: source.operationId ? { operationId: source.operationId } : {}
  });
  classified.broadcastAttempted = true;
  return classified;
}

/**
 * Missing or non-authoritative failure results stay unresolved.
 * `beforeBroadcast` is not inferred from a missing classifier.
 */
function coerceTransferClassification(classified) {
  if (!classified || typeof classified !== 'object' || !CLASSIFIED_OUTCOMES.has(classified.outcome)) {
    return unclassifiedTransferResult(classified);
  }
  if (classified.outcome === 'failed' && classified.authoritativeNonPayment !== true) {
    return {
      ...classified,
      outcome: 'needs_reconciliation',
      authoritativeNonPayment: false,
      ownedTxHash: null,
      untrustedTxHash: classified.ownedTxHash || classified.untrustedTxHash || null,
      errorCode: classified.errorCode || 'UNCLASSIFIED_RESPONSE',
      errorMessage: classified.errorMessage
        || 'MakeX did not prove that no payment was broadcast. Reserved funds were not restored.'
    };
  }
  return classified;
}

function mapClassifiedTransferResult(classified, parsedResponse, httpStatus) {
  const pending = classified.outcome === 'pending' || classified.outcome === 'needs_reconciliation';
  return {
    success: classified.outcome === 'confirmed',
    txHash: classified.outcome === 'confirmed' ? classified.ownedTxHash : null,
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
    skippedWhitelist: classified.skippedWhitelist,
    usageFee: classified.usageFee,
    usageFeeHash: classified.usageFeeHash,
    classified
  };
}

module.exports = {
  extractEsdtTransferApiFields,
  exactTransferIdentity,
  classifyEsdtTransferResponse,
  unclassifiedTransferResult,
  coerceTransferClassification,
  mapClassifiedTransferResult
};
