const supabase = require('../supabase-client');

// Create a new drop game
async function createDropGame(guildId, gameData) {
  try {
    const { error } = await supabase
      .from('drop_games')
      .insert({
        guild_id: guildId,
        channel_id: gameData.channelId,
        message_id: gameData.messageId || null,
        status: gameData.status || 'ACTIVE',
        token_ticker: gameData.tokenTicker || null,
        base_amount_wei: gameData.baseAmountWei,
        min_droppers: gameData.minDroppers,
        collection_identifier: gameData.collectionIdentifier || null,
        nft_collection_multiplier: gameData.nftCollectionMultiplier || false
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating drop game:', error);
    throw error;
  }
}

// Get drop game for a guild
async function getDropGame(guildId) {
  try {
    const { data, error } = await supabase
      .from('drop_games')
      .select('*')
      .eq('guild_id', guildId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    // Backward compatibility: use token_ticker if available, otherwise take first from supported_tokens array
    let tokenTicker = data.token_ticker;
    if (!tokenTicker && data.supported_tokens && Array.isArray(data.supported_tokens) && data.supported_tokens.length > 0) {
      tokenTicker = data.supported_tokens[0];
    }
    
    return {
      id: data.id,
      guildId: data.guild_id,
      channelId: data.channel_id,
      messageId: data.message_id,
      status: data.status,
      tokenTicker: tokenTicker || null,
      baseAmountWei: data.base_amount_wei,
      minDroppers: data.min_droppers,
      collectionIdentifier: data.collection_identifier,
      nftCollectionMultiplier: data.nft_collection_multiplier || false,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error('[DB] Error getting drop game:', error);
    throw error;
  }
}

// Update drop game
async function updateDropGame(guildId, gameData) {
  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (gameData.channelId !== undefined) updateData.channel_id = gameData.channelId;
    if (gameData.messageId !== undefined) updateData.message_id = gameData.messageId;
    if (gameData.status !== undefined) updateData.status = gameData.status;
    if (gameData.tokenTicker !== undefined) updateData.token_ticker = gameData.tokenTicker;
    if (gameData.baseAmountWei !== undefined) updateData.base_amount_wei = gameData.baseAmountWei;
    if (gameData.minDroppers !== undefined) updateData.min_droppers = gameData.minDroppers;
    if (gameData.collectionIdentifier !== undefined) updateData.collection_identifier = gameData.collectionIdentifier;
    if (gameData.nftCollectionMultiplier !== undefined) updateData.nft_collection_multiplier = gameData.nftCollectionMultiplier;
    
    const { error } = await supabase
      .from('drop_games')
      .update(updateData)
      .eq('guild_id', guildId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating drop game:', error);
    throw error;
  }
}

// Stop drop game (set status to STOPPED)
async function stopDropGame(guildId) {
  try {
    const { error } = await supabase
      .from('drop_games')
      .update({
        status: 'STOPPED',
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error stopping drop game:', error);
    throw error;
  }
}

// Get all active drop games
async function getActiveDropGames() {
  try {
    const { data, error } = await supabase
      .from('drop_games')
      .select('*')
      .eq('status', 'ACTIVE');
    
    if (error) throw error;
    
    return (data || []).map(row => {
      // Backward compatibility: use token_ticker if available, otherwise take first from supported_tokens array
      let tokenTicker = row.token_ticker;
      if (!tokenTicker && row.supported_tokens && Array.isArray(row.supported_tokens) && row.supported_tokens.length > 0) {
        tokenTicker = row.supported_tokens[0];
      }
      
      return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        status: row.status,
        tokenTicker: tokenTicker || null,
        baseAmountWei: row.base_amount_wei,
        minDroppers: row.min_droppers,
        collectionIdentifier: row.collection_identifier,
        nftCollectionMultiplier: row.nft_collection_multiplier || false,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  } catch (error) {
    console.error('[DB] Error getting active drop games:', error);
    throw error;
  }
}

module.exports = {
  createDropGame,
  getDropGame,
  updateDropGame,
  stopDropGame,
  getActiveDropGames
};
