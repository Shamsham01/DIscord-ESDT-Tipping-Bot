'use strict';

const { canonicalizeEsdtAmount } = require('./esdt-amount');
const { classifyEsdtTransferResponse, mapClassifiedTransferResult } = require('./esdt-transfer-outcome');

function preBroadcastError(message, code = 'ESDT_PRECHECK_FAILED') {
  const error = new Error(message);
  error.code = code;
  error.beforeBroadcast = true;
  return error;
}

function buildEsdtTransferRequest({
  recipient,
  tokenIdentifier,
  amount,
  pem,
  options = {}
}) {
  const cleanToken = String(tokenIdentifier || '').trim().replace(/^["']+|["']+$/g, '');
  const identifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
  if (!identifierRegex.test(cleanToken)) {
    throw preBroadcastError(`Invalid token identifier format: "${cleanToken}"`, 'ESDT_AMOUNT_INVALID');
  }

  let amountValue;
  let amountRaw = options.amountRaw || null;
  let decimals = options.decimals;
  if (options.exactDecimal) {
    const canonical = canonicalizeEsdtAmount(amount, Number(decimals));
    if (amountRaw != null && String(amountRaw) !== canonical.raw) {
      throw preBroadcastError(
        'Exact withdrawal amount does not match the raw blockchain amount',
        'ESDT_AMOUNT_INVALID'
      );
    }
    amountValue = canonical.human;
    amountRaw = canonical.raw;
    decimals = canonical.decimals;
  } else if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      throw preBroadcastError(`Invalid amount format: "${amount}"`, 'ESDT_AMOUNT_INVALID');
    }
    amountValue = amount;
  } else {
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum)) {
      throw preBroadcastError(`Invalid amount format: "${amount}"`, 'ESDT_AMOUNT_INVALID');
    }
    amountValue = amountNum;
  }

  const body = {
    recipient,
    amount: amountValue,
    tokenTicker: cleanToken,
    walletPem: pem
  };

  if (options.exactDecimal) {
    body.amountRaw = amountRaw;
    body.tokenDecimals = decimals;
    body.withdrawalId = options.withdrawalId || null;
    body.idempotencyKey = options.idempotencyKey || null;
    if (options.expectFeeExempt === true) body.expectFeeExempt = true;
  }

  const headers = {
    'Content-Type': 'application/json'
  };
  if (options.apiToken) headers.Authorization = `Bearer ${options.apiToken}`;
  if (options.idempotencyKey) headers['x-makex-idempotency-key'] = options.idempotencyKey;

  return {
    body,
    headers,
    amountValue,
    amountRaw,
    tokenIdentifier: cleanToken
  };
}

async function executeMakeXEsdtTransfer({
  endpointBase,
  apiToken,
  pem,
  recipient,
  tokenIdentifier,
  amount,
  options = {},
  fetchImpl,
  timeoutMs = 60000,
  logPrefix = '[TRANSFER]'
}) {
  if (!endpointBase || !apiToken) {
    throw preBroadcastError('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
  }
  if (typeof fetchImpl !== 'function') {
    throw preBroadcastError('Fetch implementation is required');
  }

  const request = buildEsdtTransferRequest({
    recipient,
    tokenIdentifier,
    amount,
    pem,
    options: { ...options, apiToken }
  });

  if (!options.idempotencyKey) {
    throw preBroadcastError(
      'Refusing to call MakeX without a persisted idempotency key.',
      'IDEMPOTENCY_KEY_REQUIRED'
    );
  }

  const fullEndpoint = endpointBase.endsWith('/')
    ? `${endpointBase}execute/esdtTransfer`
    : `${endpointBase}/execute/esdtTransfer`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const classifyOptions = {
    expected: options.expected || null,
    requireTransferIdentity: options.requireTransferIdentity !== false,
    expectFeeExempt: options.expectFeeExempt === true
  };
  let requestStarted = false;

  try {
    console.log(
      `${logPrefix} POST /execute/esdtTransfer idempotency=${options.idempotencyKey || 'none'} token=${request.tokenIdentifier} amount=${options.exactDecimal ? request.amountValue : '[legacy-number]'}`
    );
    if (typeof options.onDispatch === 'function') options.onDispatch();
    requestStarted = true;
    const response = await fetchImpl(fullEndpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
    const responseText = await readResponseBody(response, controller.signal);
    clearTimeout(timeoutId);
    console.log(`${logPrefix} API response status: ${response.status}`);
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      parsedResponse = { success: response.ok, message: responseText.slice(0, 500) };
    }

    const classified = classifyEsdtTransferResponse({
      httpStatus: response.status,
      parsedResponse,
      ...classifyOptions
    });
    const result = mapClassifiedTransferResult(classified, parsedResponse, response.status);
    if (result.success) {
      console.log(`${logPrefix} MakeX confirmed operation ${result.operationId || 'n/a'} hash ${result.txHash}`);
    } else {
      console.error(`${logPrefix} MakeX outcome ${result.outcome}: ${result.errorMessage || 'unresolved'}`);
    }
    return result;
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (!requestStarted) throw fetchError;
    const timedOut = fetchError.name === 'AbortError';
    console.error(`${logPrefix} transfer request ${timedOut ? 'timed out' : 'failed'}: ${fetchError.message}`);
    const classified = classifyEsdtTransferResponse({
      timedOut,
      networkError: timedOut ? null : fetchError,
      ...classifyOptions
    });
    const result = mapClassifiedTransferResult(classified, null, 0);
    result.broadcastAttempted = true;
    return result;
  }
}

function readResponseBody(response, signal) {
  const bodyPromise = response.text();
  if (!signal) return bodyPromise;
  return new Promise((resolve, reject) => {
    const fail = () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) {
      fail();
      return;
    }
    const onAbort = () => fail();
    signal.addEventListener('abort', onAbort, { once: true });
    bodyPromise.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

module.exports = {
  buildEsdtTransferRequest,
  executeMakeXEsdtTransfer
};
