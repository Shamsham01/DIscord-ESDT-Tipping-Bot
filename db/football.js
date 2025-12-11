const supabase = require('../supabase-client');

// Get a single match by matchId
async function getMatch(matchId) {
  try {
    const { data: matchData, error: matchError } = await supabase
      .from('football_matches')
      .select('*')
      .eq('match_id', matchId)
      .single();
    
    if (matchError && matchError.code !== 'PGRST116') throw matchError;
    if (!matchData) return null;
    
    // Get all guild relationships for this match
    const { data: guildRelations, error: guildError } = await supabase
      .from('match_guilds')
      .select('*')
      .eq('match_id', matchId);
    
    if (guildError) throw guildError;
    
    // Build embeds object from guild relationships
    const embeds = {};
    const guildIds = [];
    const tokenByGuild = {};
    const requiredAmountWeiByGuild = {};
    const bonusPotWeiByGuild = {};
    const houseEarningsTrackedByGuild = {};
    
    if (guildRelations) {
      for (const rel of guildRelations) {
        guildIds.push(rel.guild_id);
        embeds[rel.guild_id] = {
          messageId: rel.message_id || null,
          threadId: rel.thread_id || null
        };
        // Populate per-guild token and stake from match_guilds table
        // (token_data and required_amount_wei are now stored per-guild in match_guilds)
        if (rel.token_data) {
          tokenByGuild[rel.guild_id] = rel.token_data;
        }
        if (rel.required_amount_wei) {
          requiredAmountWeiByGuild[rel.guild_id] = rel.required_amount_wei;
        }
        bonusPotWeiByGuild[rel.guild_id] = rel.bonus_pot_wei || '0';
        houseEarningsTrackedByGuild[rel.guild_id] = rel.house_earnings_tracked || false;
      }
    }
    
    // Get a default token/amount from the first guild if available (for backward compatibility)
    const firstGuildRel = guildRelations && guildRelations.length > 0 ? guildRelations[0] : null;
    const defaultToken = firstGuildRel?.token_data || null;
    const defaultRequiredAmountWei = firstGuildRel?.required_amount_wei || null;
    
    return {
      matchId: matchData.match_id,
      compCode: matchData.comp_code,
      compName: matchData.comp_name,
      home: matchData.home_team,
      away: matchData.away_team,
      kickoffISO: matchData.kickoff_iso,
      token: defaultToken, // For backward compatibility
      requiredAmountWei: defaultRequiredAmountWei, // For backward compatibility
      tokenByGuild: tokenByGuild,
      requiredAmountWeiByGuild: requiredAmountWeiByGuild,
      bonusPotWeiByGuild: bonusPotWeiByGuild,
      status: matchData.status,
      ftScore: matchData.ft_score || { home: 0, away: 0 },
      houseEarningsTracked: firstGuildRel?.house_earnings_tracked || false, // For backward compatibility
      houseEarningsTrackedByGuild: houseEarningsTrackedByGuild, // Per-guild tracking
      guildIds: guildIds,
      embeds: embeds,
      createdAt: matchData.created_at,
      updatedAt: matchData.updated_at
    };
  } catch (error) {
    console.error('[DB] Error getting match:', error);
    throw error;
  }
}

// Get all matches for a specific guild
async function getMatchesByGuild(guildId) {
  try {
    const { data: guildRelations, error: guildError } = await supabase
      .from('match_guilds')
      .select('match_id')
      .eq('guild_id', guildId);
    
    if (guildError) throw guildError;
    if (!guildRelations || guildRelations.length === 0) return {};
    
    const matchIds = guildRelations.map(rel => rel.match_id);
    
    const { data: matchesData, error: matchesError } = await supabase
      .from('football_matches')
      .select('*')
      .in('match_id', matchIds);
    
    if (matchesError) throw matchesError;
    
    const result = {};
    
    for (const matchData of matchesData || []) {
      // Get guild relationships for this match
      const { data: rels } = await supabase
        .from('match_guilds')
        .select('*')
        .eq('match_id', matchData.match_id);
      
      const embeds = {};
      const guildIds = [];
      const tokenByGuild = {};
      const requiredAmountWeiByGuild = {};
      const bonusPotWeiByGuild = {};
      const houseEarningsTrackedByGuild = {};
      
      if (rels) {
        for (const rel of rels) {
          guildIds.push(rel.guild_id);
          embeds[rel.guild_id] = {
            messageId: rel.message_id || null,
            threadId: rel.thread_id || null
          };
          // Populate per-guild token and stake from match_guilds table
          if (rel.token_data) {
            tokenByGuild[rel.guild_id] = rel.token_data;
          }
          if (rel.required_amount_wei) {
            requiredAmountWeiByGuild[rel.guild_id] = rel.required_amount_wei;
          }
          bonusPotWeiByGuild[rel.guild_id] = rel.bonus_pot_wei || '0';
          houseEarningsTrackedByGuild[rel.guild_id] = rel.house_earnings_tracked || false;
        }
      }
      
      // Get default token/amount from the first guild if available (for backward compatibility)
      const firstGuildRel = rels && rels.length > 0 ? rels[0] : null;
      const defaultToken = firstGuildRel?.token_data || null;
      const defaultRequiredAmountWei = firstGuildRel?.required_amount_wei || null;
      
      result[matchData.match_id] = {
        matchId: matchData.match_id,
        compCode: matchData.comp_code,
        compName: matchData.comp_name,
        home: matchData.home_team,
        away: matchData.away_team,
        kickoffISO: matchData.kickoff_iso,
        token: defaultToken, // For backward compatibility
        requiredAmountWei: defaultRequiredAmountWei, // For backward compatibility
        tokenByGuild: tokenByGuild,
        requiredAmountWeiByGuild: requiredAmountWeiByGuild,
        bonusPotWeiByGuild: bonusPotWeiByGuild,
        status: matchData.status,
        ftScore: matchData.ft_score || { home: 0, away: 0 },
        houseEarningsTracked: firstGuildRel?.house_earnings_tracked || false, // For backward compatibility
        houseEarningsTrackedByGuild: houseEarningsTrackedByGuild, // Per-guild tracking
        guildIds: guildIds,
        embeds: embeds,
        createdAt: matchData.created_at,
        updatedAt: matchData.updated_at
      };
    }
    
    return result;
  } catch (error) {
    console.error('[DB] Error getting matches by guild:', error);
    throw error;
  }
}

// Get all scheduled matches (status = 'SCHEDULED' or 'TIMED')
async function getScheduledMatches() {
  try {
    const { data, error } = await supabase
      .from('football_matches')
      .select('*')
      .in('status', ['SCHEDULED', 'TIMED']);
    
    if (error) throw error;
    
    const matches = [];
    
    for (const matchData of data || []) {
      // Get guild relationships
      const { data: rels } = await supabase
        .from('match_guilds')
        .select('*')
        .eq('match_id', matchData.match_id);
      
      const embeds = {};
      const guildIds = [];
      const tokenByGuild = {};
      const requiredAmountWeiByGuild = {};
      const bonusPotWeiByGuild = {};
      const houseEarningsTrackedByGuild = {};
      
      if (rels) {
        for (const rel of rels) {
          guildIds.push(rel.guild_id);
          embeds[rel.guild_id] = {
            messageId: rel.message_id || null,
            threadId: rel.thread_id || null
          };
          // Populate per-guild token and stake from match_guilds table
          if (rel.token_data) {
            tokenByGuild[rel.guild_id] = rel.token_data;
          }
          if (rel.required_amount_wei) {
            requiredAmountWeiByGuild[rel.guild_id] = rel.required_amount_wei;
          }
          bonusPotWeiByGuild[rel.guild_id] = rel.bonus_pot_wei || '0';
          houseEarningsTrackedByGuild[rel.guild_id] = rel.house_earnings_tracked || false;
        }
      }
      
      // Get default token/amount from the first guild if available (for backward compatibility)
      const firstGuildRel = rels && rels.length > 0 ? rels[0] : null;
      const defaultToken = firstGuildRel?.token_data || null;
      const defaultRequiredAmountWei = firstGuildRel?.required_amount_wei || null;
      
      matches.push({
        matchId: matchData.match_id,
        compCode: matchData.comp_code,
        compName: matchData.comp_name,
        home: matchData.home_team,
        away: matchData.away_team,
        kickoffISO: matchData.kickoff_iso,
        token: defaultToken, // For backward compatibility
        requiredAmountWei: defaultRequiredAmountWei, // For backward compatibility
        tokenByGuild: tokenByGuild,
        requiredAmountWeiByGuild: requiredAmountWeiByGuild,
        bonusPotWeiByGuild: bonusPotWeiByGuild,
        status: matchData.status,
        ftScore: matchData.ft_score || { home: 0, away: 0 },
        houseEarningsTracked: firstGuildRel?.house_earnings_tracked || false, // For backward compatibility
        houseEarningsTrackedByGuild: houseEarningsTrackedByGuild, // Per-guild tracking
        guildIds: guildIds,
        embeds: embeds,
        createdAt: matchData.created_at,
        updatedAt: matchData.updated_at
      });
    }
    
    return matches;
  } catch (error) {
    console.error('[DB] Error getting scheduled matches:', error);
    throw error;
  }
}

// Get all paused matches (status = 'PAUSED')
async function getPausedMatches() {
  try {
    const { data, error } = await supabase
      .from('football_matches')
      .select('*')
      .eq('status', 'PAUSED');
    
    if (error) throw error;
    
    const matches = [];
    
    for (const matchData of data || []) {
      // Get guild relationships
      const { data: rels } = await supabase
        .from('match_guilds')
        .select('*')
        .eq('match_id', matchData.match_id);
      
      const embeds = {};
      const guildIds = [];
      const tokenByGuild = {};
      const requiredAmountWeiByGuild = {};
      const bonusPotWeiByGuild = {};
      const houseEarningsTrackedByGuild = {};
      
      if (rels) {
        for (const rel of rels) {
          guildIds.push(rel.guild_id);
          embeds[rel.guild_id] = {
            messageId: rel.message_id || null,
            threadId: rel.thread_id || null
          };
          // Populate per-guild token and stake from match_guilds table
          if (rel.token_data) {
            tokenByGuild[rel.guild_id] = rel.token_data;
          }
          if (rel.required_amount_wei) {
            requiredAmountWeiByGuild[rel.guild_id] = rel.required_amount_wei;
          }
          bonusPotWeiByGuild[rel.guild_id] = rel.bonus_pot_wei || '0';
          houseEarningsTrackedByGuild[rel.guild_id] = rel.house_earnings_tracked || false;
        }
      }
      
      // Get default token/amount from the first guild if available (for backward compatibility)
      const firstGuildRel = rels && rels.length > 0 ? rels[0] : null;
      const defaultToken = firstGuildRel?.token_data || null;
      const defaultRequiredAmountWei = firstGuildRel?.required_amount_wei || null;
      
      matches.push({
        matchId: matchData.match_id,
        compCode: matchData.comp_code,
        compName: matchData.comp_name,
        home: matchData.home_team,
        away: matchData.away_team,
        kickoffISO: matchData.kickoff_iso,
        token: defaultToken, // For backward compatibility
        requiredAmountWei: defaultRequiredAmountWei, // For backward compatibility
        tokenByGuild: tokenByGuild,
        requiredAmountWeiByGuild: requiredAmountWeiByGuild,
        bonusPotWeiByGuild: bonusPotWeiByGuild,
        status: matchData.status,
        ftScore: matchData.ft_score || { home: 0, away: 0 },
        houseEarningsTracked: firstGuildRel?.house_earnings_tracked || false, // For backward compatibility
        houseEarningsTrackedByGuild: houseEarningsTrackedByGuild, // Per-guild tracking
        guildIds: guildIds,
        embeds: embeds,
        createdAt: matchData.created_at,
        updatedAt: matchData.updated_at
      });
    }
    
    return matches;
  } catch (error) {
    console.error('[DB] Error getting paused matches:', error);
    throw error;
  }
}

// Get all in-play matches (status = 'IN_PLAY')
async function getInPlayMatches() {
  try {
    const { data, error } = await supabase
      .from('football_matches')
      .select('*')
      .eq('status', 'IN_PLAY');
    
    if (error) throw error;
    
    const matches = [];
    
    for (const matchData of data || []) {
      // Get guild relationships
      const { data: rels } = await supabase
        .from('match_guilds')
        .select('*')
        .eq('match_id', matchData.match_id);
      
      const embeds = {};
      const guildIds = [];
      const tokenByGuild = {};
      const requiredAmountWeiByGuild = {};
      const bonusPotWeiByGuild = {};
      const houseEarningsTrackedByGuild = {};
      
      if (rels) {
        for (const rel of rels) {
          guildIds.push(rel.guild_id);
          embeds[rel.guild_id] = {
            messageId: rel.message_id || null,
            threadId: rel.thread_id || null
          };
          // Populate per-guild token and stake from match_guilds table
          if (rel.token_data) {
            tokenByGuild[rel.guild_id] = rel.token_data;
          }
          if (rel.required_amount_wei) {
            requiredAmountWeiByGuild[rel.guild_id] = rel.required_amount_wei;
          }
          bonusPotWeiByGuild[rel.guild_id] = rel.bonus_pot_wei || '0';
          houseEarningsTrackedByGuild[rel.guild_id] = rel.house_earnings_tracked || false;
        }
      }
      
      // Get default token/amount from the first guild if available (for backward compatibility)
      const firstGuildRel = rels && rels.length > 0 ? rels[0] : null;
      const defaultToken = firstGuildRel?.token_data || null;
      const defaultRequiredAmountWei = firstGuildRel?.required_amount_wei || null;
      
      matches.push({
        matchId: matchData.match_id,
        compCode: matchData.comp_code,
        compName: matchData.comp_name,
        home: matchData.home_team,
        away: matchData.away_team,
        kickoffISO: matchData.kickoff_iso,
        token: defaultToken, // For backward compatibility
        requiredAmountWei: defaultRequiredAmountWei, // For backward compatibility
        tokenByGuild: tokenByGuild,
        requiredAmountWeiByGuild: requiredAmountWeiByGuild,
        bonusPotWeiByGuild: bonusPotWeiByGuild,
        status: matchData.status,
        ftScore: matchData.ft_score || { home: 0, away: 0 },
        houseEarningsTracked: firstGuildRel?.house_earnings_tracked || false, // For backward compatibility
        houseEarningsTrackedByGuild: houseEarningsTrackedByGuild, // Per-guild tracking
        guildIds: guildIds,
        embeds: embeds,
        createdAt: matchData.created_at,
        updatedAt: matchData.updated_at
      });
    }
    
    return matches;
  } catch (error) {
    console.error('[DB] Error getting in-play matches:', error);
    throw error;
  }
}

// Create a new match
async function createMatch(matchData) {
  try {
    // Insert match (without token_data and required_amount_wei - those are per-guild now)
    const { error: matchError } = await supabase
      .from('football_matches')
      .insert({
        match_id: matchData.matchId,
        comp_code: matchData.compCode,
        comp_name: matchData.compName,
        home_team: matchData.home,
        away_team: matchData.away,
        kickoff_iso: matchData.kickoffISO,
        status: matchData.status || 'SCHEDULED',
        ft_score: matchData.ftScore || { home: 0, away: 0 }
      });
    
    if (matchError) throw matchError;
    
    // Create guild relationships with per-guild token and stake configuration
    if (matchData.guildIds && matchData.guildIds.length > 0) {
      const guildInserts = matchData.guildIds.map(guildId => ({
        match_id: matchData.matchId,
        guild_id: guildId,
        message_id: matchData.embeds && matchData.embeds[guildId] ? matchData.embeds[guildId].messageId : null,
        thread_id: matchData.embeds && matchData.embeds[guildId] ? matchData.embeds[guildId].threadId : null,
        token_data: matchData.token, // Per-guild token configuration
        required_amount_wei: matchData.requiredAmountWei, // Per-guild stake configuration
        bonus_pot_wei: '0' // Initialize bonus pot
      }));
      
      const { error: guildError } = await supabase
        .from('match_guilds')
        .insert(guildInserts);
      
      if (guildError) throw guildError;
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error creating match:', error);
    throw error;
  }
}

// Update a match
async function updateMatch(matchId, updates) {
  try {
    const updateData = {};
    
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.ftScore !== undefined) updateData.ft_score = updates.ftScore;
    if (updates.houseEarningsTracked !== undefined) updateData.house_earnings_tracked = updates.houseEarningsTracked;
    
    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = new Date().toISOString();
      
      const { error } = await supabase
        .from('football_matches')
        .update(updateData)
        .eq('match_id', matchId);
      
      if (error) throw error;
    }
    
    // Update guild relationships if embeds are provided
    if (updates.embeds) {
      for (const [guildId, embedData] of Object.entries(updates.embeds)) {
        // First, check if the match_guilds relationship already exists
        const { data: existingRel, error: fetchError } = await supabase
          .from('match_guilds')
          .select('required_amount_wei, token_data, bonus_pot_wei, house_earnings_tracked')
          .eq('match_id', matchId)
          .eq('guild_id', guildId)
          .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
        
        // Prepare upsert data - preserve existing values if they exist, otherwise use provided values
        const upsertData = {
          match_id: matchId,
          guild_id: guildId,
          message_id: embedData.messageId || null,
          thread_id: embedData.threadId || null
        };
        
        // Preserve existing required_amount_wei and token_data if they exist
        // Otherwise use values from updates (for new guild relationships)
        if (existingRel) {
          // Guild relationship exists - preserve existing values
          upsertData.required_amount_wei = existingRel.required_amount_wei;
          upsertData.token_data = existingRel.token_data;
          upsertData.bonus_pot_wei = existingRel.bonus_pot_wei || '0';
          upsertData.house_earnings_tracked = existingRel.house_earnings_tracked || false;
        } else {
          // New guild relationship - use provided values or defaults
          if (updates.requiredAmountWei !== undefined) {
            upsertData.required_amount_wei = updates.requiredAmountWei;
          } else if (updates.token && updates.requiredAmountWei !== undefined) {
            // Fallback: try to get from updates
            upsertData.required_amount_wei = updates.requiredAmountWei;
          } else {
            throw new Error(`Cannot create new match_guilds relationship for guild ${guildId}: required_amount_wei is required`);
          }
          
          if (updates.token) {
            upsertData.token_data = updates.token;
          } else {
            throw new Error(`Cannot create new match_guilds relationship for guild ${guildId}: token_data is required`);
          }
          
          upsertData.bonus_pot_wei = '0';
          upsertData.house_earnings_tracked = false;
        }
        
        const { error: relError } = await supabase
          .from('match_guilds')
          .upsert(upsertData, {
            onConflict: 'match_id,guild_id'
          });
        
        if (relError) throw relError;
      }
    }
    
    // Add new guild relationships if guildIds are provided
    if (updates.guildIds) {
      for (const guildId of updates.guildIds) {
        // First, check if the match_guilds relationship already exists
        const { data: existingRel, error: fetchError } = await supabase
          .from('match_guilds')
          .select('required_amount_wei, token_data, bonus_pot_wei, house_earnings_tracked')
          .eq('match_id', matchId)
          .eq('guild_id', guildId)
          .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
        
        // Prepare upsert data - preserve existing values if they exist, otherwise use provided values
        const upsertData = {
          match_id: matchId,
          guild_id: guildId,
          message_id: updates.embeds && updates.embeds[guildId] ? updates.embeds[guildId].messageId : null,
          thread_id: updates.embeds && updates.embeds[guildId] ? updates.embeds[guildId].threadId : null
        };
        
        // Preserve existing required_amount_wei and token_data if they exist
        // Otherwise use values from updates (for new guild relationships)
        if (existingRel) {
          // Guild relationship exists - preserve existing values
          upsertData.required_amount_wei = existingRel.required_amount_wei;
          upsertData.token_data = existingRel.token_data;
          upsertData.bonus_pot_wei = existingRel.bonus_pot_wei || '0';
          upsertData.house_earnings_tracked = existingRel.house_earnings_tracked || false;
        } else {
          // New guild relationship - use provided values or defaults
          if (updates.requiredAmountWei !== undefined) {
            upsertData.required_amount_wei = updates.requiredAmountWei;
          } else {
            throw new Error(`Cannot create new match_guilds relationship for guild ${guildId}: required_amount_wei is required`);
          }
          
          if (updates.token) {
            upsertData.token_data = updates.token;
          } else {
            throw new Error(`Cannot create new match_guilds relationship for guild ${guildId}: token_data is required`);
          }
          
          upsertData.bonus_pot_wei = '0';
          upsertData.house_earnings_tracked = false;
        }
        
        const { error: relError } = await supabase
          .from('match_guilds')
          .upsert(upsertData, {
            onConflict: 'match_id,guild_id'
          });
        
        if (relError) throw relError;
      }
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error updating match:', error);
    throw error;
  }
}

// Create a bet
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
        token_data: betData.token,
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

// Get bets for a specific match
async function getBetsByMatch(guildId, matchId) {
  try {
    const { data, error } = await supabase
      .from('football_bets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('match_id', matchId)
      .eq('status', 'ACCEPTED');
    
    if (error) throw error;
    
    return (data || []).map(bet => ({
      betId: bet.bet_id,
      guildId: bet.guild_id,
      matchId: bet.match_id,
      userId: bet.user_id,
      outcome: bet.outcome,
      token: bet.token_data,
      amountWei: bet.amount_wei,
      txHash: bet.tx_hash,
      createdAtISO: bet.created_at_iso,
      status: bet.status,
      prizeSent: bet.prize_sent || false,
      prizeAmount: bet.prize_amount,
      prizeSentAt: bet.prize_sent_at,
      createdAt: bet.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting bets by match:', error);
    throw error;
  }
}

// Get bets for a specific user
async function getBetsByUser(guildId, userId) {
  try {
    const { data, error } = await supabase
      .from('football_bets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('status', 'ACCEPTED');
    
    if (error) throw error;
    
    return (data || []).map(bet => ({
      betId: bet.bet_id,
      guildId: bet.guild_id,
      matchId: bet.match_id,
      userId: bet.user_id,
      outcome: bet.outcome,
      token: bet.token_data,
      amountWei: bet.amount_wei,
      txHash: bet.tx_hash,
      createdAtISO: bet.created_at_iso,
      status: bet.status,
      prizeSent: bet.prize_sent || false,
      prizeAmount: bet.prize_amount,
      prizeSentAt: bet.prize_sent_at,
      createdAt: bet.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting bets by user:', error);
    throw error;
  }
}

// Update bet prize
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

// Atomically increment bonus pot to prevent race conditions
async function incrementMatchGuildBonusPot(matchId, guildId, incrementAmountWei) {
  try {
    // Use RPC to call PostgreSQL function that atomically increments the bonus pot
    // This prevents race conditions when multiple concurrent requests try to top up the pot
    const { data, error } = await supabase.rpc('increment_match_guild_bonus_pot', {
      p_match_id: matchId,
      p_guild_id: guildId,
      p_increment_amount: incrementAmountWei
    });
    
    if (error) {
      // If RPC function doesn't exist, fall back to non-atomic update (for backwards compatibility)
      if (error.code === '42883' || error.message?.includes('function') || error.message?.includes('does not exist')) {
        console.warn('[DB] increment_match_guild_bonus_pot RPC function not found, falling back to non-atomic update. Please run migration to enable atomic updates.');
        // Fallback: read current value, add increment, write back (not atomic, but works)
        const { data: existingGuild, error: readError } = await supabase
          .from('match_guilds')
          .select('bonus_pot_wei')
          .eq('match_id', matchId)
          .eq('guild_id', guildId)
          .single();
        
        if (readError) throw readError;
        if (!existingGuild) {
          throw new Error(`Match ${matchId} is not associated with guild ${guildId}`);
        }
        
        const BigNumber = require('bignumber.js');
        const currentBonusPotWei = existingGuild.bonus_pot_wei || '0';
        const newBonusPotWei = new BigNumber(currentBonusPotWei).plus(new BigNumber(incrementAmountWei)).toString();
        
        const { error: updateError } = await supabase
          .from('match_guilds')
          .update({ bonus_pot_wei: newBonusPotWei })
          .eq('match_id', matchId)
          .eq('guild_id', guildId);
        
        if (updateError) throw updateError;
        return { bonus_pot_wei: newBonusPotWei };
      }
      throw error;
    }
    
    // The RPC function returns TABLE(bonus_pot_wei TEXT), which Supabase returns as an array
    // Extract the first row and return it in the same format as the fallback
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error(`Failed to increment bonus pot: RPC returned invalid data`);
    }
    
    return { bonus_pot_wei: data[0].bonus_pot_wei };
  } catch (error) {
    console.error('[DB] Error atomically incrementing match-guild bonus pot:', error);
    throw error;
  }
}

// Update match guild house earnings
async function updateMatchGuildHouseEarnings(matchId, guildId, tracked) {
  try {
    const { error } = await supabase
      .from('match_guilds')
      .update({ house_earnings_tracked: tracked })
      .eq('match_id', matchId)
      .eq('guild_id', guildId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating match guild house earnings:', error);
    throw error;
  }
}

// Update match guild stake
async function updateMatchGuildStake(matchId, guildId, stakeWei) {
  try {
    const { error } = await supabase
      .from('match_guilds')
      .upsert({
        match_id: matchId,
        guild_id: guildId,
        stake_wei: stakeWei
      }, {
        onConflict: 'match_id,guild_id'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating match guild stake:', error);
    throw error;
  }
}

// Get current bonus pot for a match-guild combination
async function getMatchGuildBonusPot(matchId, guildId) {
  try {
    const { data, error } = await supabase
      .from('match_guilds')
      .select('bonus_pot_wei')
      .eq('match_id', matchId)
      .eq('guild_id', guildId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return '0';
    
    return data.bonus_pot_wei || '0';
  } catch (error) {
    console.error('[DB] Error getting match guild bonus pot:', error);
    throw error;
  }
}

// Update match guild bonus pot
async function updateMatchGuildBonusPot(matchId, guildId, bonusPotWei) {
  try {
    // Use UPDATE instead of UPSERT to avoid null constraint violations
    // This only updates existing rows and won't create new ones
    const { data, error } = await supabase
      .from('match_guilds')
      .update({ bonus_pot_wei: bonusPotWei })
      .eq('match_id', matchId)
      .eq('guild_id', guildId)
      .select();
    
    if (error) throw error;
    
    // Check if any rows were updated
    if (!data || data.length === 0) {
      throw new Error(`Match-guild relationship not found for match ${matchId} in guild ${guildId}`);
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error updating match guild bonus pot:', error);
    throw error;
  }
}

// Lightweight function for autocomplete - gets only basic match info in a single query
// This is much faster than getMatchesByGuild which does N+1 queries
async function getMatchesForAutocomplete(guildId) {
  try {
    // First get match IDs for this guild
    const { data: guildRelations, error: guildError } = await supabase
      .from('match_guilds')
      .select('match_id')
      .eq('guild_id', guildId);
    
    if (guildError) throw guildError;
    if (!guildRelations || guildRelations.length === 0) return [];
    
    const matchIds = guildRelations.map(rel => rel.match_id);
    
    // Then get all match data in a single query
    const { data: matchesData, error: matchesError } = await supabase
      .from('football_matches')
      .select('match_id, comp_code, comp_name, home_team, away_team, status, ft_score, kickoff_iso')
      .in('match_id', matchIds);
    
    if (matchesError) throw matchesError;
    if (!matchesData || matchesData.length === 0) return [];
    
    // Transform to simpler format
    const matches = matchesData.map(match => ({
      matchId: match.match_id,
      compCode: match.comp_code,
      compName: match.comp_name,
      home: match.home_team,
      away: match.away_team,
      status: match.status,
      ftScore: match.ft_score || { home: 0, away: 0 },
      kickoffISO: match.kickoff_iso
    }));
    
    return matches;
  } catch (error) {
    console.error('[DB] Error getting matches for autocomplete:', error);
    throw error;
  }
}

module.exports = {
  getMatch,
  getMatchesByGuild,
  getMatchesForAutocomplete,
  getScheduledMatches,
  getPausedMatches,
  getInPlayMatches,
  createMatch,
  updateMatch,
  createBet,
  getBetsByMatch,
  getBetsByUser,
  updateBetPrize,
  incrementMatchGuildBonusPot,
  updateMatchGuildHouseEarnings,
  updateMatchGuildStake,
  getMatchGuildBonusPot,
  updateMatchGuildBonusPot
};
