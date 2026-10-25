const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ruleNeedsCheck,
  memberScheduleStatus,
  pickDueUserSlice,
  computeScheduledUserBudget,
  noteRuleResult
} = require('./nft-role-sync-schedule');

const DAY = 24 * 60 * 60 * 1000;

test('one rule succeeding does not finish another rule', () => {
  const now = 1_700_000_000_000;
  assert.equal(ruleNeedsCheck(now, 0, now + 1000, DAY), false);
  assert.equal(ruleNeedsCheck(0, 0, now, DAY), true);

  const status = memberScheduleStatus(
    [
      { ruleId: 'empyreans', checkedAt: now, retryAt: 0 },
      { ruleId: 'dolphin', checkedAt: 0, retryAt: 0 }
    ],
    now + 1000,
    DAY
  );
  assert.equal(status.due, true);
  assert.equal(status.oldestDueAt, 0);
});

test('wallet failure backs off without blocking members who were never checked', () => {
  const now = 5_000_000_000;
  const retryAt = now + 30 * 60 * 1000;
  const { dueCount, slice } = pickDueUserSlice(
    [
      {
        guildId: 'g',
        userId: 'failed-wallet',
        rules: [{ ruleId: 'dolphin', checkedAt: 0, retryAt }]
      },
      {
        guildId: 'g',
        userId: 'never-checked',
        rules: [{ ruleId: 'dolphin', checkedAt: 0, retryAt: 0 }]
      }
    ],
    1,
    now,
    DAY
  );
  assert.equal(dueCount, 1);
  assert.deepEqual(
    slice.map(item => item.userId),
    ['never-checked']
  );
});

test('a member stays due for the rule that has not evaluated them', () => {
  const now = 9_000_000_000;
  const { slice } = pickDueUserSlice(
    [
      {
        guildId: 'g',
        userId: 'registered-1',
        rules: [
          { ruleId: 'empyreans', checkedAt: now, retryAt: 0 },
          { ruleId: 'dolphin', checkedAt: 0, retryAt: 0 },
          { ruleId: 'shark', checkedAt: 0, retryAt: 0 }
        ]
      }
    ],
    5,
    now,
    DAY
  );
  assert.equal(slice.length, 1);
  assert.equal(slice[0].userId, 'registered-1');
});

test('cycle progress is per rule', () => {
  const dolphin = {
    pending: new Set(['a', 'b', 'c']),
    candidateCount: 3,
    membersChecked: 0,
    summarySent: false
  };
  const empyreans = {
    pending: new Set(['a', 'b', 'c']),
    candidateCount: 3,
    membersChecked: 0,
    summarySent: false
  };

  noteRuleResult(empyreans, 'a', 'evaluated');
  noteRuleResult(empyreans, 'b', 'evaluated');
  noteRuleResult(empyreans, 'c', 'evaluated');
  noteRuleResult(dolphin, 'a', 'retry');

  assert.equal(empyreans.membersChecked, 3);
  assert.equal(empyreans.pending.size, 0);
  assert.equal(dolphin.membersChecked, 0);
  assert.equal(dolphin.pending.has('a'), true);

  noteRuleResult(dolphin, 'a', 'evaluated');
  noteRuleResult(dolphin, 'b', 'absent');
  noteRuleResult(dolphin, 'c', 'evaluated');

  assert.equal(dolphin.membersChecked, 2);
  assert.equal(dolphin.candidateCount, 2);
  assert.equal(dolphin.pending.size, 0);
});

test('budget spreads one candidate pass across the 24h window', () => {
  const tenMinutes = 10 * 60 * 1000;
  assert.equal(computeScheduledUserBudget(99, DAY, tenMinutes), 1);
  assert.equal(computeScheduledUserBudget(144, DAY, tenMinutes), 1);
  assert.equal(computeScheduledUserBudget(145, DAY, tenMinutes), 2);
});
