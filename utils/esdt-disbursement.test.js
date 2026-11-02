'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyEsdtTransferResponse,
  coerceTransferClassification
} = require('./esdt-transfer-outcome');
const { buildEsdtTransferRequest, executeMakeXEsdtTransfer } = require('./makex-esdt-client');
const {
  MemoryEsdtDisbursementRepository,
  executeEsdtDisbursement,
  resumeUnresolvedEsdtDisbursements,
  buildEsdtTransferOptions,
  massRefundDisbursementId,
  interactionDisbursementId,
  legacyAttemptFlags,
  unconfirmedLegacyTransfer
} = require('./esdt-disbursement-flow');

process.env.ESDT_DISBURSEMENTS_ENABLED = 'true';
process.env.ESDT_NFT_DISBURSEMENTS_ENABLED = 'true';

const INCIDENT_HASH = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7';
const OWN_HASH = 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd';
const TOKEN = 'DROP-1fc8cc';
const SENDER = 'erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs';
const RECIPIENT = 'erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n';
const OTHER = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hv';
const TREASURY = 'erd158k2c3aserjmwnyxzpln24xukl2fsvlk9x46xae4dxl5xds79g6sdz37qn';

function repoWith(balance, extra = {}) {
  const repo = new MemoryEsdtDisbursementRepository();
  repo.seedAccount({
    guildId: extra.guildId || 'g',
    userId: extra.userId || 'u',
    tokenIdentifier: extra.tokenIdentifier || TOKEN,
    balance,
    auctionReserved: extra.auctionReserved || '0'
  });
  if (extra.counterparty) repo.seedAccount({ ...extra.counterparty, balance: extra.counterparty.balance || '0' });
  return repo;
}

function refundInput(interactionId, amountHuman, extra = {}) {
  const id = massRefundDisbursementId(interactionId, extra.userId || 'u', extra.tokenIdentifier || TOKEN);
  return {
    operationKind: 'mass_refund',
    disbursementId: id,
    businessActionId: id,
    interactionId,
    guildId: 'g',
    userId: extra.userId || 'u',
    tokenIdentifier: extra.tokenIdentifier || TOKEN,
    tokenTicker: 'DROP',
    amountHuman,
    decimals: extra.decimals != null ? extra.decimals : 8,
    recipientWallet: extra.recipientWallet || RECIPIENT,
    senderWallet: extra.senderWallet || SENDER
  };
}

function classifyFor(record, spec) {
  return classifyEsdtTransferResponse({
    httpStatus: spec.httpStatus,
    parsedResponse: spec.body,
    expected: buildEsdtTransferOptions(record).expected,
    requireTransferIdentity: true,
    expectFeeExempt: record.expectFeeExempt === true,
    timedOut: spec.timedOut === true
  });
}

function successSpec(record, txHash = OWN_HASH) {
  return {
    httpStatus: 200,
    body: {
      operationId: `op-${record.disbursementId}`,
      status: 'success',
      complete: true,
      success: true,
      replayed: false,
      skippedWhitelist: true,
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

test('two identical refunds from different Discord interactions use different keys', async () => {
  const repo = repoWith('20');
  const keys = [];
  const send = async (record) => {
    keys.push(record.disbursementId);
    return classifyFor(record, successSpec(record, keys.length === 1 ? OWN_HASH : INCIDENT_HASH));
  };
  const first = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000201', '4'),
    send
  });
  const second = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000202', '4'),
    send
  });
  assert.equal(first.kind, 'confirmed');
  assert.equal(second.kind, 'confirmed');
  assert.notEqual(first.record.disbursementId, second.record.disbursementId);
  assert.equal(keys.length, 2);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '12');
  assert.equal(repo.exportState().ledger.filter((entry) => entry.type === 'deduction').length, 2);
});

test('a repeated refund retries the original persisted key and does not debit again', async () => {
  const repo = repoWith('10');
  const keys = [];
  let attempt = 0;
  const send = async (record) => {
    keys.push(record.disbursementId);
    attempt += 1;
    if (attempt === 1) return classifyEsdtTransferResponse({ timedOut: true, requireTransferIdentity: true, expectFeeExempt: true });
    return classifyFor(record, successSpec(record));
  };
  const first = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000203', '3'), send });
  assert.equal(first.kind, 'pending');
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  const second = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000203', '3'), send });
  assert.equal(second.kind, 'confirmed');
  assert.equal(second.record.disbursementId, first.record.disbursementId);
  assert.deepEqual(keys, [first.record.disbursementId, first.record.disbursementId]);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  assert.equal(repo.exportState().ledger.filter((entry) => entry.type === 'deduction').length, 1);
});

test('a second refund interaction is refused while the first refund is unresolved', async () => {
  const repo = repoWith('10');
  let sends = 0;
  const send = async () => {
    sends += 1;
    return classifyEsdtTransferResponse({ timedOut: true, requireTransferIdentity: true, expectFeeExempt: true });
  };
  const first = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000204', '2'), send });
  const second = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000205', '2'), send });
  assert.equal(first.kind, 'pending');
  assert.equal(second.kind, 'blocked');
  assert.equal(sends, 1);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '8');
  assert.equal(repo.exportState().disbursements.length, 1);
});

test('timeout after broadcast keeps the refund reserved', async () => {
  const repo = repoWith('9');
  const outcome = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000206', '1'),
    send: async (record) => classifyFor(record, { timedOut: true })
  });
  assert.equal(outcome.kind, 'pending');
  assert.equal(outcome.record.primaryTxHash, null);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '8');
  assert.equal(repo.exportState().ledger.filter((entry) => entry.type === 'deposit').length, 0);
});

test('a foreign blocking hash is not a successful refund', async () => {
  const repo = repoWith('9');
  const outcome = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000207', '1'),
    send: async (record) => classifyFor(record, {
      httpStatus: 503,
      body: {
        error: 'Lost the wallet lease during confirmation.',
        status: 'error',
        code: 'FENCING_LOST',
        message: 'Lost the wallet lease during confirmation.',
        retryable: true,
        complete: false,
        usageFeeHash: null,
        data: {
          operationId: '4c2b2a44-4831-477d-9d80-b54e8f061123',
          txHash: INCIDENT_HASH,
          blockingTxHash: INCIDENT_HASH,
          state: 'SUBMITTED'
        }
      }
    })
  });
  assert.equal(outcome.kind, 'needs_reconciliation');
  assert.equal(outcome.record.primaryTxHash, null);
  assert.equal(outcome.record.blockingTxHash, INCIDENT_HASH);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '8');
});

test('a successful body with the wrong recipient or amount is not confirmation', async () => {
  const repo = repoWith('9');
  const outcome = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000208', '1'),
    send: async (record) => classifyFor(record, {
      httpStatus: 200,
      body: {
        operationId: 'op-mismatch',
        status: 'success',
        complete: true,
        success: true,
        skippedWhitelist: true,
        usageFeeHash: null,
        result: {
          txHash: OWN_HASH,
          status: 'success',
          sender: record.senderWallet,
          receiver: OTHER,
          tokenIdentifier: record.tokenIdentifier,
          amount: '1'
        }
      }
    })
  });
  assert.equal(outcome.kind, 'needs_reconciliation');
  assert.equal(outcome.record.primaryTxHash, null);
  assert.equal(outcome.record.untrustedTxHash, OWN_HASH);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '8');
});

test('worker restart reuses the refund key only after recovery is enabled', async () => {
  const repo = repoWith('9');
  let sends = 0;
  const send = async (record) => {
    sends += 1;
    if (sends === 1) return classifyEsdtTransferResponse({ timedOut: true, requireTransferIdentity: true, expectFeeExempt: true });
    return classifyFor(record, successSpec(record));
  };
  const first = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000209', '2'), send });
  const restarted = MemoryEsdtDisbursementRepository.importState(repo.exportState());
  const paused = await resumeUnresolvedEsdtDisbursements({
    repo: restarted,
    workerId: 'boot',
    recoveryEnabled: false,
    send
  });
  assert.equal(paused.recovery, 'paused');
  assert.equal(paused.posted, 0);
  assert.equal(sends, 1);
  const enabled = await resumeUnresolvedEsdtDisbursements({
    repo: restarted,
    workerId: 'boot',
    recoveryEnabled: true,
    send
  });
  assert.equal(enabled.recovery, 'enabled');
  assert.equal(enabled.posted, 1);
  assert.equal(sends, 2);
  const row = await restarted.getById(first.record.disbursementId);
  assert.equal(row.status, 'CONFIRMED');
  assert.equal(restarted.balanceOf('g', 'u', TOKEN), '7');
});

test('an expired lease cannot confirm or restore a refund', async () => {
  const repo = repoWith('10');
  const first = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000210', '4'),
    send: async () => classifyEsdtTransferResponse({ timedOut: true, requireTransferIdentity: true, expectFeeExempt: true })
  });
  const claimed = await repo.claimLease(first.record.disbursementId, 'worker-a', 150);
  const state = repo.exportState();
  state.disbursements[0].processingLeaseUntil = new Date(Date.now() - 1000).toISOString();
  const raced = MemoryEsdtDisbursementRepository.importState(state);
  const next = await raced.claimLease(first.record.disbursementId, 'worker-b', 150);
  assert.equal(next.acquired, true);
  assert.notEqual(next.fence, claimed.fence);
  await assert.rejects(
    () => raced.confirm(first.record.disbursementId, {
      ownedTxHash: OWN_HASH,
      processingOwner: 'worker-a',
      processingFence: claimed.fence,
      httpStatus: 200,
      feeExempt: true
    }),
    (error) => error.code === 'lease_lost'
  );
  await assert.rejects(
    () => raced.failAndRestore(first.record.disbursementId, {
      authoritativeNonPayment: true,
      processingOwner: 'worker-a',
      processingFence: claimed.fence,
      errorMessage: 'stale restore'
    }),
    (error) => error.code === 'lease_lost'
  );
  assert.equal((await raced.getById(first.record.disbursementId)).status, 'PENDING');
  assert.equal(raced.balanceOf('g', 'u', TOKEN), '6');
});

test('concurrent refund reservations cannot overdraw one virtual balance', async () => {
  const repo = repoWith('10');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started = 0;
  const send = async (record) => {
    started += 1;
    if (started === 1) await gate;
    return classifyFor(record, successSpec(record));
  };
  const work = Promise.all([
    executeEsdtDisbursement({
      repo,
      workerId: 'a',
      input: refundInput('100000000000000211', '6', { userId: 'u' }),
      send
    }),
    executeEsdtDisbursement({
      repo,
      workerId: 'b',
      input: {
        ...refundInput('100000000000000212', '6'),
        operationKind: 'cross_guild',
        disbursementId: interactionDisbursementId('xg', '100000000000000212'),
        businessActionId: interactionDisbursementId('xg', '100000000000000212'),
        counterpartyGuildId: 'g2',
        counterpartyUserId: 'u'
      },
      send
    })
  ]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  const [left, right] = await work;
  const kinds = [left.kind, right.kind].sort();
  assert.deepEqual(kinds, ['confirmed', 'insufficient']);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '4');
});

test('authoritative non-payment restores a refund exactly once', async () => {
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
  const first = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000213', '1.5'), send });
  assert.equal(first.kind, 'failed');
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '5');
  const second = await executeEsdtDisbursement({ repo, input: refundInput('100000000000000213', '1.5'), send });
  await repo.failAndRestore(first.record.disbursementId, { authoritativeNonPayment: true, errorMessage: 'again' });
  assert.equal(second.kind, 'failed');
  assert.equal(sends, 1);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '5');
  const ledger = repo.exportState().ledger;
  assert.equal(ledger.filter((entry) => entry.type === 'deduction').length, 1);
  assert.equal(ledger.filter((entry) => entry.id.startsWith('esdt-disburse-restore:')).length, 1);
});

test('a whitelisted Community Fund refund sends the persisted key and expects no usage fee', async () => {
  const repo = repoWith('4');
  let captured;
  const outcome = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000214', '1'),
    send: async (record) => {
      captured = buildEsdtTransferRequest({
        recipient: record.recipientWallet,
        tokenIdentifier: record.tokenIdentifier,
        amount: record.amountHuman,
        pem: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
        options: { ...buildEsdtTransferOptions(record), apiToken: 'token' }
      });
      return classifyFor(record, successSpec(record));
    }
  });
  assert.equal(outcome.kind, 'confirmed');
  assert.equal(outcome.record.feeExempt, true);
  assert.equal(outcome.record.usageFee, '0');
  assert.equal(captured.headers['x-makex-idempotency-key'], outcome.record.disbursementId);
  assert.equal(captured.body.idempotencyKey, outcome.record.disbursementId);
  assert.equal(captured.body.expectFeeExempt, true);
  assert.equal(captured.body.amount, '1');
  assert.equal(typeof captured.body.amount, 'string');
  assert.equal(Object.hasOwn(captured.body, 'fee'), false);
});

test('subscription, pool fee, house withdraw, and admin send keep separate identities', async () => {
  const repo = repoWith('100');
  const cases = [
    {
      operationKind: 'subscription',
      disbursementId: interactionDisbursementId('sub', '100000000000000215'),
      recipientWallet: TREASURY,
      effectPayload: { planMonths: 1, amountUsdc: 10 }
    },
    {
      operationKind: 'pool_fee',
      disbursementId: 'pf_pool_100000000000000216_abc',
      businessActionId: 'pf_pool_100000000000000216_abc',
      interactionId: '100000000000000216',
      recipientWallet: TREASURY
    },
    {
      operationKind: 'house_withdraw',
      disbursementId: interactionDisbursementId('hw', '100000000000000217'),
      recipientWallet: OTHER,
      effectPayload: { source: 'betting' }
    },
    {
      operationKind: 'admin_send',
      disbursementId: interactionDisbursementId('send', '100000000000000218'),
      recipientWallet: OTHER,
      effectPayload: { projectName: 'Project A' }
    }
  ];
  const keys = [];
  for (const item of cases) {
    const outcome = await executeEsdtDisbursement({
    repo,
    input: {
      operationKind: item.operationKind,
      disbursementId: item.disbursementId,
      businessActionId: item.businessActionId || item.disbursementId,
      interactionId: item.interactionId || item.disbursementId.split('_').pop(),
      guildId: 'g',
      userId: 'u',
        tokenIdentifier: TOKEN,
        tokenTicker: 'DROP',
        amountHuman: '1',
        decimals: 8,
        recipientWallet: item.recipientWallet,
        senderWallet: SENDER,
        effectPayload: item.effectPayload || null
      },
      send: async (record) => {
        keys.push(record.disbursementId);
        const request = buildEsdtTransferOptions(record);
        assert.equal(request.idempotencyKey, record.disbursementId);
        assert.equal(request.expectFeeExempt, item.operationKind !== 'admin_send');
        return classifyFor(record, successSpec(record));
      }
    });
    assert.equal(outcome.kind, 'confirmed', item.operationKind);
  }
  assert.equal(new Set(keys).size, 4);
  const house = await repo.noteEffect(interactionDisbursementId('hw', '100000000000000217'));
  assert.equal(house.claimed, true);
  assert.equal(repo.houseSpending('g', TOKEN, 'betting'), '100000000');
  const again = await repo.noteEffect(interactionDisbursementId('hw', '100000000000000217'));
  assert.equal(again.claimed, false);
  assert.equal(repo.houseSpending('g', TOKEN, 'betting'), '100000000');
});

test('a non-replayable NFT attempt is not sent twice and is not confirmed from a legacy hash', async () => {
  const repo = new MemoryEsdtDisbursementRepository();
  let sends = 0;
  const input = {
    operationKind: 'nft_transfer',
    disbursementId: 'nr_100000000000000219_abcdef1234567890abcd',
    businessActionId: 'nr_100000000000000219_abcdef1234567890abcd',
    interactionId: '100000000000000219',
    guildId: 'g',
    userId: 'u',
    tokenIdentifier: 'COLLECTION-abc123-01',
    tokenTicker: 'COLLECTION',
    amountHuman: '1',
    decimals: 0,
    recipientWallet: RECIPIENT,
    senderWallet: SENDER
  };
  const first = await executeEsdtDisbursement({
    repo,
    input,
    send: async () => {
      sends += 1;
      return unconfirmedLegacyTransfer({
        success: true,
        txHash: OWN_HASH,
        httpStatus: 200,
        broadcastAttempted: true,
        authoritativeNonPayment: false
      });
    }
  });
  assert.equal(first.kind, 'needs_reconciliation');
  assert.equal(first.record.primaryTxHash, null);
  assert.equal(first.record.untrustedTxHash, OWN_HASH);
  const second = await executeEsdtDisbursement({
    repo,
    input,
    send: async () => {
      sends += 1;
      return unconfirmedLegacyTransfer({ success: true, txHash: OWN_HASH, httpStatus: 200 });
    }
  });
  assert.equal(second.kind, 'needs_reconciliation');
  assert.equal(second.sent, false);
  assert.equal(sends, 1);
});

function clientRequest(idempotencyKey) {
  return {
    endpointBase: 'https://makex.example',
    apiToken: 'token',
    pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    recipient: RECIPIENT,
    tokenIdentifier: TOKEN,
    amount: '1',
    options: {
      exactDecimal: true,
      decimals: 8,
      amountRaw: '100000000',
      idempotencyKey,
      withdrawalId: idempotencyKey,
      requireTransferIdentity: true,
      expectFeeExempt: true,
      expected: {
        sender: SENDER,
        recipient: RECIPIENT,
        tokenIdentifier: TOKEN,
        amountHuman: '1',
        amountRaw: '100000000',
        decimals: 8,
        idempotencyKey
      }
    }
  };
}

test('an unclassified HTTP 200 does not restore a reserved refund', async () => {
  const repo = repoWith('9');
  const outcome = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000220', '1'),
    send: async () => ({ httpStatus: 200, txHash: OWN_HASH })
  });
  assert.equal(outcome.kind, 'needs_reconciliation');
  assert.equal(outcome.record.errorCode, 'UNCLASSIFIED_RESPONSE');
  assert.equal(outcome.record.primaryTxHash, null);
  assert.equal(outcome.record.untrustedTxHash, OWN_HASH);
  assert.equal(outcome.record.restoredAt, null);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '8');
  assert.equal(repo.exportState().ledger.some((entry) => entry.id.startsWith('esdt-disburse-restore:')), false);
});

test('an unexpected response and a failed outcome without proof stay reserved', async () => {
  const unexpectedRepo = repoWith('9');
  const unexpected = await executeEsdtDisbursement({
    repo: unexpectedRepo,
    input: refundInput('100000000000000221', '1'),
    send: async () => ({ surprise: true, httpStatus: 200 })
  });
  assert.equal(unexpected.kind, 'needs_reconciliation');
  assert.equal(unexpectedRepo.balanceOf('g', 'u', TOKEN), '8');

  const failureRepo = repoWith('9');
  const bareFailure = await executeEsdtDisbursement({
    repo: failureRepo,
    input: refundInput('100000000000000222', '1'),
    send: async () => ({ outcome: 'failed', errorCode: 'HTTP_500', errorMessage: 'no proof' })
  });
  assert.equal(bareFailure.kind, 'needs_reconciliation');
  assert.equal(failureRepo.balanceOf('g', 'u', TOKEN), '8');
  assert.equal(failureRepo.exportState().ledger.filter((entry) => entry.type === 'deposit').length, 0);
  const coerced = coerceTransferClassification({ outcome: 'failed', ownedTxHash: OWN_HASH });
  assert.equal(coerced.outcome, 'needs_reconciliation');
  assert.equal(coerced.authoritativeNonPayment, false);
  assert.equal(coerced.ownedTxHash, null);
});

test('timeout and HTTP 503 leave the reservation in place', async () => {
  const timeoutRepo = repoWith('9');
  const timedOut = await executeEsdtDisbursement({
    repo: timeoutRepo,
    input: refundInput('100000000000000223', '1'),
    send: async (record) => classifyFor(record, { timedOut: true, httpStatus: 0 })
  });
  assert.equal(timedOut.kind, 'pending');
  assert.equal(timedOut.record.errorCode, 'TIMEOUT');
  assert.equal(timeoutRepo.balanceOf('g', 'u', TOKEN), '8');
  assert.equal(timeoutRepo.exportState().ledger.some((entry) => entry.type === 'deposit'), false);

  const unavailableRepo = repoWith('9');
  const unavailable = await executeEsdtDisbursement({
    repo: unavailableRepo,
    input: refundInput('100000000000000224', '1'),
    send: async () => classifyEsdtTransferResponse({
      httpStatus: 503,
      parsedResponse: {
        code: 'TX_PENDING',
        message: 'upstream unavailable',
        data: { blockingTxHash: INCIDENT_HASH }
      },
      requireTransferIdentity: true,
      expectFeeExempt: true
    })
  });
  assert.equal(unavailable.kind, 'needs_reconciliation');
  assert.equal(unavailable.record.blockingTxHash, INCIDENT_HASH);
  assert.equal(unavailable.record.primaryTxHash, null);
  assert.equal(unavailableRepo.balanceOf('g', 'u', TOKEN), '8');
});

test('a client failure is not confirmation, and a later exact success settles once', async () => {
  const repo = repoWith('9');
  let attempt = 0;
  const outcome = async () => executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000225', '2'),
    send: async (record) => {
      attempt += 1;
      if (attempt === 1) return { httpStatus: 0, errorMessage: 'socket hang up' };
      if (attempt === 2) {
        return classifyFor(record, {
          httpStatus: 200,
          body: {
            status: 'success',
            success: true,
            result: {
              txHash: OWN_HASH,
              status: 'success',
              sender: record.senderWallet,
              receiver: record.recipientWallet,
              tokenIdentifier: record.tokenIdentifier,
              amount: record.amountRaw
            }
          }
        });
      }
      return classifyFor(record, successSpec(record));
    }
  });
  const first = await outcome();
  const second = await outcome();
  const third = await outcome();
  assert.equal(first.kind, 'needs_reconciliation');
  assert.equal(second.kind, 'pending');
  assert.equal(second.record.status, 'PENDING');
  assert.equal(second.record.errorCode, 'HTTP_200');
  assert.equal(third.kind, 'confirmed');
  assert.equal(third.record.primaryTxHash, OWN_HASH);
  assert.equal(attempt, 3);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  assert.equal(repo.exportState().ledger.filter((entry) => entry.type === 'deduction').length, 1);
  await assert.rejects(
    () => repo.failAndRestore(third.record.disbursementId, {
      authoritativeNonPayment: true,
      processingOwner: third.record.processingOwner,
      processingFence: third.record.processingFence,
      errorCode: 'EXECUTION_FAILED'
    }),
    (error) => error.code === 'invalid_transition' || /invalid_transition|lease_lost/.test(error.message)
  );
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
});

test('MakeX client responses without the success contract do not claim a payment', async () => {
  const seen = [];
  const unclassified = await executeMakeXEsdtTransfer({
    ...clientRequest('mr_client_unclassified'),
    fetchImpl: async (url, init) => {
      seen.push(init.headers['x-makex-idempotency-key']);
      return { status: 200, text: async () => JSON.stringify({ ok: true, txHash: OWN_HASH }) };
    }
  });
  assert.equal(unclassified.outcome, 'pending');
  assert.equal(unclassified.success, false);
  assert.equal(unclassified.authoritativeNonPayment, false);
  assert.equal(unclassified.txHash, null);
  assert.deepEqual(seen, ['mr_client_unclassified']);

  const malformed = await executeMakeXEsdtTransfer({
    ...clientRequest('mr_client_malformed'),
    fetchImpl: async () => ({ status: 200, text: async () => '<html>gateway</html>' })
  });
  assert.equal(malformed.outcome, 'pending');
  assert.equal(malformed.success, false);
  assert.equal(malformed.authoritativeNonPayment, false);
  assert.equal(malformed.txHash, null);

  const timeout = await executeMakeXEsdtTransfer({
    ...clientRequest('mr_client_timeout'),
    timeoutMs: 20,
    fetchImpl: async () => ({ status: 200, text() { return new Promise(() => {}); } })
  });
  assert.equal(timeout.outcome, 'pending');
  assert.equal(timeout.classified.errorCode, 'TIMEOUT');
  assert.equal(timeout.broadcastAttempted, true);
  assert.equal(timeout.authoritativeNonPayment, false);

  const unavailable = await executeMakeXEsdtTransfer({
    ...clientRequest('mr_client_503'),
    fetchImpl: async () => ({
      status: 503,
      text: async () => JSON.stringify({
        code: 'TX_PENDING',
        data: { blockingTxHash: INCIDENT_HASH }
      })
    })
  });
  assert.equal(unavailable.outcome, 'needs_reconciliation');
  assert.equal(unavailable.authoritativeNonPayment, false);
  assert.equal(unavailable.blockingTxHash, INCIDENT_HASH);
  assert.equal(unavailable.success, false);
});

test('new disbursement routes fail closed until their rollout flag is exactly true', async () => {
  const repo = repoWith('9');
  let sends = 0;
  const send = async () => {
    sends += 1;
    return { outcome: 'confirmed', ownedTxHash: OWN_HASH };
  };
  const paused = await executeEsdtDisbursement({
    repo,
    env: {},
    input: refundInput('100000000000000226', '1'),
    send
  });
  assert.equal(paused.kind, 'paused');
  assert.equal(paused.code, 'DISBURSEMENTS_PAUSED');
  assert.equal(paused.sent, false);
  assert.equal(sends, 0);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '9');
  assert.equal(repo.exportState().disbursements.length, 0);

  const nft = await executeEsdtDisbursement({
    repo,
    env: { ESDT_DISBURSEMENTS_ENABLED: 'true' },
    input: {
      operationKind: 'nft_transfer',
      disbursementId: 'nr_100000000000000227_abcdef1234567890abcd',
      businessActionId: 'nr_100000000000000227_abcdef1234567890abcd',
      interactionId: '100000000000000227',
      guildId: 'g',
      userId: 'u',
      tokenIdentifier: 'COLLECTION-abc123-01',
      tokenTicker: 'COLLECTION',
      amountHuman: '1',
      decimals: 0,
      recipientWallet: RECIPIENT,
      senderWallet: SENDER
    },
    send
  });
  assert.equal(nft.kind, 'paused');
  assert.equal(nft.code, 'NFT_DISBURSEMENTS_PAUSED');
  assert.equal(sends, 0);
});

test('recovery does not post while the rollout flag is off, and a confirmed effect can be retried', async () => {
  const repo = repoWith('9');
  const input = refundInput('100000000000000228', '1');
  await executeEsdtDisbursement({
    repo,
    input,
    send: async (record) => classifyFor(record, { timedOut: true })
  });
  let posts = 0;
  const paused = await resumeUnresolvedEsdtDisbursements({
    repo,
    recoveryEnabled: true,
    env: {},
    send: async () => {
      posts += 1;
      return { outcome: 'confirmed', ownedTxHash: OWN_HASH, authoritativeNonPayment: false };
    }
  });
  assert.equal(paused.posted, 0);
  assert.equal(posts, 0);
  assert.equal(paused.results[0].kind, 'rollout_paused');
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '8');

  const house = await executeEsdtDisbursement({
    repo,
    input: {
      operationKind: 'house_withdraw',
      disbursementId: interactionDisbursementId('hw', '100000000000000229'),
      interactionId: '100000000000000229',
      guildId: 'g',
      userId: 'u',
      tokenIdentifier: TOKEN,
      tokenTicker: 'DROP',
      amountHuman: '1',
      decimals: 8,
      recipientWallet: OTHER,
      senderWallet: SENDER,
      effectPayload: { source: 'betting' }
    },
    send: async (record) => classifyFor(record, successSpec(record))
  });
  assert.equal(house.kind, 'confirmed');
  assert.equal(house.record.effectAppliedAt, null);
  const blocked = await executeEsdtDisbursement({
    repo,
    input: {
      operationKind: 'house_withdraw',
      disbursementId: interactionDisbursementId('hw', '100000000000000230'),
      interactionId: '100000000000000230',
      guildId: 'g',
      userId: 'u',
      tokenIdentifier: TOKEN,
      tokenTicker: 'DROP',
      amountHuman: '1',
      decimals: 8,
      recipientWallet: OTHER,
      senderWallet: SENDER,
      effectPayload: { source: 'betting' }
    },
    send: async () => {
      throw new Error('must not send while the first house effect is unapplied');
    }
  });
  assert.equal(blocked.kind, 'blocked');
  const due = await repo.listEffectsDue();
  assert.equal(due.length, 1);
  const applied = await repo.noteEffect(house.record.disbursementId);
  const appliedAgain = await repo.noteEffect(house.record.disbursementId);
  assert.equal(applied.claimed, true);
  assert.equal(appliedAgain.claimed, false);
  assert.equal(repo.houseSpending('g', TOKEN, 'betting'), '100000000');
});

function nftInput(interactionId) {
  const disbursementId = `nr_${interactionId}_abcdef1234567890abcd`;
  return {
    operationKind: 'nft_transfer',
    disbursementId,
    businessActionId: disbursementId,
    interactionId,
    guildId: 'g',
    userId: 'u',
    tokenIdentifier: 'COLLECTION-abc123-01',
    tokenTicker: 'COLLECTION',
    amountHuman: '1',
    decimals: 0,
    recipientWallet: RECIPIENT,
    senderWallet: SENDER,
    reservesBalance: true
  };
}

test('legacy NFT responses use the TX_REJECTED allowlist and never a 4xx range', () => {
  const ambiguous = [
    { httpStatus: 408 },
    { httpStatus: 429 },
    { httpStatus: 500 },
    { httpStatus: 503, code: 'TX_REJECTED' },
    { httpStatus: 400 },
    { httpStatus: 401 },
    { httpStatus: 404 },
    { httpStatus: 400, txHash: OWN_HASH, code: 'TX_REJECTED' },
    { timedOut: true },
    { networkError: true },
    { httpStatus: 0 }
  ];
  for (const spec of ambiguous) {
    const flags = legacyAttemptFlags({ requestStarted: true, ...spec });
    assert.equal(flags.authoritativeNonPayment, false, JSON.stringify(spec));
    assert.equal(flags.beforeBroadcast, false, JSON.stringify(spec));
    assert.equal(flags.broadcastAttempted, true, JSON.stringify(spec));
  }

  const verified = legacyAttemptFlags({
    requestStarted: true,
    httpStatus: 400,
    code: 'TX_REJECTED',
    parsedResponse: { complete: false, retryable: false, data: { txHash: null, blockingTxHash: null } }
  });
  assert.equal(verified.authoritativeNonPayment, true);
  assert.equal(verified.broadcastAttempted, false);

  const local = legacyAttemptFlags({ requestStarted: false });
  assert.equal(local.beforeBroadcast, true);
  assert.equal(local.authoritativeNonPayment, false);
  assert.equal(local.broadcastAttempted, false);
});

test('ambiguous legacy NFT outcomes stay unresolved, keep the reservation, and are not replayed', async () => {
  const specs = [
    { name: '408', httpStatus: 408 },
    { name: '429', httpStatus: 429 },
    { name: 'missing hash', httpStatus: 200, success: true },
    {
      name: 'malformed success',
      httpStatus: 200,
      success: true,
      txHash: OWN_HASH,
      rawResponse: { success: true, status: 'success', result: { txHash: OWN_HASH } }
    }
  ];
  let interaction = 100000000000000240;
  for (const spec of specs) {
    interaction += 1;
    const repo = repoWith('5', { tokenIdentifier: 'COLLECTION-abc123-01' });
    const input = nftInput(String(interaction));
    let sends = 0;
    const flags = legacyAttemptFlags({
      requestStarted: true,
      httpStatus: spec.httpStatus,
      txHash: spec.txHash || null,
      parsedResponse: spec.rawResponse || null
    });
    const first = await executeEsdtDisbursement({
      repo,
      input,
      send: async () => {
        sends += 1;
        return unconfirmedLegacyTransfer({
          success: spec.success === true,
          txHash: spec.txHash || null,
          httpStatus: spec.httpStatus,
          rawResponse: spec.rawResponse || null,
          errorMessage: spec.name,
          ...flags
        });
      }
    });
    assert.notEqual(first.kind, 'failed', spec.name);
    assert.notEqual(first.kind, 'confirmed', spec.name);
    assert.equal(first.record.status === 'PENDING' || first.record.status === 'NEEDS_RECONCILIATION', true, spec.name);
    assert.equal(repo.balanceOf('g', 'u', 'COLLECTION-abc123-01'), '4', spec.name);
    assert.equal(repo.exportState().ledger.some((entry) => entry.type === 'deposit'), false, spec.name);
    const second = await executeEsdtDisbursement({
      repo,
      input,
      send: async () => {
        sends += 1;
        return {
          outcome: 'confirmed',
          ownedTxHash: OWN_HASH,
          authoritativeNonPayment: false
        };
      }
    });
    assert.equal(sends, 1, spec.name);
    assert.equal(second.sent, false, spec.name);
    assert.equal(second.kind, 'needs_reconciliation', spec.name);
    assert.equal(repo.balanceOf('g', 'u', 'COLLECTION-abc123-01'), '4', spec.name);
  }
});

test('an interrupted client does not restore, and only a replayable exact success confirms later', async () => {
  const nftRepo = repoWith('5', { tokenIdentifier: 'COLLECTION-abc123-01' });
  const nft = nftInput('100000000000000250');
  let nftSends = 0;
  const interrupted = await executeEsdtDisbursement({
    repo: nftRepo,
    input: nft,
    send: async () => {
      nftSends += 1;
      const error = new Error('socket hang up');
      Object.assign(error, legacyAttemptFlags({ requestStarted: true, networkError: true }));
      throw error;
    }
  });
  assert.equal(interrupted.kind, 'pending');
  assert.equal(nftRepo.balanceOf('g', 'u', 'COLLECTION-abc123-01'), '4');
  const replay = await executeEsdtDisbursement({
    repo: nftRepo,
    input: nft,
    send: async () => {
      nftSends += 1;
      return { outcome: 'confirmed', ownedTxHash: OWN_HASH, authoritativeNonPayment: false };
    }
  });
  assert.equal(nftSends, 1);
  assert.equal(replay.kind, 'needs_reconciliation');
  assert.notEqual(replay.record.status, 'FAILED');
  assert.equal(nftRepo.exportState().ledger.some((entry) => entry.type === 'deposit'), false);

  const repo = repoWith('9');
  let attempt = 0;
  const send = async (record) => {
    attempt += 1;
    if (attempt === 1) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      Object.assign(error, legacyAttemptFlags({ requestStarted: true, timedOut: true }));
      throw error;
    }
    return classifyFor(record, successSpec(record));
  };
  const pending = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000251', '2'),
    send
  });
  assert.equal(pending.kind, 'pending');
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  const confirmed = await executeEsdtDisbursement({
    repo,
    input: refundInput('100000000000000251', '2'),
    send
  });
  assert.equal(confirmed.kind, 'confirmed');
  assert.equal(confirmed.record.primaryTxHash, OWN_HASH);
  assert.equal(attempt, 2);
  assert.equal(repo.balanceOf('g', 'u', TOKEN), '7');
  assert.equal(repo.exportState().ledger.filter((entry) => entry.type === 'deposit').length, 0);
});

test('MakeX is not called when the idempotency key was not persisted', async () => {
  let called = false;
  await assert.rejects(
    () => executeMakeXEsdtTransfer({
      endpointBase: 'https://makex.example',
      apiToken: 'token',
      pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      recipient: RECIPIENT,
      tokenIdentifier: TOKEN,
      amount: '1',
      options: { exactDecimal: true, decimals: 8, amountRaw: '100000000' },
      fetchImpl: async () => {
        called = true;
        return { status: 200, text: async () => '{}' };
      }
    }),
    (error) => error.code === 'IDEMPOTENCY_KEY_REQUIRED' && error.beforeBroadcast === true
  );
  assert.equal(called, false);
});
