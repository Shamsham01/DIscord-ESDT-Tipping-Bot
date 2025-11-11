const supabase = require('../supabase-client');

async function getGame(guildId, gameId) {
  try {
    const { data, error } = await supabase
      .from('rps_games')
      .select('*')
      .eq('guild_id', guildId)
      .eq('game_id', gameId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    return {
      gameId: data.game_id,
      guildId: data.guild_id,
      challengerId: data.challenger_id,
      challengerTag: data.challenger_tag,
      challengerWallet: data.challenger_wallet,
      challengedId: data.challenged_id,
      challengedTag: data.challenged_tag,
      challengedWallet: data.challenged_wallet,
      amount: data.amount,
      humanAmount: data.human_amount,
      decimals: data.decimals,
      token: data.token,
      transactionHash: data.transaction_hash,
      joinerTransactionHash: data.joiner_transaction_hash,
      memo: data.memo,
      status: data.status,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      joinedAt: data.joined_at,
      completedAt: data.completed_at,
      currentRound: data.current_round,
      winner: data.winner,
      winnerId: data.winner_id,
      winnerTag: data.winner_tag,
      loserId: data.loser_id,
      loserTag: data.loser_tag,
      rounds: data.rounds || []
    };
  } catch (error) {
    console.error('[DB] Error getting RPS game:', error);
    throw error;
  }
}

async function getGamesByGuild(guildId) {
  try {
    const { data, error } = await supabase
      .from('rps_games')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const games = {};
    (data || []).forEach(row => {
      games[row.game_id] = {
        gameId: row.game_id,
        guildId: row.guild_id,
        challengerId: row.challenger_id,
        challengerTag: row.challenger_tag,
        challengerWallet: row.challenger_wallet,
        challengedId: row.challenged_id,
        challengedTag: row.challenged_tag,
        challengedWallet: row.challenged_wallet,
        amount: row.amount,
        humanAmount: row.human_amount,
        decimals: row.decimals,
        token: row.token,
        transactionHash: row.transaction_hash,
        joinerTransactionHash: row.joiner_transaction_hash,
        memo: row.memo,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        joinedAt: row.joined_at,
        completedAt: row.completed_at,
        currentRound: row.current_round,
        winner: row.winner,
        winnerId: row.winner_id,
        winnerTag: row.winner_tag,
        loserId: row.loser_id,
        loserTag: row.loser_tag,
        rounds: row.rounds || []
      };
    });
    return games;
  } catch (error) {
    console.error('[DB] Error getting RPS games by guild:', error);
    throw error;
  }
}

async function getActiveGames(guildId) {
  try {
    const { data, error } = await supabase
      .from('rps_games')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      gameId: row.game_id,
      guildId: row.guild_id,
      challengerId: row.challenger_id,
      challengerTag: row.challenger_tag,
      challengerWallet: row.challenger_wallet,
      challengedId: row.challenged_id,
      challengedTag: row.challenged_tag,
      challengedWallet: row.challenged_wallet,
      amount: row.amount,
      humanAmount: row.human_amount,
      decimals: row.decimals,
      token: row.token,
      transactionHash: row.transaction_hash,
      joinerTransactionHash: row.joiner_transaction_hash,
      memo: row.memo,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      joinedAt: row.joined_at,
      completedAt: row.completed_at,
      currentRound: row.current_round,
      winner: row.winner,
      winnerId: row.winner_id,
      winnerTag: row.winner_tag,
      loserId: row.loser_id,
      loserTag: row.loser_tag,
      rounds: row.rounds || []
    }));
  } catch (error) {
    console.error('[DB] Error getting active RPS games:', error);
    throw error;
  }
}

async function createGame(guildId, gameId, gameData) {
  try {
    const { error } = await supabase
      .from('rps_games')
      .insert({
        game_id: gameId,
        guild_id: guildId,
        challenger_id: gameData.challengerId,
        challenger_tag: gameData.challengerTag || null,
        challenger_wallet: gameData.challengerWallet,
        challenged_id: gameData.challengedId,
        challenged_tag: gameData.challengedTag || null,
        challenged_wallet: gameData.challengedWallet || null,
        amount: gameData.amount,
        human_amount: gameData.humanAmount,
        decimals: gameData.decimals,
        token: gameData.token,
        transaction_hash: gameData.transactionHash || '',
        joiner_transaction_hash: gameData.joinerTransactionHash || null,
        memo: gameData.memo || null,
        status: gameData.status || 'pending',
        created_at: gameData.createdAt,
        expires_at: gameData.expiresAt || null,
        joined_at: gameData.joinedAt || null,
        completed_at: gameData.completedAt || null,
        current_round: gameData.currentRound || 1,
        winner: gameData.winner || null,
        winner_id: gameData.winnerId || null,
        winner_tag: gameData.winnerTag || null,
        loser_id: gameData.loserId || null,
        loser_tag: gameData.loserTag || null,
        rounds: gameData.rounds || []
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating RPS game:', error);
    throw error;
  }
}

async function updateGame(guildId, gameId, gameData) {
  try {
    const updateData = {};
    
    if (gameData.challengerId !== undefined) updateData.challenger_id = gameData.challengerId;
    if (gameData.challengerTag !== undefined) updateData.challenger_tag = gameData.challengerTag;
    if (gameData.challengerWallet !== undefined) updateData.challenger_wallet = gameData.challengerWallet;
    if (gameData.challengedId !== undefined) updateData.challenged_id = gameData.challengedId;
    if (gameData.challengedTag !== undefined) updateData.challenged_tag = gameData.challengedTag;
    if (gameData.challengedWallet !== undefined) updateData.challenged_wallet = gameData.challengedWallet;
    if (gameData.amount !== undefined) updateData.amount = gameData.amount;
    if (gameData.humanAmount !== undefined) updateData.human_amount = gameData.humanAmount;
    if (gameData.decimals !== undefined) updateData.decimals = gameData.decimals;
    if (gameData.token !== undefined) updateData.token = gameData.token;
    if (gameData.transactionHash !== undefined) updateData.transaction_hash = gameData.transactionHash;
    if (gameData.joinerTransactionHash !== undefined) updateData.joiner_transaction_hash = gameData.joinerTransactionHash;
    if (gameData.memo !== undefined) updateData.memo = gameData.memo;
    if (gameData.status !== undefined) updateData.status = gameData.status;
    if (gameData.createdAt !== undefined) updateData.created_at = gameData.createdAt;
    if (gameData.expiresAt !== undefined) updateData.expires_at = gameData.expiresAt;
    if (gameData.joinedAt !== undefined) updateData.joined_at = gameData.joinedAt;
    if (gameData.completedAt !== undefined) updateData.completed_at = gameData.completedAt;
    if (gameData.currentRound !== undefined) updateData.current_round = gameData.currentRound;
    if (gameData.winner !== undefined) updateData.winner = gameData.winner;
    if (gameData.winnerId !== undefined) updateData.winner_id = gameData.winnerId;
    if (gameData.winnerTag !== undefined) updateData.winner_tag = gameData.winnerTag;
    if (gameData.loserId !== undefined) updateData.loser_id = gameData.loserId;
    if (gameData.loserTag !== undefined) updateData.loser_tag = gameData.loserTag;
    if (gameData.rounds !== undefined) updateData.rounds = gameData.rounds;
    
    const { error } = await supabase
      .from('rps_games')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('game_id', gameId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating RPS game:', error);
    throw error;
  }
}

async function deleteGame(guildId, gameId) {
  try {
    const { error } = await supabase
      .from('rps_games')
      .delete()
      .eq('guild_id', guildId)
      .eq('game_id', gameId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error deleting RPS game:', error);
    throw error;
  }
}

// Alias for getGamesByGuild for backward compatibility
async function getRpsGames(guildId) {
  return await getGamesByGuild(guildId);
}

module.exports = {
  getGame,
  getGamesByGuild,
  getRpsGames,
  getActiveGames,
  createGame,
  updateGame,
  deleteGame
};

