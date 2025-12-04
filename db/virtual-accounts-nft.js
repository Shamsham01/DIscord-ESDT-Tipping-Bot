const supabase = require('../supabase-client');
const BigNumber = require('bignumber.js');

// ============================================
// BALANCE MANAGEMENT
// ============================================

async function getUserNFTBalances(guildId, userId, collection = null, includeStaked = false) {
  try {
    let query = supabase
      .from('virtual_account_nft_balances')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    // By default, exclude staked NFTs (only show available NFTs)
    if (!includeStaked) {
      query = query.eq('staked', false);
    }
    
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

async function addNFTToAccount(guildId, userId, collection, identifier, nonce, metadata = {}, amount = 1, tokenType = 'NFT') {
  try {
    // Convert amount to number if string
    const amountNum = typeof amount === 'string' ? parseInt(amount, 10) : Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
    }

    // Validate token type - must be explicitly 'SFT' or 'NFT'
    // CRITICAL: Don't infer from amount! 1 SFT is still SFT, not NFT
    const validTokenType = (tokenType === 'SFT' || tokenType === 'NFT') ? tokenType : 'NFT';
    const finalTokenType = validTokenType; // Use explicit type, no inference

    // Check if record already exists
    const existing = await getUserNFTBalance(guildId, userId, collection, nonce);
    
    if (existing) {
      // Update existing record: increment amount, preserve token_type (don't downgrade SFT to NFT)
      const newAmount = (existing.amount || 1) + amountNum;
      const existingTokenType = existing.token_type || 'NFT';
      // If existing is SFT, keep it as SFT; if new is SFT, upgrade to SFT
      const updatedTokenType = existingTokenType === 'SFT' || finalTokenType === 'SFT' ? 'SFT' : 'NFT';
      
      const { data, error } = await supabase
        .from('virtual_account_nft_balances')
        .update({
          amount: newAmount,
          token_type: updatedTokenType,
          nft_name: metadata.nft_name || existing.nft_name || null,
          nft_image_url: metadata.nft_image_url || existing.nft_image_url || null,
          metadata: metadata.metadata || existing.metadata || {},
          updated_at: new Date().toISOString()
        })
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .eq('collection', collection)
        .eq('nonce', nonce)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('virtual_account_nft_balances')
        .insert({
          guild_id: guildId,
          user_id: userId,
          collection: collection,
          identifier: identifier,
          nonce: nonce,
          amount: amountNum,
          token_type: finalTokenType,
          nft_name: metadata.nft_name || null,
          nft_image_url: metadata.nft_image_url || null,
          metadata: metadata.metadata || {}
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error('[DB] Error adding NFT to account:', error);
    throw error;
  }
}

async function removeNFTFromAccount(guildId, userId, collection, nonce, amount = 1) {
  try {
    // Convert amount to number if string
    const amountNum = typeof amount === 'string' ? parseInt(amount, 10) : Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
    }

    // Get current balance
    const existing = await getUserNFTBalance(guildId, userId, collection, nonce);
    
    if (!existing) {
      throw new Error('NFT not found in account');
    }

    const currentAmount = existing.amount || 1;
    
    if (amountNum > currentAmount) {
      throw new Error(`Insufficient balance. You have ${currentAmount}, trying to remove ${amountNum}`);
    }

    if (amountNum >= currentAmount) {
      // Remove entire record
      const { error } = await supabase
        .from('virtual_account_nft_balances')
        .delete()
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .eq('collection', collection)
        .eq('nonce', nonce);
      
      if (error) throw error;
      return { removed: currentAmount, remaining: 0 };
    } else {
      // Decrement amount
      const newAmount = currentAmount - amountNum;
      const { error } = await supabase
        .from('virtual_account_nft_balances')
        .update({
          amount: newAmount,
          updated_at: new Date().toISOString()
        })
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .eq('collection', collection)
        .eq('nonce', nonce);
      
      if (error) throw error;
      return { removed: amountNum, remaining: newAmount };
    }
  } catch (error) {
    console.error('[DB] Error removing NFT from account:', error);
    throw error;
  }
}

async function transferNFTBetweenUsers(guildId, fromUserId, toUserId, collection, nonce, priceData = null, amount = 1) {
  try {
    // Convert amount to number if string
    const amountNum = typeof amount === 'string' ? parseInt(amount, 10) : Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
    }

    // 1. Verify seller owns the NFT and has sufficient amount
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

    const currentAmount = nftData.amount || 1;
    if (amountNum > currentAmount) {
      throw new Error(`Insufficient balance. You have ${currentAmount}, trying to transfer ${amountNum}`);
    }
    
    // 2. Remove from seller (handles partial removal)
    await removeNFTFromAccount(guildId, fromUserId, collection, nonce, amountNum);
    
    // 3. Add to buyer (handles aggregation)
    // CRITICAL: Get token_type from seller's balance (most reliable source)
    // Don't infer from amount - 1 SFT is still SFT, not NFT!
    const sellerTokenType = nftData.token_type || 'NFT';
    await addNFTToAccount(
      guildId,
      toUserId,
      collection,
      nftData.identifier,
      nonce,
      {
        nft_name: nftData.nft_name,
        nft_image_url: nftData.nft_image_url,
        metadata: nftData.metadata
      },
      amountNum,
      sellerTokenType // Preserve token_type from seller (SFT vs NFT)
    );
    
    // 4. Create transaction records for both users
    const transactionId = `nft_transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();
    const amountText = amountNum > 1 ? `${amountNum}x ` : '';
    const sftText = sellerTokenType === 'SFT' ? 'SFT' : 'NFT';
    
    // Seller transaction
    await addNFTTransaction(guildId, fromUserId, {
      id: `${transactionId}_seller`,
      type: 'transfer_out',
      collection: collection,
      identifier: nftData.identifier,
      nonce: nonce,
      nft_name: nftData.nft_name,
      amount: amountNum, // Store amount for SFTs
      token_type: sellerTokenType, // Use actual token_type from balance, not inferred from amount
      from_user_id: fromUserId, // Set from_user_id for sender's transaction record
      to_user_id: toUserId,
      price_token_identifier: priceData?.tokenIdentifier || null,
      price_amount: priceData?.amount || null,
      timestamp: timestamp,
      description: priceData 
        ? `Sold ${amountText}${sftText} to user ${toUserId}` 
        : `Transferred ${amountText}${sftText} to user ${toUserId}`
    });
    
    // Buyer transaction
    await addNFTTransaction(guildId, toUserId, {
      id: `${transactionId}_buyer`,
      type: 'transfer_in',
      collection: collection,
      identifier: nftData.identifier,
      nonce: nonce,
      nft_name: nftData.nft_name,
      amount: amountNum, // Store amount for SFTs
      token_type: sellerTokenType, // Use same token_type as seller (preserves SFT classification)
      from_user_id: fromUserId, // Set from_user_id for recipient's transaction record
      to_user_id: toUserId, // Set to_user_id to recipient's own ID (they received it)
      price_token_identifier: priceData?.tokenIdentifier || null,
      price_amount: priceData?.amount || null,
      timestamp: timestamp,
      description: priceData 
        ? `Purchased ${amountText}${sftText} from user ${fromUserId}` 
        : `Received ${amountText}${sftText} from user ${fromUserId}`
    });
    
    return { success: true, nftData, amount: amountNum };
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
    // Convert amount to integer (default to 1 if not provided)
    const amount = transaction.amount !== undefined && transaction.amount !== null 
      ? (typeof transaction.amount === 'string' ? parseInt(transaction.amount, 10) : Number(transaction.amount))
      : 1;
    const finalAmount = isNaN(amount) || amount <= 0 ? 1 : amount;
    
    // Validate token_type - must be 'NFT' or 'SFT', default to 'NFT' if not provided
    const tokenType = transaction.token_type === 'SFT' ? 'SFT' : 'NFT';
    
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
        amount: finalAmount, // Store amount for SFTs
        token_type: tokenType, // Explicit token type (NFT or SFT), not inferred from amount
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
// LISTINGS
// ============================================

async function createListing(guildId, listingId, listingData) {
  try {
    const amount = listingData.amount || 1;
    // CRITICAL: Use explicit tokenType from listingData, don't infer from amount
    // 1 SFT is still SFT, not NFT! Must be passed explicitly from balance/listing source
    const tokenType = listingData.tokenType === 'SFT' ? 'SFT' : 'NFT';
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
        amount: amount,
        token_type: tokenType,
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
      buyerId: data.buyer_id || null,
      collection: data.collection,
      identifier: data.identifier,
      nonce: data.nonce,
      amount: data.amount || 1,
      tokenType: data.token_type || 'NFT',
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
      buyerId: row.buyer_id || null,
      collection: row.collection,
      identifier: row.identifier,
      nonce: row.nonce,
      amount: row.amount || 1,
      tokenType: row.token_type || 'NFT',
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
    if (updates.buyerId !== undefined) updateData.buyer_id = updates.buyerId;
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
      buyerId: row.buyer_id || null,
      collection: row.collection,
      identifier: row.identifier,
      nonce: row.nonce,
      amount: row.amount || 1,
      tokenType: row.token_type || 'NFT',
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

async function getOfferById(offerId) {
  try {
    const { data, error } = await supabase
      .from('nft_offers')
      .select('*')
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
    console.error('[DB] Error getting offer by ID:', error);
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
  
  // Listings
  createListing,
  getListing,
  getActiveListings,
  updateListing,
  getUserListings,
  
  // Offers
  createOffer,
  getOffer,
  getOfferById,
  getOffersForListing,
  getUserOffers,
  updateOffer,
  cleanupExpiredOffers,
  cleanupExpiredListings
};

