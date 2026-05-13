/**
 * Human-readable NFT role verification diagnostics for Discord notifications.
 */

/**
 * @param {string[]} tickers
 * @param {Record<string, number>} countsByCollection
 * @param {number} minCount
 * @returns {string}
 */
function formatCollectionMarks(tickers, countsByCollection, minCount) {
  const min = Math.max(1, parseInt(String(minCount), 10) || 1);
  const list = (tickers || []).filter(Boolean);
  return list
    .map(t => {
      const n = Number(countsByCollection[t] ?? 0);
      const ok = n >= min;
      return `\`${String(t)}\` ${ok ? '✅' : '❌'} ${n}`;
    })
    .join(' · ');
}

/**
 * @param {{ granted: boolean, userId: string, walletAddress?: string|null, walletPass: boolean, vaPass: boolean, walletLegVerified?: boolean, wCounts: Record<string, number>|null|undefined, vaCounts: Record<string, number>|null|undefined, collectionTickers: string[], matchMode: string, minCountPerCollection: number|string }} opts
 * @returns {string} Multiline plaintext (one revoke/grant diagnostic block).
 */
function formatNftRuleMemberDiag(opts) {
  const {
    granted,
    userId,
    walletAddress,
    walletPass,
    vaPass,
    walletLegVerified = true,
    wCounts,
    vaCounts,
    collectionTickers,
    matchMode,
    minCountPerCollection
  } = opts;

  const tickers = [...new Set((collectionTickers || []).filter(Boolean))];
  const min = Math.max(1, parseInt(String(minCountPerCollection), 10) || 1);
  const mode = matchMode === 'all' ? 'all' : 'any';
  const countsW = wCounts || {};
  const countsV = vaCounts || {};

  const header = `<@${userId}> — role **${granted ? 'granted' : 'removed'}** · match **${mode}** · min **${min}** per collection`;

  const hasLinked = walletAddress && typeof walletAddress === 'string' && walletAddress.startsWith('erd1');

  let walletSection;
  if (!hasLinked) {
    walletSection = [
      `**Wallet** (MvX API): ⚠️ \`erd1\` wallet not linked — counts treated as zero — leg ❌`,
      `└ Collections: ${formatCollectionMarks(tickers, {}, min)}`
    ].join('\n');
  } else if (!walletLegVerified) {
    walletSection =
      `**Wallet** (MvX API): ⚠️ could not verify (rate limit/error) — **no role change applied for this member in this pass**`;
  } else {
    walletSection = [
      `**Wallet** (MvX API): leg ${walletPass ? '✅' : '❌'} · ${formatCollectionMarks(tickers, countsW, min)}`,
      `└ Linked: \`${String(walletAddress)}\``
    ].join('\n');
  }

  const vaSection =
    tickers.length > 0
      ? `**VA** (Supabase): leg ${vaPass ? '✅' : '❌'} · ${formatCollectionMarks(tickers, countsV, min)}`
      : `**VA** (Supabase): leg ${vaPass ? '✅' : '❌'}`;

  return [header, walletSection, vaSection].join('\n');
}

module.exports = {
  formatCollectionMarks,
  formatNftRuleMemberDiag
};
