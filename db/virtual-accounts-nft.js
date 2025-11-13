const supabase = require('../supabase-client');
const BigNumber = require('bignumber.js');

// ============================================
// BALANCE MANAGEMENT
// ============================================

async function getUserNFTBalances(guildId, userId, collection = null) {
  try {
    let query = supabase
      .from('virtual_account_nft_balances')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (collection) {
      query = query.eq('collection', collection);
    }
    
    const { data, error } = await query.order('collection', { ascending: true }).order('nft_name', { ascending: true });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[DB] Error getting user NFT balances:', error);
    throw error;
  }
}

async function getUserNFTBalance(guildId, userId, collection, nonce) {
  try {
    const { data, error } = await supabase
      .from('virtual_account_nft_balances')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('collection', collection)
      .eq('nonce', nonce)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  } catch (error) {
    console.error('[DB] Error getting user NFT balance:', error);
    throw error;
  }
}

async function getUserCollections(guildId, userId) {
  try {
    const { data, error } = await supabase
      .from('virtual_account_nft_balances')
      .select('collection')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (error) throw error;
    
    // Get unique collections
    const collections = [...new Set((data || []).map(row => row.collection))];
    return collections.sort();
  } catch (error) {
    console.error('[DB] Error getting user collections:', error);
    throw error;
  }
}

async function addNFTToAccount(guildId, userId, collection, identifier, nonce, metadata = {}) {
  try {
    const { data, error } = await supabase
      .from('virtual_account_nft_balances')
      .insert({
        guild_id: guildId,
        user_id: userId,
        collection: collection,
        identifier: identifier,
        nonce: nonce,
        nft_name: metadata.nft_name || null,
        nft_image_url: metadata.nft_image_url || null,
        metadata: metadata.metadata || {}
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[DB] Error adding NFT to account:', error);
    throw error;
  }
}

async function removeNFTFromAccount(guildId, userId, collection, nonce) {
  try {
    const { error } = await supabase
      .from('virtual_account_nft_balances')
      .delete()
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('collection', collection)
      .eq('nonce', nonce);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error removing NFT from account:', error);
    throw error;
  }
}

async function transferNFTBetweenUsers(guildId, fromUserId, toUserId, collection, nonce, priceData = null) {
  try {
    // 1. Verify seller owns the NFT
    const { data: nftData, error: fetchError } = await supabase
      .from('virtual_account_nft_balances')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', fromUserId)
      .eq('collection', collection)
      .eq('nonce', nonce)
      .single();
    
    if (fetchError || !nftData) {
      throw new Error('NFT not found in seller account');
    }
    
    // 2. DELETE from seller
    const { error: deleteError } = await supabase
      .from('virtual_account_nft_balances')
      .delete()
      .eq('guild_id', guildId)
      .eq('user_id', fromUserId)
      .eq('collection', collection)
      .eq('nonce', nonce);
    
    if (deleteError) throw deleteError;
    
    // 3. INSERT for buyer
    const { error: insertError } = await supabase
      .from('virtual_account_nft_balances')
      .insert({
        guild_id: guildId,
        user_id: toUserId,
        collection: collection,
        identifier: nftData.identifier,
        nonce: nonce,
        nft_name: nftData.nft_name,
        nft_image_url: nftData.nft_image_url,
        metadata: nftData.metadata
      });
    
    if (insertError) throw insertError;
    
    // 4. Create transaction records for both users
    const transactionId = `nft_transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();
    
    // Seller transaction
    await addNFTTransaction(guildId, fromUserId, {
      id: `${transactionId}_seller`,
      type: 'transfer_out',
      collection: collection,
      identifier: nftData.identifier,
      nonce: nonce,
      nft_name: nftData.nft_name,
      to_user_id: toUserId,
      price_token_identifier: priceData?.tokenIdentifier || null,
      price_amount: priceData?.amount || null,
      timestamp: timestamp,
      description: priceData ? `Sold NFT to user ${toUserId}` : `Transferred NFT to user ${toUserId}`
    });
    
    // Buyer transaction
    await addNFTTransaction(guildId, toUserId, {
      id: `${transactionId}_buyer`,
      type: 'transfer_in',
      collection: collection,
      identifier: nftData.identifier,
      nonce: nonce,
      nft_name: nftData.nft_name,
      from_user_id: fromUserId,
      price_token_identifier: priceData?.tokenIdentifier || null,
      price_amount: priceData?.amount || null,
      timestamp: timestamp,
      description: priceData ? `Purchased NFT from user ${fromUserId}` : `Received NFT from user ${fromUserId}`
    });
    
    return { success: true, nftData };
  } catch (error) {
    console.error('[DB] Error transferring NFT:', error);
    throw error;
  }
}

// ============================================
// TRANSACTION HISTORY
// ============================================

async function addNFTTransaction(guildId, userId, transaction) {
  try {
    const { error } = await supabase
      .from('virtual_account_nft_transactions')
      .insert({
        guild_id: guildId,
        user_id: userId,
        transaction_id: transaction.id,
        type: transaction.type,
        collection: transaction.collection,
        identifier: transaction.identifier,
        nonce: transaction.nonce,
        nft_name: transaction.nft_name || null,
        from_user_id: transaction.from_user_id || null,
        to_user_id: transaction.to_user_id || null,
        price_token_identifier: transaction.price_token_identifier || null,
        price_amount: transaction.price_amount || null,
        tx_hash: transaction.tx_hash || null,
        source: transaction.source || null,
        timestamp: transaction.timestamp,
        description: transaction.description || null
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error adding NFT transaction:', error);
    throw error;
  }
}

async function getNFTTransactionHistory(guildId, userId, collection = null, limit = 50) {
  try {
    let query = supabase
      .from('virtual_account_nft_transactions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit);
    
    if (collection) {
      query = query.eq('collection', collection);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.transaction_id,
      type: row.type,
      collection: row.collection,
      identifier: row.identifier,
      nonce: row.nonce,
      nftName: row.nft_name,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      priceTokenIdentifier: row.price_token_identifier,
      priceAmount: row.price_amount,
      txHash: row.tx_hash,
      source: row.source,
      timestamp: row.timestamp,
      description: row.description
    }));
  } catch (error) {
    console.error('[DB] Error getting NFT transaction history:', error);
    throw error;
  }
}

// ============================================
// HOUSE BALANCE
// ============================================

async function trackNFTTopup(guildId, collection, identifier, nonce, userId, txHash, metadata = {}) {
  try {
    // Get or create house balance record for this collection
    const { data: existingBalance, error: fetchError } = await supabase
      .from('house_nft_balance')
      .select('*')
      .eq('guild_id', guildId)
      .eq('collection', collection)
      .single();
    
    let nftList = [];
    let nftCount = 0;
    
    if (existingBalance) {
      nftList = existingBalance.nft_list || [];
      nftCount = existingBalance.nft_count || 0;
    }
    
    // Add NFT to list
    const nftEntry = {
      identifier: identifier,
      nonce: nonce,
      nft_name: metadata.nft_name || null,
      deposited_by: userId,
      deposited_at: Date.now(),
      tx_hash: txHash
    };
    
    nftList.push(nftEntry);
    nftCount += 1;
    
    // Update or insert house balance
    const { error } = await supabase
      .from('house_nft_balance')
      .upsert({
        guild_id: guildId,
        collection: collection,
        nft_count: nftCount,
        nft_list: nftList,
        updated_at: new Date().toISOString()
      }, { onConflict: 'guild_id,collection' });
    
    if (error) throw error;
    
    return { success: true, nftCount };
  } catch (error) {
    console.error('[DB] Error tracking NFT topup:', error);
    throw error;
  }
}

async function getHouseNFTBalance(guildId, collection = null) {
  try {
    let query = supabase
      .from('house_nft_balance')
      .select('*')
      .eq('guild_id', guildId);
    
    if (collection) {
      query = query.eq('collection', collection);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[DB] Error getting house NFT balance:', error);
    throw error;
  }
}

// ============================================
// LISTINGS
// ============================================

async function createListing(guildId, listingId, listingData) {
  try {
    const { error } = await supabase
      .from('nft_listings')
      .insert({
        listing_id: listingId,
        guild_id: guildId,
        seller_id: listingData.sellerId,
        seller_tag: listingData.sellerTag || null,
        collection: listingData.collection,
        identifier: listingData.identifier,
        nonce: listingData.nonce,
        nft_name: listingData.nftName || null,
        nft_image_url: listingData.nftImageUrl || null,
        title: listingData.title,
        description: listingData.description || null,
        price_token_identifier: listingData.priceTokenIdentifier,
        price_amount: listingData.priceAmount,
        listing_type: listingData.listingType || 'fixed_price',
        status: listingData.status || 'ACTIVE',
        message_id: listingData.messageId || null,
        thread_id: listingData.threadId || null,
        channel_id: listingData.channelId || null,
        created_at: listingData.createdAt || Date.now(),
        expires_at: listingData.expiresAt || null
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating listing:', error);
    throw error;
  }
}

async function getListing(guildId, listingId) {
  try {
    const { data, error } = await supabase
      .from('nft_listings')
      .select('*')
      .eq('guild_id', guildId)
      .eq('listing_id', listingId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) return null;
    
    return {
      listingId: data.listing_id,
      guildId: data.guild_id,
      sellerId: data.seller_id,
      sellerTag: data.seller_tag,
      collection: data.collection,
      identifier: data.identifier,
      nonce: data.nonce,
      nftName: data.nft_name,
      nftImageUrl: data.nft_image_url,
      title: data.title,
      description: data.description,
      priceTokenIdentifier: data.price_token_identifier,
      priceAmount: data.price_amount,
      listingType: data.listing_type,
      status: data.status,
      messageId: data.message_id,
      threadId: data.thread_id,
      channelId: data.channel_id,
      createdAt: data.created_at,
      soldAt: data.sold_at,
      expiresAt: data.expires_at
    };
  } catch (error) {
    console.error('[DB] Error getting listing:', error);
    throw error;
  }
}

async function getActiveListings(guildId, collection = null) {
  try {
    let query = supabase
      .from('nft_listings')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'ACTIVE');
    
    if (collection) {
      query = query.eq('collection', collection);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      listingId: row.listing_id,
      guildId: row.guild_id,
      sellerId: row.seller_id,
      sellerTag: row.seller_tag,
      collection: row.collection,
      identifier: row.identifier,
      nonce: row.nonce,
      nftName: row.nft_name,
      nftImageUrl: row.nft_image_url,
      title: row.title,
      description: row.description,
      priceTokenIdentifier: row.price_token_identifier,
      priceAmount: row.price_amount,
      listingType: row.listing_type,
      status: row.status,
      messageId: row.message_id,
      threadId: row.thread_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
      soldAt: row.sold_at,
      expiresAt: row.expires_at
    }));
  } catch (error) {
    console.error('[DB] Error getting active listings:', error);
    throw error;
  }
}

async function updateListing(guildId, listingId, updates) {
  try {
    const updateData = {};
    
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.soldAt !== undefined) updateData.sold_at = updates.soldAt;
    if (updates.messageId !== undefined) updateData.message_id = updates.messageId;
    if (updates.threadId !== undefined) updateData.thread_id = updates.threadId;
    if (updates.channelId !== undefined) updateData.channel_id = updates.channelId;
    if (updates.expiresAt !== undefined) updateData.expires_at = updates.expiresAt;
    
    updateData.updated_at = new Date().toISOString();
    
    const { error } = await supabase
      .from('nft_listings')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('listing_id', listingId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating listing:', error);
    throw error;
  }
}

async function getUserListings(guildId, userId, status = 'ACTIVE') {
  try {
    let query = supabase
      .from('nft_listings')
      .select('*')
      .eq('guild_id', guildId)
      .eq('seller_id', userId);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      listingId: row.listing_id,
      guildId: row.guild_id,
      sellerId: row.seller_id,
      sellerTag: row.seller_tag,
      collection: row.collection,
      identifier: row.identifier,
      nonce: row.nonce,
      nftName: row.nft_name,
      nftImageUrl: row.nft_image_url,
      title: row.title,
      description: row.description,
      priceTokenIdentifier: row.price_token_identifier,
      priceAmount: row.price_amount,
      listingType: row.listing_type,
      status: row.status,
      messageId: row.message_id,
      threadId: row.thread_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
      soldAt: row.sold_at,
      expiresAt: row.expires_at
    }));
  } catch (error) {
    console.error('[DB] Error getting user listings:', error);
    throw error;
  }
}

// ============================================
// OFFERS
// ============================================

async function createOffer(guildId, offerId, offerData) {
  try {
    const { error } = await supabase
      .from('nft_offers')
      .insert({
        offer_id: offerId,
        guild_id: guildId,
        listing_id: offerData.listingId,
        offerer_id: offerData.offererId,
        offerer_tag: offerData.offererTag || null,
        price_token_identifier: offerData.priceTokenIdentifier,
        price_amount: offerData.priceAmount,
        status: offerData.status || 'PENDING',
        created_at: offerData.createdAt || Date.now(),
        expires_at: offerData.expiresAt || null
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating offer:', error);
    throw error;
  }
}

async function getOffer(guildId, offerId) {
  try {
    const { data, error } = await supabase
      .from('nft_offers')
      .select('*')
      .eq('guild_id', guildId)
      .eq('offer_id', offerId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) return null;
    
    return {
      offerId: data.offer_id,
      guildId: data.guild_id,
      listingId: data.listing_id,
      offererId: data.offerer_id,
      offererTag: data.offerer_tag,
      priceTokenIdentifier: data.price_token_identifier,
      priceAmount: data.price_amount,
      status: data.status,
      createdAt: data.created_at,
      acceptedAt: data.accepted_at,
      expiresAt: data.expires_at
    };
  } catch (error) {
    console.error('[DB] Error getting offer:', error);
    throw error;
  }
}

async function getOffersForListing(guildId, listingId) {
  try {
    const { data, error } = await supabase
      .from('nft_offers')
      .select('*')
      .eq('guild_id', guildId)
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      offerId: row.offer_id,
      guildId: row.guild_id,
      listingId: row.listing_id,
      offererId: row.offerer_id,
      offererTag: row.offerer_tag,
      priceTokenIdentifier: row.price_token_identifier,
      priceAmount: row.price_amount,
      status: row.status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      expiresAt: row.expires_at
    }));
  } catch (error) {
    console.error('[DB] Error getting offers for listing:', error);
    throw error;
  }
}

async function getUserOffers(guildId, userId, status = 'PENDING') {
  try {
    let query = supabase
      .from('nft_offers')
      .select('*')
      .eq('guild_id', guildId)
      .eq('offerer_id', userId);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      offerId: row.offer_id,
      guildId: row.guild_id,
      listingId: row.listing_id,
      offererId: row.offerer_id,
      offererTag: row.offerer_tag,
      priceTokenIdentifier: row.price_token_identifier,
      priceAmount: row.price_amount,
      status: row.status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      expiresAt: row.expires_at
    }));
  } catch (error) {
    console.error('[DB] Error getting user offers:', error);
    throw error;
  }
}

async function updateOffer(guildId, offerId, updates) {
  try {
    const updateData = {};
    
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.acceptedAt !== undefined) updateData.accepted_at = updates.acceptedAt;
    if (updates.expiresAt !== undefined) updateData.expires_at = updates.expiresAt;
    
    updateData.updated_at = new Date().toISOString();
    
    const { error } = await supabase
      .from('nft_offers')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('offer_id', offerId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating offer:', error);
    throw error;
  }
}

async function cleanupExpiredOffers() {
  try {
    const now = Date.now();
    
    // Update expired offers to EXPIRED status
    const { error } = await supabase
      .from('nft_offers')
      .update({ 
        status: 'EXPIRED',
        updated_at: new Date().toISOString()
      })
      .eq('status', 'PENDING')
      .lt('expires_at', now)
      .not('expires_at', 'is', null);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('[DB] Error cleaning up expired offers:', error);
    throw error;
  }
}

async function cleanupExpiredListings() {
  try {
    const now = Date.now();
    
    // Update expired listings to EXPIRED status
    const { error } = await supabase
      .from('nft_listings')
      .update({ 
        status: 'EXPIRED',
        updated_at: new Date().toISOString()
      })
      .eq('status', 'ACTIVE')
      .lt('expires_at', now)
      .not('expires_at', 'is', null);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('[DB] Error cleaning up expired listings:', error);
    throw error;
  }
}

module.exports = {
  // Balance Management
  getUserNFTBalances,
  getUserNFTBalance,
  getUserCollections,
  addNFTToAccount,
  removeNFTFromAccount,
  transferNFTBetweenUsers,
  
  // Transaction History
  addNFTTransaction,
  getNFTTransactionHistory,
  
  // House Balance
  trackNFTTopup,
  getHouseNFTBalance,
  
  // Listings
  createListing,
  getListing,
  getActiveListings,
  updateListing,
  getUserListings,
  
  // Offers
  createOffer,
  getOffer,
  getOffersForListing,
  getUserOffers,
  updateOffer,
  cleanupExpiredOffers,
  cleanupExpiredListings
};

