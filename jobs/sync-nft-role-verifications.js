const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const fetch = require('node-fetch');
const dbServerData = require('../db/server-data');
const dbNftRoleRules = require('../db/nft-role-verification');
const dbVirtualAccountsNft = require('../db/virtual-accounts-nft');
const { evaluateRuleAgainstCounts, countAtTickerIc, mergeCollectionCounts } = require('../utils/nft-role-rule-evaluator');
const { formatNftRuleMemberDiag, discordIdentityFromMember } = require('../utils/nft-role-verification-diagnostics');
const {
  coerceEligibilityMode,
  eligibilityUsesVa,
  shouldFetchWalletNft,
  computeEligibility,
  skipMemberOnWalletAmbiguity
} = require('../utils/nft-role-eligibility-mode');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** OOX marketplace indexer — per-wallet collection counts without paging every NFT. */
const OOX_API_BASE = 'https://api.oox.art';
/** Fallback indexer (same count endpoint as OOX; wallet-only, no marketplace custody). */
const MVX_API_BASE = 'https://api.multiversx.com';

/** Spacing between outbound indexer requests so public quota is not blown (other bot jobs share MvX). */
const INDEXER_MIN_INTERVAL_MS = 2000;
/** HTTP timeout per collection-count / NFT page fetch. */
const INDEXER_FETCH_TIMEOUT_MS = 30000;
/** Obey Retry-After up to this cap before falling back to exponential waits. */
const INDEXER_MAX_RETRY_AFTER_MS = 60000;
const INDEXER_FETCH_MAX_ATTEMPTS = 8;

const SFT_LIKE_TYPES = new Set([
  'SemiFungibleESDT',
  'DynamicSemiFungibleESDT',
  'MetaESDT',
  'DynamicMetaESDT'
]);

let nextIndexerSlot = 0;

async function waitIndexerSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextIndexerSlot - now);
  if (wait > 0) {
    await sleep(wait);
  }
  nextIndexerSlot = Date.now() + INDEXER_MIN_INTERVAL_MS;
}

function isSftLikeType(type) {
  return SFT_LIKE_TYPES.has(String(type || ''));
}

function parseRetryBackoffMs(response, attempt) {
  const retryAfterSec = parseInt(response.headers.get('retry-after') || '0', 10);
  const fromHeader = retryAfterSec > 0 ? Math.min(retryAfterSec * 1000, INDEXER_MAX_RETRY_AFTER_MS) : 0;
  const exp = Math.floor(1800 * Math.pow(2, Math.min(attempt - 1, 5)));
  return Math.min(
    INDEXER_MAX_RETRY_AFTER_MS + 12000,
    Math.max(fromHeader + 900, attempt * INDEXER_MIN_INTERVAL_MS + exp)
  );
}

/**
 * @returns {Promise<{ ok: true, status: number, json: any } | { ok: false, status: number, retryable: boolean }>}
 */
async function fetchIndexerJson(url, label) {
  for (let attempt = 1; attempt <= INDEXER_FETCH_MAX_ATTEMPTS; attempt++) {
    await waitIndexerSlot();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: INDEXER_FETCH_TIMEOUT_MS
      });

      if (response.status === 429 || response.status >= 500) {
        const backoff = parseRetryBackoffMs(response, attempt);
        console.warn(
          `[NFT-ROLE-SYNC] ${label} HTTP ${response.status}, waiting ${backoff}ms (${attempt}/${INDEXER_FETCH_MAX_ATTEMPTS})`
        );
        await sleep(backoff);
        continue;
      }

      if (response.status === 404) {
        return { ok: true, status: 404, json: null };
      }

      if (!response.ok) {
        console.warn(`[NFT-ROLE-SYNC] ${label} HTTP ${response.status}`);
        return { ok: false, status: response.status, retryable: false };
      }

      const json = await response.json();
      return { ok: true, status: response.status, json };
    } catch (err) {
      console.warn(`[NFT-ROLE-SYNC] ${label} fetch error:`, err.message);
      if (attempt === INDEXER_FETCH_MAX_ATTEMPTS) {
        return { ok: false, status: 0, retryable: true };
      }
      const netBackoff = Math.min(
        INDEXER_MAX_RETRY_AFTER_MS,
        2800 + Math.floor(INDEXER_MIN_INTERVAL_MS * Math.pow(1.8, attempt))
      );
      await sleep(netBackoff);
    }
  }
  return { ok: false, status: 0, retryable: true };
}

function collectionCountUrl(base, walletAddress, ticker) {
  return `${base}/accounts/${encodeURIComponent(walletAddress)}/collections/${encodeURIComponent(ticker)}`;
}

function accountNftsUrl(base, walletAddress, collectionsQuery, from, pageSize) {
  return `${base}/accounts/${encodeURIComponent(walletAddress)}/nfts?collections=${collectionsQuery}&from=${from}&size=${pageSize}`;
}

/**
 * Sum SFT/MetaESDT balances by paging NFT rows (collection `count` is nonce cardinality, not quantity).
 * @returns {Promise<{ counts: Record<string, number>, walletLegVerified: boolean }>}
 */
async function fetchSftBalancesByPaging(walletAddress, collectionTickers, apiBase, labelPrefix) {
  const tickers = [...new Set((collectionTickers || []).filter(Boolean))];
  const counts = {};
  const canonicalLower = new Map();
  tickers.forEach(t => {
    const s = String(t);
    canonicalLower.set(s.toLowerCase(), s);
    counts[s] = 0;
  });
  if (tickers.length === 0) {
    return { counts, walletLegVerified: true };
  }

  const collectionsQuery = [...canonicalLower.values()].map(t => encodeURIComponent(t)).join(',');
  const pageSize = 100;
  const maxPages = 100;
  let from = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = accountNftsUrl(apiBase, walletAddress, collectionsQuery, from, pageSize);
    const fetched = await fetchIndexerJson(url, `${labelPrefix} nfts page from=${from}`);
    if (!fetched.ok) {
      return { counts, walletLegVerified: false };
    }
    if (fetched.status === 404) {
      return { counts, walletLegVerified: true };
    }

    const responseData = fetched.json;
    const items = Array.isArray(responseData) ? responseData : responseData?.data || [];
    if (!Array.isArray(items)) {
      console.warn(`[NFT-ROLE-SYNC] ${labelPrefix} nfts unexpected JSON shape`);
      return { counts, walletLegVerified: false };
    }

    for (const item of items) {
      const lk = item.collection ? String(item.collection).toLowerCase() : '';
      const canon = lk ? canonicalLower.get(lk) : '';
      if (!canon) {
        continue;
      }
      const type = item.type || '';
      let add = 1;
      if (isSftLikeType(type)) {
        const bal = parseInt(String(item.balance ?? item.value ?? 1), 10);
        add = Number.isFinite(bal) && bal > 0 ? bal : 1;
      }
      counts[canon] += add;
    }

    if (items.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return { counts, walletLegVerified: true };
}

/**
 * One indexer host: collection details (count) for NFT types; 404 = zero holdings.
 * @returns {Promise<{ ok: boolean, count: number, type: string|null }>}
 */
async function fetchCollectionDetails(apiBase, walletAddress, ticker, labelPrefix) {
  const url = collectionCountUrl(apiBase, walletAddress, ticker);
  const fetched = await fetchIndexerJson(url, `${labelPrefix} collection ${ticker}`);
  if (!fetched.ok) {
    return { ok: false, count: 0, type: null };
  }
  if (fetched.status === 404 || !fetched.json) {
    return { ok: true, count: 0, type: null };
  }
  const type = fetched.json.type || fetched.json.subType || null;
  const count = parseInt(String(fetched.json.count ?? 0), 10);
  return { ok: true, count: Number.isFinite(count) && count > 0 ? count : 0, type };
}

/**
 * Wallet leg: count on-chain / OOX-attributed NFT/SFT per collection.
 * Prefers OOX `GET /accounts/{address}/collections/{ticker}` (one call, includes marketplace custody
 * attributed back to the owner). Holder snapshots are not used: `/holders` always embeds full nftIds
 * lists and is heavier than per-user counts for Discord-sized candidate sets.
 * Falls back to MultiversX the same endpoint, then SFT quantity paging when needed.
 * On unrecoverable error returns walletLegVerified:false — caller must NOT revoke roles (unknown state).
 * @returns {Promise<{ counts: Record<string, number>, walletLegVerified: boolean }>}
 */
async function fetchWalletCollectionCounts(walletAddress, collectionTickers) {
  const tickers = [...new Set((collectionTickers || []).filter(Boolean).map(String))];
  const counts = {};
  tickers.forEach(t => {
    counts[t] = 0;
  });
  if (tickers.length === 0) {
    return { counts, walletLegVerified: true };
  }

  const sftTickers = [];
  for (const ticker of tickers) {
    let details = await fetchCollectionDetails(OOX_API_BASE, walletAddress, ticker, 'OOX');
    if (!details.ok) {
      details = await fetchCollectionDetails(MVX_API_BASE, walletAddress, ticker, 'MvX');
    }
    if (!details.ok) {
      return { counts, walletLegVerified: false };
    }
    if (details.type && isSftLikeType(details.type)) {
      sftTickers.push(ticker);
      continue;
    }
    counts[ticker] = details.count;
  }

  if (sftTickers.length > 0) {
    let paged = await fetchSftBalancesByPaging(walletAddress, sftTickers, OOX_API_BASE, 'OOX');
    if (!paged.walletLegVerified) {
      paged = await fetchSftBalancesByPaging(walletAddress, sftTickers, MVX_API_BASE, 'MvX');
    }
    if (!paged.walletLegVerified) {
      return { counts, walletLegVerified: false };
    }
    for (const t of sftTickers) {
      counts[t] = countAtTickerIc(paged.counts, t);
    }
  }

  return { counts, walletLegVerified: true };
}

/**
 * Reuse indexer results within one sync run / tick. Dolphin/Shark/Whale/Mega-Whale all query EMP-897b49
 * for the same wallets; without a cache that is 4× the public API quota (429s, skipped members).
 */
function createWalletNftCountCache() {
  /** @type {Map<string, { verified: boolean, counts: Record<string, number>, fetchedLower: Set<string> }>} */
  const byAddress = new Map();

  return async function fetchWalletCollectionCountsCached(walletAddress, collectionTickers) {
    const wanted = [...new Set((collectionTickers || []).filter(Boolean).map(String))];
    const entry = byAddress.get(walletAddress);

    if (entry && !entry.verified) {
      return { counts: {}, walletLegVerified: false };
    }

    if (entry && entry.verified) {
      const missing = wanted.filter(t => !entry.fetchedLower.has(t.toLowerCase()));
      if (missing.length === 0) {
        const out = {};
        for (const t of wanted) {
          out[t] = countAtTickerIc(entry.counts, t);
        }
        return { counts: out, walletLegVerified: true };
      }
      const extra = await fetchWalletCollectionCounts(walletAddress, missing);
      if (!extra.walletLegVerified) {
        byAddress.set(walletAddress, { verified: false, counts: {}, fetchedLower: new Set() });
        return extra;
      }
      Object.assign(entry.counts, extra.counts);
      for (const t of missing) {
        entry.fetchedLower.add(String(t).toLowerCase());
      }
      const out = {};
      for (const t of wanted) {
        out[t] = countAtTickerIc(entry.counts, t);
      }
      return { counts: out, walletLegVerified: true };
    }

    const result = await fetchWalletCollectionCounts(walletAddress, wanted);
    if (!result.walletLegVerified) {
      byAddress.set(walletAddress, { verified: false, counts: {}, fetchedLower: new Set() });
      return result;
    }
    byAddress.set(walletAddress, {
      verified: true,
      counts: { ...result.counts },
      fetchedLower: new Set(wanted.map(t => t.toLowerCase()))
    });
    return result;
  };
}

function chunkLines(lines, maxPerChunk = 12) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += maxPerChunk) {
    chunks.push(lines.slice(i, i + maxPerChunk));
  }
  return chunks.length ? chunks : [[]];
}

async function sendChunksToChannel(channel, title, lines, maxPerChunk = 12) {
  if (!channel || lines.length === 0) {
    return;
  }
  const chunks = chunkLines(lines, maxPerChunk);
  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder()
      .setTitle(title + (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''))
      .setDescription(chunks[i].join('\n') || '—')
      .setColor(0x5865f2)
      .setTimestamp();
    try {
      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error(`[NFT-ROLE-SYNC] Failed to send notification:`, e.message);
    }
  }
}

function canBotManageRole(guild, role) {
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return false;
  }
  if (!role || role.managed) {
    return false;
  }
  if (me.roles.highest.position <= role.position) {
    return false;
  }
  return true;
}

function workKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

/**
 * Even slice so N candidates finish one pass in `windowMs` when ticked every `tickMs`.
 * @param {number} totalCandidates
 * @param {number} [windowMs]
 * @param {number} [tickMs]
 */
function computeScheduledUserBudget(totalCandidates, windowMs = NFT_ROLE_SYNC_WINDOW_MS, tickMs = NFT_ROLE_SYNC_TICK_MS) {
  const ticks = Math.max(1, Math.floor(windowMs / tickMs));
  return Math.max(1, Math.ceil(Math.max(0, Number(totalCandidates) || 0) / ticks));
}

let syncInFlight = false;

/** Full coverage window for automated mode (each candidate is due once per window). */
const NFT_ROLE_SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How often the scheduler picks the next even slice. */
const NFT_ROLE_SYNC_TICK_MS = 10 * 60 * 1000;
const NFT_ROLE_SYNC_STARTUP_DELAY_MS = 60 * 1000;

/** @type {Map<string, number>} `${guildId}:${userId}` -> last successful scheduled/run-now check */
const lastCheckedAt = new Map();

/**
 * @typedef {{ pending: Set<string>, granted: number, revoked: number, errors: number, membersChecked: number, startedAt: number, completedAt: number, summarySent: boolean }} RuleCycle
 */
/** @type {Map<string, RuleCycle>} */
const scheduledCycleByRule = new Map();

function emptySummary(filterRuleId) {
  return {
    guilds: 0,
    rules: 0,
    granted: 0,
    revoked: 0,
    errors: 0,
    walletCheckSkipped: 0,
    processedUsers: 0,
    dueUsers: 0,
    budget: 0,
    /** @type {string|null} When run-now targets a single rule */
    ruleId: filterRuleId || null,
    /** @type {string[]} Sample diagnostic blocks for /run-now ephemeral embed */
    grantDiagBlocks: [],
    /** @type {string[]} Sample diagnostic blocks for /run-now ephemeral embed */
    revokeDiagBlocks: []
  };
}

function startRuleCycle(ruleId, candidateIds) {
  scheduledCycleByRule.set(ruleId, {
    pending: new Set(candidateIds),
    granted: 0,
    revoked: 0,
    errors: 0,
    membersChecked: 0,
    startedAt: Date.now(),
    completedAt: 0,
    summarySent: false
  });
}

function creditDuePending(cycle, guildId, now) {
  if (!cycle || cycle.summarySent) {
    return;
  }
  for (const uid of [...cycle.pending]) {
    const t = lastCheckedAt.get(workKey(guildId, uid)) || 0;
    if (t > 0 && now - t < NFT_ROLE_SYNC_WINDOW_MS) {
      cycle.pending.delete(uid);
    }
  }
}

/**
 * @param {import('discord.js').Client} client
 * @param {{ guildId?: string, ruleId?: string }} [opts]
 */
async function buildGuildPlans(client, opts = {}) {
  const { guildId: filterGuildId, ruleId: filterRuleId } = opts;
  let rules = await dbNftRoleRules.listEnabledRulesGlobally();
  if (filterGuildId) {
    rules = rules.filter(r => r.guildId === filterGuildId);
  }
  if (filterRuleId) {
    rules = rules.filter(r => r.id === filterRuleId);
  }
  if (rules.length === 0) {
    return [];
  }

  const byGuild = new Map();
  for (const r of rules) {
    if (!byGuild.has(r.guildId)) {
      byGuild.set(r.guildId, []);
    }
    byGuild.get(r.guildId).push(r);
  }

  const plans = [];
  for (const [gid, guildRules] of byGuild) {
    const guild = client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
    if (!guild) {
      console.warn(`[NFT-ROLE-SYNC] Guild not found: ${gid}`);
      continue;
    }

    const walletsMap = await dbServerData.getUserWallets(gid);
    const walletUserIds = Object.keys(walletsMap || {});
    const vaUserIds = await dbVirtualAccountsNft.getDistinctUserIdsWithNftBalances(gid);
    const candidateIds = new Set([...walletUserIds, ...vaUserIds]);

    for (const rule of guildRules) {
      try {
        const role = await guild.roles.fetch(rule.discordRoleId).catch(() => null);
        if (role) {
          role.members.forEach(m => candidateIds.add(m.user.id));
        }
      } catch (_) {
        /* ignore */
      }
    }

    plans.push({
      guildId: gid,
      guild,
      guildRules,
      walletsMap: walletsMap || {},
      candidateIds
    });
  }
  return plans;
}

function pickDueUserSlice(plans, budget, now) {
  /** @type {{ guildId: string, userId: string }[]} */
  const due = [];
  for (const plan of plans) {
    for (const userId of plan.candidateIds) {
      const t = lastCheckedAt.get(workKey(plan.guildId, userId)) || 0;
      if (t === 0 || now - t >= NFT_ROLE_SYNC_WINDOW_MS) {
        due.push({ guildId: plan.guildId, userId, last: t });
      }
    }
  }
  due.sort((a, b) => a.last - b.last || String(a.userId).localeCompare(String(b.userId)));
  const seen = new Set();
  const slice = [];
  for (const item of due) {
    const k = workKey(item.guildId, item.userId);
    if (seen.has(k)) continue;
    seen.add(k);
    slice.push(item);
    if (slice.length >= budget) break;
  }
  return { dueCount: due.length, slice };
}

function pruneLastChecked(activeKeys) {
  for (const key of [...lastCheckedAt.keys()]) {
    if (!activeKeys.has(key)) {
      lastCheckedAt.delete(key);
    }
  }
}

async function sendRuleCycleSummary(notifyChannel, rule, cycle, tickers) {
  if (!notifyChannel || !notifyChannel.isTextBased() || !cycle || cycle.summarySent) {
    return;
  }
  const modeHuman = String(rule.eligibilityMode || 'wallet_or_va').replace(/_/g, ' ');
  const elapsedMin = Math.max(1, Math.round((Date.now() - cycle.startedAt) / 60000));
  const summaryEmbed = new EmbedBuilder()
    .setTitle('NFT role verification — 24h cycle complete')
    .setDescription(
      cycle.granted || cycle.revoked
        ? '_Per-member details are in the grant/removal embeds posted during this cycle._'
        : '_No role changes were needed._'
    )
    .addFields(
      { name: 'Role', value: `<@&${rule.discordRoleId}>`, inline: true },
      { name: 'Rule ID', value: `\`${rule.id}\``, inline: true },
      { name: 'Members checked', value: String(cycle.membersChecked), inline: true },
      { name: 'Granted', value: String(cycle.granted), inline: true },
      { name: 'Removed', value: String(cycle.revoked), inline: true },
      { name: 'Errors', value: String(cycle.errors), inline: true },
      { name: 'Spread', value: `${elapsedMin} min over this cycle`, inline: true },
      {
        name: 'Collections',
        value: (tickers.join(', ') || '—').slice(0, 1024),
        inline: false
      },
      {
        name: 'Eligibility',
        value: `${modeHuman} · match **${rule.matchMode}**, min **${rule.minCountPerCollection}**`,
        inline: false
      }
    )
    .setColor(cycle.errors > 0 ? 0xe74c3c : cycle.granted || cycle.revoked ? 0x5865f2 : 0x57f287)
    .setTimestamp();
  try {
    await notifyChannel.send({ embeds: [summaryEmbed] });
    cycle.summarySent = true;
    cycle.completedAt = Date.now();
  } catch (e) {
    console.error(`[NFT-ROLE-SYNC] Failed to send scheduled summary:`, e.message);
  }
}

/**
 * @param {object} args
 */
async function syncUsersInGuild(args) {
  const {
    guild,
    guildId,
    guildRules,
    walletsMap,
    userIds,
    scheduled,
    fetchWalletCollectionCountsCached,
    summary
  } = args;

  const MAX_RUN_NOW_SAMPLES = 8;
  const EMBED_CHUNKSIZE = 3;
  const userIdList = [...new Set(userIds || [])];
  if (userIdList.length === 0) {
    return;
  }

  summary.guilds += 1;
  const now = Date.now();

  for (const rule of guildRules) {
    let role = null;
    try {
      role = await guild.roles.fetch(rule.discordRoleId).catch(() => null);
    } catch (_) {
      /* ignore */
    }

    if (!role) {
      console.warn(`[NFT-ROLE-SYNC] Role ${rule.discordRoleId} not in guild ${guildId}`);
      summary.errors += 1;
      continue;
    }
    if (!canBotManageRole(guild, role)) {
      console.warn(`[NFT-ROLE-SYNC] Bot cannot manage role ${rule.discordRoleId} in ${guildId}`);
      summary.errors += 1;
      continue;
    }

    const grantedLines = [];
    const revokedLines = [];
    const tickers = rule.collectionTickers || [];
    let revokeDiagSamples = 0;
    let ruleErrors = 0;
    const REVOKE_DIAG_MAX = 8;

    const eligibilityMode = coerceEligibilityMode(rule.eligibilityMode);
    let vaCountsByUser = new Map();
    if (eligibilityUsesVa(eligibilityMode)) {
      try {
        vaCountsByUser = await dbVirtualAccountsNft.batchCountEligibleVirtualInventoryForRoleRule(
          guildId,
          userIdList,
          tickers
        );
      } catch (batchErr) {
        console.error(`[NFT-ROLE-SYNC] Batch VA count failed for guild ${guildId}:`, batchErr.message);
        summary.errors += 1;
        continue;
      }
    }

    if (scheduled) {
      const candidateAll = args.candidateIds instanceof Set ? args.candidateIds : new Set(userIdList);
      let cycle = scheduledCycleByRule.get(rule.id);
      if (!cycle || cycle.summarySent) {
        startRuleCycle(rule.id, candidateAll);
        cycle = scheduledCycleByRule.get(rule.id);
      } else {
        for (const id of candidateAll) {
          if (!cycle.pending.has(id) && (lastCheckedAt.get(workKey(guildId, id)) || 0) === 0) {
            cycle.pending.add(id);
          }
        }
      }
      creditDuePending(cycle, guildId, now);
    }

    for (const userId of userIdList) {
      try {
        const member = await guild.members.fetch({ user: userId, force: false }).catch(() => null);
        if (!member || member.user.bot) {
          lastCheckedAt.set(workKey(guildId, userId), Date.now());
          const cycleSkip = scheduledCycleByRule.get(rule.id);
          if (cycleSkip) cycleSkip.pending.delete(userId);
          continue;
        }
        if (member.guild?.id !== guildId) {
          console.warn(
            `[NFT-ROLE-SYNC] skipping user=${userId}: resolved guild=${member.guild?.id ?? '?'}, expected=${guildId}`
          );
          continue;
        }

        const discordIdentity = discordIdentityFromMember(member);
        const walletAddress = walletsMap[userId];

        let vaCounts = {};
        let vaPass = false;
        if (eligibilityUsesVa(eligibilityMode)) {
          vaCounts = vaCountsByUser.get(userId) || {};
          for (const t of tickers) {
            if (vaCounts[t] === undefined) vaCounts[t] = 0;
          }
          vaPass = evaluateRuleAgainstCounts(
            vaCounts,
            tickers,
            rule.matchMode,
            rule.minCountPerCollection
          );
        }

        const needWalletMvX = shouldFetchWalletNft(eligibilityMode, vaPass);
        let walletPass = false;
        let walletLegVerified = true;
        let wCountsForLog = null;
        /** True only when indexer was invoked (erd1-linked). Used for ambiguity / diagnostics. */
        let walletMvXRan = false;
        let skipRoleChange = false;

        if (needWalletMvX) {
          if (walletAddress && typeof walletAddress === 'string' && walletAddress.startsWith('erd1')) {
            walletMvXRan = true;
            const { counts: wCounts, walletLegVerified: wlOk } = await fetchWalletCollectionCountsCached(
              walletAddress,
              tickers
            );
            wCountsForLog = wCounts;
            walletLegVerified = wlOk;
            if (!walletLegVerified && skipMemberOnWalletAmbiguity(eligibilityMode, vaPass)) {
              skipRoleChange = true;
              summary.walletCheckSkipped += 1;
            } else if (walletLegVerified) {
              walletPass = evaluateRuleAgainstCounts(
                wCounts,
                tickers,
                rule.matchMode,
                rule.minCountPerCollection
              );
            }
          } else {
            walletPass = false;
          }
        }

        if (skipRoleChange) {
          continue;
        }

        let combinedCounts = null;
        let combinedPass = false;
        if (eligibilityMode === 'wallet_or_va' && wCountsForLog && walletLegVerified) {
          combinedCounts = mergeCollectionCounts(wCountsForLog, vaCounts);
          combinedPass = evaluateRuleAgainstCounts(
            combinedCounts,
            tickers,
            rule.matchMode,
            rule.minCountPerCollection
          );
        }

        const eligible = computeEligibility(walletPass, vaPass, eligibilityMode, combinedPass);
        const hasRole = member.roles.cache.has(rule.discordRoleId);

        if (eligible && !hasRole) {
          await member.roles.add(role, `NFT role verification (${eligibilityMode})`);
          const grantBlock = formatNftRuleMemberDiag({
            granted: true,
            userId,
            guildSnowflakeId: guildId,
            discordIdentity,
            eligibilityMode,
            walletFetched: walletMvXRan,
            walletAddress,
            walletPass,
            vaPass,
            walletLegVerified,
            wCounts: wCountsForLog || {},
            vaCounts,
            combinedCounts,
            collectionTickers: tickers,
            matchMode: rule.matchMode,
            minCountPerCollection: rule.minCountPerCollection
          });
          grantedLines.push(grantBlock);
          if (summary.grantDiagBlocks.length < MAX_RUN_NOW_SAMPLES) {
            summary.grantDiagBlocks.push(grantBlock);
          }
          summary.granted += 1;
        } else if (!eligible && hasRole) {
          if (revokeDiagSamples < REVOKE_DIAG_MAX) {
            revokeDiagSamples += 1;
            const wPart =
              wCountsForLog != null
                ? JSON.stringify(wCountsForLog)
                : '(no linked erd1 wallet — wallet leg counts as fail)';
            console.warn(
              `[NFT-ROLE-SYNC] revoke_diag rule=${rule.id} user=${userId} walletPass=${walletPass} vaPass=${vaPass} wCounts=${wPart} vaCounts=${JSON.stringify(vaCounts)}`
            );
          }
          await member.roles.remove(role, `NFT role verification (${eligibilityMode})`);
          const revokeBlock = formatNftRuleMemberDiag({
            granted: false,
            userId,
            guildSnowflakeId: guildId,
            discordIdentity,
            eligibilityMode,
            walletFetched: walletMvXRan,
            walletAddress,
            walletPass,
            vaPass,
            walletLegVerified,
            wCounts: wCountsForLog || {},
            vaCounts,
            combinedCounts,
            collectionTickers: tickers,
            matchMode: rule.matchMode,
            minCountPerCollection: rule.minCountPerCollection
          });
          revokedLines.push(revokeBlock);
          if (summary.revokeDiagBlocks.length < MAX_RUN_NOW_SAMPLES) {
            summary.revokeDiagBlocks.push(revokeBlock);
          }
          summary.revoked += 1;
        }

        lastCheckedAt.set(workKey(guildId, userId), Date.now());
        const cycle = scheduledCycleByRule.get(rule.id);
        if (cycle && !cycle.summarySent) {
          cycle.pending.delete(userId);
          cycle.membersChecked += 1;
          if (eligible && !hasRole) cycle.granted += 1;
          else if (!eligible && hasRole) cycle.revoked += 1;
        }
      } catch (e) {
        console.error(`[NFT-ROLE-SYNC] User ${userId} rule ${rule.id}:`, e.message);
        summary.errors += 1;
        ruleErrors += 1;
        const cycleErr = scheduledCycleByRule.get(rule.id);
        if (cycleErr && !cycleErr.summarySent) {
          cycleErr.errors += 1;
        }
      }
    }

    const notifyChannel = await guild.channels.fetch(rule.notificationChannelId).catch(() => null);
    if (notifyChannel && notifyChannel.isTextBased()) {
      const shortId = String(rule.id).slice(0, 8);
      if (grantedLines.length) {
        await sendChunksToChannel(
          notifyChannel,
          `NFT role sync — granted (${shortId}…)`,
          grantedLines,
          EMBED_CHUNKSIZE
        );
      }
      if (revokedLines.length) {
        await sendChunksToChannel(
          notifyChannel,
          `NFT role sync — removed (${shortId}…)`,
          revokedLines,
          EMBED_CHUNKSIZE
        );
      }
      if (scheduled) {
        const cycle = scheduledCycleByRule.get(rule.id);
        if (cycle && !cycle.summarySent && cycle.pending.size === 0) {
          await sendRuleCycleSummary(notifyChannel, rule, cycle, tickers);
        }
      }
    } else if (scheduled) {
      console.warn(
        `[NFT-ROLE-SYNC] Notification channel ${rule.notificationChannelId} unavailable for rule ${rule.id}`
      );
    }

    void ruleErrors;
  }
}

async function completeReadyScheduledCycles(plans) {
  const now = Date.now();
  for (const plan of plans) {
    for (const rule of plan.guildRules) {
      if (plan.candidateIds.size === 0) {
        continue;
      }
      let cycle = scheduledCycleByRule.get(rule.id);
      const dueExists = [...plan.candidateIds].some(uid => {
        const t = lastCheckedAt.get(workKey(plan.guildId, uid)) || 0;
        return t === 0 || now - t >= NFT_ROLE_SYNC_WINDOW_MS;
      });
      if (!cycle) {
        if (!dueExists) {
          continue;
        }
        startRuleCycle(rule.id, plan.candidateIds);
        cycle = scheduledCycleByRule.get(rule.id);
      } else if (cycle.summarySent && dueExists) {
        startRuleCycle(rule.id, plan.candidateIds);
        cycle = scheduledCycleByRule.get(rule.id);
      }
      if (!cycle || cycle.summarySent) {
        continue;
      }
      creditDuePending(cycle, plan.guildId, now);
      if (cycle.pending.size > 0) {
        continue;
      }
      const notifyChannel = await plan.guild.channels.fetch(rule.notificationChannelId).catch(() => null);
      if (notifyChannel && notifyChannel.isTextBased()) {
        await sendRuleCycleSummary(notifyChannel, rule, cycle, rule.collectionTickers || []);
      } else {
        cycle.summarySent = true;
        cycle.completedAt = now;
      }
    }
  }
}

/**
 * @param {import('discord.js').Client} client
 * @param {{ guildId?: string, ruleId?: string, scheduled?: boolean, maxUsers?: number }} [opts]
 */
async function runNftRoleSync(client, opts = {}) {
  const { guildId: filterGuildId, ruleId: filterRuleId, scheduled = false, maxUsers = null } = opts;
  if (syncInFlight) {
    console.log('[NFT-ROLE-SYNC] Skipped: sync already running');
    return { skipped: true };
  }
  syncInFlight = true;
  const summary = emptySummary(filterRuleId);

  try {
    const fetchWalletCollectionCountsCached = createWalletNftCountCache();
    const plans = await buildGuildPlans(client, { guildId: filterGuildId, ruleId: filterRuleId });
    if (plans.length === 0) {
      return summary;
    }
    summary.rules = plans.reduce((n, p) => n + p.guildRules.length, 0);

    const activeKeys = new Set();
    let totalCandidates = 0;
    for (const plan of plans) {
      totalCandidates += plan.candidateIds.size;
      for (const uid of plan.candidateIds) {
        activeKeys.add(workKey(plan.guildId, uid));
      }
    }
    pruneLastChecked(activeKeys);

    const now = Date.now();
    /** @type {Map<string, string[]>} */
    const usersByGuild = new Map();

    if (scheduled) {
      const budget = maxUsers != null ? Math.max(1, maxUsers) : computeScheduledUserBudget(totalCandidates);
      summary.budget = budget;
      const { dueCount, slice } = pickDueUserSlice(plans, budget, now);
      summary.dueUsers = dueCount;
      summary.processedUsers = slice.length;
      for (const item of slice) {
        if (!usersByGuild.has(item.guildId)) usersByGuild.set(item.guildId, []);
        usersByGuild.get(item.guildId).push(item.userId);
      }
      console.log(
        `[NFT-ROLE-SYNC] Scheduled tick due=${dueCount} slice=${slice.length} budget=${budget} candidates=${totalCandidates} guilds=${plans.length}`
      );
    } else {
      for (const plan of plans) {
        usersByGuild.set(plan.guildId, [...plan.candidateIds]);
        summary.processedUsers += plan.candidateIds.size;
      }
    }

    const planByGuild = new Map(plans.map(p => [p.guildId, p]));
    for (const [gid, userIds] of usersByGuild) {
      const plan = planByGuild.get(gid);
      if (!plan || userIds.length === 0) continue;
      await syncUsersInGuild({
        guild: plan.guild,
        guildId: gid,
        guildRules: plan.guildRules,
        walletsMap: plan.walletsMap,
        userIds,
        candidateIds: plan.candidateIds,
        scheduled,
        fetchWalletCollectionCountsCached,
        summary
      });
    }

    if (scheduled) {
      await completeReadyScheduledCycles(plans);
    }
  } finally {
    syncInFlight = false;
  }

  if (summary.walletCheckSkipped > 0) {
    console.warn(
      `[NFT-ROLE-SYNC] Wallet API incomplete for ${summary.walletCheckSkipped} user-rule checks; those members were left unchanged (no revoke on ambiguity).`
    );
  }
  console.log('[NFT-ROLE-SYNC] Done', {
    guilds: summary.guilds,
    rules: summary.rules,
    granted: summary.granted,
    revoked: summary.revoked,
    errors: summary.errors,
    walletCheckSkipped: summary.walletCheckSkipped,
    processedUsers: summary.processedUsers,
    dueUsers: summary.dueUsers,
    budget: summary.budget
  });
  return summary;
}

async function runScheduledNftRoleSync(client) {
  if (syncInFlight) {
    console.log('[NFT-ROLE-SYNC] Scheduled tick skipped: sync already running');
    return;
  }

  console.log('[NFT-ROLE-SYNC] Starting scheduled tick (24h even spread)');
  try {
    await runNftRoleSync(client, { scheduled: true });
  } catch (error) {
    console.error('[NFT-ROLE-SYNC] Scheduled run error:', error.message);
  }
}

/**
 * Automated mode: drip candidate members evenly across 24 hours (10-minute ticks).
 * Manual `/nft-role-verification run-now` still processes the full guild immediately.
 * @param {import('discord.js').Client} client
 */
function scheduleNftRoleVerificationSync(client) {
  setTimeout(() => {
    runScheduledNftRoleSync(client);
  }, NFT_ROLE_SYNC_STARTUP_DELAY_MS);

  setInterval(() => {
    runScheduledNftRoleSync(client);
  }, NFT_ROLE_SYNC_TICK_MS);
}

module.exports = {
  runNftRoleSync,
  fetchWalletCollectionCounts,
  computeScheduledUserBudget,
  scheduleNftRoleVerificationSync,
  NFT_ROLE_SYNC_WINDOW_MS,
  NFT_ROLE_SYNC_TICK_MS
};
