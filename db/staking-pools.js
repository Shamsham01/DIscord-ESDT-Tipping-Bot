const supabase = require('../supabase-client');
const BigNumber = require('bignumber.js');

// ============================================
// POOL MANAGEMENT
// ============================================

async function createStakingPool(guildId, poolData) {
  try {
    const { data, error } = await supabase
      .from('staking_pools')
      .insert({
        pool_id: poolData.poolId,
        guild_id: guildId,
        creator_id: poolData.creatorId,
        creator_tag: poolData.creatorTag,
        pool_name: poolData.poolName || null,
        collection_ticker: poolData.collectionTicker,
        collection_name: poolData.collectionName,
        collection_image_url: poolData.collectionImageUrl || null,
        reward_token_identifier: poolData.rewardTokenIdentifier,
        reward_token_ticker: poolData.rewardTokenTicker,
        reward_token_decimals: poolData.rewardTokenDecimals,
        initial_supply_wei: poolData.initialSupplyWei,
        current_supply_wei: poolData.initialSupplyWei,
        reward_per_nft_per_day_wei: poolData.rewardPerNftPerDayWei,
        staking_total_limit: poolData.stakingTotalLimit || null,
        staking_limit_per_user: poolData.stakingLimitPerUser || null,
        duration_months: poolData.durationMonths || null,
        trait_filters: poolData.traitFilters || null,
        created_at: poolData.createdAt,
        expires_at: poolData.expiresAt || null,
        next_reward_distribution_at: poolData.nextRewardDistributionAt,
        channel_id: poolData.channelId,
        message_id: poolData.messageId,
        thread_id: poolData.threadId || null,
        status: 'ACTIVE'
      })
      .select()
      .single();
    
    if (error) throw error;
    return mapPoolFromDb(data);
  } catch (error) {
    console.error('[DB] Error creating staking pool:', error);
    throw error;
  }
}

async function getStakingPool(guildId, poolId) {
  try {
    const { data, error } = await supabase
      .from('staking_pools')
      .select('*')
      .eq('guild_id', guildId)
      .eq('pool_id', poolId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data ? mapPoolFromDb(data) : null;
  } catch (error) {
    console.error('[DB] Error getting staking pool:', error);
    throw error;
  }
}

async function getStakingPoolsByGuild(guildId, status = null) {
  try {
    let query = supabase
      .from('staking_pools')
      .select('*')
      .eq('guild_id', guildId);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    return (data || []).map(mapPoolFromDb);
  } catch (error) {
    console.error('[DB] Error getting staking pools:', error);
    throw error;
  }
}

async function getStakingPoolsByCreator(guildId, creatorId) {
  try {
    const { data, error } = await supabase
      .from('staking_pools')
      .select('*')
      .eq('guild_id', guildId)
      .eq('creator_id', creatorId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return (data || []).map(mapPoolFromDb);
  } catch (error) {
    console.error('[DB] Error getting pools by creator:', error);
    throw error;
  }
}

async function updateStakingPool(guildId, poolId, updates) {
  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (updates.currentSupplyWei !== undefined) updateData.current_supply_wei = updates.currentSupplyWei;
    if (updates.rewardPerNftPerDayWei !== undefined) updateData.reward_per_nft_per_day_wei = updates.rewardPerNftPerDayWei;
    if (updates.stakingTotalLimit !== undefined) updateData.staking_total_limit = updates.stakingTotalLimit;
    if (updates.stakingLimitPerUser !== undefined) updateData.staking_limit_per_user = updates.stakingLimitPerUser;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.nextRewardDistributionAt !== undefined) updateData.next_reward_distribution_at = updates.nextRewardDistributionAt;
    if (updates.lastRewardDistributionAt !== undefined) updateData.last_reward_distribution_at = updates.lastRewardDistributionAt;
    if (updates.lowSupplyWarningAt !== undefined) updateData.low_supply_warning_at = updates.lowSupplyWarningAt;
    if (updates.autoCloseAt !== undefined) updateData.auto_close_at = updates.autoCloseAt;
    if (updates.totalNftsStaked !== undefined) updateData.total_nfts_staked = updates.totalNftsStaked;
    if (updates.uniqueStakersCount !== undefined) updateData.unique_stakers_count = updates.uniqueStakersCount;
    if (updates.traitFilters !== undefined) updateData.trait_filters = updates.traitFilters;
    if (updates.messageId !== undefined) updateData.message_id = updates.messageId;
    if (updates.threadId !== undefined) updateData.thread_id = updates.threadId;
    if (updates.collectionImageUrl !== undefined) updateData.collection_image_url = updates.collectionImageUrl;
    
    const { data, error } = await supabase
      .from('staking_pools')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('pool_id', poolId)
      .select()
      .single();
    
    if (error) throw error;
    return mapPoolFromDb(data);
  } catch (error) {
    console.error('[DB] Error updating staking pool:', error);
    throw error;
  }
}

async function getPoolsForRewardDistribution() {
  try {
    const now = Date.now();
    const { data, error } = await supabase
      .from('staking_pools')
      .select('*')
      .eq('status', 'ACTIVE')
      .lte('next_reward_distribution_at', now);
    
    if (error) throw error;
    return (data || []).map(mapPoolFromDb);
  } catch (error) {
    console.error('[DB] Error getting pools for distribution:', error);
    throw error;
  }
}

async function getPoolsForAutoClose() {
  try {
    const now = Date.now();
    const { data, error } = await supabase
      .from('staking_pools')
      .select('*')
      .eq('status', 'PAUSED')
      .not('auto_close_at', 'is', null)
      .lte('auto_close_at', now);
    
    if (error) throw error;
    return (data || []).map(mapPoolFromDb);
  } catch (error) {
    console.error('[DB] Error getting pools for auto-close:', error);
    throw error;
  }
}

function mapPoolFromDb(data) {
  return {
    poolId: data.pool_id,
    guildId: data.guild_id,
    creatorId: data.creator_id,
    creatorTag: data.creator_tag,
    poolName: data.pool_name,
    collectionTicker: data.collection_ticker,
    collectionName: data.collection_name,
    collectionImageUrl: data.collection_image_url,
    rewardTokenIdentifier: data.reward_token_identifier,
    rewardTokenTicker: data.reward_token_ticker,
    rewardTokenDecimals: data.reward_token_decimals,
    initialSupplyWei: data.initial_supply_wei,
    currentSupplyWei: data.current_supply_wei,
    rewardPerNftPerDayWei: data.reward_per_nft_per_day_wei,
    stakingTotalLimit: data.staking_total_limit,
    stakingLimitPerUser: data.staking_limit_per_user,
    durationMonths: data.duration_months,
    traitFilters: data.trait_filters,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    nextRewardDistributionAt: data.next_reward_distribution_at,
    lastRewardDistributionAt: data.last_reward_distribution_at,
    lowSupplyWarningAt: data.low_supply_warning_at,
    autoCloseAt: data.auto_close_at,
    channelId: data.channel_id,
    messageId: data.message_id,
    threadId: data.thread_id,
    status: data.status,
    totalNftsStaked: data.total_nfts_staked || 0,
    uniqueStakersCount: data.unique_stakers_count || 0
  };
}

// ============================================
// STAKING BALANCES
// ============================================

async function stakeNFT(guildId, poolId, userId, nftData) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_balances')
      .insert({
        pool_id: poolId,
        guild_id: guildId,
        user_id: userId,
        collection: nftData.collection,
        identifier: nftData.identifier,
        nonce: nftData.nonce,
        nft_name: nftData.nftName || null,
        nft_image_url: nftData.nftImageUrl || null,
        staked_at: Date.now(),
        lock_until: nftData.lockUntil || null,
        unstake_priority: Date.now() // Now BIGINT, can store full timestamp
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Update pool statistics
    await updatePoolStatistics(guildId, poolId);
    
    return data;
  } catch (error) {
    console.error('[DB] Error staking NFT:', error);
    throw error;
  }
}

async function unstakeNFT(guildId, poolId, userId, collection, nonce) {
  try {
    const { error } = await supabase
      .from('staking_pool_balances')
      .delete()
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('collection', collection)
      .eq('nonce', nonce);
    
    if (error) throw error;
    
    // Update pool statistics
    await updatePoolStatistics(guildId, poolId);
    
    return true;
  } catch (error) {
    console.error('[DB] Error unstaking NFT:', error);
    throw error;
  }
}

async function getUserStakedNFTs(guildId, poolId, userId) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_balances')
      .select('*')
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('staked_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[DB] Error getting user staked NFTs:', error);
    throw error;
  }
}

async function getAllStakedNFTs(guildId, poolId) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_balances')
      .select('*')
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .order('staked_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[DB] Error getting all staked NFTs:', error);
    throw error;
  }
}

async function updatePoolStatistics(guildId, poolId) {
  try {
    // Count total NFTs staked
    const { count: totalNfts, error: countError } = await supabase
      .from('staking_pool_balances')
      .select('*', { count: 'exact', head: true })
      .eq('pool_id', poolId)
      .eq('guild_id', guildId);
    
    if (countError) throw countError;
    
    // Count unique stakers
    const { data: stakersData, error: uniqueError } = await supabase
      .from('staking_pool_balances')
      .select('user_id')
      .eq('pool_id', poolId)
      .eq('guild_id', guildId);
    
    if (uniqueError) throw uniqueError;
    
    const uniqueStakers = new Set((stakersData || []).map(s => s.user_id)).size;
    
    // Update pool
    await updateStakingPool(guildId, poolId, {
      totalNftsStaked: totalNfts || 0,
      uniqueStakersCount: uniqueStakers || 0
    });
    
    return { totalNfts: totalNfts || 0, uniqueStakers: uniqueStakers || 0 };
  } catch (error) {
    console.error('[DB] Error updating pool statistics:', error);
    throw error;
  }
}

// ============================================
// RATE LIMITING
// ============================================

async function checkRateLimit(guildId, poolId, userId, actionType) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_rate_limits')
      .select('last_action_at')
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (data) {
      const timeSince = Date.now() - data.last_action_at;
      if (timeSince < 60000) { // 1 minute
        return {
          allowed: false,
          waitSeconds: Math.ceil((60000 - timeSince) / 1000)
        };
      }
    }
    
    // Update/insert rate limit record
    await supabase
      .from('staking_pool_rate_limits')
      .upsert({
        pool_id: poolId,
        guild_id: guildId,
        user_id: userId,
        action_type: actionType,
        last_action_at: Date.now()
      }, {
        onConflict: 'pool_id,guild_id,user_id,action_type'
      });
    
    return { allowed: true };
  } catch (error) {
    console.error('[DB] Error checking rate limit:', error);
    throw error;
  }
}

// ============================================
// REWARD DISTRIBUTIONS
// ============================================

async function createRewardDistribution(guildId, distributionData) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_reward_distributions')
      .insert({
        pool_id: distributionData.poolId,
        guild_id: guildId,
        distribution_id: distributionData.distributionId,
        total_rewards_paid_wei: distributionData.totalRewardsPaidWei,
        total_rewards_paid_usd: distributionData.totalRewardsPaidUsd || 0,
        nfts_staked_at_time: distributionData.nftsStakedAtTime,
        unique_stakers_at_time: distributionData.uniqueStakersAtTime,
        distributed_at: distributionData.distributedAt,
        next_distribution_at: distributionData.nextDistributionAt,
        thread_id: distributionData.threadId || null,
        notification_message_id: distributionData.notificationMessageId || null
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[DB] Error creating reward distribution:', error);
    throw error;
  }
}

async function createUserReward(guildId, rewardData) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_user_rewards')
      .insert({
        pool_id: rewardData.poolId,
        guild_id: guildId,
        user_id: rewardData.userId,
        distribution_id: rewardData.distributionId,
        nfts_staked_count: rewardData.nftsStakedCount,
        reward_amount_wei: rewardData.rewardAmountWei,
        reward_amount_usd: rewardData.rewardAmountUsd || 0,
        claimed: false,
        expired: false
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[DB] Error creating user reward:', error);
    throw error;
  }
}

async function getUserUnclaimedRewards(guildId, poolId, userId) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_user_rewards')
      .select('*')
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('claimed', false)
      .eq('expired', false)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[DB] Error getting user unclaimed rewards:', error);
    throw error;
  }
}

async function claimUserReward(guildId, poolId, userId, distributionId) {
  try {
    const { data, error } = await supabase
      .from('staking_pool_user_rewards')
      .update({
        claimed: true,
        claimed_at: Date.now()
      })
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('distribution_id', distributionId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[DB] Error claiming user reward:', error);
    throw error;
  }
}

async function expireOldRewards() {
  try {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    const { error } = await supabase
      .from('staking_pool_user_rewards')
      .update({
        expired: true
      })
      .eq('claimed', false)
      .eq('expired', false)
      .lt('created_at', new Date(twentyFourHoursAgo).toISOString());
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error expiring old rewards:', error);
    throw error;
  }
}

module.exports = {
  // Pool Management
  createStakingPool,
  getStakingPool,
  getStakingPoolsByGuild,
  getStakingPoolsByCreator,
  updateStakingPool,
  getPoolsForRewardDistribution,
  getPoolsForAutoClose,
  
  // Staking Balances
  stakeNFT,
  unstakeNFT,
  getUserStakedNFTs,
  getAllStakedNFTs,
  updatePoolStatistics,
  
  // Rate Limiting
  checkRateLimit,
  
  // Rewards
  createRewardDistribution,
  createUserReward,
  getUserUnclaimedRewards,
  claimUserReward,
  expireOldRewards
};

