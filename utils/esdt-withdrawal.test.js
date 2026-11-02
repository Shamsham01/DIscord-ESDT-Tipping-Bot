'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BigNumber = require('bignumber.js');
const { canonicalizeEsdtAmount } = require('./esdt-amount');
const { classifyEsdtTransferResponse } = require('./esdt-transfer-outcome');
const { buildEsdtTransferRequest } = require('./makex-esdt-client');
const { executeMakeXEsdtTransfer } = require('./makex-esdt-client');
const {
  MemoryEsdtWithdrawalRepository,
  executeEsdtWithdrawal,
  resumeEsdtWithdrawal,
  resumeUnresolvedEsdtWithdrawals,
  buildWithdrawalView
} = require('./esdt-withdrawal-flow');

const INCIDENT_HASH = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7';
const OWN_HASH = 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd';
const TOKEN = 'DROP-1fc8cc';
const SENDER = 'erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs';
const RECIPIENT = 'erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n';
const OTHER = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hv';

function repoWith(balance, extra = {}) {
  const repo = new MemoryEsdtWithdrawalRepository();
  repo.seedAccount({
    guildId: 'g',
    userId: 'u',
    tokenIdentifier: extra.tokenIdentifier || TOKEN,
    balance,
    auctionReserved: extra.auctionReserved || '0'
  });
  return repo;
}

function withdrawalInput(interactionId, amountHuman, extra = {}) {
  return {
    interactionId,
    guildId: 'g',
    userId: 'u',
    tokenIdentifier: extra.tokenIdentifier || TOKEN,
    tokenTicker: extra.tokenTicker || 'DROP',
    amountHuman,
    decimals: extra.decimals != null ? extra.decimals : 8,
    recipientWallet: extra.recipientWallet || RECIPIENT,
    senderWallet: extra.senderWallet || SENDER,
    paused: false
  };
}

function expectedOf(record) {
  return {
    sender: record.senderWallet,
    recipient: record.recipientWallet,
    tokenIdentifier: record.tokenIdentifier,
    amountHuman: record.amountHuman,
    amountRaw: record.amountRaw,
    decimals: record.decimals,
    idempotencyKey: record.withdrawalId
  };
}

function classifyFor(record, spec) {
  return classifyEsdtTransferResponse({
    httpStatus: spec.httpStatus,
    parsedResponse: spec.body,
    expected: expectedOf(record),
    requireTransferIdentity: true,
    expectFeeExempt: true,
    timedOut: spec.timedOut === true,
    chainStatus: spec.chainStatus
  });
}

function successSpec(record, txHash = OWN_HASH) {
  return {
    httpStatus: 200,
    chainStatus: 'success',
    body: {
      operationId: `op-${record.withdrawalId}`,
      status: 'success',
      complete: true,
      success: true,
      replayed: false,
      skippedWhitelist: true,
      message: 'ESDT transfer executed successfully.',
      walletAddress: record.senderWallet,
      usageFeeHash: null,
      result: {
        txHash,
        nonce: 20,
        status: 'success',
        sender: record.senderWallet,
        receiver: record.recipientWallet,
        tokenIdentifier: record.tokenIdentifier,
        amount: record.amountRaw
      }
    }
  };
}

function viewText(view) {
  return JSON.stringify(view);
}

test('normal confirmed withdrawal shows the owned hash and deducts once', async () => {
  const repo = repoWith('1000');
  const keys = [];
  const outcome = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000001', '800'),
    send: async (record) => {
      keys.push(record.withdrawalId);
      return classifyFor(record, successSpec(record));
    }
  });

  assert.equal(outcome.kind, 'confirmed');
  assert.equal(outcome.record.status, 'CONFIRMED');
  assert.equal(outcome.record.primaryTxHash, OWN_HASH);
  assert.equal(outcome.record.withdrawalId, 'wd_100000000000000001');
  assert.equal(outcome.record.feeExempt, true);
  assert.equal(outcome.record.usageFee, '0');
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '200');
  assert.match(outcome.view.content, /Withdrawal completed successfully/);
  assert.match(viewText(outcome.view), /800/);
  assert.match(viewText(outcome.view), new RegExp(RECIPIENT));
  assert.match(viewText(outcome.view), new RegExp(OWN_HASH));
  assert.match(viewText(outcome.view), /wd_100000000000000001/);
  assert.match(viewText(outcome.view), /Success/);
  assert.deepEqual(keys, ['wd_100000000000000001']);
});

test('wrong transaction hash is not displayed as this withdrawal', async () => {
  const repo = repoWith('1000');
  const outcome = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000002', '10'),
    send: async (record) => classifyFor(record, {
      httpStatus: 200,
      chainStatus: 'success',
      body: {
        operationId: 'op-wrong',
        status: 'success',
        complete: true,
        success: true,
        replayed: false,
        skippedWhitelist: true,
        usageFeeHash: null,
        walletAddress: record.senderWallet,
        result: {
          txHash: INCIDENT_HASH,
          nonce: 1817,
          status: 'success',
          sender: record.senderWallet,
          receiver: OTHER,
          tokenIdentifier: 'USDC-c76f1f',
          amount: '1'
        }
      }
    })
  });

  assert.notEqual(outcome.kind, 'confirmed');
  assert.equal(outcome.record.status, 'NEEDS_RECONCILIATION');
  assert.equal(outcome.record.primaryTxHash, null);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '990');
  assert.equal(viewText(outcome.view).includes(INCIDENT_HASH), false);
  assert.doesNotMatch(outcome.view.content, /Withdrawal completed successfully/);
});

test('HTTP 503 with an unrelated blocking hash is not a successful withdrawal', async () => {
  const incidentBody = {
    error: 'Lost the wallet lease during confirmation.',
    status: 'error',
    code: 'FENCING_LOST',
    message: 'Lost the wallet lease during confirmation.',
    retryable: true,
    usageFeeHash: null,
    data: {
      retryable: true,
      operationId: '4c2b2a44-4831-477d-9d80-b54e8f061123',
      txHash: INCIDENT_HASH,
      blockingTxHash: INCIDENT_HASH,
      state: 'SUBMITTED'
    }
  };
  const classified = classifyEsdtTransferResponse({
    httpStatus: 503,
    parsedResponse: incidentBody,
    chainStatus: 'success',
    requireTransferIdentity: true,
    expectFeeExempt: true,
    expected: {
      sender: SENDER,
      recipient: OTHER,
      tokenIdentifier: 'USDC-c76f1f',
      amountHuman: '5',
      amountRaw: '5000000',
      decimals: 6,
      idempotencyKey: 'wd_100000000000000003'
    }
  });
  assert.notEqual(classified.outcome, 'confirmed');
  assert.equal(classified.authoritativeNonPayment, false);
  assert.equal(classified.ownedTxHash, null);

  const gatewayTimeout = classifyEsdtTransferResponse({
    httpStatus: 504,
    parsedResponse: {
      status: 'error',
      code: 'TRANSACTION_STATUS_INCONCLUSIVE',
      message: 'The transaction was sent but a final success status could not be confirmed in time.',
      data: { txHash: INCIDENT_HASH }
    },
    chainStatus: 'success',
    requireTransferIdentity: true,
    expectFeeExempt: true
  });
  assert.notEqual(gatewayTimeout.outcome, 'confirmed');
  assert.equal(gatewayTimeout.authoritativeNonPayment, false);

  const seeded = repoWith('50', { tokenIdentifier: 'USDC-c76f1f' });
  const settled = await executeEsdtWithdrawal({
    repo: seeded,
    input: withdrawalInput('100000000000000003', '5', {
      recipientWallet: OTHER,
      decimals: 6,
      tokenIdentifier: 'USDC-c76f1f',
      tokenTicker: 'USDC'
    }),
    send: async () => classified
  });
  assert.equal(settled.kind, 'needs_reconciliation');
  assert.equal(settled.record.status, 'NEEDS_RECONCILIATION');
  assert.equal(settled.record.primaryTxHash, null);
  assert.equal(seeded.balanceOf('g', 'u', 'USDC-c76f1f'), '45');
  assert.equal(viewText(settled.view).includes(INCIDENT_HASH), false);
  assert.match(settled.view.content, /pending verification/i);
  assert.match(viewText(settled.view), /Do not create another withdrawal/);
});

test('wallet lease lost after broadcast stays unresolved and is not restored', async () => {
  const repo = repoWith('80');
  const outcome = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000004', '8'),
    send: async () => classifyEsdtTransferResponse({
      httpStatus: 503,
      chainStatus: 'success',
      requireTransferIdentity: true,
      expectFeeExempt: true,
      parsedResponse: {
        error: 'Lost the wallet lease during confirmation.',
        status: 'error',
        code: 'FENCING_LOST',
        retryable: true,
        data: {
          operationId: '4c2b2a44-4831-477d-9d80-b54e8f061123',
          txHash: INCIDENT_HASH,
          state: 'SUBMITTED'
        }
      }
    })
  });

  assert.equal(outcome.record.status, 'NEEDS_RECONCILIATION');
  assert.equal(outcome.record.primaryTxHash, null);
  assert.equal(outcome.record.untrustedTxHash, INCIDENT_HASH);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '72');
  assert.equal(outcome.record.restoredAt, null);
  const restores = repo.exportState().ledger.filter((entry) => entry.type === 'deposit');
  assert.equal(restores.length, 0);
  assert.equal(viewText(outcome.view).includes(INCIDENT_HASH), false);
  assert.doesNotMatch(outcome.view.content, /Withdrawal completed successfully/);
});

test('HTTP timeout stays pending and a later verified confirmation settles the same withdrawal', async () => {
  const repo = repoWith('30');
  const seen = [];
  let attempt = 0;
  const send = async (record) => {
    seen.push(record.withdrawalId);
    attempt += 1;
    if (attempt === 1) {
      return classifyFor(record, { timedOut: true, httpStatus: 0, chainStatus: 'success', body: {} });
    }
    return classifyFor(record, successSpec(record, OWN_HASH));
  };

  const first = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000005', '3'),
    send
  });
  assert.equal(first.record.status, 'PENDING');
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '27');
  assert.doesNotMatch(first.view.content, /Withdrawal completed successfully/);

  const second = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000005', '3'),
    send
  });
  assert.equal(second.kind, 'confirmed');
  assert.equal(second.record.withdrawalId, first.record.withdrawalId);
  assert.equal(second.record.primaryTxHash, OWN_HASH);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '27');
  assert.deepEqual(seen, ['wd_100000000000000005', 'wd_100000000000000005']);
  assert.equal(repo.exportState().withdrawals.length, 1);
});

test('repeated identical withdrawals use distinct ids and both settle', async () => {
  const repo = repoWith('20');
  const keys = [];
  const send = async (record) => {
    keys.push(record.withdrawalId);
    return classifyFor(record, successSpec(record, record.withdrawalId.endsWith('6') ? OWN_HASH : INCIDENT_HASH.replace(/2/g, 'a')));
  };
  const first = await executeEsdtWithdrawal({ repo, input: withdrawalInput('100000000000000006', '4'), send });
  const second = await executeEsdtWithdrawal({ repo, input: withdrawalInput('100000000000000007', '4'), send });
  assert.equal(first.kind, 'confirmed');
  assert.equal(second.kind, 'confirmed');
  assert.notEqual(first.record.withdrawalId, second.record.withdrawalId);
  assert.deepEqual(keys, ['wd_100000000000000006', 'wd_100000000000000007']);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '12');
  assert.equal(repo.exportState().withdrawals.length, 2);
});

test('retry of one pending withdrawal reuses its original id', async () => {
  const repo = repoWith('15');
  const keys = [];
  let attempt = 0;
  const send = async (record) => {
    keys.push(record.withdrawalId);
    attempt += 1;
    if (attempt === 1) {
      return classifyEsdtTransferResponse({
        httpStatus: 503,
        requireTransferIdentity: true,
        expectFeeExempt: true,
        expected: expectedOf(record),
        parsedResponse: {
          error: 'Operation in progress',
          status: 'error',
          code: 'OPERATION_IN_PROGRESS',
          retryable: true,
          data: { operationId: 'op-same', state: 'OPERATION_IN_PROGRESS' }
        }
      });
    }
    return classifyFor(record, successSpec(record));
  };

  const first = await executeEsdtWithdrawal({ repo, input: withdrawalInput('100000000000000008', '2'), send });
  const second = await executeEsdtWithdrawal({ repo, input: withdrawalInput('100000000000000008', '2'), send });
  assert.equal(first.record.withdrawalId, 'wd_100000000000000008');
  assert.equal(second.record.withdrawalId, 'wd_100000000000000008');
  assert.equal(second.kind, 'confirmed');
  assert.deepEqual(keys, ['wd_100000000000000008', 'wd_100000000000000008']);
  assert.equal(repo.exportState().ledger.filter((entry) => entry.type === 'deduction').length, 1);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '13');
});

test('bot restart during a pending withdrawal resumes the same durable id', async () => {
  const repo = repoWith('11');
  let attempt = 0;
  const send = async (record) => {
    attempt += 1;
    if (attempt === 1) return classifyFor(record, { timedOut: true, body: {} });
    return classifyFor(record, successSpec(record));
  };
  const first = await executeEsdtWithdrawal({
    repo,
    workerId: 'process-a',
    input: withdrawalInput('100000000000000009', '1'),
    send
  });
  assert.equal(first.record.status, 'PENDING');
  const restarted = MemoryEsdtWithdrawalRepository.importState(repo.exportState());
  const paused = await resumeEsdtWithdrawal({
    repo: restarted,
    withdrawalId: first.record.withdrawalId,
    workerId: 'process-b',
    send
  });
  assert.equal(paused.kind, 'recovery_paused');
  assert.equal(paused.posted, false);
  assert.equal(attempt, 1);

  const resumed = await resumeEsdtWithdrawal({
    repo: restarted,
    withdrawalId: first.record.withdrawalId,
    workerId: 'process-b',
    recoveryEnabled: true,
    send
  });
  assert.equal(resumed.kind, 'confirmed');
  assert.equal(resumed.record.withdrawalId, 'wd_100000000000000009');
  assert.equal(restarted.exportState().withdrawals.length, 1);
  assert.equal(restarted.balanceOf('g', 'u', TOKEN), '10');
  assert.equal(restarted.exportState().ledger.filter((entry) => entry.type === 'deduction').length, 1);
});

test('concurrent withdrawals from one virtual account cannot overdraw', async () => {
  const repo = repoWith('10');
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const send = async (record) => {
    calls += 1;
    await gate;
    return classifyFor(record, successSpec(record));
  };
  const pending = Promise.all([
    executeEsdtWithdrawal({ repo, workerId: 'a', input: withdrawalInput('100000000000000010', '6'), send }),
    executeEsdtWithdrawal({ repo, workerId: 'b', input: withdrawalInput('100000000000000011', '6'), send })
  ]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  release();
  const [left, right] = await pending;
  const kinds = [left.kind, right.kind].sort();
  assert.deepEqual(kinds, ['confirmed', 'insufficient']);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '4');
  assert.equal(repo.exportState().withdrawals.length, 1);

  const both = repoWith('10');
  const ids = [];
  await Promise.all([
    executeEsdtWithdrawal({
      repo: both,
      workerId: 'c',
      input: withdrawalInput('100000000000000012', '4'),
      send: async (record) => {
        ids.push(record.withdrawalId);
        return classifyFor(record, successSpec(record));
      }
    }),
    executeEsdtWithdrawal({
      repo: both,
      workerId: 'd',
      input: withdrawalInput('100000000000000013', '4'),
      send: async (record) => {
        ids.push(record.withdrawalId);
        return classifyFor(record, successSpec(record));
      }
    })
  ]);
  assert.equal(both.balanceOf('g', 'u', TOKEN), '2');
  assert.equal(new Set(ids).size, 2);

  const shared = repoWith('9');
  let sharedCalls = 0;
  let sharedRelease;
  const sharedGate = new Promise((resolve) => { sharedRelease = resolve; });
  const sharedWork = Promise.all([
    executeEsdtWithdrawal({
      repo: shared,
      workerId: 'e',
      input: withdrawalInput('100000000000000014', '3'),
      send: async (record) => {
        sharedCalls += 1;
        await sharedGate;
        return classifyFor(record, successSpec(record));
      }
    }),
    executeEsdtWithdrawal({
      repo: shared,
      workerId: 'f',
      input: withdrawalInput('100000000000000014', '3'),
      send: async (record) => {
        sharedCalls += 1;
        await sharedGate;
        return classifyFor(record, successSpec(record));
      }
    })
  ]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sharedCalls, 1);
  sharedRelease();
  await sharedWork;
  assert.equal(shared.exportState().withdrawals.length, 1);
  assert.equal(shared.balanceOf('g', 'u', TOKEN), '6');
});

test('exact 18-decimal token arithmetic survives values JavaScript Number cannot represent', () => {
  const human = '1.234567890123456789';
  const canonical = canonicalizeEsdtAmount(human, 18);
  assert.equal(canonical.raw, '1234567890123456789');
  assert.equal(canonical.human, human);
  const viaNumber = new BigNumber(Number(human)).shiftedBy(18).integerValue(BigNumber.ROUND_HALF_UP).toFixed(0);
  assert.notEqual(viaNumber, canonical.raw);

  const request = buildEsdtTransferRequest({
    recipient: RECIPIENT,
    tokenIdentifier: 'PREC-abcdef',
    amount: human,
    pem: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    options: {
      exactDecimal: true,
      decimals: 18,
      amountRaw: canonical.raw,
      idempotencyKey: 'wd_100000000000000015',
      withdrawalId: 'wd_100000000000000015',
      expectFeeExempt: true,
      apiToken: 'secret-token'
    }
  });
  assert.equal(typeof request.body.amount, 'string');
  assert.equal(request.body.amount, human);
  assert.equal(request.body.amountRaw, canonical.raw);
  assert.equal(request.headers['x-makex-idempotency-key'], 'wd_100000000000000015');
  assert.equal(JSON.stringify(request.body).includes('"amount":"1.234567890123456789"'), true);
  assert.equal(Object.hasOwn(request.body, 'fee'), false);
  assert.equal(Object.hasOwn(request.body, 'usageFee'), false);
});

test('a failed matched transaction restores the reserved balance exactly once', async () => {
  const repo = repoWith('5');
  let sends = 0;
  const send = async (record) => {
    sends += 1;
    return classifyFor(record, {
      httpStatus: 422,
      body: {
        operationId: 'op-fail',
        status: 'failed',
        complete: false,
        code: 'EXECUTION_FAILED',
        error: 'execution reverted',
        message: 'execution reverted',
        retryable: false,
        skippedWhitelist: true,
        usageFeeHash: null,
        result: {
          txHash: OWN_HASH,
          nonce: 21,
          status: 'fail',
          sender: record.senderWallet,
          receiver: record.recipientWallet,
          tokenIdentifier: record.tokenIdentifier,
          amount: record.amountRaw
        }
      }
    });
  };
  const first = await executeEsdtWithdrawal({ repo, input: withdrawalInput('100000000000000016', '1.5'), send });
  assert.equal(first.kind, 'failed');
  assert.equal(first.record.restoredAt != null, true);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '5');

  const second = await executeEsdtWithdrawal({ repo, input: withdrawalInput('100000000000000016', '1.5'), send });
  await repo.failAndRestore(first.record.withdrawalId, { authoritativeNonPayment: true, errorMessage: 'again' });
  assert.equal(second.kind, 'failed');
  assert.equal(sends, 1);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '5');
  const ledger = repo.exportState().ledger;
  assert.equal(ledger.filter((entry) => entry.type === 'deduction').length, 1);
  assert.equal(ledger.filter((entry) => entry.type === 'deposit').length, 1);
  assert.equal(buildWithdrawalView(second.record).content.includes('Withdrawal completed successfully'), false);
});

test('whitelisted Community Fund withdrawal requests zero usage fee and does not deduct one', async () => {
  const captured = [];
  const repo = repoWith('9007199254740993', { tokenIdentifier: 'UNIT-abc123' });
  const outcome = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000017', '1', { decimals: 0, tokenIdentifier: 'UNIT-abc123', tokenTicker: 'UNIT' }),
    send: async (record) => {
      const request = buildEsdtTransferRequest({
        recipient: record.recipientWallet,
        tokenIdentifier: record.tokenIdentifier,
        amount: record.amountHuman,
        pem: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
        options: {
          exactDecimal: true,
          decimals: record.decimals,
          amountRaw: record.amountRaw,
          idempotencyKey: record.withdrawalId,
          withdrawalId: record.withdrawalId,
          expectFeeExempt: true,
          apiToken: 'token'
        }
      });
      captured.push(request);
      return classifyFor(record, successSpec(record));
    }
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].body.expectFeeExempt, true);
  assert.equal(captured[0].headers['x-makex-idempotency-key'], outcome.record.withdrawalId);
  assert.equal(captured[0].body.fee, undefined);
  assert.equal(outcome.kind, 'confirmed');
  assert.equal(outcome.record.usageFee, '0');
  assert.equal(outcome.record.feeExempt, true);
  assert.equal(outcome.record.usageFeeHash, null);
  assert.equal(repo.balanceOf('g', 'u', 'UNIT-abc123'), '9007199254740992');

  const charged = classifyEsdtTransferResponse({
    httpStatus: 200,
    expectFeeExempt: true,
    requireTransferIdentity: true,
    parsedResponse: {
      ...successSpec({
        senderWallet: SENDER,
        recipientWallet: RECIPIENT,
        tokenIdentifier: TOKEN,
        amountHuman: '1',
        amountRaw: '100000000',
        decimals: 8,
        withdrawalId: 'wd_fee'
      }).body,
      usageFeeHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      feeExempt: false,
      usageFee: '1'
    },
    expected: {
      sender: SENDER,
      recipient: RECIPIENT,
      tokenIdentifier: TOKEN,
      amountHuman: '1',
      amountRaw: '100000000',
      decimals: 8,
      idempotencyKey: 'wd_fee'
    }
  });
  assert.equal(charged.outcome, 'needs_reconciliation');
  assert.equal(charged.errorCode, 'UNEXPECTED_USAGE_FEE');
});

test('a stalled response body is a timeout and does not become a pre-broadcast failure', async () => {
  const result = await executeMakeXEsdtTransfer({
    endpointBase: 'https://makex.example',
    apiToken: 'token',
    pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    recipient: RECIPIENT,
    tokenIdentifier: TOKEN,
    amount: '1',
    timeoutMs: 30,
    options: {
      exactDecimal: true,
      decimals: 8,
      amountRaw: '100000000',
      idempotencyKey: 'wd_100000000000000018',
      withdrawalId: 'wd_100000000000000018',
      expectFeeExempt: true
    },
    fetchImpl: async () => ({
      status: 200,
      text() {
        return new Promise(() => {});
      }
    })
  });
  assert.equal(result.outcome, 'pending');
  assert.equal(result.success, false);
  assert.equal(result.broadcastAttempted, true);
  assert.equal(result.classified.errorCode, 'TIMEOUT');
  assert.equal(result.authoritativeNonPayment, false);

  let called = false;
  await assert.rejects(
    () => executeMakeXEsdtTransfer({
      endpointBase: 'https://makex.example',
      apiToken: 'token',
      pem: 'pem',
      recipient: RECIPIENT,
      tokenIdentifier: 'not-a-token',
      amount: '1',
      options: { exactDecimal: true, decimals: 0, amountRaw: '1' },
      fetchImpl: async () => {
        called = true;
        return { status: 500, text: async () => '{}' };
      }
    }),
    (error) => error.beforeBroadcast === true && error.broadcastAttempted !== true
  );
  assert.equal(called, false);
});

test('a stale lease cannot confirm or restore a withdrawal', async () => {
  const repo = repoWith('10');
  const first = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000019', '4'),
    send: async () => classifyEsdtTransferResponse({ timedOut: true, requireTransferIdentity: true, expectFeeExempt: true })
  });
  assert.equal(first.record.status, 'PENDING');
  const claimed = await repo.claimLease(first.record.withdrawalId, 'worker-a', 150);
  const state = repo.exportState();
  state.withdrawals[0].processingLeaseUntil = new Date(Date.now() - 1000).toISOString();
  const raced = MemoryEsdtWithdrawalRepository.importState(state);
  const next = await raced.claimLease(first.record.withdrawalId, 'worker-b', 150);
  assert.equal(next.acquired, true);
  assert.notEqual(next.fence, claimed.fence);
  await assert.rejects(
    () => raced.confirm(first.record.withdrawalId, {
      ownedTxHash: OWN_HASH,
      processingOwner: 'worker-a',
      processingFence: claimed.fence,
      httpStatus: 200,
      feeExempt: true
    }),
    (error) => error.code === 'lease_lost'
  );
  await assert.rejects(
    () => raced.failAndRestore(first.record.withdrawalId, {
      authoritativeNonPayment: true,
      processingOwner: 'worker-a',
      processingFence: claimed.fence,
      errorMessage: 'stale restore'
    }),
    (error) => error.code === 'lease_lost'
  );
  assert.equal((await raced.getById(first.record.withdrawalId)).status, 'PENDING');
  assert.equal(raced.balanceOf('g', 'u', TOKEN), '6');
  assert.equal((await raced.releaseLease(first.record.withdrawalId, 'worker-a', claimed.fence)).released, false);
  assert.equal((await raced.getById(first.record.withdrawalId)).processingOwner, 'worker-b');
});

test('automated recovery stays paused unless explicitly enabled', async () => {
  const repo = repoWith('9');
  let sends = 0;
  await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000020', '2'),
    send: async () => {
      sends += 1;
      return classifyEsdtTransferResponse({ timedOut: true });
    }
  });
  const paused = await resumeUnresolvedEsdtWithdrawals({
    repo,
    workerId: 'interval',
    send: async () => {
      sends += 1;
      return classifyEsdtTransferResponse({ timedOut: true });
    }
  });
  assert.equal(paused.recovery, 'paused');
  assert.equal(paused.posted, 0);
  assert.equal(sends, 1);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
});

test('an unclassified withdrawal response stays reserved and a later exact success confirms once', async () => {
  const repo = repoWith('9');
  let attempt = 0;
  const send = async (record) => {
    attempt += 1;
    if (attempt === 1) return { httpStatus: 200, txHash: OWN_HASH, authoritativeNonPayment: true };
    return classifyFor(record, successSpec(record));
  };
  const unresolved = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000021', '2'),
    send
  });
  assert.equal(unresolved.kind, 'needs_reconciliation');
  assert.equal(unresolved.record.errorCode, 'UNCLASSIFIED_RESPONSE');
  assert.equal(unresolved.record.primaryTxHash, null);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  const confirmed = await executeEsdtWithdrawal({
    repo,
    input: withdrawalInput('100000000000000021', '2'),
    send
  });
  assert.equal(confirmed.kind, 'confirmed');
  assert.equal(confirmed.record.primaryTxHash, OWN_HASH);
  assert.equal(confirmed.record.withdrawalId, 'wd_100000000000000021');
  assert.equal(attempt, 2);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  assert.equal(repo.exportState().ledger.filter((entry) => String(entry.id).startsWith('esdt-restore:')).length, 0);
});
