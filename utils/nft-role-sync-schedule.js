/**
 * Pure scheduling rules for NFT role verification.
 *
 * A member is finished for a rule only after that rule evaluates them inside the
 * coverage window. One rule succeeding must not close the cycle for another rule.
 */

/**
 * @param {number} checkedAt
 * @param {number} retryAt
 * @param {number} now
 * @param {number} windowMs
 */
function ruleNeedsCheck(checkedAt, retryAt, now, windowMs) {
  const checked = Number(checkedAt) || 0;
  const retry = Number(retryAt) || 0;
  if (checked > 0 && now - checked < windowMs) return false;
  if (retry > now) return false;
  return true;
}

/**
 * @param {{ ruleId: string, checkedAt: number, retryAt: number }[]} rules
 * @param {number} now
 * @param {number} windowMs
 * @returns {{ due: boolean, oldestDueAt: number }}
 */
function memberScheduleStatus(rules, now, windowMs) {
  let due = false;
  let oldestDueAt = Infinity;
  for (const rule of rules || []) {
    const checkedAt = Number(rule.checkedAt) || 0;
    if (!ruleNeedsCheck(checkedAt, rule.retryAt, now, windowMs)) continue;
    due = true;
    if (checkedAt < oldestDueAt) oldestDueAt = checkedAt;
  }
  return { due, oldestDueAt: due ? oldestDueAt : 0 };
}

/**
 * Never-checked members (oldestDueAt 0) sort ahead of retries.
 * @param {{ guildId: string, userId: string, rules: { ruleId: string, checkedAt: number, retryAt: number }[] }[]} candidates
 * @param {number} budget
 * @param {number} now
 * @param {number} windowMs
 */
function pickDueUserSlice(candidates, budget, now, windowMs) {
  /** @type {{ guildId: string, userId: string, last: number }[]} */
  const due = [];
  for (const candidate of candidates || []) {
    const status = memberScheduleStatus(candidate.rules, now, windowMs);
    if (!status.due) continue;
    due.push({
      guildId: candidate.guildId,
      userId: candidate.userId,
      last: status.oldestDueAt
    });
  }
  due.sort((a, b) => a.last - b.last || String(a.userId).localeCompare(String(b.userId)));
  const seen = new Set();
  const slice = [];
  const limit = Math.max(0, Number(budget) || 0);
  for (const item of due) {
    const key = `${item.guildId}:${item.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slice.push(item);
    if (slice.length >= limit) break;
  }
  return { dueCount: due.length, slice };
}

/**
 * Even slice so N candidates finish one pass in `windowMs` when ticked every `tickMs`.
 * @param {number} totalCandidates
 * @param {number} windowMs
 * @param {number} tickMs
 */
function computeScheduledUserBudget(totalCandidates, windowMs, tickMs) {
  const ticks = Math.max(1, Math.floor(windowMs / tickMs));
  return Math.max(1, Math.ceil(Math.max(0, Number(totalCandidates) || 0) / ticks));
}

/**
 * @param {{ pending: Set<string>, candidateCount?: number, membersChecked: number, summarySent?: boolean }} cycle
 * @param {string} userId
 * @param {'evaluated'|'absent'|'retry'} result
 */
function noteRuleResult(cycle, userId, result) {
  if (!cycle || cycle.summarySent || !cycle.pending) return;
  if (result === 'evaluated') {
    if (cycle.pending.has(userId)) {
      cycle.pending.delete(userId);
      cycle.membersChecked += 1;
    }
    return;
  }
  if (result === 'absent') {
    if (cycle.pending.has(userId)) {
      cycle.pending.delete(userId);
      cycle.candidateCount = Math.max(0, (cycle.candidateCount || 0) - 1);
    }
  }
}

module.exports = {
  ruleNeedsCheck,
  memberScheduleStatus,
  pickDueUserSlice,
  computeScheduledUserBudget,
  noteRuleResult
};
