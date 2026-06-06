const { getMakexSupabase, isMakexSupabaseConfigured } = require('../makex-supabase-client');
const supabase = require('../supabase-client');

const PENDING_PAYMENT_NAME_PREFIX = 'TippingBot:pending-payment:';

function buildWhitelistName(guildId, guildName) {
  const safeName = (guildName || 'Unknown').replace(/:/g, '-').slice(0, 200);
  return `TippingBot:${guildId}:${safeName}`;
}

function buildPendingPaymentWhitelistName(guildId, guildName) {
  const safeName = (guildName || 'Unknown').replace(/:/g, '-').slice(0, 180);
  return `${PENDING_PAYMENT_NAME_PREFIX}${guildId}:${safeName}`;
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
  email,
  status = 'valid',
  name = null
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
        name: name || buildWhitelistName(guildId, guildName),
        email: email || null,
        whitelist_start: whitelistStart,
        whitelist_end: whitelistEnd,
        status,
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

async function getWhitelistEntriesForAddresses(walletAddresses) {
  if (!walletAddresses.length || !isMakexSupabaseConfigured()) return [];

  try {
    const { data, error } = await getMakexSupabase()
      .from('makex_usage_fee_whitelist')
      .select('*')
      .in('wallet_address', walletAddresses);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[MAKEX-WHITELIST] Error fetching whitelist entries by address:', error);
    throw error;
  }
}

async function captureGuildWhitelistSnapshot(guildId) {
  const wallets = await getGuildWalletAddresses(guildId);
  const addresses = wallets.map(w => w.walletAddress);
  const entries = await getWhitelistEntriesForAddresses(addresses);
  const entryByAddress = new Map(entries.map(e => [e.wallet_address, e]));

  return wallets.map(w => ({
    walletAddress: w.walletAddress,
    projectName: w.projectName,
    previous: entryByAddress.get(w.walletAddress) || null
  }));
}

async function provisionGuildWalletsForPayment(guildId, guildName, whitelistStart, whitelistEnd) {
  if (!isMakexSupabaseConfigured()) {
    throw new Error('MakeX Supabase is not configured. Cannot provision whitelist before subscription payment.');
  }

  const wallets = await getGuildWalletAddresses(guildId);
  const email = process.env.MAKEX_WHITELIST_CONTACT_EMAIL || null;
  const pendingName = buildPendingPaymentWhitelistName(guildId, guildName);
  const results = [];

  for (const wallet of wallets) {
    const result = await upsertWalletWhitelist({
      walletAddress: wallet.walletAddress,
      guildId,
      guildName,
      whitelistStart,
      whitelistEnd,
      email,
      status: 'valid',
      name: pendingName
    });
    results.push({ ...wallet, ...result });
  }

  console.log(`[MAKEX-WHITELIST] Provisionally whitelisted ${results.length} wallet(s) for guild ${guildId} before subscription payment`);
  return results;
}

async function confirmGuildWalletsAfterPayment(guildId, guildName, whitelistStart, whitelistEnd) {
  return syncGuildWalletsToWhitelist(guildId, guildName, whitelistStart, whitelistEnd);
}

async function rollbackGuildWhitelistSnapshot(snapshot) {
  if (!isMakexSupabaseConfigured() || !snapshot?.length) return { rolledBack: 0 };

  let rolledBack = 0;
  for (const item of snapshot) {
    try {
      if (item.previous) {
        await getMakexSupabase()
          .from('makex_usage_fee_whitelist')
          .upsert({
            wallet_address: item.previous.wallet_address,
            name: item.previous.name,
            email: item.previous.email,
            whitelist_start: item.previous.whitelist_start,
            whitelist_end: item.previous.whitelist_end,
            status: item.previous.status,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'wallet_address'
          });
      } else {
        await expireWalletWhitelist(item.walletAddress);
      }
      rolledBack += 1;
    } catch (error) {
      console.error(`[MAKEX-WHITELIST] Rollback failed for ${item.walletAddress}:`, error);
    }
  }

  console.log(`[MAKEX-WHITELIST] Rolled back provisional whitelist for ${rolledBack} wallet(s)`);
  return { rolledBack };
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
  buildPendingPaymentWhitelistName,
  getGuildWalletAddresses,
  upsertWalletWhitelist,
  getWhitelistEntriesForAddresses,
  captureGuildWhitelistSnapshot,
  provisionGuildWalletsForPayment,
  confirmGuildWalletsAfterPayment,
  rollbackGuildWhitelistSnapshot,
  syncGuildWalletsToWhitelist,
  expireWalletWhitelist,
  expireGuildWallets,
  hasValidWhitelistForWallets,
  getWhitelistEntriesForGuild,
  isMakexSupabaseConfigured
};
