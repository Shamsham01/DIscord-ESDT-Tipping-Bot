const supabase = require('../supabase-client');
const { coerceEligibilityMode } = require('../utils/nft-role-eligibility-mode');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    discordRoleId: row.discord_role_id,
    notificationChannelId: row.notification_channel_id,
    collectionTickers: row.collection_tickers || [],
    matchMode: row.match_mode,
    minCountPerCollection: row.min_count_per_collection,
    eligibilityMode: coerceEligibilityMode(row.eligibility_mode),
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createRule(guildId, fields) {
  const eligibilityMode = coerceEligibilityMode(fields.eligibilityMode);
  const { data, error } = await supabase
    .from('guild_nft_role_rules')
    .insert({
      guild_id: guildId,
      discord_role_id: fields.discordRoleId,
      notification_channel_id: fields.notificationChannelId,
      collection_tickers: fields.collectionTickers,
      match_mode: fields.matchMode,
      min_count_per_collection: fields.minCountPerCollection,
      eligibility_mode: eligibilityMode,
      enabled: fields.enabled !== false
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

async function getRuleById(guildId, ruleId) {
  const { data, error } = await supabase
    .from('guild_nft_role_rules')
    .select('*')
    .eq('guild_id', guildId)
    .eq('id', ruleId)
    .maybeSingle();
  if (error) throw error;
  return mapRow(data);
}

async function listRulesForGuild(guildId, { enabledOnly = false } = {}) {
  let q = supabase
    .from('guild_nft_role_rules')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false });
  if (enabledOnly) {
    q = q.eq('enabled', true);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapRow);
}

async function listEnabledRulesGlobally() {
  const { data, error } = await supabase
    .from('guild_nft_role_rules')
    .select('*')
    .eq('enabled', true);
  if (error) throw error;
  return (data || []).map(mapRow);
}

async function setRuleEnabled(guildId, ruleId, enabled) {
  const { data, error } = await supabase
    .from('guild_nft_role_rules')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('id', ruleId)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

async function setRuleEligibilityMode(guildId, ruleId, eligibilityMode) {
  const mode = coerceEligibilityMode(eligibilityMode);
  const { data, error } = await supabase
    .from('guild_nft_role_rules')
    .update({ eligibility_mode: mode, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('id', ruleId)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

async function deleteRule(guildId, ruleId) {
  const { error } = await supabase
    .from('guild_nft_role_rules')
    .delete()
    .eq('guild_id', guildId)
    .eq('id', ruleId);
  if (error) throw error;
  return true;
}

module.exports = {
  createRule,
  getRuleById,
  listRulesForGuild,
  listEnabledRulesGlobally,
  setRuleEnabled,
  setRuleEligibilityMode,
  deleteRule
};
