const supabase = require('../supabase-client');

// Match functions
async function getMatch(matchId) {
  try {
    const { data: matchData, error: matchError } = await supabase
      .from('football_matches')
      .select('*')
      .eq('match_id', matchId)
      .single();
    
    if (matchError && matchError.code !== 'PGRST116') throw matchError;
    if (!matchData) return null;
    
    // Get guild relationships for this match (including guild-specific config)
    const { data: guildData, error: guildError } = await supabase
      .from('match_guilds')
      .select('guild_id, message_id, thread_id, house_earnings_tracked, required_amount_wei, token_data')
      .eq('match_id', matchId);
    
    if (guildError) throw guildError;
    
    // Build embeds, guildIds, and per-guild configuration from guild relationships
    const guildIds = [];
    const embeds = {};
    const houseEarningsTrackedByGuild = {};
    const tokenByGuild = {};
    const requiredAmountWeiByGuild = {};
    
    (guildData || []).forEach(row => {
      guildIds.push(row.guild_id);
      embeds[row.guild_id] = {
        messageId: row.message_id,
        threadId: row.thread_id
      };
      houseEarningsTrackedByGuild[row.guild_id] = row.house_earnings_tracked || false;
      
      // Store per-guild configuration (REQUIRED - no fallback)
      if (!row.token_data || !row.required_amount_wei) {
        console.warn(`[DB] Match ${matchId} guild ${row.guild_id} missing token_data or required_amount_wei`);
      }
      
      if (row.token_data) {
        tokenByGuild[row.guild_id] = row.token_data;
      }
      
      if (row.required_amount_wei) {
        requiredAmountWeiByGuild[row.guild_id] = row.required_amount_wei;
      }
    });
    
    return {
      matchId: matchData.match_id,
      compCode: matchData.comp_code,
      compName: matchData.comp_name,
      home: matchData.home_team,
      away: matchData.away_team,
      kickoffISO: matchData.kickoff_iso,
      tokenByGuild: tokenByGuild, // Per-guild token configuration (REQUIRED)
      requiredAmountWeiByGuild: requiredAmountWeiByGuild, // Per-guild stake configuration (REQUIRED)
      status: matchData.status,
      ftScore: matchData.ft_score,
      houseEarningsTrackedByGuild: houseEarningsTrackedByGuild,
      guildIds: guildIds,
      embeds: embeds
    };
  } catch (error) {
    console.error('[DB] Error getting match:', error);
    throw error;
  }
}

async function getMatchesByGuild(guildId) {
  try {
    // First, get all match-guild relationships for this guild (including guild-specific config)
    const { data: guildRelations, error: guildError } = await supabase
      .from('match_guilds')
      .select('match_id, message_id, thread_id, house_earnings_tracked, required_amount_wei, token_data')
      .eq('guild_id', guildId);
    
    if (guildError) throw guildError;
    
    if (!guildRelations || guildRelations.length === 0) {
      return {};
    }
    
    // Get all unique match IDs
    const matchIds = [...new Set(guildRelations.map(r => r.match_id))];
    
    // Fetch all matches for these match IDs
    const { data: matchesData, error: matchesError } = await supabase
      .from('football_matches')
      .select('*')
      .in('match_id', matchIds);
    
    if (matchesError) throw matchesError;
    
    // Build matches object with guild relationships and per-guild configuration
    const matches = {};
    (matchesData || []).forEach(match => {
      if (!matches[match.match_id]) {
        matches[match.match_id] = {
          matchId: match.match_id,
          compCode: match.comp_code,
          compName: match.comp_name,
          home: match.home_team,
          away: match.away_team,
          kickoffISO: match.kickoff_iso,
          status: match.status,
          ftScore: match.ft_score,
          guildIds: [],
          embeds: {},
          houseEarningsTracked: false
        };
      }
      
      // Add guild relationship for this match
      const guildRelation = guildRelations.find(r => r.match_id === match.match_id);
      if (guildRelation) {
        matches[match.match_id].guildIds.push(guildId);
        matches[match.match_id].embeds[guildId] = {
          messageId: guildRelation.message_id,
          threadId: guildRelation.thread_id
        };
        // Set house earnings tracked for this specific guild
        matches[match.match_id].houseEarningsTracked = guildRelation.house_earnings_tracked || false;
        
        // Use guild-specific token and stake (REQUIRED - no fallback)
        if (!guildRelation.token_data || !guildRelation.required_amount_wei) {
          console.warn(`[DB] Match ${match.match_id} guild ${guildId} missing token_data or required_amount_wei`);
        }
        
        if (guildRelation.token_data) {
          matches[match.match_id].token = guildRelation.token_data;
        }
        if (guildRelation.required_amount_wei) {
          matches[match.match_id].requiredAmountWei = guildRelation.required_amount_wei;
        }
      }
    });
    
    return matches;
  } catch (error) {
    console.error('[DB] Error getting matches by guild:', error);
    throw error;
  }
}

async function getScheduledMatches() {
  try {
    const { data, error } = await supabase
      .from('football_matches')
      .select('*')
      .in('status', ['SCHEDULED', 'TIMED', 'IN_PLAY'])
      .order('kickoff_iso', { ascending: true });
    
    if (error) throw error;
    
    // Return only shared match data (no token/stake - those are in match_guilds)
    return (data || []).map(row => ({
      matchId: row.match_id,
      compCode: row.comp_code,
      compName: row.comp_name,
      home: row.home_team,
      away: row.away_team,
      kickoffISO: row.kickoff_iso,
      status: row.status,
      ftScore: row.ft_score
    }));
  } catch (error) {
    console.error('[DB] Error getting scheduled matches:', error);
    throw error;
  }
}

async function createMatch(matchData) {
  try {
    // Create match with shared data only (no guild-specific config)
    const { error: matchError } = await supabase
      .from('football_matches')
      .upsert({
        match_id: matchData.matchId,
        comp_code: matchData.compCode,
        comp_name: matchData.compName,
        home_team: matchData.home,
        away_team: matchData.away,
        kickoff_iso: matchData.kickoffISO,
        status: matchData.status || 'SCHEDULED',
        ft_score: matchData.ftScore || { home: 0, away: 0 }
      }, {
        onConflict: 'match_id'
      });
    
    if (matchError) throw matchError;
    
    // Handle guild relationships with per-guild configuration
    // Token and stake are REQUIRED for each guild
    if (matchData.guildIds && matchData.guildIds.length > 0) {
      if (!matchData.requiredAmountWei || !matchData.token) {
        throw new Error('requiredAmountWei and token are required when creating match with guilds');
      }
      
      const guildInserts = matchData.guildIds.map(guildId => ({
        match_id: matchData.matchId,
        guild_id: guildId,
        message_id: matchData.embeds?.[guildId]?.messageId || null,
        thread_id: matchData.embeds?.[guildId]?.threadId || null,
        // Store guild-specific configuration (stake and token) - REQUIRED
        required_amount_wei: matchData.requiredAmountWei,
        token_data: matchData.token
      }));
      
      const { error: guildError } = await supabase
        .from('match_guilds')
        .upsert(guildInserts, {
          onConflict: 'match_id,guild_id'
        });
      
      if (guildError) throw guildError;
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error creating match:', error);
    throw error;
  }
}

async function updateMatch(matchId, matchData) {
  try {
    const updateData = {};
    
    // Only update shared match data (not guild-specific config like token/stake)
    if (matchData.compCode !== undefined) updateData.comp_code = matchData.compCode;
    if (matchData.compName !== undefined) updateData.comp_name = matchData.compName;
    if (matchData.home !== undefined) updateData.home_team = matchData.home;
    if (matchData.away !== undefined) updateData.away_team = matchData.away;
    if (matchData.kickoffISO !== undefined) updateData.kickoff_iso = matchData.kickoffISO;
    // DO NOT update token_data or required_amount_wei here - they are now per-guild in match_guilds
    if (matchData.status !== undefined) updateData.status = matchData.status;
    if (matchData.ftScore !== undefined) updateData.ft_score = matchData.ftScore;
    
    updateData.updated_at = new Date().toISOString();
    
    const { error } = await supabase
      .from('football_matches')
      .update(updateData)
      .eq('match_id', matchId);
    
    if (error) throw error;
    
    // Update guild relationships if provided (preserve existing guild-specific config)
    // Only update the guilds that are in matchData.embeds (the ones being added/updated)
    if (matchData.embeds) {
      for (const guildId of Object.keys(matchData.embeds)) {
        // Get existing guild config to preserve it
        const { data: existingGuild } = await supabase
          .from('match_guilds')
          .select('required_amount_wei, token_data')
          .eq('match_id', matchId)
          .eq('guild_id', guildId)
          .single();
        
        // Preserve existing config if updating, or use new config if creating
        const guildUpdateData = {
          match_id: matchId,
          guild_id: guildId,
          message_id: matchData.embeds[guildId]?.messageId || null,
          thread_id: matchData.embeds[guildId]?.threadId || null
        };
        
        // Only update config if this is a new guild (no existing config), otherwise preserve existing
        if (!existingGuild) {
          // New guild being added - REQUIRED config must be provided
          if (!matchData.requiredAmountWei || !matchData.token) {
            throw new Error(`Cannot add guild ${guildId} to match ${matchId}: requiredAmountWei and token are required`);
          }
          guildUpdateData.required_amount_wei = matchData.requiredAmountWei;
          guildUpdateData.token_data = matchData.token;
        } else {
          // Existing guild - preserve existing config (REQUIRED fields)
          guildUpdateData.required_amount_wei = existingGuild.required_amount_wei;
          guildUpdateData.token_data = existingGuild.token_data;
        }
        
        const { error: guildError } = await supabase
          .from('match_guilds')
          .upsert(guildUpdateData, {
            onConflict: 'match_id,guild_id'
          });
        
        if (guildError) throw guildError;
      }
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error updating match:', error);
    throw error;
  }
}

// Bet functions
async function createBet(betData) {
  try {
    const { error } = await supabase
      .from('football_bets')
      .insert({
        bet_id: betData.betId,
        guild_id: betData.guildId,
        match_id: betData.matchId,
        user_id: betData.userId,
        outcome: betData.outcome,
        token_data: betData.tokenData,
        amount_wei: betData.amountWei,
        tx_hash: betData.txHash,
        created_at_iso: betData.createdAtISO,
        status: betData.status || 'ACCEPTED'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating bet:', error);
    throw error;
  }
}

async function getBetsByMatch(guildId, matchId) {
  try {
    const { data, error } = await supabase
      .from('football_bets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('match_id', matchId);
    
    if (error) throw error;
    
    const bets = {};
    (data || []).forEach(row => {
      bets[row.bet_id] = {
        betId: row.bet_id,
        guildId: row.guild_id,
        matchId: row.match_id,
        userId: row.user_id,
        outcome: row.outcome,
        tokenData: row.token_data,
        amountWei: row.amount_wei,
        txHash: row.tx_hash,
        createdAtISO: row.created_at_iso,
        status: row.status,
        prizeSent: row.prize_sent || false,
        prizeAmount: row.prize_amount || null,
        prizeSentAt: row.prize_sent_at || null
      };
    });
    return bets;
  } catch (error) {
    console.error('[DB] Error getting bets by match:', error);
    throw error;
  }
}

async function getBetsByUser(guildId, userId) {
  try {
    const { data, error } = await supabase
      .from('football_bets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (error) throw error;
    
    const bets = {};
    (data || []).forEach(row => {
      bets[row.bet_id] = {
        betId: row.bet_id,
        guildId: row.guild_id,
        matchId: row.match_id,
        userId: row.user_id,
        outcome: row.outcome,
        tokenData: row.token_data,
        amountWei: row.amount_wei,
        txHash: row.tx_hash,
        createdAtISO: row.created_at_iso,
        status: row.status,
        prizeSent: row.prize_sent || false,
        prizeAmount: row.prize_amount || null,
        prizeSentAt: row.prize_sent_at || null
      };
    });
    return bets;
  } catch (error) {
    console.error('[DB] Error getting bets by user:', error);
    throw error;
  }
}

async function updateBetPrize(betId, guildId, prizeAmount) {
  try {
    const { error } = await supabase
      .from('football_bets')
      .update({
        prize_sent: true,
        prize_amount: prizeAmount,
        prize_sent_at: new Date().toISOString()
      })
      .eq('bet_id', betId)
      .eq('guild_id', guildId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating bet prize:', error);
    throw error;
  }
}

async function updateMatchGuildHouseEarnings(matchId, guildId, houseEarningsTracked) {
  try {
    const { error } = await supabase
      .from('match_guilds')
      .update({
        house_earnings_tracked: houseEarningsTracked
      })
      .eq('match_id', matchId)
      .eq('guild_id', guildId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating match-guild house earnings:', error);
    throw error;
  }
}

module.exports = {
  getMatch,
  getMatchesByGuild,
  getScheduledMatches,
  createMatch,
  updateMatch,
  createBet,
  getBetsByMatch,
  getBetsByUser,
  updateBetPrize,
  updateMatchGuildHouseEarnings
};

