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