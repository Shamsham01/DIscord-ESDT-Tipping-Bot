/**
 * Human-readable NFT role verification diagnostics for Discord notifications.
 */

const { countAtTickerIc } = require('./nft-role-rule-evaluator');

/**
 * Strip backticks so usernames/newlines can't break fenced-style embed lines.
 */
function safePlain(s) {
  return String(s ?? '')
    .replace(/`/g, "'")
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Plaintext line admins can correlate even when @mentions do not resolve in the client.
 * @param {{ userId: string, username?: string|null, globalName?: string|null, nickname?: string|null }} identity
 */
function formatDiscordWhoLine(identity) {
  if (!identity?.userId) {
    return '**Who:** _(unknown Discord user)_';
  }
  const un = identity.username != null ? safePlain(identity.username) : 'unknown-handle';
  const gn =
    identity.globalName && identity.globalName !== identity.username ? safePlain(identity.globalName) : '';
  let main = gn ? `${gn} (login \`${safePlain(un)}\`)` : `login \`${un}\``;
  if (identity.nickname) {
    const nick = safePlain(identity.nickname);
    if (nick && nick !== un && nick !== gn) {
      main += ` · nick _${nick}_`;
    }
  }
  return `**Who:** ${main} · ID \`${identity.userId}\``;
}

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
      const n = countAtTickerIc(countsByCollection, t);
      const ok = n >= min;
      return `\`${String(t)}\` ${ok ? '✅' : '❌'} ${n}`;
    })
    .join(' · ');
}

/**
 * @param {{ granted: boolean, userId: string, guildSnowflakeId?: string|null, discordIdentity?: { userId: string, username?: string|null, globalName?: string|null, nickname?: string|null }|null, walletAddress?: string|null, walletPass: boolean, vaPass: boolean, walletLegVerified?: boolean, wCounts: Record<string, number>|null|undefined, vaCounts: Record<string, number>|null|undefined, collectionTickers: string[], matchMode: string, minCountPerCollection: number|string }} opts
 * @returns {string} Multiline plaintext (one revoke/grant diagnostic block).
 */
function formatNftRuleMemberDiag(opts) {
  const {
    granted,
    userId,
    guildSnowflakeId,
    discordIdentity,
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

  const identityLine = `${formatDiscordWhoLine({
    userId,
    username: discordIdentity?.username ?? null,
    globalName: discordIdentity?.globalName ?? null,
    nickname: discordIdentity?.nickname ?? null
  })}${_guildFootnote(guildSnowflakeId)}`;

  const mentionLine = `<@${userId}> — role **${granted ? 'granted' : 'removed'}** · match **${mode}** · min **${min}** per collection · both Wallet + VA legs must qualify`;

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

  return [identityLine, mentionLine, walletSection, vaSection].join('\n');
}

/** @param {string|null|undefined} guildId */
function _guildFootnote(guildId) {
  if (!guildId) return '';
  return `\n└ _Member resolved in guild \`${guildId}\`; candidates come from wallets/VA scoped to this server._`;
}

/**
 * @param {import('discord.js').GuildMember|null|undefined} member
 * @returns {{ userId: string, username: string, globalName: string|null, nickname: string|null }|null}
 */
function discordIdentityFromMember(member) {
  if (!member?.user?.id) {
    return null;
  }
  const u = member.user;
  return {
    userId: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    nickname: member.nickname ?? null
  };
}

module.exports = {
  formatCollectionMarks,
  formatDiscordWhoLine,
  formatNftRuleMemberDiag,
  safePlain,
  discordIdentityFromMember
};
