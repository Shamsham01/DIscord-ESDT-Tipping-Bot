const BigNumber = require('bignumber.js');

const EGLD_DECIMALS = 18;
/** Minimum EGLD required before any on-chain transfer from Community Fund or project wallets. */
const WALLET_EGLD_MIN_BALANCE = 0.08;

async function fetchWalletEgldBalanceHuman(walletAddress) {
  const response = await fetch(`https://api.multiversx.com/accounts/${walletAddress}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch EGLD balance (${response.status} ${response.statusText})`);
  }
  const data = await response.json();
  const wei = data.balance || '0';
  return new BigNumber(wei).dividedBy(new BigNumber(10).pow(EGLD_DECIMALS)).toString();
}

/**
 * Rejects on-chain operations when the wallet cannot cover blockchain fees.
 * @throws {Error} when balance is below WALLET_EGLD_MIN_BALANCE
 */
async function ensureWalletEgldForOnChainTransfer(walletAddress) {
  if (!walletAddress || !walletAddress.startsWith('erd1')) {
    throw new Error('Invalid wallet address for EGLD balance check.');
  }
  const balanceHuman = await fetchWalletEgldBalanceHuman(walletAddress);
  if (new BigNumber(balanceHuman).isLessThan(WALLET_EGLD_MIN_BALANCE)) {
    throw new Error(
      `Insufficient EGLD for blockchain fees: wallet has ${balanceHuman} EGLD but needs at least ${WALLET_EGLD_MIN_BALANCE} EGLD. ` +
      'Ask a server admin to top up the Community Fund or project wallet with EGLD.'
    );
  }
  return balanceHuman;
}

module.exports = {
  WALLET_EGLD_MIN_BALANCE,
  EGLD_DECIMALS,
  fetchWalletEgldBalanceHuman,
  ensureWalletEgldForOnChainTransfer
};
