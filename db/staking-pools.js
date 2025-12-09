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
    
    // Get all rewards that should be expired (grouped by pool)
    const { data: rewardsToExpire, error: fetchError } = await supabase
      .from('staking_pool_user_rewards')
      .select('*')
      .eq('claimed', false)
      .eq('expired', false)
      .lt('created_at', new Date(twentyFourHoursAgo).toISOString());
    
    if (fetchError) throw fetchError;
    
    if (!rewardsToExpire || rewardsToExpire.length === 0) {
      return { expiredCount: 0, poolsUpdated: [] };
    }
    
    // Group rewards by pool_id and guild_id to calculate totals
    const poolRewards = {};
    for (const reward of rewardsToExpire) {
      const key = `${reward.guild_id}:${reward.pool_id}`;
      if (!poolRewards[key]) {
        poolRewards[key] = {
          guildId: reward.guild_id,
          poolId: reward.pool_id,
          totalWei: new BigNumber('0')
        };
      }
      poolRewards[key].totalWei = poolRewards[key].totalWei.plus(new BigNumber(reward.reward_amount_wei));
    }
    
    // Mark rewards as expired
    const { error: updateError } = await supabase
      .from('staking_pool_user_rewards')
      .update({
        expired: true
      })
      .eq('claimed', false)
      .eq('expired', false)
      .lt('created_at', new Date(twentyFourHoursAgo).toISOString());
    
    if (updateError) throw updateError;
    
    // Return expired rewards to pool supply
    const poolsUpdated = [];
    for (const [key, poolData] of Object.entries(poolRewards)) {
      try {
        const pool = await getStakingPool(poolData.guildId, poolData.poolId);
        if (pool) {
          const currentSupplyBN = new BigNumber(pool.currentSupplyWei);
          const newSupplyBN = currentSupplyBN.plus(poolData.totalWei);
          
          await updateStakingPool(poolData.guildId, poolData.poolId, {
            currentSupplyWei: newSupplyBN.toString()
          });
          
          poolsUpdated.push({
            poolId: poolData.poolId,
            guildId: poolData.guildId,
            returnedWei: poolData.totalWei.toString()
          });
          
          console.log(`[STAKING] Returned ${poolData.totalWei.dividedBy(new BigNumber(10).pow(pool.rewardTokenDecimals || 18)).toString()} ${pool.rewardTokenTicker} to pool ${poolData.poolId} from expired rewards`);
        }
      } catch (poolError) {
        console.error(`[DB] Error returning expired rewards to pool ${poolData.poolId}:`, poolError);
      }
    }
    
    return { expiredCount: rewardsToExpire.length, poolsUpdated };
  } catch (error) {
    console.error('[DB] Error expiring old rewards:', error);
    throw error;
  }
}

async function getDistributionStats(guildId, poolId, distributionId) {
  try {
    // Get all rewards for this distribution
    const { data: rewards, error } = await supabase
      .from('staking_pool_user_rewards')
      .select('*')
      .eq('pool_id', poolId)
      .eq('guild_id', guildId)
      .eq('distribution_id', distributionId);
    
    if (error) throw error;
    
    if (!rewards || rewards.length === 0) {
      return {
        totalRewardsWei: '0',
        claimedRewardsWei: '0',
        unclaimedRewardsWei: '0',
        expiredRewardsWei: '0',
        totalUsers: 0,
        claimedUsers: 0,
        unclaimedUsers: 0,
        expiredUsers: 0
      };
    }
    
    let totalRewardsBN = new BigNumber('0');
    let claimedRewardsBN = new BigNumber('0');
    let unclaimedRewardsBN = new BigNumber('0');
    let expiredRewardsBN = new BigNumber('0');
    
    const claimedUserIds = new Set();
    const unclaimedUserIds = new Set();
    const expiredUserIds = new Set();
    
    for (const reward of rewards) {
      const rewardBN = new BigNumber(reward.reward_amount_wei);
      totalRewardsBN = totalRewardsBN.plus(rewardBN);
      
      if (reward.claimed) {
        claimedRewardsBN = claimedRewardsBN.plus(rewardBN);
        claimedUserIds.add(reward.user_id);
      } else if (reward.expired) {
        expiredRewardsBN = expiredRewardsBN.plus(rewardBN);
        expiredUserIds.add(reward.user_id);
      } else {
        unclaimedRewardsBN = unclaimedRewardsBN.plus(rewardBN);
        unclaimedUserIds.add(reward.user_id);
      }
    }
    
    return {
      totalRewardsWei: totalRewardsBN.toString(),
      claimedRewardsWei: claimedRewardsBN.toString(),
      unclaimedRewardsWei: unclaimedRewardsBN.toString(),
      expiredRewardsWei: expiredRewardsBN.toString(),
      totalUsers: rewards.length,
      claimedUsers: claimedUserIds.size,
      unclaimedUsers: unclaimedUserIds.size,
      expiredUsers: expiredUserIds.size
    };
  } catch (error) {
    console.error('[DB] Error getting distribution stats:', error);
    throw error;
  }
}

async function getDistributionsForSummary() {
  try {
    // Get distributions that were created 24 hours ago (ready for summary)
    // Check for distributions between 23-25 hours ago to catch them reliably
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
    const twentyThreeHoursAgo = Date.now() - (23 * 60 * 60 * 1000);
    
    // Try to query with summary_posted filter, but handle case where column doesn't exist yet
    let query = supabase
      .from('staking_pool_reward_distributions')
      .select('*')
      .gte('distributed_at', twentyFiveHoursAgo)
      .lte('distributed_at', twentyThreeHoursAgo);
    
    const { data, error } = await query;
    
    if (error) {
      // If column doesn't exist, query without the filter
      if (error.code === '42703' || error.message.includes('summary_posted')) {
        const { data: allData, error: retryError } = await supabase
          .from('staking_pool_reward_distributions')
          .select('*')
          .gte('distributed_at', twentyFiveHoursAgo)
          .lte('distributed_at', twentyThreeHoursAgo);
        
        if (retryError) throw retryError;
        // Filter manually - only include if summary_posted is false or doesn't exist
        return (allData || []).filter(dist => !dist.summary_posted);
      }
      throw error;
    }
    
    // Filter to only include distributions that haven't had summaries posted
    return (data || []).filter(dist => !dist.summary_posted);
  } catch (error) {
    console.error('[DB] Error getting distributions for summary:', error);
    throw error;
  }
}

async function markDistributionSummaryPosted(guildId, distributionId) {
  try {
    const { error } = await supabase
      .from('staking_pool_reward_distributions')
      .update({ summary_posted: true })
      .eq('guild_id', guildId)
      .eq('distribution_id', distributionId);
    
    // If column doesn't exist, that's okay - we'll handle it gracefully
    if (error && error.code !== '42703' && !error.message.includes('summary_posted')) {
      throw error;
    }
    
    return true;
  } catch (error) {
    console.error('[DB] Error marking distribution summary as posted:', error);
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
  expireOldRewards,
  getDistributionStats,
  getDistributionsForSummary,
  markDistributionSummaryPosted
};

