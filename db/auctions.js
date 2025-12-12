const supabase = require('../supabase-client');

async function getAuction(guildId, auctionId) {
  try {
    const { data, error } = await supabase
      .from('auctions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    // Infer source from project_name: NULL = virtual_account, has value = project_wallet
    const inferredSource = data.project_name ? 'project_wallet' : 'virtual_account';
    
    // Use token_ticker as token_identifier if it contains '-', otherwise resolve it
    const tokenIdentifier = data.token_identifier || (data.token_ticker?.includes('-') ? data.token_ticker : null);
    const tokenTicker = data.token_ticker?.includes('-') ? data.token_ticker.split('-')[0] : data.token_ticker;
    
    return {
      auctionId: data.auction_id,
      guildId: data.guild_id,
      creatorId: data.creator_id,
      creatorTag: data.creator_tag,
      projectName: data.project_name,
      collection: data.collection,
      nftName: data.nft_name,
      nftIdentifier: data.nft_identifier,
      nftNonce: data.nft_nonce,
      amount: data.amount || 1,
      tokenType: data.token_type || 'NFT',
      nftImageUrl: data.nft_image_url,
      title: data.title,
      description: data.description,
      duration: data.duration,
      endTime: data.end_time,
      tokenTicker: tokenTicker || data.token_ticker, // Display ticker (extracted from identifier if needed)
      tokenIdentifier: tokenIdentifier || data.token_ticker, // Full identifier (use token_ticker if it's already an identifier)
      startingAmount: data.starting_amount,
      minBidIncrease: data.min_bid_increase,
      currentBid: data.current_bid,
      highestBidderId: data.highest_bidder_id,
      highestBidderTag: data.highest_bidder_tag,
      messageId: data.message_id,
      threadId: data.thread_id,
      channelId: data.channel_id,
      status: data.status,
      createdAt: data.created_at,
      source: data.source || inferredSource, // Use stored source or infer from project_name
      sellerId: data.seller_id
    };
  } catch (error) {
    console.error('[DB] Error getting auction:', error);
    throw error;
  }
}

async function getAuctionsByGuild(guildId) {
  try {
    const { data, error } = await supabase
      .from('auctions')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const auctions = {};
    (data || []).forEach(row => {
      // Infer source from project_name: NULL = virtual_account, has value = project_wallet
      const inferredSource = row.project_name ? 'project_wallet' : 'virtual_account';
      
      // Use token_ticker as token_identifier if it contains '-', otherwise resolve it
      const tokenIdentifier = row.token_identifier || (row.token_ticker?.includes('-') ? row.token_ticker : null);
      const tokenTicker = row.token_ticker?.includes('-') ? row.token_ticker.split('-')[0] : row.token_ticker;
      
      auctions[row.auction_id] = {
        auctionId: row.auction_id,
        guildId: row.guild_id,
        creatorId: row.creator_id,
        creatorTag: row.creator_tag,
        projectName: row.project_name,
        collection: row.collection,
        nftName: row.nft_name,
        nftIdentifier: row.nft_identifier,
        nftNonce: row.nft_nonce,
        amount: row.amount || 1,
        tokenType: row.token_type || 'NFT',
        nftImageUrl: row.nft_image_url,
        title: row.title,
        description: row.description,
        duration: row.duration,
        endTime: row.end_time,
        tokenTicker: tokenTicker || row.token_ticker, // Display ticker
        tokenIdentifier: tokenIdentifier || row.token_ticker, // Full identifier
        startingAmount: row.starting_amount,
        minBidIncrease: row.min_bid_increase,
        currentBid: row.current_bid,
        highestBidderId: row.highest_bidder_id,
        highestBidderTag: row.highest_bidder_tag,
        messageId: row.message_id,
        threadId: row.thread_id,
        channelId: row.channel_id,
        status: row.status,
        createdAt: row.created_at,
        source: row.source || inferredSource, // Use stored source or infer
        sellerId: row.seller_id
      };
    });
    return auctions;
  } catch (error) {
    console.error('[DB] Error getting auctions by guild:', error);
    throw error;
  }
}

async function getActiveAuctions(guildId) {
  try {
    const { data, error } = await supabase
      .from('auctions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      auctionId: row.auction_id,
      guildId: row.guild_id,
      creatorId: row.creator_id,
      creatorTag: row.creator_tag,
      projectName: row.project_name,
      collection: row.collection,
      nftName: row.nft_name,
      nftIdentifier: row.nft_identifier,
      nftNonce: row.nft_nonce,
      amount: row.amount || 1,
      tokenType: row.token_type || 'NFT',
      nftImageUrl: row.nft_image_url,
      title: row.title,
      description: row.description,
      duration: row.duration,
      endTime: row.end_time,
      tokenTicker: row.token_ticker,
      startingAmount: row.starting_amount,
      minBidIncrease: row.min_bid_increase,
      currentBid: row.current_bid,
      highestBidderId: row.highest_bidder_id,
      highestBidderTag: row.highest_bidder_tag,
      messageId: row.message_id,
      threadId: row.thread_id,
      channelId: row.channel_id,
      status: row.status,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting active auctions:', error);
    throw error;
  }
}

async function createAuction(guildId, auctionId, auctionData) {
  try {
    // Store token_identifier in token_ticker column (repurposed)
    // If tokenIdentifier is provided, use it; otherwise use tokenTicker (which might already be an identifier)
    const tokenTickerValue = auctionData.tokenIdentifier || auctionData.tokenTicker;
    
    // Build insert data - repurpose columns:
    // - project_name: stores project name (NULL for virtual_account auctions)
    // - token_ticker: stores full token identifier (e.g., "REWARD-cf6eac")
    // - seller_id: only new column needed
    const insertData = {
      auction_id: auctionId,
      guild_id: guildId,
      creator_id: auctionData.creatorId,
      creator_tag: auctionData.creatorTag || null,
      project_name: auctionData.projectName || null, // NULL = virtual_account, value = project_wallet
      collection: auctionData.collection || null,
      nft_name: auctionData.nftName || null,
      nft_identifier: auctionData.nftIdentifier || null,
      nft_nonce: auctionData.nftNonce || null,
      nft_image_url: auctionData.nftImageUrl || null,
      title: auctionData.title,
      description: auctionData.description || null,
      duration: auctionData.duration || null,
      end_time: auctionData.endTime,
      token_ticker: tokenTickerValue, // Store full identifier here
      starting_amount: auctionData.startingAmount,
      min_bid_increase: auctionData.minBidIncrease || null,
      current_bid: auctionData.currentBid || null,
      highest_bidder_id: auctionData.highestBidderId || null,
      highest_bidder_tag: auctionData.highestBidderTag || null,
      message_id: auctionData.messageId || null,
      thread_id: auctionData.threadId || null,
      channel_id: auctionData.channelId || null,
      status: auctionData.status || 'ACTIVE',
      created_at: auctionData.createdAt || Date.now()
    };

    // Try to include seller_id, amount, and token_type (new columns)
    const amount = auctionData.amount || 1;
    const tokenType = auctionData.tokenType || (amount > 1 ? 'SFT' : 'NFT');
    let insertWithSellerId = {
      ...insertData,
      seller_id: auctionData.sellerId || null,
      amount: amount,
      token_type: tokenType
    };

    let { error } = await supabase
      .from('auctions')
      .insert(insertWithSellerId);
    
    // If error is about missing seller_id column, retry without it
    if (error && (error.message?.includes('seller_id') || error.code === '42703')) {
      console.warn('[DB] seller_id column not found, inserting without it. Please run migration to add seller_id column.');
      // Retry without seller_id
      const { error: retryError } = await supabase
        .from('auctions')
        .insert(insertData);
      
      if (retryError) throw retryError;
      
      if (auctionData.sellerId) {
        console.warn(`[DB] Auction ${auctionId} created without seller_id field. Run migration and update manually if needed.`);
      }
    } else if (error) {
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error creating auction:', error);
    throw error;
  }
}

async function updateAuction(guildId, auctionId, auctionData) {
  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (auctionData.creatorId !== undefined) updateData.creator_id = auctionData.creatorId;
    if (auctionData.creatorTag !== undefined) updateData.creator_tag = auctionData.creatorTag;
    if (auctionData.projectName !== undefined) updateData.project_name = auctionData.projectName;
    if (auctionData.collection !== undefined) updateData.collection = auctionData.collection;
    if (auctionData.nftName !== undefined) updateData.nft_name = auctionData.nftName;
    if (auctionData.nftIdentifier !== undefined) updateData.nft_identifier = auctionData.nftIdentifier;
    if (auctionData.nftNonce !== undefined) updateData.nft_nonce = auctionData.nftNonce;
    if (auctionData.nftImageUrl !== undefined) updateData.nft_image_url = auctionData.nftImageUrl;
    if (auctionData.title !== undefined) updateData.title = auctionData.title;
    if (auctionData.description !== undefined) updateData.description = auctionData.description;
    if (auctionData.duration !== undefined) updateData.duration = auctionData.duration;
    if (auctionData.endTime !== undefined) updateData.end_time = auctionData.endTime;
    // Store token_identifier in token_ticker column (repurposed)
    if (auctionData.tokenIdentifier !== undefined) {
      updateData.token_ticker = auctionData.tokenIdentifier; // Store full identifier
    } else if (auctionData.tokenTicker !== undefined) {
      updateData.token_ticker = auctionData.tokenTicker;
    }
    if (auctionData.startingAmount !== undefined) updateData.starting_amount = auctionData.startingAmount;
    if (auctionData.minBidIncrease !== undefined) updateData.min_bid_increase = auctionData.minBidIncrease;
    if (auctionData.currentBid !== undefined) updateData.current_bid = auctionData.currentBid;
    if (auctionData.highestBidderId !== undefined) updateData.highest_bidder_id = auctionData.highestBidderId;
    if (auctionData.highestBidderTag !== undefined) updateData.highest_bidder_tag = auctionData.highestBidderTag;
    if (auctionData.messageId !== undefined) updateData.message_id = auctionData.messageId;
    if (auctionData.threadId !== undefined) updateData.thread_id = auctionData.threadId;
    if (auctionData.channelId !== undefined) updateData.channel_id = auctionData.channelId;
    if (auctionData.status !== undefined) updateData.status = auctionData.status;
    if (auctionData.createdAt !== undefined) updateData.created_at = auctionData.createdAt;
    // source is inferred from project_name, no need to store separately
    if (auctionData.sellerId !== undefined) updateData.seller_id = auctionData.sellerId;
    
    const { error } = await supabase
      .from('auctions')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating auction:', error);
    throw error;
  }
}

// Atomically update auction status from ACTIVE to PROCESSING
// Returns true if the update succeeded (meaning we got the lock), false otherwise
async function trySetProcessingStatus(guildId, auctionId) {
  try {
    // Use a conditional update: only update if status is ACTIVE
    const { data, error } = await supabase
      .from('auctions')
      .update({ 
        status: 'PROCESSING',
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .eq('status', 'ACTIVE')
      .select();
    
    if (error) throw error;
    
    // If data is returned and has length > 0, the update succeeded
    // This means the auction was ACTIVE and we successfully changed it to PROCESSING
    return data && data.length > 0;
  } catch (error) {
    console.error('[DB] Error trying to set PROCESSING status:', error);
    return false;
  }
}

async function createBid(guildId, auctionId, bidData) {
  try {
    const { error } = await supabase
      .from('auction_bids')
      .insert({
        auction_id: auctionId,
        guild_id: guildId,
        bidder_id: bidData.bidderId,
        bidder_tag: bidData.bidderTag || null,
        bid_amount_wei: bidData.bidAmountWei
        // Note: tx_hash removed - all bids are virtual account bids, no blockchain transactions
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating bid:', error);
    throw error;
  }
}

async function getBidsByAuction(guildId, auctionId) {
  try {
    const { data, error } = await supabase
      .from('auction_bids')
      .select('*')
      .eq('guild_id', guildId)
      .eq('auction_id', auctionId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      bidderId: row.bidder_id,
      bidderTag: row.bidder_tag,
      bidAmountWei: row.bid_amount_wei,
      txHash: row.tx_hash,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting bids by auction:', error);
    throw error;
  }
}

async function getUserActiveAuctions(guildId, userId, collection = null, nonce = null) {
  try {
    let query = supabase
      .from('auctions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'ACTIVE')
      .or(`creator_id.eq.${userId},seller_id.eq.${userId}`); // Get auctions where user is creator or seller
    
    if (collection) {
      query = query.eq('collection', collection);
    }
    
    if (nonce !== null) {
      query = query.eq('nft_nonce', nonce);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      auctionId: row.auction_id,
      guildId: row.guild_id,
      creatorId: row.creator_id,
      sellerId: row.seller_id,
      collection: row.collection,
      nftNonce: row.nft_nonce,
      amount: row.amount || 1,
      tokenType: row.token_type || 'NFT'
    }));
  } catch (error) {
    console.error('[DB] Error getting user active auctions:', error);
    throw error;
  }
}

module.exports = {
  getAuction,
  getAuctionsByGuild,
  getActiveAuctions,
  getUserActiveAuctions,
  createAuction,
  updateAuction,
  trySetProcessingStatus,
  createBid,
  getBidsByAuction
};

