/**
 * Evaluate NFT collection counts against rule thresholds (shared by wallet leg and VA leg).
 * @param {Record<string, number>} countsByCollection - ticker -> count
 * @param {string[]} collectionTickers - tickers required by the rule
 * @param {'any'|'all'} matchMode
 * @param {number} minCountPerCollection
 * @returns {boolean}
 */
function countAtTickerIc(countsByCollection, ticker) {
  const req = String(ticker);
  const by = countsByCollection || {};
  if (Object.prototype.hasOwnProperty.call(by, req)) {
    return Number(by[req]) || 0;
  }
  const lk = req.toLowerCase();
  let sum = 0;
  for (const [k, v] of Object.entries(by)) {
    if (String(k).toLowerCase() === lk) {
      sum += Number(v) || 0;
    }
  }
  return sum;
}

function evaluateRuleAgainstCounts(countsByCollection, collectionTickers, matchMode, minCountPerCollection) {
  const tickers = (collectionTickers || []).filter(Boolean);
  if (tickers.length === 0) {
    return false;
  }
  const min = Math.max(1, parseInt(String(minCountPerCollection), 10) || 1);
  const mode = matchMode === 'all' ? 'all' : 'any';
  if (mode === 'all') {
    return tickers.every(t => countAtTickerIc(countsByCollection, t) >= min);
  }
  return tickers.some(t => countAtTickerIc(countsByCollection, t) >= min);
}

module.exports = {
  evaluateRuleAgainstCounts,
  countAtTickerIc
};
