'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classifyEsdtTransferResponse } = require('./esdt-transfer-outcome');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../test/fixtures/transfers-pr7-esdt-transfer.json'),
  'utf8'
));

const SENDER = 'erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs';
const RECIPIENT = 'erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n';
const HASH = '228a5272b2e7cae10820012d974719e4badc8598cb1003bccbe293a3e19259b7';

function classify(entry, expected) {
  return classifyEsdtTransferResponse({
    httpStatus: entry.httpStatus,
    parsedResponse: entry.body,
    expected: expected || {
      sender: SENDER,
      recipient: RECIPIENT,
      tokenIdentifier: 'DROP-1fc8cc',
      amountRaw: '80000000000'
    },
    requireTransferIdentity: true,
    expectFeeExempt: true,
    chainStatus: 'success'
  });
}

test('Transfers PR #7 confirmed JSON matches sender, recipient, token, and raw amount', () => {
  assert.equal(fixture.sha, 'd7243201cae637ffd5df59c93441071a7330c556');
  assert.equal(fixture.confirmed.body.result.amount, '80000000000');
  assert.equal(fixture.confirmed.body.transfer, undefined);
  const classified = classify(fixture.confirmed);
  assert.equal(classified.outcome, 'confirmed');
  assert.equal(classified.ownedTxHash, HASH);
  assert.equal(classified.feeExempt, true);
  assert.equal(classified.skippedWhitelist, true);
  assert.equal(classified.usageFee, '0');
  assert.equal(classified.usageFeeHash, null);
  assert.equal(classified.authoritativeNonPayment, false);
});

test('a human amount in result.amount is not accepted as the raw withdrawal amount', () => {
  const body = structuredClone(fixture.confirmed.body);
  body.result.amount = '800';
  const classified = classify({ httpStatus: 200, body });
  assert.notEqual(classified.outcome, 'confirmed');
  assert.equal(classified.errorCode, 'TRANSFER_IDENTITY_MISMATCH');
  assert.equal(classified.mismatches.includes('amountRaw'), true);
  assert.equal(classified.ownedTxHash, null);
  assert.equal(classified.authoritativeNonPayment, false);
});

test('skippedWhitelist must be true before a fee-exempt withdrawal is confirmed', () => {
  const body = structuredClone(fixture.confirmed.body);
  body.skippedWhitelist = false;
  const classified = classify({ httpStatus: 200, body });
  assert.equal(classified.outcome, 'needs_reconciliation');
  assert.equal(classified.errorCode, 'WHITELIST_NOT_CONFIRMED');
  assert.equal(classified.authoritativeNonPayment, false);
});

test('a lost lease after broadcast stays unresolved and keeps only this operation hash', () => {
  const classified = classify(fixture.fencingLost);
  assert.equal(classified.outcome, 'needs_reconciliation');
  assert.equal(classified.authoritativeNonPayment, false);
  assert.equal(classified.ownedTxHash, HASH);
  assert.equal(classified.blockingTxHash, null);
  assert.notEqual(classified.outcome, 'confirmed');
});

test('another operation blocking hash is not this withdrawal', () => {
  const classified = classify(fixture.blocking, {
    sender: SENDER,
    recipient: 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hv',
    tokenIdentifier: 'USDC-c76f1f',
    amountRaw: '5000000'
  });
  assert.notEqual(classified.outcome, 'confirmed');
  assert.equal(classified.authoritativeNonPayment, false);
  assert.equal(classified.ownedTxHash, null);
  assert.equal(classified.blockingTxHash, HASH);
  assert.equal(classified.untrustedTxHash, null);
});

test('an execution failure restores only when the raw identity matches', () => {
  const matched = classify(fixture.executionFailed);
  assert.equal(matched.outcome, 'failed');
  assert.equal(matched.authoritativeNonPayment, true);
  assert.equal(matched.ownedTxHash, fixture.executionFailed.body.result.txHash);

  const body = structuredClone(fixture.executionFailed.body);
  body.result.amount = '1';
  const mismatched = classify({ httpStatus: 422, body });
  assert.equal(mismatched.outcome, 'needs_reconciliation');
  assert.equal(mismatched.authoritativeNonPayment, false);
});

test('a pre-broadcast rejection with no hash is a non-payment and a 409 is not', () => {
  const rejected = classify(fixture.txRejected);
  assert.equal(rejected.outcome, 'failed');
  assert.equal(rejected.authoritativeNonPayment, true);
  assert.equal(rejected.ownedTxHash, null);

  const required = classify(fixture.paymentIdRequired);
  assert.equal(required.outcome, 'needs_reconciliation');
  assert.equal(required.authoritativeNonPayment, false);
  assert.equal(required.errorCode, 'PAYMENT_ID_REQUIRED');
  assert.equal(required.ownedTxHash, null);
});

test('complete false is never a confirmed withdrawal', () => {
  const body = structuredClone(fixture.confirmed.body);
  body.complete = false;
  body.status = 'success';
  const classified = classify({ httpStatus: 200, body });
  assert.notEqual(classified.outcome, 'confirmed');
  assert.equal(classified.authoritativeNonPayment, false);
});
