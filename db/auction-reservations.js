const supabase = require('../supabase-client');
const BigNumber = require('bignumber.js');

// Create or update a bid reservation
// If user already has an ACTIVE reservation for this auction, update it
// Handles race conditions by trying insert first, then updating on conflict
async function createOrUpdateReservation(guildId, auctionId, userId, tokenIdentifier, amount) {
  try {
    // Try to insert a new reservation first
    // If an ACTIVE reservation already exists, the partial unique index will prevent this
    const reservationData = {
      auction_id: auctionId,
      guild_id: guildId,
      user_id: userId,
      token_identifier: tokenIdentifier,
      reserved_amount: amount,
      status: 'ACTIVE',
      created_at: new Date().toISOString()
    };
    
    const { data: newReservation, error: insertError } = await supabase
      .from('auction_bid_reservations')
      .insert(reservationData)
      .select()
      .single();
    
    // If insert succeeded, we're done
    if (newReservation && !insertError) {
      return { success: true, reservationId: newReservation.id, isUpdate: false };
    }
    
    // If insert failed due to unique constraint violation (ACTIVE reservation exists),
    // update the existing ACTIVE reservation
    if (insertError && insertError.code === '23505') {
      // Find and update the existing ACTIVE reservation
      const { data: existing, error: findError } = await supabase
        .from('auction_bid_reservations')
        .select('id')
        .eq('guild_id', guildId)
        .eq('auction_id', auctionId)
        .eq('user_id', userId)
        .eq('status', 'ACTIVE')
        .maybeSingle();
      
      if (findError && findError.code !== 'PGRST116') throw findError;
      
      if (existing) {
        // Update the existing ACTIVE reservation
        const { data: updated, error: updateError } = await supabase
          .from('auction_bid_reservations')
          .update({
            reserved_amount: amount,
            token_identifier: tokenIdentifier,
            created_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .eq('status', 'ACTIVE')
          .select()
          .single();
        
        if (updateError) throw updateError;
        return { success: true, reservationId: updated.id, isUpdate: true };
      } else {
        // This shouldn't happen, but if it does, throw the original error
        throw insertError;
      }
    }
    
    // If it's a different error, throw it
    if (insertError) throw insertError;
    
    // This shouldn't be reached, but just in case
    throw new Error('Unexpected error in createOrUpdateReservation');
  } catch (error) {
    console.error('[DB] Error creating/updating reservation:', error);
    throw error;
  }
}

// Release a reservation (when user is outbid or auction ends and they didn't win)
async function releaseReservation(guildId, auctionId, userId) {
  try {
    const { error } = await supabase
      .from('auction_bid_reservations')
      .update({
        status: 'RELEASED',
        released_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .eq('user_id', userId)
      .eq('status', 'ACTIVE');
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[DB] Error releasing reservation:', error);
    throw error;
  }
}

// Convert reservation to payment (when auction ends and user wins)
// This marks the reservation as converted so it can be used for payment
async function convertReservationToPayment(guildId, auctionId, userId) {
  try {
    const { error } = await supabase
      .from('auction_bid_reservations')
      .update({
        status: 'CONVERTED',
        released_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .eq('user_id', userId)
      .eq('status', 'ACTIVE');
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[DB] Error converting reservation:', error);
    throw error;
  }
}

// Get active reservation for a user on a specific auction
async function getActiveReservation(guildId, auctionId, userId) {
  try {
    const { data, error } = await supabase
      .from('auction_bid_reservations')
      .select('*')
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  } catch (error) {
    console.error('[DB] Error getting reservation:', error);
    throw error;
  }
}

// Get total reserved amount for a user and token (across all auctions)
async function getTotalReservedAmount(guildId, userId, tokenIdentifier) {
  try {
    const { data, error } = await supabase
      .from('auction_bid_reservations')
      .select('reserved_amount')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('token_identifier', tokenIdentifier)
      .eq('status', 'ACTIVE');
    
    if (error) throw error;
    
    // Sum all reserved amounts
    const total = (data || []).reduce((sum, reservation) => {
      return new BigNumber(sum).plus(new BigNumber(reservation.reserved_amount || '0')).toString();
    }, '0');
    
    return total;
  } catch (error) {
    console.error('[DB] Error getting total reserved amount:', error);
    return '0';
  }
}

// Release all reservations for a completed auction (for non-winners)
async function releaseAllReservationsForAuction(guildId, auctionId, winnerId = null) {
  try {
    let query = supabase
      .from('auction_bid_reservations')
      .update({
        status: 'RELEASED',
        released_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .eq('status', 'ACTIVE');
    
    // If winnerId is provided, exclude them (their reservation will be converted)
    if (winnerId) {
      query = query.neq('user_id', winnerId);
    }
    
    const { error } = await query;
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[DB] Error releasing all reservations:', error);
    throw error;
  }
}

// Clean up old reservations (for auctions that ended long ago)
// This is a maintenance function that can be called periodically
async function cleanupOldReservations(daysOld = 7) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    // Get all ACTIVE reservations for auctions that ended more than X days ago
    const { data: auctions, error: auctionError } = await supabase
      .from('auctions')
      .select('auction_id, guild_id, end_time')
      .in('status', ['FINISHED', 'FAILED', 'CANCELLED'])
      .lt('end_time', cutoffDate.getTime());
    
    if (auctionError) throw auctionError;
    
    if (!auctions || auctions.length === 0) {
      return { success: true, cleaned: 0 };
    }
    
    // Release all reservations for these auctions
    const auctionIds = auctions.map(a => a.auction_id);
    const guildIds = [...new Set(auctions.map(a => a.guild_id))];
    
    let totalCleaned = 0;
    for (const guildId of guildIds) {
      const guildAuctions = auctions.filter(a => a.guild_id === guildId);
      for (const auction of guildAuctions) {
        const result = await releaseAllReservationsForAuction(guildId, auction.auction_id);
        if (result.success) {
          totalCleaned++;
        }
      }
    }
    
    return { success: true, cleaned: totalCleaned };
  } catch (error) {
    console.error('[DB] Error cleaning up old reservations:', error);
    throw error;
  }
}

module.exports = {
  createOrUpdateReservation,
  releaseReservation,
  convertReservationToPayment,
  getActiveReservation,
  getTotalReservedAmount,
  releaseAllReservationsForAuction,
  cleanupOldReservations
};
