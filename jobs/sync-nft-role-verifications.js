const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const dbServerData = require('../db/server-data');
const dbNftRoleRules = require('../db/nft-role-verification');
const dbVirtualAccountsNft = require('../db/virtual-accounts-nft');
const { getUserNFTCount } = require('../utils/drop-helpers');
const { evaluateRuleAgainstCounts } = require('../utils/nft-role-rule-evaluator');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch on-chain collection counts for a wallet. Any failed API response fails the whole wallet leg.
 * @returns {Promise<{ counts: Record<string, number>, walletLegOk: boolean }>}
 */
async function fetchWalletCollectionCounts(walletAddress, collectionTickers, delayMs = 120) {
  const tickers = [...new Set((collectionTickers || []).filter(Boolean))];
  const counts = {};
  let walletLegOk = true;
  for (const c of tickers) {
    try {
      const r = await getUserNFTCount(walletAddress, c);
      if (r.success) {
        counts[c] = r.count;
      } else {
        counts[c] = 0;
        walletLegOk = false;
      }
    } catch (e) {
      console.error(`[NFT-ROLE-SYNC] Wallet count error ${walletAddress} ${c}:`, e.message);
      counts[c] = 0;
      walletLegOk = false;
    }
    await sleep(delayMs);
  }
  return { counts, walletLegOk };
}

function chunkLines(lines, maxPerChunk = 12) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += maxPerChunk) {
    chunks.push(lines.slice(i, i + maxPerChunk));
  }
  return chunks.length ? chunks : [[]];
}

async function sendChunksToChannel(channel, title, lines) {
  if (!channel || lines.length === 0) {
    return;
  }
  const chunks = chunkLines(lines, 12);
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
 * @param {{ guildId?: string, force?: boolean }} [opts]
 */
async function runNftRoleSync(client, opts = {}) {
  const { guildId: filterGuildId } = opts;
  if (syncInFlight) {
    console.log('[NFT-ROLE-SYNC] Skipped: sync already running');
    return { skipped: true };
  }
  syncInFlight = true;
  const summary = { guilds: 0, rules: 0, granted: 0, revoked: 0, errors: 0 };

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

        for (const userId of candidateIds) {
          try {
            const member = await guild.members.fetch({ user: userId, force: false }).catch(() => null);
            if (!member || member.user.bot) {
              continue;
            }

            const walletAddress = walletsMap[userId];
            let walletPass = false;
            if (walletAddress && typeof walletAddress === 'string' && walletAddress.startsWith('erd1')) {
              const { counts: wCounts, walletLegOk } = await fetchWalletCollectionCounts(walletAddress, tickers);
              walletPass =
                walletLegOk &&
                evaluateRuleAgainstCounts(wCounts, tickers, rule.matchMode, rule.minCountPerCollection);
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
              grantedLines.push(`<@${userId}> — role granted`);
              summary.granted += 1;
            } else if (!eligible && hasRole) {
              await member.roles.remove(role, 'NFT role verification (wallet + VA)');
              revokedLines.push(`<@${userId}> — role removed`);
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
              grantedLines
            );
          }
          if (revokedLines.length) {
            await sendChunksToChannel(
              notifyChannel,
              `NFT role sync — removed (${shortId}…)`,
              revokedLines
            );
          }
        }
      }
    }
  } finally {
    syncInFlight = false;
  }

  console.log('[NFT-ROLE-SYNC] Done', summary);
  return summary;
}

module.exports = {
  runNftRoleSync,
  fetchWalletCollectionCounts
};
