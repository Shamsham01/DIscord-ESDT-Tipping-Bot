const dbOnChainSubscriptions = require('../db/on-chain-subscriptions');
const makexWhitelist = require('../db/makex-whitelist');

const ON_CHAIN_SUBSCRIPTION_ERROR =
  'This server does not have an active on-chain plan. An administrator must run `/subscribe-on-chain-plan` to enable on-chain transfers (withdrawals, sends, swaps, etc.).';

async function isGuildOnChainPlanActive(guildId) {
  try {
    const subscription = await dbOnChainSubscriptions.getSubscription(guildId);
    if (dbOnChainSubscriptions.isSubscriptionActive(subscription)) {
      return true;
    }

    const wallets = await makexWhitelist.getGuildWalletAddresses(guildId);
    const addresses = wallets.map(w => w.walletAddress);
    if (addresses.length === 0) return false;

    return await makexWhitelist.hasValidWhitelistForWallets(addresses);
  } catch (error) {
    console.error(`[ON-CHAIN-GUARD] Error checking plan for guild ${guildId}:`, error);
    return false;
  }
}

async function assertGuildOnChainPlanActive(guildId) {
  const active = await isGuildOnChainPlanActive(guildId);
  if (!active) {
    throw new Error(ON_CHAIN_SUBSCRIPTION_ERROR);
  }
}

module.exports = {
  ON_CHAIN_SUBSCRIPTION_ERROR,
  isGuildOnChainPlanActive,
  assertGuildOnChainPlanActive
};
