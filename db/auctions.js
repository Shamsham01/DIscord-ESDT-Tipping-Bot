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
      nftImageUrl: data.nft_image_url,
      title: data.title,
      description: data.description,
      duration: data.duration,
      endTime: data.end_time,
      tokenTicker: data.token_ticker,
      startingAmount: data.starting_amount,
      minBidIncrease: data.min_bid_increase,
      currentBid: data.current_bid,
      highestBidderId: data.highest_bidder_id,
      highestBidderTag: data.highest_bidder_tag,
      messageId: data.message_id,
      threadId: data.thread_id,
      channelId: data.channel_id,
      status: data.status,
      createdAt: data.created_at
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
    const { error } = await supabase
      .from('auctions')
      .insert({
        auction_id: auctionId,
        guild_id: guildId,
        creator_id: auctionData.creatorId,
        creator_tag: auctionData.creatorTag || null,
        project_name: auctionData.projectName || null,
        collection: auctionData.collection || null,
        nft_name: auctionData.nftName || null,
        nft_identifier: auctionData.nftIdentifier || null,
        nft_nonce: auctionData.nftNonce || null,
        nft_image_url: auctionData.nftImageUrl || null,
        title: auctionData.title,
        description: auctionData.description || null,
        duration: auctionData.duration || null,
        end_time: auctionData.endTime,
        token_ticker: auctionData.tokenTicker,
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
      });
    
    if (error) throw error;
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
    if (auctionData.tokenTicker !== undefined) updateData.token_ticker = auctionData.tokenTicker;
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

async function createBid(guildId, auctionId, bidData) {
  try {
    const { error } = await supabase
      .from('auction_bids')
      .insert({
        auction_id: auctionId,
        guild_id: guildId,
        bidder_id: bidData.bidderId,
        bidder_tag: bidData.bidderTag || null,
        bid_amount_wei: bidData.bidAmountWei,
        tx_hash: bidData.txHash || null // Make tx_hash optional for virtual account bids
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

module.exports = {
  getAuction,
  getAuctionsByGuild,
  getActiveAuctions,
  createAuction,
  updateAuction,
  createBid,
  getBidsByAuction
};

