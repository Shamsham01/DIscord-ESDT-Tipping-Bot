const BigNumber = require('bignumber.js');
const supabase = require('../supabase-client');

const ESDT_IDENTIFIER_REGEX = /^[A-Z0-9]+-[a-f0-9]{6}$/i;

function normalizeTokenLookupKey(tokenKey) {
  return (tokenKey || '').toLowerCase();
}

function nftLedgerKey(collection, nonce) {
  return `${(collection || '').toLowerCase()}\u0000${Number(nonce)}`;
}

function addToMap(map, key, amount) {
  const bn = new BigNumber(amount || '0');
  if (bn.isZero()) return;
  const existing = map.get(key) || new BigNumber(0);
  map.set(key, existing.plus(bn));
}

/** Sum betting + auction + lottery + drop PNL per token key (wei strings). */
function aggregateHousePnlByToken(houseBalanceData) {
  const totals = new Map();
  const pnlFields = ['bettingPNL', 'auctionPNL', 'lotteryPNL', 'dropPNL'];

  for (const tokenData of Object.values(houseBalanceData || {})) {
    for (const field of pnlFields) {
      const pnl = tokenData[field];
      if (!pnl || typeof pnl !== 'object') continue;
      for (const [token, amount] of Object.entries(pnl)) {
        addToMap(totals, normalizeTokenLookupKey(token), amount);
      }
    }
  }

  return totals;
}

async function aggregateVirtualAccountEsdtBalances(guildId) {
  const { data, error } = await supabase
    .from('virtual_accounts')
    .select('balances')
    .eq('guild_id', guildId);

  if (error) throw error;

  const totals = new Map();
  for (const account of data || []) {
    for (const [token, balance] of Object.entries(account.balances || {})) {
      addToMap(totals, normalizeTokenLookupKey(token), balance);
    }
  }
  return totals;
}

async function aggregateLedgerNftBalances(guildId) {
  const { data, error } = await supabase
    .from('virtual_account_nft_balances')
    .select('collection, nonce, amount, token_type, identifier')
    .eq('guild_id', guildId);

  if (error) throw error;

  const totals = new Map();
  for (const row of data || []) {
    const key = nftLedgerKey(row.collection, row.nonce);
    const amount = row.token_type === 'SFT' ? (row.amount || 1) : 1;
    addToMap(totals, key, amount);
  }
  return totals;
}

async function fetchWalletEsdtBalances(walletAddress) {
  const totals = new Map();
  let from = 0;
  const size = 100;

  while (true) {
    const url = `https://api.multiversx.com/accounts/${walletAddress}/tokens?from=${from}&size=${size}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch wallet tokens (${response.status} ${response.statusText})`);
    }

    const body = await response.json();
    const items = Array.isArray(body) ? body : (body.data || []);
    if (!items.length) break;

    for (const token of items) {
      const identifier = token.identifier || token.token;
      if (!identifier) continue;
      addToMap(totals, normalizeTokenLookupKey(identifier), token.balance || '0');
    }

    if (items.length < size) break;
    from += size;
    if (from >= 5000) break;
  }

  return totals;
}

async function fetchWalletNftBalances(walletAddress, fetchAllNFTs) {
  const items = await fetchAllNFTs(walletAddress, 15000);
  const totals = new Map();

  for (const nft of items) {
    const collection = nft.collection || nft.token;
    const nonce = nft.nonce;
    if (collection == null || nonce == null) continue;

    const key = nftLedgerKey(collection, nonce);
    const balanceBN = new BigNumber(nft.balance || '1');
    const isSft = nft.type === 'SemiFungibleESDT' || (balanceBN.isGreaterThan(1));
    const amount = isSft ? (nft.balance || '1') : '1';
    addToMap(totals, key, amount);
  }

  return totals;
}

/** Merge ledger keys (ticker-only vs full identifier) onto on-chain identifier keys when possible. */
function alignLedgerEsdtKeysToOnChain(ledgerMap, onChainMap) {
  const onChainByTicker = new Map();
  for (const key of onChainMap.keys()) {
    const ticker = key.split('-')[0];
    if (!onChainByTicker.has(ticker)) {
      onChainByTicker.set(ticker, key);
    }
  }

  const aligned = new Map();
  for (const [key, amount] of ledgerMap) {
    const targetKey = ESDT_IDENTIFIER_REGEX.test(key)
      ? key
      : (onChainByTicker.get(key.split('-')[0]) || key);
    addToMap(aligned, targetKey, amount.toString());
  }
  return aligned;
}

function compareBigNumberMaps(expectedMap, actualMap, labelForKey) {
  const mismatches = [];
  const matched = [];
  const keys = new Set([...expectedMap.keys(), ...actualMap.keys()]);

  for (const key of keys) {
    const expected = expectedMap.get(key) || new BigNumber(0);
    const actual = actualMap.get(key) || new BigNumber(0);
    if (expected.isEqualTo(actual)) {
      if (!expected.isZero()) {
        matched.push({ key: labelForKey(key), expected: expected.toString(), actual: actual.toString() });
      }
      continue;
    }
    mismatches.push({
      key: labelForKey(key),
      expected: expected.toString(),
      actual: actual.toString(),
      delta: actual.minus(expected).toString()
    });
  }

  return { mismatches, matched };
}

/**
 * Compare guild virtual-account ledger (ESDT + house + NFT/SFT) with Community Fund on-chain holdings.
 */
async function syncCommunityFundLedger(guildId, options = {}) {
  const { walletAddress, getAllHouseBalances, fetchAllNFTs } = options;
  if (!walletAddress) {
    throw new Error('Community Fund wallet address is not configured.');
  }

  const vaEsdt = await aggregateVirtualAccountEsdtBalances(guildId);
  const houseData = await getAllHouseBalances(guildId);
  const houseEsdt = aggregateHousePnlByToken(houseData);

  const ledgerEsdt = new Map();
  for (const [token, amount] of vaEsdt) {
    addToMap(ledgerEsdt, token, amount.toString());
  }
  for (const [token, amount] of houseEsdt) {
    addToMap(ledgerEsdt, token, amount.toString());
  }

  const onChainEsdt = await fetchWalletEsdtBalances(walletAddress);
  const ledgerEsdtAligned = alignLedgerEsdtKeysToOnChain(ledgerEsdt, onChainEsdt);
  const ledgerNft = await aggregateLedgerNftBalances(guildId);
  const onChainNft = await fetchWalletNftBalances(walletAddress, fetchAllNFTs);

  const esdtComparison = compareBigNumberMaps(ledgerEsdtAligned, onChainEsdt, (k) => k);
  const nftComparison = compareBigNumberMaps(ledgerNft, onChainNft, (k) => {
    const [collection, nonce] = k.split('\u0000');
    return `${collection}#${nonce}`;
  });

  const esdtMismatches = esdtComparison.mismatches;
  const nftMismatches = nftComparison.mismatches;
  const inSync = esdtMismatches.length === 0 && nftMismatches.length === 0;

  return {
    inSync,
    walletAddress,
    esdt: {
      matchedCount: esdtComparison.matched.length,
      mismatchCount: esdtMismatches.length,
      mismatches: esdtMismatches.slice(0, 25),
      ledgerTokenCount: ledgerEsdt.size,
      onChainTokenCount: onChainEsdt.size
    },
    nft: {
      matchedCount: nftComparison.matched.length,
      mismatchCount: nftMismatches.length,
      mismatches: nftMismatches.slice(0, 25),
      ledgerItemCount: ledgerNft.size,
      onChainItemCount: onChainNft.size
    }
  };
}

module.exports = {
  ESDT_IDENTIFIER_REGEX,
  syncCommunityFundLedger,
  aggregateVirtualAccountEsdtBalances,
  aggregateHousePnlByToken
};
