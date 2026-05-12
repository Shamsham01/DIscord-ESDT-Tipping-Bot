/**
 * Evaluate NFT collection counts against rule thresholds (shared by wallet leg and VA leg).
 * @param {Record<string, number>} countsByCollection - ticker -> count
 * @param {string[]} collectionTickers - tickers required by the rule
 * @param {'any'|'all'} matchMode
 * @param {number} minCountPerCollection
 * @returns {boolean}
 */
function evaluateRuleAgainstCounts(countsByCollection, collectionTickers, matchMode, minCountPerCollection) {
  const tickers = (collectionTickers || []).filter(Boolean);
  if (tickers.length === 0) {
    return false;
  }
  const min = Math.max(1, parseInt(String(minCountPerCollection), 10) || 1);
  const mode = matchMode === 'all' ? 'all' : 'any';
  if (mode === 'all') {
    return tickers.every(t => (countsByCollection[t] || 0) >= min);
  }
  return tickers.some(t => (countsByCollection[t] || 0) >= min);
}

module.exports = {
  evaluateRuleAgainstCounts
};
