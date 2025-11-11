const supabase = require('../supabase-client');

async function getUserStats(guildId, userId) {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    return {
      points: data.points || 0,
      wins: data.wins || 0,
      totalEarningsWei: data.total_earnings_wei || '0',
      totalBetsWei: data.total_bets_wei || '0',
      pnlWei: data.pnl_wei || '0',
      lastWinISO: data.last_win_iso ? new Date(data.last_win_iso).toISOString() : null,
      tokenEarnings: data.token_earnings || {},
      tokenBets: data.token_bets || {},
      tokenPNL: data.token_pnl || {},
      isHouse: data.is_house || false
    };
  } catch (error) {
    console.error('[DB] Error getting user stats:', error);
    throw error;
  }
}

async function getLeaderboard(guildId) {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .eq('guild_id', guildId)
      .order('points', { ascending: false });
    
    if (error) throw error;
    
    const leaderboard = {};
    (data || []).forEach(row => {
      leaderboard[row.user_id] = {
        points: row.points || 0,
        wins: row.wins || 0,
        totalEarningsWei: row.total_earnings_wei || '0',
        totalBetsWei: row.total_bets_wei || '0',
        pnlWei: row.pnl_wei || '0',
        lastWinISO: row.last_win_iso ? new Date(row.last_win_iso).toISOString() : null,
        tokenEarnings: row.token_earnings || {},
        tokenBets: row.token_bets || {},
        tokenPNL: row.token_pnl || {},
        isHouse: row.is_house || false
      };
    });
    return leaderboard;
  } catch (error) {
    console.error('[DB] Error getting leaderboard:', error);
    throw error;
  }
}

async function updateLeaderboardEntry(guildId, userId, stats) {
  try {
    const updateData = {
      guild_id: guildId,
      user_id: userId,
      updated_at: new Date().toISOString()
    };
    
    if (stats.points !== undefined) updateData.points = stats.points;
    if (stats.wins !== undefined) updateData.wins = stats.wins;
    if (stats.totalEarningsWei !== undefined) updateData.total_earnings_wei = stats.totalEarningsWei;
    if (stats.totalBetsWei !== undefined) updateData.total_bets_wei = stats.totalBetsWei;
    if (stats.pnlWei !== undefined) updateData.pnl_wei = stats.pnlWei;
    if (stats.lastWinISO !== undefined) {
      updateData.last_win_iso = stats.lastWinISO ? new Date(stats.lastWinISO).toISOString() : null;
    }
    if (stats.tokenEarnings !== undefined) updateData.token_earnings = stats.tokenEarnings;
    if (stats.tokenBets !== undefined) updateData.token_bets = stats.tokenBets;
    if (stats.tokenPNL !== undefined) updateData.token_pnl = stats.tokenPNL;
    if (stats.isHouse !== undefined) updateData.is_house = stats.isHouse;
    
    const { error } = await supabase
      .from('leaderboard')
      .upsert(updateData, {
        onConflict: 'guild_id,user_id'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating leaderboard entry:', error);
    throw error;
  }
}

async function deleteAllLeaderboardEntries(guildId) {
  try {
    const { error } = await supabase
      .from('leaderboard')
      .delete()
      .eq('guild_id', guildId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error deleting all leaderboard entries:', error);
    throw error;
  }
}

module.exports = {
  getUserStats,
  getLeaderboard,
  updateLeaderboardEntry,
  deleteAllLeaderboardEntries
};

