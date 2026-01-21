const fetch = require('node-fetch');
const BigNumber = require('bignumber.js');

// Calculate supporter status multiplier based on NFT count
function calculateSupporterStatus(nftCount) {
  if (!nftCount || nftCount === 0) {
    return { status: 'Plankton', multiplier: 1 };
  }
  
  if (nftCount >= 500) {
    return { status: 'Mega Whale', multiplier: 10 };
  } else if (nftCount >= 250) {
    return { status: 'Whale', multiplier: 8 };
  } else if (nftCount >= 100) {
    return { status: 'Shark', multiplier: 5 };
  } else if (nftCount >= 50) {
    return { status: 'Dolphin', multiplier: 4 };
  } else if (nftCount >= 25) {
    return { status: 'Crab', multiplier: 3 };
  } else if (nftCount >= 10) {
    return { status: 'Fish', multiplier: 2 };
  } else {
    return { status: 'Plankton', multiplier: 1 };
  }
}

// Get user NFT count from MultiversX API
// Returns: { success: boolean, count: number, error?: string }
async function getUserNFTCount(walletAddress, collectionIdentifier) {
  try {
    if (!walletAddress || !collectionIdentifier) {
      return { success: false, count: 0, error: 'Missing wallet address or collection identifier' };
    }
    
    const url = `https://api.multiversx.com/accounts/${walletAddress}/collections/${collectionIdentifier}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        // User doesn't own any NFTs from this collection
        return { success: true, count: 0 };
      }
      throw new Error(`API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract count from response
    const count = data.count || 0;
    
    return { success: true, count: parseInt(count, 10) || 0 };
  } catch (error) {
    console.error(`[DROP] Error fetching NFT count for ${walletAddress} in collection ${collectionIdentifier}:`, error.message);
    // Return default multiplier on error (Plankton = x1)
    return { success: false, count: 0, error: error.message };
  }
}

// Calculate weekly airdrop amount
// Formula: points × baseAmount × multiplier
function calculateWeeklyAirdrop(points, baseAmountWei, multiplier) {
  try {
    const pointsBN = new BigNumber(points || 0);
    const baseAmountBN = new BigNumber(baseAmountWei || '0');
    const multiplierBN = new BigNumber(multiplier || 1);
    
    if (pointsBN.isLessThanOrEqualTo(0) || baseAmountBN.isLessThanOrEqualTo(0)) {
      return '0';
    }
    
    const airdropAmount = pointsBN.multipliedBy(baseAmountBN).multipliedBy(multiplierBN);
    
    return airdropAmount.toString();
  } catch (error) {
    console.error('[DROP] Error calculating weekly airdrop:', error);
    return '0';
  }
}

// Get week boundaries (Sunday 18:00 ECT)
// Returns: { weekStart: number, weekEnd: number }
function getWeekBoundaries(timestamp = Date.now()) {
  try {
    // ECT timezone offset (Europe/Copenhagen)
    // Note: ECT is UTC+1 in winter (CET) and UTC+2 in summer (CEST)
    // For simplicity, we'll use a fixed offset approach, but ideally should use a timezone library
    
    // Convert timestamp to Date object
    const date = new Date(timestamp);
    
    // Get current day of week (0 = Sunday, 6 = Saturday)
    const dayOfWeek = date.getUTCDay();
    
    // Calculate days to subtract to get to most recent Sunday
    const daysToSubtract = dayOfWeek === 0 ? 0 : dayOfWeek;
    
    // Create date for most recent Sunday at 00:00 UTC
    const sundayUTC = new Date(date);
    sundayUTC.setUTCDate(date.getUTCDate() - daysToSubtract);
    sundayUTC.setUTCHours(0, 0, 0, 0);
    
    // Convert to ECT (UTC+1, but we'll use UTC+2 for CEST which is more common in summer)
    // Actually, let's use a more accurate approach - check if we're in DST
    // For now, use UTC+1 (CET) as base, but this should be improved with proper timezone handling
    const ectOffset = 1; // UTC+1 for CET (winter time)
    
    // Set to Sunday 18:00 ECT (which is 17:00 UTC in winter, 16:00 UTC in summer)
    // For simplicity, use 17:00 UTC (18:00 CET)
    sundayUTC.setUTCHours(17, 0, 0, 0);
    
    // If current time is before Sunday 18:00 ECT, go back one week
    const currentTimeUTC = date.getTime();
    const sunday1800UTC = sundayUTC.getTime();
    
    let weekStart;
    let weekEnd;
    
    if (currentTimeUTC < sunday1800UTC) {
      // Current time is before this week's Sunday 18:00, so use previous week
      weekStart = sunday1800UTC - (7 * 24 * 60 * 60 * 1000);
      weekEnd = sunday1800UTC;
    } else {
      // Current time is after this week's Sunday 18:00, so use current week
      weekStart = sunday1800UTC;
      weekEnd = sunday1800UTC + (7 * 24 * 60 * 60 * 1000);
    }
    
    return { weekStart, weekEnd };
  } catch (error) {
    console.error('[DROP] Error calculating week boundaries:', error);
    // Fallback: return current week boundaries
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    return { weekStart: now, weekEnd: now + oneWeek };
  }
}

// Check if current time is Sunday 18:00 ECT (within a 1-hour window)
function isSunday1800ECT() {
  try {
    const now = Date.now();
    const { weekStart } = getWeekBoundaries(now);
    
    // Check if we're within 1 hour after weekStart (Sunday 18:00 ECT)
    const oneHour = 60 * 60 * 1000;
    const timeSinceWeekStart = now - weekStart;
    
    // Return true if we're within 0-1 hour after Sunday 18:00 ECT
    return timeSinceWeekStart >= 0 && timeSinceWeekStart < oneHour;
  } catch (error) {
    console.error('[DROP] Error checking if Sunday 18:00 ECT:', error);
    return false;
  }
}

// Get current week boundaries
function getCurrentWeekBoundaries() {
  return getWeekBoundaries(Date.now());
}

// Get previous week boundaries (for airdrop distribution)
function getPreviousWeekBoundaries() {
  const now = Date.now();
  const { weekStart } = getWeekBoundaries(now);
  
  // If we're past Sunday 18:00, previous week is the one that just ended
  // Otherwise, go back one more week
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  
  if (now >= weekStart) {
    // We're in current week, previous week is weekStart - 1 week to weekStart
    return {
      weekStart: weekStart - oneWeek,
      weekEnd: weekStart
    };
  } else {
    // We're before current week start, so previous week is 2 weeks ago
    return {
      weekStart: weekStart - (2 * oneWeek),
      weekEnd: weekStart - oneWeek
    };
  }
}

// Format countdown timer (returns string like "45m 30s")
function formatCountdown(milliseconds) {
  if (milliseconds <= 0) {
    return '0s';
  }
  
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

module.exports = {
  calculateSupporterStatus,
  getUserNFTCount,
  calculateWeeklyAirdrop,
  getWeekBoundaries,
  isSunday1800ECT,
  getCurrentWeekBoundaries,
  getPreviousWeekBoundaries,
  formatCountdown
};
