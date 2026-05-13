const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const fetch = require('node-fetch');
const dbServerData = require('../db/server-data');
const dbNftRoleRules = require('../db/nft-role-verification');
const dbVirtualAccountsNft = require('../db/virtual-accounts-nft');
const { evaluateRuleAgainstCounts } = require('../utils/nft-role-rule-evaluator');
const { formatNftRuleMemberDiag } = require('../utils/nft-role-verification-diagnostics');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** MultiversX public API: pace NFT wallet checks (~1 req / 1.5s) — too many MvX hits also starves other bot features sharing the quota. */
const MVX_ACCOUNT_COLLECTION_MIN_INTERVAL_MS = 1500;
/** Do not sleep longer than this on 429 Retry-After (header often sends 60s; we still retry). */
const MVX_MAX_RETRY_AFTER_MS = 30000;
let nextMvxSlot = 0;

async function waitMvxSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextMvxSlot - now);
  if (wait > 0) {
    await sleep(wait);
  }
  nextMvxSlot = Date.now() + MVX_ACCOUNT_COLLECTION_MIN_INTERVAL_MS;
}

/**
 * Wallet leg: count on-chain NFT/SFT per collection using one paginated stream:
 * GET /accounts/{address}/nfts?collections=t1,t2,... (matches explorer-style holdings; fewer MvX calls than per-collection /collections/{t}).
 * On unrecoverable error returns walletLegVerified:false — caller must NOT revoke roles (unknown state).
 * @returns {Promise<{ counts: Record<string, number>, walletLegVerified: boolean }>}
 */
async function fetchWalletCollectionCounts(walletAddress, collectionTickers) {
  const tickers = [...new Set((collectionTickers || []).filter(Boolean))];
  const counts = {};
  tickers.forEach(t => {
    counts[t] = 0;
  });
  if (tickers.length === 0) {
    return { counts, walletLegVerified: true };
  }

  const collectionsQuery = tickers.map(t => encodeURIComponent(t)).join(',');
  const pageSize = 100;
  const maxPages = 100;
  let from = 0;

  for (let page = 0; page < maxPages; page++) {
    await waitMvxSlot();
    const url = `https://api.multiversx.com/accounts/${encodeURIComponent(walletAddress)}/nfts?collections=${collectionsQuery}&from=${from}&size=${pageSize}`;

    let items = null;
    let pageOk = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          timeout: 20000
        });

        if (response.status === 429 || response.status >= 500) {
          const retryAfterSec = parseInt(response.headers.get('retry-after') || '0', 10);
          const fromHeader =
            retryAfterSec > 0 ? Math.min(retryAfterSec * 1000, MVX_MAX_RETRY_AFTER_MS) : 0;
          const backoff = Math.max(
            fromHeader,
            MVX_ACCOUNT_COLLECTION_MIN_INTERVAL_MS * (attempt + 1),
            2000
          );
          console.warn(
            `[NFT-ROLE-SYNC] MvX HTTP ${response.status} nfts page from=${from}, waiting ${backoff}ms (${attempt}/5)`
          );
          await sleep(backoff);
          await waitMvxSlot();
          continue;
        }

        if (!response.ok) {
          console.warn(`[NFT-ROLE-SYNC] MvX nfts HTTP ${response.status} for wallet (from=${from})`);
          return { counts, walletLegVerified: false };
        }

        const responseData = await response.json();
        items = Array.isArray(responseData) ? responseData : responseData.data || [];
        if (!Array.isArray(items)) {
          console.warn('[NFT-ROLE-SYNC] MvX nfts unexpected JSON shape');
          return { counts, walletLegVerified: false };
        }
        pageOk = true;
        break;
      } catch (err) {
        console.warn(`[NFT-ROLE-SYNC] MvX nfts fetch error:`, err.message);
        if (attempt === 5) {
          return { counts, walletLegVerified: false };
        }
        await sleep(1000 * attempt);
        await waitMvxSlot();
      }
    }

    if (!pageOk) {
      return { counts, walletLegVerified: false };
    }

    const tickerSet = new Set(tickers);
    for (const item of items) {
      const c = item.collection;
      if (!c || !tickerSet.has(c)) {
        continue;
      }
      const type = item.type || '';
      let add = 1;
      if (type === 'SemiFungibleESDT' || type === 'MetaESDT') {
        const bal = parseInt(String(item.balance ?? item.value ?? 1), 10);
        add = Number.isFinite(bal) && bal > 0 ? bal : 1;
      }
      counts[c] += add;
    }

    if (items.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return { counts, walletLegVerified: true };
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

let syncInFlight = false;

/**
 * @param {import('discord.js').Client} client
 * @param {{ guildId?: string }} [opts]
 */
async function runNftRoleSync(client, opts = {}) {
  const { guildId: filterGuildId } = opts;
  if (syncInFlight) {
    console.log('[NFT-ROLE-SYNC] Skipped: sync already running');
    return { skipped: true };
  }
  syncInFlight = true;
  const summary = {
    guilds: 0,
    rules: 0,
    granted: 0,
    revoked: 0,
    errors: 0,
    walletCheckSkipped: 0,
    /** @type {string[]} Sample diagnostic blocks for /run-now ephemeral embed */
    grantDiagBlocks: [],
    /** @type {string[]} Sample diagnostic blocks for /run-now ephemeral embed */
    revokeDiagBlocks: []
  };

  const MAX_RUN_NOW_SAMPLES = 8;
  /** Each notification entry is multi-line — keep chunks small */
  const EMBED_CHUNKSIZE = 4;

  try {
    let rules = await dbNftRoleRules.listEnabledRulesGlobally();
    if (filterGuildId) {
      rules = rules.filter(r => r.guildId === filterGuildId);
    }
    summary.rules = rules.length;
    if (rules.length === 0) {
      return summary;
    }

    const byGuild = new Map();
    for (const r of rules) {
      if (!byGuild.has(r.guildId)) {
        byGuild.set(r.guildId, []);
      }
      byGuild.get(r.guildId).push(r);
    }

    for (const [gid, guildRules] of byGuild) {
      const guild = client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
      if (!guild) {
        console.warn(`[NFT-ROLE-SYNC] Guild not found: ${gid}`);
        continue;
      }
      summary.guilds += 1;

      const walletsMap = await dbServerData.getUserWallets(gid);
      const walletUserIds = Object.keys(walletsMap || {});
      const vaUserIds = await dbVirtualAccountsNft.getDistinctUserIdsWithNftBalances(gid);

      for (const rule of guildRules) {
        const candidateIds = new Set([...walletUserIds, ...vaUserIds]);
        let role = null;
        try {
          role = await guild.roles.fetch(rule.discordRoleId).catch(() => null);
          if (role) {
            role.members.forEach(m => candidateIds.add(m.user.id));
          }
        } catch (_) {
          /* ignore */
        }

        if (!role) {
          console.warn(`[NFT-ROLE-SYNC] Role ${rule.discordRoleId} not in guild ${gid}`);
          summary.errors += 1;
          continue;
        }
        if (!canBotManageRole(guild, role)) {
          console.warn(`[NFT-ROLE-SYNC] Bot cannot manage role ${rule.discordRoleId} in ${gid}`);
          summary.errors += 1;
          continue;
        }

        const grantedLines = [];
        const revokedLines = [];
        const tickers = rule.collectionTickers || [];
        let revokeDiagSamples = 0;
        const REVOKE_DIAG_MAX = 8;

        for (const userId of candidateIds) {
          try {
            const member = await guild.members.fetch({ user: userId, force: false }).catch(() => null);
            if (!member || member.user.bot) {
              continue;
            }

            const walletAddress = walletsMap[userId];
            let walletPass = false;
            let skipRoleChange = false;
            let wCountsForLog = null;

            if (walletAddress && typeof walletAddress === 'string' && walletAddress.startsWith('erd1')) {
              const { counts: wCounts, walletLegVerified } = await fetchWalletCollectionCounts(
                walletAddress,
                tickers
              );
              wCountsForLog = wCounts;
              if (!walletLegVerified) {
                // Rate limit / API error: do not grant AND do not revoke (would wrongly strip valid holders)
                skipRoleChange = true;
                summary.walletCheckSkipped += 1;
              } else {
                walletPass = evaluateRuleAgainstCounts(
                  wCounts,
                  tickers,
                  rule.matchMode,
                  rule.minCountPerCollection
                );
              }
            }

            if (skipRoleChange) {
              continue;
            }

            const vaCounts = await dbVirtualAccountsNft.countEligibleVirtualInventoryForRoleRule(
              gid,
              userId,
              tickers
            );
            const vaPass = evaluateRuleAgainstCounts(
              vaCounts,
              tickers,
              rule.matchMode,
              rule.minCountPerCollection
            );

            const eligible = walletPass && vaPass;
            const hasRole = member.roles.cache.has(rule.discordRoleId);

            if (eligible && !hasRole) {
              await member.roles.add(role, 'NFT role verification (wallet + VA)');
              const grantBlock = formatNftRuleMemberDiag({
                granted: true,
                userId,
                walletAddress,
                walletPass: true,
                vaPass: true,
                walletLegVerified: true,
                wCounts: wCountsForLog || {},
                vaCounts,
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
              await member.roles.remove(role, 'NFT role verification (wallet + VA)');
              const revokeBlock = formatNftRuleMemberDiag({
                granted: false,
                userId,
                walletAddress,
                walletPass,
                vaPass,
                walletLegVerified: true,
                wCounts: wCountsForLog || {},
                vaCounts,
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
          } catch (e) {
            console.error(`[NFT-ROLE-SYNC] User ${userId} rule ${rule.id}:`, e.message);
            summary.errors += 1;
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
        }
      }
    }
  } finally {
    syncInFlight = false;
  }

  if (summary.walletCheckSkipped > 0) {
    console.warn(
      `[NFT-ROLE-SYNC] Wallet API incomplete for ${summary.walletCheckSkipped} user-rule checks; those members were left unchanged (no revoke on ambiguity).`
    );
  }
  console.log('[NFT-ROLE-SYNC] Done', summary);
  return summary;
}

module.exports = {
  runNftRoleSync,
  fetchWalletCollectionCounts
};
