const dbOnChainSubscriptions = require('../db/on-chain-subscriptions');
const makexWhitelist = require('../db/makex-whitelist');

async function syncGuildWhitelistIfSubscribed(guildId, guildName) {
  const subscription = await dbOnChainSubscriptions.getSubscription(guildId);
  if (!dbOnChainSubscriptions.isSubscriptionActive(subscription)) {
    return { synced: false, reason: 'no_active_subscription' };
  }

  const results = await makexWhitelist.syncGuildWalletsToWhitelist(
    guildId,
    guildName,
    subscription.subscriptionStart,
    subscription.subscriptionEnd
  );

  return { synced: true, walletCount: results.length, results };
}

module.exports = {
  syncGuildWhitelistIfSubscribed
};
