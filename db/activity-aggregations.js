const supabase = require('../supabase-client');

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

// Get all active subscriptions for an activity type
async function getSubscriptions(activityType) {
  try {
    const { data, error } = await supabase
      .from('activity_subscriptions')
      .select('guild_id, channel_id')
      .eq('activity_type', activityType)
      .eq('enabled', true);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      guildId: row.guild_id,
      channelId: row.channel_id
    }));
  } catch (error) {
    console.error('[DB] Error getting subscriptions:', error);
    return [];
  }
}

// Get all subscriptions for a specific guild
async function getGuildSubscriptions(guildId) {
  try {
    const { data, error } = await supabase
      .from('activity_subscriptions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('enabled', true);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      guildId: row.guild_id,
      activityType: row.activity_type,
      channelId: row.channel_id,
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting guild subscriptions:', error);
    return [];
  }
}

// Create new subscription (upsert with enabled=true)
async function createSubscription(guildId, activityType, channelId) {
  try {
    const { error } = await supabase
      .from('activity_subscriptions')
      .upsert({
        guild_id: guildId,
        activity_type: activityType,
        channel_id: channelId,
        enabled: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'guild_id,activity_type,channel_id'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating subscription:', error);
    throw error;
  }
}

// Remove specific subscription (set enabled=false)
async function removeSubscription(guildId, activityType, channelId) {
  try {
    const { error } = await supabase
      .from('activity_subscriptions')
      .update({
        enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('activity_type', activityType)
      .eq('channel_id', channelId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error removing subscription:', error);
    throw error;
  }
}

// Remove all subscriptions for guild and activity type
async function removeAllSubscriptions(guildId, activityType) {
  try {
    const { error } = await supabase
      .from('activity_subscriptions')
      .update({
        enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('activity_type', activityType);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error removing all subscriptions:', error);
    throw error;
  }
}

// Check if subscription exists and is enabled
async function hasSubscription(guildId, activityType, channelId) {
  try {
    const { data, error } = await supabase
      .from('activity_subscriptions')
      .select('id')
      .eq('guild_id', guildId)
      .eq('activity_type', activityType)
      .eq('channel_id', channelId)
      .eq('enabled', true)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  } catch (error) {
    console.error('[DB] Error checking subscription:', error);
    return false;
  }
}

// ============================================
// FORWARDED MESSAGE TRACKING
// ============================================

// Record forwarded message
async function recordForwardedMessage(sourceGuildId, destinationGuildId, activityType, activityId, destinationMessageId, destinationChannelId) {
  try {
    const { error } = await supabase
      .from('forwarded_activity_messages')
      .insert({
        source_guild_id: sourceGuildId,
        destination_guild_id: destinationGuildId,
        activity_type: activityType,
        activity_id: activityId,
        destination_message_id: destinationMessageId,
        destination_channel_id: destinationChannelId
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error recording forwarded message:', error);
    throw error;
  }
}

// Get all forwarded messages for an activity
async function getForwardedMessages(sourceGuildId, activityType, activityId) {
  try {
    const { data, error } = await supabase
      .from('forwarded_activity_messages')
      .select('*')
      .eq('source_guild_id', sourceGuildId)
      .eq('activity_type', activityType)
      .eq('activity_id', activityId);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      sourceGuildId: row.source_guild_id,
      destinationGuildId: row.destination_guild_id,
      activityType: row.activity_type,
      activityId: row.activity_id,
      destinationMessageId: row.destination_message_id,
      destinationChannelId: row.destination_channel_id,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting forwarded messages:', error);
    return [];
  }
}

// Delete forwarded message record
async function deleteForwardedMessage(destinationGuildId, destinationMessageId) {
  try {
    const { error } = await supabase
      .from('forwarded_activity_messages')
      .delete()
      .eq('destination_guild_id', destinationGuildId)
      .eq('destination_message_id', destinationMessageId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error deleting forwarded message:', error);
    throw error;
  }
}

module.exports = {
  getSubscriptions,
  getGuildSubscriptions,
  createSubscription,
  removeSubscription,
  removeAllSubscriptions,
  hasSubscription,
  recordForwardedMessage,
  getForwardedMessages,
  deleteForwardedMessage
};
