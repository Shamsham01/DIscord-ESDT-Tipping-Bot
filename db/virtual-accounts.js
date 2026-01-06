const supabase = require('../supabase-client');
const BigNumber = require('bignumber.js');

async function getUserAccount(guildId, userId, username = null) {
  try {
    const { data, error } = await supabase
      .from('virtual_accounts')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) {
      // Create new account if it doesn't exist
      const now = Date.now();
      const newAccount = {
        guild_id: guildId,
        user_id: userId,
        username: username,
        balances: {},
        created_at: now,
        last_updated: now
      };
      
      const { data: createdData, error: createError } = await supabase
        .from('virtual_accounts')
        .insert(newAccount)
        .select()
        .single();
      
      if (createError) throw createError;
      
      return {
        guildId: createdData.guild_id,
        userId: createdData.user_id,
        username: createdData.username,
        balances: createdData.balances || {},
        createdAt: createdData.created_at,
        lastUpdated: createdData.last_updated
      };
    }
    
    // Update username if provided and different
    if (username && data.username !== username) {
      await supabase
        .from('virtual_accounts')
        .update({ username: username })
        .eq('guild_id', guildId)
        .eq('user_id', userId);
    }
    
    // Sanitize balances - replace "NaN" strings with "0"
    const balances = data.balances || {};
    const sanitizedBalances = {};
    for (const [token, balance] of Object.entries(balances)) {
      if (balance === null || balance === undefined || balance === 'null' || balance === 'undefined' || balance === 'NaN') {
        sanitizedBalances[token] = '0';
      } else {
        // Double-check with BigNumber to catch numeric NaN
        const BigNumber = require('bignumber.js');
        const balanceBN = new BigNumber(balance);
        if (balanceBN.isNaN()) {
          sanitizedBalances[token] = '0';
        } else {
          sanitizedBalances[token] = balance.toString();
        }
      }
    }
    
    return {
      guildId: data.guild_id,
      userId: data.user_id,
      username: data.username,
      balances: sanitizedBalances,
      createdAt: data.created_at,
      lastUpdated: data.last_updated
    };
  } catch (error) {
    console.error('[DB] Error getting user account:', error);
    throw error;
  }
}

async function getAccountBalance(guildId, userId, tokenTicker) {
  try {
    const account = await getUserAccount(guildId, userId);
    const balances = account.balances || {};
    
    // Case-insensitive token lookup
    const tokenKey = Object.keys(balances).find(
      key => key.toLowerCase() === tokenTicker.toLowerCase()
    ) || tokenTicker;
    
    let balance = balances[tokenKey];
    
    // If token doesn't exist in balances, return '0'
    if (balance === undefined || balance === null) {
      console.log(`[DB] Token ${tokenTicker} not found in balances for user ${userId}, returning 0`);
      return '0';
    }
    
    // Sanitize balance value - handle "NaN" string
    if (balance === 'null' || balance === 'undefined' || balance === 'NaN') {
      console.log(`[DB] Invalid balance value "${balance}" for token ${tokenTicker}, returning 0`);
      return '0';
    }
    
    // Check if it's a valid number
    const BigNumber = require('bignumber.js');
    const balanceBN = new BigNumber(balance);
    if (balanceBN.isNaN()) {
      console.log(`[DB] Balance "${balance}" is NaN for token ${tokenTicker}, returning 0`);
      return '0';
    }
    
    return balance.toString();
  } catch (error) {
    console.error('[DB] Error getting account balance:', error);
    // Return '0' on error instead of throwing, to prevent undefined returns
    return '0';
  }
}

async function getAllUserBalances(guildId, userId) {
  try {
    const account = await getUserAccount(guildId, userId);
    return account.balances || {};
  } catch (error) {
    console.error('[DB] Error getting all user balances:', error);
    throw error;
  }
}

async function updateAccountBalance(guildId, userId, tokenIdentifier, amountChange) {
  try {
    // Validate that tokenIdentifier is a full identifier (format: TICKER-6hexchars)
    // This ensures we NEVER store tickers, only identifiers
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      throw new Error(`Invalid token identifier format: "${tokenIdentifier}". Expected format: TICKER-6hexchars (e.g., "USDC-c76f1f"). Tickers are not allowed for security reasons.`);
    }
    
    const account = await getUserAccount(guildId, userId);
    const balances = account.balances || {};
    
    // Find existing token with case-insensitive matching (by identifier only)
    const existingToken = Object.keys(balances).find(
      key => key.toLowerCase() === tokenIdentifier.toLowerCase()
    );
    
    // Use the provided identifier (never fall back to ticker)
    const tokenKey = tokenIdentifier;
    
    // Use BigNumber for large number arithmetic
    const BigNumber = require('bignumber.js');
    
    // Sanitize current balance - handle "NaN" string from database
    let currentBalanceValue = balances[tokenKey] || '0';
    if (currentBalanceValue === 'NaN' || currentBalanceValue === null || currentBalanceValue === undefined) {
      currentBalanceValue = '0';
    }
    const currentBalance = new BigNumber(currentBalanceValue);
    
    // Validate current balance is not NaN
    if (currentBalance.isNaN()) {
      console.warn(`[DB] Current balance for ${tokenKey} is NaN, resetting to 0`);
      currentBalanceValue = '0';
    }
    
    // Validate and sanitize amountChange
    let amountChangeStr = amountChange;
    if (typeof amountChange === 'string' && (amountChange === 'NaN' || isNaN(parseFloat(amountChange)))) {
      throw new Error(`Invalid amount change: ${amountChange}`);
    }
    if (typeof amountChange === 'number' && isNaN(amountChange)) {
      throw new Error(`Invalid amount change: ${amountChange}`);
    }
    amountChangeStr = amountChange.toString();
    
    const change = new BigNumber(amountChangeStr);
    if (change.isNaN()) {
      throw new Error(`Invalid amount change: ${amountChange}`);
    }
    
    const currentBalanceBN = new BigNumber(currentBalanceValue);
    const newBalance = currentBalanceBN.plus(change);
    
    if (newBalance.isNaN()) {
      throw new Error('Balance calculation resulted in NaN');
    }
    
    const newBalanceStr = newBalance.toString();
    balances[tokenKey] = newBalanceStr;
    
    // Sanitize all balances before saving to prevent NaN storage
    const sanitizedBalances = {};
    for (const [token, balance] of Object.entries(balances)) {
      if (balance === null || balance === undefined || balance === 'null' || balance === 'undefined' || balance === 'NaN') {
        sanitizedBalances[token] = '0';
      } else {
        const balanceBN = new BigNumber(balance);
        if (balanceBN.isNaN()) {
          sanitizedBalances[token] = '0';
        } else {
          sanitizedBalances[token] = balance.toString();
        }
      }
    }
    
    const { error } = await supabase
      .from('virtual_accounts')
      .update({
        balances: sanitizedBalances,
        last_updated: Date.now(),
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return newBalanceStr;
  } catch (error) {
    console.error('[DB] Error updating account balance:', error);
    throw error;
  }
}

async function addTransaction(guildId, userId, transaction) {
  try {
    const { error } = await supabase
      .from('virtual_account_transactions')
      .insert({
        guild_id: guildId,
        user_id: userId,
        transaction_id: transaction.id,
        type: transaction.type,
        token: transaction.token,
        amount: transaction.amount,
        balance_before: transaction.balanceBefore,
        balance_after: transaction.balanceAfter,
        tx_hash: transaction.txHash || null,
        source: transaction.source || null,
        timestamp: transaction.timestamp,
        description: transaction.description || null
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error adding transaction:', error);
    throw error;
  }
}

async function getTransactionHistory(guildId, userId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('virtual_account_transactions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.transaction_id,
      type: row.type,
      token: row.token,
      amount: row.amount,
      balanceBefore: row.balance_before,
      balanceAfter: row.balance_after,
      txHash: row.tx_hash,
      source: row.source,
      timestamp: row.timestamp,
      description: row.description
    }));
  } catch (error) {
    console.error('[DB] Error getting transaction history:', error);
    throw error;
  }
}

// Get server-wide virtual accounts summary
async function getServerVirtualAccountsSummary(guildId) {
  try {
    const { data, error } = await supabase
      .from('virtual_accounts')
      .select('user_id, balances')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const totalUsers = data?.length || 0;
    let activeUsers = 0;
    const totalBalances = {};
    
    (data || []).forEach(account => {
      const balances = account.balances || {};
      let hasBalance = false;
      
      for (const [token, balance] of Object.entries(balances)) {
        const balanceBN = new BigNumber(balance || '0');
        if (balanceBN.isGreaterThan(0)) {
          hasBalance = true;
          
          if (!totalBalances[token]) {
            totalBalances[token] = new BigNumber(0);
          }
          totalBalances[token] = totalBalances[token].plus(balanceBN);
        }
      }
      
      if (hasBalance) {
        activeUsers++;
      }
    });
    
    // Convert BigNumber values to strings
    const totalBalancesStr = {};
    for (const [token, balance] of Object.entries(totalBalances)) {
      totalBalancesStr[token] = balance.toString();
    }
    
    return {
      totalUsers,
      activeUsers,
      totalBalances: totalBalancesStr
    };
  } catch (error) {
    console.error('[DB] Error getting server virtual accounts summary:', error);
    throw error;
  }
}

// Get all virtual accounts with balances for a guild (for mass refund)
// Includes both ESDT tokens and NFT/SFT tokens
async function getAllVirtualAccountsWithBalances(guildId) {
  try {
    const { data, error } = await supabase
      .from('virtual_accounts')
      .select('user_id, username, balances')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const accountsWithBalances = [];
    const userIds = new Set();
    
    // Process ESDT token balances
    (data || []).forEach(account => {
      const balances = account.balances || {};
      const userBalances = {};
      let hasBalance = false;
      
      for (const [token, balance] of Object.entries(balances)) {
        const balanceBN = new BigNumber(balance || '0');
        if (balanceBN.isGreaterThan(0)) {
          hasBalance = true;
          userBalances[token] = balance.toString();
        }
      }
      
      if (hasBalance) {
        userIds.add(account.user_id);
        accountsWithBalances.push({
          userId: account.user_id,
          username: account.username,
          balances: userBalances,
          nftBalances: [] // Will be populated below
        });
      } else {
        // Even if no ESDT balance, user might have NFT/SFT balances
        userIds.add(account.user_id);
        accountsWithBalances.push({
          userId: account.user_id,
          username: account.username,
          balances: {},
          nftBalances: []
        });
      }
    });
    
    // Get all NFT/SFT balances for this guild
    const { data: nftBalances, error: nftError } = await supabase
      .from('virtual_account_nft_balances')
      .select('user_id, collection, identifier, nonce, amount, token_type, nft_name')
      .eq('guild_id', guildId)
      .eq('staked', false); // Only include non-staked NFTs/SFTs
    
    if (nftError) {
      console.error('[DB] Error getting NFT balances for mass refund:', nftError);
      // Continue without NFT balances rather than failing completely
    } else {
      // Group NFT balances by user_id
      const nftBalancesByUser = {};
      (nftBalances || []).forEach(nft => {
        if (!nftBalancesByUser[nft.user_id]) {
          nftBalancesByUser[nft.user_id] = [];
        }
        nftBalancesByUser[nft.user_id].push({
          collection: nft.collection,
          identifier: nft.identifier,
          nonce: nft.nonce,
          amount: nft.amount || 1,
          tokenType: nft.token_type || 'NFT',
          nftName: nft.nft_name
        });
      });
      
      // Add NFT balances to accounts
      for (const account of accountsWithBalances) {
        if (nftBalancesByUser[account.userId]) {
          account.nftBalances = nftBalancesByUser[account.userId];
        }
      }
      
      // Add accounts that only have NFT balances (no ESDT balances)
      for (const [userId, nfts] of Object.entries(nftBalancesByUser)) {
        if (!userIds.has(userId)) {
          // Get username from virtual_accounts or use placeholder
          const accountData = data?.find(a => a.user_id === userId);
          accountsWithBalances.push({
            userId: userId,
            username: accountData?.username || `User ${userId}`,
            balances: {},
            nftBalances: nfts
          });
        }
      }
    }
    
    // Filter out accounts with no balances at all
    return accountsWithBalances.filter(account => 
      Object.keys(account.balances || {}).length > 0 || 
      (account.nftBalances && account.nftBalances.length > 0)
    );
  } catch (error) {
    console.error('[DB] Error getting all virtual accounts with balances:', error);
    throw error;
  }
}

// Find all guilds where a user has a virtual account or balances
async function getUserGuilds(userId) {
  try {
    // Query virtual_accounts table to find all guilds where user has an account
    const { data, error } = await supabase
      .from('virtual_accounts')
      .select('guild_id')
      .eq('user_id', userId);
    
    if (error) throw error;
    
    // Extract unique guild IDs
    const guildIds = [...new Set((data || []).map(row => row.guild_id))];
    
    // Also check virtual_account_nft_balances for additional guilds
    const { data: nftData, error: nftError } = await supabase
      .from('virtual_account_nft_balances')
      .select('guild_id')
      .eq('user_id', userId);
    
    if (!nftError && nftData) {
      nftData.forEach(row => {
        if (!guildIds.includes(row.guild_id)) {
          guildIds.push(row.guild_id);
        }
      });
    }
    
    return guildIds;
  } catch (error) {
    console.error('[DB] Error finding user guilds:', error);
    return [];
  }
}

module.exports = {
  getUserAccount,
  getAccountBalance,
  getAllUserBalances,
  getAllVirtualAccountsWithBalances,
  updateAccountBalance,
  addTransaction,
  getTransactionHistory,
  getServerVirtualAccountsSummary,
  getUserGuilds
};

