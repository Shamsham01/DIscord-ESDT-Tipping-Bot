const dbOnChainSubscriptions = require('../db/on-chain-subscriptions');
const makexWhitelist = require('../db/makex-whitelist');

async function sendExpiryReminders(client) {
  const subscriptions = await dbOnChainSubscriptions.getSubscriptionsNeedingExpiryReminder();

  for (const sub of subscriptions) {
    try {
      const user = await client.users.fetch(sub.subscribedByDiscordId);
      const endDate = new Date(sub.subscriptionEnd).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      });

      await user.send(
        `Your server's **on-chain plan** expires on **${endDate}** (in about 7 days).\n\n` +
        `Renew with \`/subscribe-on-chain-plan\` in your Discord server to keep on-chain transfers, withdrawals, and MakeX API fee waivers active.`
      );

      await dbOnChainSubscriptions.markExpiryReminderSent(sub.guildId);
      console.log(`[ON-CHAIN-SUB] Sent expiry reminder to ${sub.subscribedByDiscordId} for guild ${sub.guildId}`);
    } catch (error) {
      console.error(`[ON-CHAIN-SUB] Failed to send expiry reminder for guild ${sub.guildId}:`, error.message);
    }
  }
}

async function processExpiredSubscriptions() {
  const expired = await dbOnChainSubscriptions.getExpiredSubscriptions();

  for (const sub of expired) {
    try {
      await makexWhitelist.expireGuildWallets(sub.guildId);
      await dbOnChainSubscriptions.disableSubscription(sub.guildId);
      console.log(`[ON-CHAIN-SUB] Expired subscription processed for guild ${sub.guildId}`);
    } catch (error) {
      console.error(`[ON-CHAIN-SUB] Error processing expired subscription for guild ${sub.guildId}:`, error.message);
    }
  }
}

async function runOnChainSubscriptionMaintenance(client) {
  await sendExpiryReminders(client);
  await processExpiredSubscriptions();
}

module.exports = {
  sendExpiryReminders,
  processExpiredSubscriptions,
  runOnChainSubscriptionMaintenance
};
