const supabase = require('../supabase-client');

function mapRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    subscribedByDiscordId: row.subscribed_by_discord_id,
    planMonths: row.plan_months,
    amountUsdc: row.amount_usdc,
    subscriptionStart: row.subscription_start,
    subscriptionEnd: row.subscription_end,
    enabled: row.enabled,
    lastPaymentTxHash: row.last_payment_tx_hash,
    expiryReminderSentAt: row.expiry_reminder_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getSubscription(guildId) {
  try {
    const { data, error } = await supabase
      .from('guild_on_chain_subscriptions')
      .select('*')
      .eq('guild_id', guildId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return mapRow(data);
  } catch (error) {
    console.error('[DB] Error getting on-chain subscription:', error);
    throw error;
  }
}

async function upsertSubscription({
  guildId,
  subscribedByDiscordId,
  planMonths,
  amountUsdc,
  subscriptionStart,
  subscriptionEnd,
  lastPaymentTxHash
}) {
  try {
    const { data, error } = await supabase
      .from('guild_on_chain_subscriptions')
      .upsert({
        guild_id: guildId,
        subscribed_by_discord_id: subscribedByDiscordId,
        plan_months: planMonths,
        amount_usdc: amountUsdc,
        subscription_start: subscriptionStart,
        subscription_end: subscriptionEnd,
        enabled: true,
        last_payment_tx_hash: lastPaymentTxHash || null,
        expiry_reminder_sent_at: null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'guild_id'
      })
      .select()
      .single();

    if (error) throw error;
    return mapRow(data);
  } catch (error) {
    console.error('[DB] Error upserting on-chain subscription:', error);
    throw error;
  }
}

async function markExpiryReminderSent(guildId) {
  try {
    const { error } = await supabase
      .from('guild_on_chain_subscriptions')
      .update({
        expiry_reminder_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error marking expiry reminder sent:', error);
    throw error;
  }
}

async function getSubscriptionsNeedingExpiryReminder() {
  try {
    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const inEightDays = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('guild_on_chain_subscriptions')
      .select('*')
      .eq('enabled', true)
      .is('expiry_reminder_sent_at', null)
      .gte('subscription_end', inSevenDays.toISOString())
      .lt('subscription_end', inEightDays.toISOString());

    if (error) throw error;
    return (data || []).map(mapRow);
  } catch (error) {
    console.error('[DB] Error getting subscriptions needing expiry reminder:', error);
    throw error;
  }
}

async function getExpiredSubscriptions() {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('guild_on_chain_subscriptions')
      .select('*')
      .eq('enabled', true)
      .lt('subscription_end', now);

    if (error) throw error;
    return (data || []).map(mapRow);
  } catch (error) {
    console.error('[DB] Error getting expired subscriptions:', error);
    throw error;
  }
}

async function disableSubscription(guildId) {
  try {
    const { error } = await supabase
      .from('guild_on_chain_subscriptions')
      .update({
        enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error disabling on-chain subscription:', error);
    throw error;
  }
}

function isSubscriptionActive(subscription) {
  if (!subscription || !subscription.enabled) return false;
  return new Date(subscription.subscriptionEnd).getTime() > Date.now();
}

module.exports = {
  getSubscription,
  upsertSubscription,
  markExpiryReminderSent,
  getSubscriptionsNeedingExpiryReminder,
  getExpiredSubscriptions,
  disableSubscription,
  isSubscriptionActive
};
