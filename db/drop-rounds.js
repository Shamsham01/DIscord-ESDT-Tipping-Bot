const supabase = require('../supabase-client');

// Create a new round
async function createRound(guildId, roundData) {
  try {
    const { error } = await supabase
      .from('drop_rounds')
      .insert({
        round_id: roundData.roundId,
        guild_id: guildId,
        channel_id: roundData.channelId,
        message_id: roundData.messageId || null,
        status: roundData.status || 'LIVE',
        created_at: roundData.createdAt,
        closed_at: roundData.closedAt || null,
        draw_time: roundData.drawTime,
        min_droppers: roundData.minDroppers,
        current_droppers: roundData.currentDroppers || 0,
        winner_id: roundData.winnerId || null,
        winner_tag: roundData.winnerTag || null,
        airdrop_status: roundData.airdropStatus || false,
        week_start: roundData.weekStart,
        week_end: roundData.weekEnd
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating drop round:', error);
    throw error;
  }
}

// Get a round by round ID
async function getRound(guildId, roundId) {
  try {
    const { data, error } = await supabase
      .from('drop_rounds')
      .select('*')
      .eq('guild_id', guildId)
      .eq('round_id', roundId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    return {
      id: data.id,
      roundId: data.round_id,
      guildId: data.guild_id,
      channelId: data.channel_id,
      messageId: data.message_id,
      status: data.status,
      createdAt: data.created_at,
      closedAt: data.closed_at,
      drawTime: data.draw_time,
      minDroppers: data.min_droppers,
      currentDroppers: data.current_droppers || 0,
      winnerId: data.winner_id,
      winnerTag: data.winner_tag,
      airdropStatus: data.airdrop_status || false,
      weekStart: data.week_start,
      weekEnd: data.week_end,
      createdAtTs: data.created_at_ts,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error('[DB] Error getting drop round:', error);
    throw error;
  }
}

// Get active rounds for a guild
async function getActiveRounds(guildId) {
  try {
    const { data, error } = await supabase
      .from('drop_rounds')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'LIVE')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      roundId: row.round_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      status: row.status,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      drawTime: row.draw_time,
      minDroppers: row.min_droppers,
      currentDroppers: row.current_droppers || 0,
      winnerId: row.winner_id,
      winnerTag: row.winner_tag,
      airdropStatus: row.airdrop_status || false,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      createdAtTs: row.created_at_ts,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting active rounds:', error);
    throw error;
  }
}

// Get all active rounds across all guilds (for timer processing)
async function getAllActiveRounds() {
  try {
    const { data, error } = await supabase
      .from('drop_rounds')
      .select('*')
      .eq('status', 'LIVE')
      .order('draw_time', { ascending: true });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      roundId: row.round_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      status: row.status,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      drawTime: row.draw_time,
      minDroppers: row.min_droppers,
      currentDroppers: row.current_droppers || 0,
      winnerId: row.winner_id,
      winnerTag: row.winner_tag,
      airdropStatus: row.airdrop_status || false,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      createdAtTs: row.created_at_ts,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting all active rounds:', error);
    throw error;
  }
}

// Get rounds for a specific week
async function getRoundsForWeek(guildId, weekStart, weekEnd) {
  try {
    const { data, error } = await supabase
      .from('drop_rounds')
      .select('*')
      .eq('guild_id', guildId)
      .eq('week_start', weekStart)
      .eq('week_end', weekEnd)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      roundId: row.round_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      status: row.status,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      drawTime: row.draw_time,
      minDroppers: row.min_droppers,
      currentDroppers: row.current_droppers || 0,
      winnerId: row.winner_id,
      winnerTag: row.winner_tag,
      airdropStatus: row.airdrop_status || false,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      createdAtTs: row.created_at_ts,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting rounds for week:', error);
    throw error;
  }
}

// Update round
async function updateRound(guildId, roundId, roundData) {
  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (roundData.channelId !== undefined) updateData.channel_id = roundData.channelId;
    if (roundData.messageId !== undefined) updateData.message_id = roundData.messageId;
    if (roundData.status !== undefined) updateData.status = roundData.status;
    if (roundData.closedAt !== undefined) updateData.closed_at = roundData.closedAt;
    if (roundData.drawTime !== undefined) updateData.draw_time = roundData.drawTime;
    if (roundData.minDroppers !== undefined) updateData.min_droppers = roundData.minDroppers;
    if (roundData.currentDroppers !== undefined) updateData.current_droppers = roundData.currentDroppers;
    if (roundData.winnerId !== undefined) updateData.winner_id = roundData.winnerId;
    if (roundData.winnerTag !== undefined) updateData.winner_tag = roundData.winnerTag;
    if (roundData.airdropStatus !== undefined) updateData.airdrop_status = roundData.airdropStatus;
    if (roundData.weekStart !== undefined) updateData.week_start = roundData.weekStart;
    if (roundData.weekEnd !== undefined) updateData.week_end = roundData.weekEnd;
    
    const { error } = await supabase
      .from('drop_rounds')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('round_id', roundId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating drop round:', error);
    throw error;
  }
}

// Add participant to a round
async function addParticipant(guildId, roundId, participantData) {
  try {
    const { error } = await supabase
      .from('drop_participants')
      .insert({
        round_id: roundId,
        guild_id: guildId,
        user_id: participantData.userId,
        user_tag: participantData.userTag || null,
        entered_at: participantData.enteredAt
      });
    
    if (error) {
      // If duplicate entry, that's okay - user already entered
      if (error.code === '23505') {
        return { success: false, alreadyEntered: true };
      }
      throw error;
    }
    
    return { success: true };
  } catch (error) {
    console.error('[DB] Error adding drop participant:', error);
    throw error;
  }
}

// Get participants for a round
async function getParticipants(guildId, roundId) {
  try {
    const { data, error } = await supabase
      .from('drop_participants')
      .select('*')
      .eq('guild_id', guildId)
      .eq('round_id', roundId)
      .order('entered_at', { ascending: true });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      roundId: row.round_id,
      guildId: row.guild_id,
      userId: row.user_id,
      userTag: row.user_tag,
      enteredAt: row.entered_at,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting drop participants:', error);
    throw error;
  }
}

// Get participant count for a round
async function getParticipantCount(guildId, roundId) {
  try {
    const { count, error } = await supabase
      .from('drop_participants')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('round_id', roundId);
    
    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('[DB] Error getting participant count:', error);
    throw error;
  }
}

// Delete all participants for a round (cleanup after round closes)
async function deleteParticipantsForRound(guildId, roundId) {
  try {
    const { error } = await supabase
      .from('drop_participants')
      .delete()
      .eq('guild_id', guildId)
      .eq('round_id', roundId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error deleting participants for round:', error);
    throw error;
  }
}

// Get weekly leaderboard
async function getWeeklyLeaderboard(guildId, weekStart, weekEnd) {
  try {
    const { data, error } = await supabase
      .from('drop_leaderboard')
      .select('*')
      .eq('guild_id', guildId)
      .eq('week_start', weekStart)
      .eq('week_end', weekEnd)
      .order('points', { ascending: false })
      .order('wins', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      userTag: row.user_tag,
      points: row.points || 0,
      wins: row.wins || 0,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      airdropStatus: row.airdrop_status || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting weekly leaderboard:', error);
    throw error;
  }
}

// Update leaderboard entry (create if doesn't exist)
async function updateLeaderboardEntry(guildId, userId, userTag, weekStart, weekEnd, updateData) {
  try {
    // First check if entry exists
    const { data: existing, error: checkError } = await supabase
      .from('drop_leaderboard')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .eq('week_end', weekEnd)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') throw checkError;
    
    const updateFields = {
      updated_at: new Date().toISOString()
    };
    
    if (updateData.points !== undefined) {
      updateFields.points = existing ? (existing.points || 0) + updateData.points : updateData.points;
    }
    if (updateData.wins !== undefined) {
      updateFields.wins = existing ? (existing.wins || 0) + updateData.wins : updateData.wins;
    }
    if (updateData.airdropStatus !== undefined) {
      updateFields.airdrop_status = updateData.airdropStatus;
    }
    if (userTag !== undefined) {
      updateFields.user_tag = userTag;
    }
    
    if (existing) {
      // Update existing entry
      const { error } = await supabase
        .from('drop_leaderboard')
        .update(updateFields)
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .eq('week_end', weekEnd);
      
      if (error) throw error;
    } else {
      // Create new entry
      const { error } = await supabase
        .from('drop_leaderboard')
        .insert({
          guild_id: guildId,
          user_id: userId,
          user_tag: userTag,
          points: updateFields.points || 0,
          wins: updateFields.wins || 0,
          week_start: weekStart,
          week_end: weekEnd,
          airdrop_status: updateFields.airdrop_status || false
        });
      
      if (error) throw error;
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error updating leaderboard entry:', error);
    throw error;
  }
}

// Get leaderboard entries ready for airdrop (previous week, not yet distributed)
async function getLeaderboardForAirdrop(guildId) {
  try {
    const now = Date.now();
    
    // Get entries where week_end <= now AND airdrop_status = false
    const { data, error } = await supabase
      .from('drop_leaderboard')
      .select('*')
      .eq('guild_id', guildId)
      .eq('airdrop_status', false)
      .lte('week_end', now)
      .order('points', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      userTag: row.user_tag,
      points: row.points || 0,
      wins: row.wins || 0,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      airdropStatus: row.airdrop_status || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting leaderboard for airdrop:', error);
    throw error;
  }
}

// Get all-time leaderboard (sum of all points across all weeks)
async function getAllTimeLeaderboard(guildId) {
  try {
    const { data, error } = await supabase
      .from('drop_leaderboard')
      .select('user_id, user_tag, points')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    // Aggregate points by user
    const userTotals = {};
    (data || []).forEach(row => {
      const userId = row.user_id;
      if (!userTotals[userId]) {
        userTotals[userId] = {
          userId,
          userTag: row.user_tag,
          totalPoints: 0
        };
      }
      userTotals[userId].totalPoints += (row.points || 0);
    });
    
    // Convert to array and sort by total points
    return Object.values(userTotals)
      .sort((a, b) => b.totalPoints - a.totalPoints);
  } catch (error) {
    console.error('[DB] Error getting all-time leaderboard:', error);
    throw error;
  }
}

module.exports = {
  createRound,
  getRound,
  getActiveRounds,
  getAllActiveRounds,
  getRoundsForWeek,
  updateRound,
  addParticipant,
  getParticipants,
  getParticipantCount,
  deleteParticipantsForRound,
  getWeeklyLeaderboard,
  updateLeaderboardEntry,
  getLeaderboardForAirdrop,
  getAllTimeLeaderboard
};
