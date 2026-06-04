const BigNumber = require('bignumber.js');
const supabase = require('../supabase-client');
const dbServerData = require('../db/server-data');

const ESDT_IDENTIFIER_REGEX = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
const DISCORD_EMBED_FIELD_MAX = 1024;

function normalizeTokenLookupKey(tokenKey) {
  return (tokenKey || '').toLowerCase();
}

function nftLedgerKey(collection, nonce) {
  return `${(collection || '').toLowerCase()}\u0000${Number(nonce)}`;
}

function parseNoncePart(noncePart) {
  if (noncePart == null || noncePart === '') return null;
  const str = String(noncePart);
  if (/^[0-9a-f]+$/i.test(str)) {
    const hex = parseInt(str, 16);
    if (!isNaN(hex)) return hex;
  }
  const dec = parseInt(str, 10);
  return isNaN(dec) ? null : dec;
}

function nftKeyFromIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const parts = identifier.split('-');
  if (parts.length < 3) return null;
  const nonce = parseNoncePart(parts[parts.length - 1]);
  if (nonce == null) return null;
  const collection = parts.slice(0, -1).join('-');
  return nftLedgerKey(collection, nonce);
}

function nftKeyFromOnChain(nft) {
  const fromIdentifier = nftKeyFromIdentifier(nft.identifier);
  if (fromIdentifier) return fromIdentifier;
  const collection = nft.collection || nft.token;
  if (collection == null || nft.nonce == null) return null;
  return nftLedgerKey(collection, nonce);
}

function nftKeyFromLedgerRow(row) {
  const fromIdentifier = nftKeyFromIdentifier(row.identifier);
  if (fromIdentifier) return fromIdentifier;
  return nftLedgerKey(row.collection, row.nonce);
}

function addToMap(map, key, amount) {
  const bn = new BigNumber(amount || '0');
  if (bn.isZero()) return;
  const existing = map.get(key) || new BigNumber(0);
  map.set(key, existing.plus(bn));
}

function buildMetadataIndexes(metadata) {
  const byIdentifier = new Map();
  const byTicker = new Map();

  for (const row of Object.values(metadata || {})) {
    if (!row) continue;
    const identifier = row.identifier || row.token_identifier;
    if (identifier) {
      byIdentifier.set(normalizeTokenLookupKey(identifier), row);
    }
    if (row.ticker) {
      const tickerKey = normalizeTokenLookupKey(row.ticker);
      if (!byTicker.has(tickerKey)) {
        byTicker.set(tickerKey, row);
      }
    }
  }

  return { byIdentifier, byTicker };
}

/**
 * Resolve decimals: Supabase token_metadata first, then on-chain API decimals, then MvX token API.
 */
async function resolveTokenMeta(tokenKey, indexes, onChainDecimalsByKey, getTokenDecimals) {
  const key = normalizeTokenLookupKey(tokenKey);
  let row = indexes.byIdentifier.get(key);
  if (!row) {
    const ticker = key.split('-')[0];
    row = indexes.byTicker.get(ticker);
  }

  let decimals = row?.decimals;
  if (decimals == null && onChainDecimalsByKey?.has(key)) {
    const chainDec = onChainDecimalsByKey.get(key);
    if (chainDec != null && chainDec !== undefined) {
      decimals = chainDec;
    }
  }

  const identifierForApi = row?.identifier || row?.token_identifier
    || (ESDT_IDENTIFIER_REGEX.test(tokenKey) ? tokenKey : null);

  if (decimals == null && identifierForApi && typeof getTokenDecimals === 'function') {
    try {
      decimals = await getTokenDecimals(identifierForApi);
    } catch (error) {
      console.error(`[LEDGER-SYNC] Could not fetch decimals for ${identifierForApi}:`, error.message);
    }
  }

  const ticker = row?.ticker || tokenKey.split('-')[0];
  const name = row?.name || ticker;
  const displayLabel = ticker || name || tokenKey;

  return {
    decimals: decimals != null ? Number(decimals) : null,
    ticker,
    name,
    displayLabel,
    identifier: identifierForApi,
    missingDecimals: decimals == null
  };
}

/** Convert atomic (wei) balance to a human-readable string using token decimals. */
function formatHumanAmount(weiStr, decimals, options = {}) {
  const { suffix = '' } = options;
  if (decimals == null || Number.isNaN(decimals)) {
    return `${weiStr} atomic (decimals unknown — add via /update-token-metadata)`;
  }

  const bn = new BigNumber(weiStr || '0');
  if (bn.isZero()) return `0${suffix ? ` ${suffix}` : ''}`;

  const human = bn.dividedBy(new BigNumber(10).pow(decimals));
  const maxDp = Math.min(8, Math.max(0, decimals));
  let formatted = human.toFixed(maxDp);
  if (formatted.includes('.')) {
    formatted = formatted.replace(/\.?0+$/, '');
  }
  return `${formatted}${suffix ? ` ${suffix}` : ''}`;
}

function truncateEmbedField(text, max = DISCORD_EMBED_FIELD_MAX) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 28)}\n\n_…truncated._`;
}

function classifyEsdtMismatch(expectedWei, actualWei) {
  const expected = new BigNumber(expectedWei || '0');
  const actual = new BigNumber(actualWei || '0');
  if (expected.isZero() && actual.isGreaterThan(0)) return 'surplus';
  if (actual.isZero() && expected.isGreaterThan(0)) return 'deficit';
  return 'amount';
}

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
    const key = nftKeyFromLedgerRow(row);
    if (!key) continue;
    const amount = row.token_type === 'SFT' ? (row.amount || 1) : 1;
    addToMap(totals, key, amount);
  }
  return totals;
}

async function fetchWalletEsdtBalances(walletAddress) {
  const totals = new Map();
  const decimalsByKey = new Map();
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
      const key = normalizeTokenLookupKey(identifier);
      addToMap(totals, key, token.balance || '0');
      if (token.decimals != null && token.decimals !== undefined) {
        decimalsByKey.set(key, Number(token.decimals));
      }
    }

    if (items.length < size) break;
    from += size;
    if (from >= 5000) break;
  }

  return { totals, decimalsByKey };
}

async function fetchWalletNftBalances(walletAddress, fetchAllNFTs) {
  const items = await fetchAllNFTs(walletAddress, 15000);
  const totals = new Map();

  for (const nft of items) {
    const key = nftKeyFromOnChain(nft);
    if (!key) continue;

    const balanceBN = new BigNumber(nft.balance || '1');
    const isSft = nft.type === 'SemiFungibleESDT' || balanceBN.isGreaterThan(1);
    const amount = isSft ? (nft.balance || '1') : '1';
    addToMap(totals, key, amount);
  }

  return totals;
}

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
        matched.push({
          key,
          label: labelForKey(key),
          expected: expected.toString(),
          actual: actual.toString()
        });
      }
      continue;
    }
    mismatches.push({
      key,
      label: labelForKey(key),
      expected: expected.toString(),
      actual: actual.toString(),
      delta: actual.minus(expected).toString()
    });
  }

  return { mismatches, matched };
}

async function enrichEsdtRows(rows, indexes, onChainDecimalsByKey, getTokenDecimals) {
  const enriched = [];
  let missingDecimalsCount = 0;

  for (const row of rows) {
    const meta = await resolveTokenMeta(row.key, indexes, onChainDecimalsByKey, getTokenDecimals);
    if (meta.missingDecimals) missingDecimalsCount++;

    const suffix = meta.ticker || '';
    enriched.push({
      ...row,
      displayLabel: meta.displayLabel,
      decimals: meta.decimals,
      missingDecimals: meta.missingDecimals,
      ledgerHuman: formatHumanAmount(row.expected, meta.decimals, { suffix }),
      walletHuman: formatHumanAmount(row.actual, meta.decimals, { suffix }),
      deltaHuman: row.delta != null
        ? formatHumanAmount(row.delta, meta.decimals, { suffix })
        : formatHumanAmount('0', meta.decimals, { suffix }),
      kind: classifyEsdtMismatch(row.expected, row.actual)
    });
  }

  return { rows: enriched, missingDecimalsCount };
}

/**
 * Compare guild virtual-account ledger (ESDT + house + NFT/SFT) with Community Fund on-chain holdings.
 * ESDT amounts are compared in atomic units (same as VA storage); display uses token_metadata decimals.
 */
async function syncCommunityFundLedger(guildId, options = {}) {
  const { walletAddress, getAllHouseBalances, fetchAllNFTs, getTokenDecimals } = options;
  if (!walletAddress) {
    throw new Error('Community Fund wallet address is not configured.');
  }

  const metadata = await dbServerData.getTokenMetadata(guildId);
  const indexes = buildMetadataIndexes(metadata);

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

  const { totals: onChainEsdt, decimalsByKey: onChainDecimalsByKey } = await fetchWalletEsdtBalances(walletAddress);
  const ledgerEsdtAligned = alignLedgerEsdtKeysToOnChain(ledgerEsdt, onChainEsdt);
  const ledgerNft = await aggregateLedgerNftBalances(guildId);
  const onChainNft = await fetchWalletNftBalances(walletAddress, fetchAllNFTs);

  const esdtComparison = compareBigNumberMaps(ledgerEsdtAligned, onChainEsdt, (k) => k);
  const nftComparison = compareBigNumberMaps(ledgerNft, onChainNft, (k) => {
    const [collection, nonce] = k.split('\u0000');
    return `${collection}#${nonce}`;
  });

  const esdtMismatchesEnriched = await enrichEsdtRows(
    esdtComparison.mismatches,
    indexes,
    onChainDecimalsByKey,
    getTokenDecimals
  );
  const esdtMatchedEnriched = await enrichEsdtRows(
    esdtComparison.matched,
    indexes,
    onChainDecimalsByKey,
    getTokenDecimals
  );

  const esdtMismatches = esdtMismatchesEnriched.rows;
  const esdtMatched = esdtMatchedEnriched.rows;
  const nftMismatches = nftComparison.mismatches;
  const inSync = esdtMismatches.length === 0 && nftMismatches.length === 0;

  const surplusCount = esdtMismatches.filter((m) => m.kind === 'surplus').length;
  const deficitCount = esdtMismatches.filter((m) => m.kind === 'deficit').length;

  return {
    inSync,
    walletAddress,
    esdt: {
      matchedCount: esdtMatched.length,
      mismatchCount: esdtMismatches.length,
      mismatches: esdtMismatches.slice(0, 25),
      matched: esdtMatched.slice(0, 15),
      ledgerTokenCount: ledgerEsdtAligned.size,
      onChainTokenCount: onChainEsdt.size,
      missingDecimalsCount: esdtMismatchesEnriched.missingDecimalsCount + esdtMatchedEnriched.missingDecimalsCount,
      surplusCount,
      deficitCount
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

function formatEsdtMismatchLine(m) {
  const tag = m.kind === 'surplus'
    ? ' _(in wallet, not in ledger)_'
    : m.kind === 'deficit'
      ? ' _(ledger > wallet)_'
      : '';
  return `• **${m.displayLabel}** — ledger **${m.ledgerHuman}** / wallet **${m.walletHuman}** (Δ **${m.deltaHuman}**)${tag}`;
}

function formatEsdtMatchedLine(m) {
  return `• **${m.displayLabel}** — **${m.ledgerHuman}** ✓`;
}

/** Build Discord embed fields (human-readable ESDT amounts, 1024-char safe). */
function buildLedgerSyncMismatchFields(syncResult) {
  const fields = [];
  const esdt = syncResult.esdt;
  const nft = syncResult.nft;

  if (esdt.mismatchCount > 0) {
    const lines = (esdt.mismatches || []).map(formatEsdtMismatchLine);
    const more = esdt.mismatchCount - lines.length;
    if (more > 0) lines.push(`_+${more} more ESDT mismatch(es)_`);
    fields.push({
      name: `⚠️ ESDT mismatches (${esdt.mismatchCount})`,
      value: truncateEmbedField(lines.join('\n')),
      inline: false
    });

    if (esdt.surplusCount > 0 || esdt.deficitCount > 0) {
      fields.push({
        name: '📋 ESDT mismatch types',
        value: truncateEmbedField(
          `• **${esdt.surplusCount}** surplus on wallet (not allocated to VA + house)\n` +
          `• **${esdt.deficitCount}** shortfall (ledger > wallet)\n` +
          `• **${esdt.mismatchCount - esdt.surplusCount - esdt.deficitCount}** amount drift (same liability, different balance)`
        ),
        inline: false
      });
    }
  }

  if (esdt.matchedCount > 0) {
    const maxMatched = esdt.mismatchCount === 0 ? 12 : 8;
    const lines = esdt.matched.slice(0, maxMatched).map(formatEsdtMatchedLine);
    const more = esdt.matchedCount - lines.length;
    if (more > 0) lines.push(`_+${more} matched token(s)_`);
    fields.push({
      name: `✅ ESDT matched (${esdt.matchedCount})`,
      value: truncateEmbedField(lines.join('\n')),
      inline: false
    });
  }

  if (esdt.missingDecimalsCount > 0) {
    fields.push({
      name: '⚠️ Missing token decimals',
      value: `${esdt.missingDecimalsCount} token(s) lack decimals in \`token_metadata\`. Run \`/update-token-metadata\` so amounts display correctly.`,
      inline: false
    });
  }

  if (nft.mismatchCount > 0) {
    const lines = nft.mismatches.slice(0, 8).map((m) => {
      const exp = m.expected === '1' && m.actual === '0' ? '0 NFT' : m.expected;
      const act = m.actual === '1' && m.expected === '0' ? '1 NFT' : m.actual;
      return `• \`${m.label}\` — ledger **${exp}** / wallet **${act}**`;
    });
    const more = nft.mismatchCount - lines.length;
    if (more > 0) lines.push(`_+${more} more NFT/SFT mismatch(es)_`);
    fields.push({
      name: `⚠️ NFT/SFT mismatches (${nft.mismatchCount})`,
      value: truncateEmbedField(lines.join('\n')),
      inline: false
    });
  }

  return fields;
}

module.exports = {
  ESDT_IDENTIFIER_REGEX,
  DISCORD_EMBED_FIELD_MAX,
  syncCommunityFundLedger,
  aggregateVirtualAccountEsdtBalances,
  aggregateHousePnlByToken,
  buildLedgerSyncMismatchFields,
  truncateEmbedField,
  formatHumanAmount
};
