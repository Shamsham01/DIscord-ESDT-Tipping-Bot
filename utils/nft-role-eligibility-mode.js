/**
 * How wallet (MvX) vs Virtual Account (Supabase) results combine into a Discord role grant.
 */

/** @readonly */
const ALLOWED = ['wallet_and_va', 'wallet_only', 'va_only', 'wallet_or_va'];

/**
 * @param {unknown} raw
 * @returns {'wallet_and_va'|'wallet_only'|'va_only'|'wallet_or_va'}
 */
function coerceEligibilityMode(raw) {
  const s = String(raw || 'wallet_and_va').trim();
  return /** @type {any} */ (ALLOWED.includes(s) ? s : 'wallet_and_va');
}

/**
 * Va inventory must be loaded and evaluated.
 */
function eligibilityUsesVa(mode) {
  const m = coerceEligibilityMode(mode);
  return m === 'wallet_and_va' || m === 'va_only' || m === 'wallet_or_va';
}

/**
 * On-chain wallet may be queried (depending on Va outcome for wallet_or_va).
 */
function eligibilityUsesWallet(mode) {
  const m = coerceEligibilityMode(mode);
  return m === 'wallet_and_va' || m === 'wallet_only' || m === 'wallet_or_va';
}

/**
 * @param {'wallet_and_va'|'wallet_only'|'va_only'|'wallet_or_va'} mode
 * @param {boolean} vaPass Va leg already satisfies rule (caller ran VA first when applicable).
 */
function shouldFetchWalletNft(mode, vaPass) {
  const m = coerceEligibilityMode(mode);
  if (!eligibilityUsesWallet(m)) return false;
  if (m === 'wallet_or_va') return !vaPass;
  return true;
}

/**
 * @param {boolean} walletPass
 * @param {boolean} vaPass
 * @param {unknown} mode
 */
function computeEligibility(walletPass, vaPass, mode) {
  const m = coerceEligibilityMode(mode);
  if (m === 'wallet_only') return walletPass;
  if (m === 'va_only') return vaPass;
  if (m === 'wallet_or_va') return walletPass || vaPass;
  return walletPass && vaPass;
}

/**
 * Wallet API returned ambiguous (retry exhausted). Skip role edits when resolving the member hinges on MvX.
 * @param {unknown} mode
 * @param {boolean} vaPass
 */
function skipMemberOnWalletAmbiguity(mode, vaPass) {
  const m = coerceEligibilityMode(mode);
  if (m === 'va_only') return false;
  if (m === 'wallet_or_va' && vaPass) return false;
  return m === 'wallet_and_va' || m === 'wallet_only' || m === 'wallet_or_va';
}

/**
 * Short label for admin UI.
 */
function describeEligibilityMode(mode) {
  const m = coerceEligibilityMode(mode);
  switch (m) {
    case 'wallet_only':
      return 'wallet only';
    case 'va_only':
      return 'Virtual Account only';
    case 'wallet_or_va':
      return 'wallet **or** Virtual Account (either qualifies)';
    default:
      return 'wallet **and** Virtual Account';
  }
}

module.exports = {
  ALLOWED,
  coerceEligibilityMode,
  eligibilityUsesVa,
  eligibilityUsesWallet,
  shouldFetchWalletNft,
  computeEligibility,
  skipMemberOnWalletAmbiguity,
  describeEligibilityMode
};
