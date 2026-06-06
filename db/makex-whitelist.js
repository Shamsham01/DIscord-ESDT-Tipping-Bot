const { getMakexSupabase, isMakexSupabaseConfigured } = require('../makex-supabase-client');
const supabase = require('../supabase-client');

function buildWhitelistName(guildId, guildName) {
  const safeName = (guildName || 'Unknown').replace(/:/g, '-').slice(0, 200);
  return `TippingBot:${guildId}:${safeName}`;
}

async function getGuildWalletAddresses(guildId) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('wallet_address, project_name')
      .eq('guild_id', guildId);

    if (error) throw error;

    const wallets = [];
    const seen = new Set();
    for (const row of data || []) {
      if (!row.wallet_address || seen.has(row.wallet_address)) continue;
      seen.add(row.wallet_address);
      wallets.push({
        walletAddress: row.wallet_address,
        projectName: row.project_name
      });
    }
    return wallets;
  } catch (error) {
    console.error('[MAKEX-WHITELIST] Error getting guild wallet addresses:', error);
    throw error;
  }
}

async function upsertWalletWhitelist({
  walletAddress,
  guildId,
  guildName,
  whitelistStart,
  whitelistEnd,
  email
}) {
  if (!isMakexSupabaseConfigured()) {
    console.warn('[MAKEX-WHITELIST] MakeX Supabase not configured, skipping upsert');
    return { success: false, skipped: true };
  }

  try {
    const { data, error } = await getMakexSupabase()
      .from('makex_usage_fee_whitelist')
      .upsert({
        wallet_address: walletAddress,
        name: buildWhitelistName(guildId, guildName),
        email: email || null,
        whitelist_start: whitelistStart,
        whitelist_end: whitelistEnd,
        status: 'valid',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'wallet_address'
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error(`[MAKEX-WHITELIST] Error upserting wallet ${walletAddress}:`, error);
    throw error;
  }
}

async function syncGuildWalletsToWhitelist(guildId, guildName, whitelistStart, whitelistEnd) {
  const wallets = await getGuildWalletAddresses(guildId);
  const email = process.env.MAKEX_WHITELIST_CONTACT_EMAIL || null;
  const results = [];

  for (const wallet of wallets) {
    const result = await upsertWalletWhitelist({
      walletAddress: wallet.walletAddress,
      guildId,
      guildName,
      whitelistStart,
      whitelistEnd,
      email
    });
    results.push({ ...wallet, ...result });
  }

  return results;
}

async function expireWalletWhitelist(walletAddress) {
  if (!isMakexSupabaseConfigured()) {
    return { success: false, skipped: true };
  }

  try {
    const { error } = await getMakexSupabase()
      .from('makex_usage_fee_whitelist')
      .update({
        status: 'expired',
        updated_at: new Date().toISOString()
      })
      .eq('wallet_address', walletAddress);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error(`[MAKEX-WHITELIST] Error expiring wallet ${walletAddress}:`, error);
    throw error;
  }
}

async function expireGuildWallets(guildId) {
  const wallets = await getGuildWalletAddresses(guildId);
  const results = [];
  for (const wallet of wallets) {
    results.push(await expireWalletWhitelist(wallet.walletAddress));
  }
  return results;
}

async function hasValidWhitelistForWallets(walletAddresses) {
  if (!walletAddresses.length) return false;
  if (!isMakexSupabaseConfigured()) return false;

  try {
    const now = new Date().toISOString();
    const { data, error } = await getMakexSupabase()
      .from('makex_usage_fee_whitelist')
      .select('wallet_address, whitelist_end, status')
      .in('wallet_address', walletAddresses)
      .eq('status', 'valid')
      .gt('whitelist_end', now)
      .limit(1);

    if (error) throw error;
    return (data || []).length > 0;
  } catch (error) {
    console.error('[MAKEX-WHITELIST] Error checking valid whitelist:', error);
    return false;
  }
}

async function getWhitelistEntriesForGuild(guildId) {
  if (!isMakexSupabaseConfigured()) return [];

  const wallets = await getGuildWalletAddresses(guildId);
  const addresses = wallets.map(w => w.walletAddress);
  if (!addresses.length) return [];

  try {
    const { data, error } = await getMakexSupabase()
      .from('makex_usage_fee_whitelist')
      .select('*')
      .in('wallet_address', addresses);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[MAKEX-WHITELIST] Error getting whitelist entries for guild:', error);
    throw error;
  }
}

module.exports = {
  buildWhitelistName,
  getGuildWalletAddresses,
  upsertWalletWhitelist,
  syncGuildWalletsToWhitelist,
  expireWalletWhitelist,
  expireGuildWallets,
  hasValidWhitelistForWallets,
  getWhitelistEntriesForGuild
};
