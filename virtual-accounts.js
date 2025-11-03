const fs = require('fs');
const BigNumber = require('bignumber.js');

// Virtual accounts data file
const VIRTUAL_ACCOUNTS_FILE = 'virtual-accounts.json';

// Global virtual accounts data
let virtualAccountsData = {};

// Load virtual accounts data from disk
function loadVirtualAccountsData() {
  try {
    if (fs.existsSync(VIRTUAL_ACCOUNTS_FILE)) {
      virtualAccountsData = JSON.parse(fs.readFileSync(VIRTUAL_ACCOUNTS_FILE, 'utf8'));
      console.log(`[VIRTUAL] Loaded virtual accounts for ${Object.keys(virtualAccountsData).length} servers`);
    }
  } catch (error) {
    console.error('[VIRTUAL] Error loading virtual accounts data:', error.message);
    virtualAccountsData = {};
  }
}

// Save virtual accounts data to disk
function saveVirtualAccountsData() {
  try {
    fs.writeFileSync(VIRTUAL_ACCOUNTS_FILE, JSON.stringify(virtualAccountsData, null, 2));
  } catch (error) {
    console.error('[VIRTUAL] Error saving virtual accounts data:', error.message);
  }
}

// Initialize virtual accounts for a server
function initializeVirtualAccounts(guildId) {
  if (!virtualAccountsData[guildId]) {
    virtualAccountsData[guildId] = {};
    saveVirtualAccountsData();
  }
  return virtualAccountsData[guildId];
}

// Get or create user account
function getUserAccount(guildId, userId, username = null) {
  initializeVirtualAccounts(guildId);
  
  if (!virtualAccountsData[guildId][userId]) {
    virtualAccountsData[guildId][userId] = {
      balances: {},
      transactions: [],
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      username: username || null
    };
    saveVirtualAccountsData();
  } else if (username && virtualAccountsData[guildId][userId].username !== username) {
    // Update username if provided and different
    virtualAccountsData[guildId][userId].username = username;
    virtualAccountsData[guildId][userId].lastUpdated = Date.now();
    saveVirtualAccountsData();
  }
  
  return virtualAccountsData[guildId][userId];
}

// Get user balance for a specific token
function getUserBalance(guildId, userId, tokenTicker) {
  // Force reload data from disk to ensure we have the latest
  loadVirtualAccountsData();
  
  const account = getUserAccount(guildId, userId);
  
  // Find the token with case-insensitive matching
  const availableTokens = Object.keys(account.balances);
  const matchingToken = availableTokens.find(token => 
    token.toLowerCase() === tokenTicker.toLowerCase()
  );
  
  const balance = matchingToken ? account.balances[matchingToken] : '0';
  return balance;
}

// Get all user balances
function getAllUserBalances(guildId, userId) {
  // Force reload data from disk to ensure we have the latest
  loadVirtualAccountsData();
  
  const account = getUserAccount(guildId, userId);
  return account.balances || {};
}

// Add funds to user account (from blockchain deposit)
function addFundsToAccount(guildId, userId, tokenTicker, amount, txHash, source = 'deposit', username = null) {
  try {
    const account = getUserAccount(guildId, userId, username);
    
    // Find existing token with case-insensitive matching
    const availableTokens = Object.keys(account.balances);
    const existingToken = availableTokens.find(token => 
      token.toLowerCase() === tokenTicker.toLowerCase()
    );
    
    // Use existing token key if found, otherwise use the provided tokenTicker
    const tokenKey = existingToken || tokenTicker;
    
    // Initialize token balance if it doesn't exist
    if (!account.balances[tokenKey]) {
      account.balances[tokenKey] = '0';
    }
    
    // Add funds
    const currentBalance = new BigNumber(account.balances[tokenKey]);
    const newBalance = currentBalance.plus(new BigNumber(amount));
    account.balances[tokenKey] = newBalance.toString();
    
    // Record transaction
    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'deposit',
      token: tokenKey,
      amount: amount,
      balanceBefore: currentBalance.toString(),
      balanceAfter: newBalance.toString(),
      txHash: txHash,
      source: source,
      timestamp: Date.now(),
      description: `Deposit of ${amount} ${tokenKey}`
    };
    
    account.transactions.push(transaction);
    account.lastUpdated = Date.now();
    
    saveVirtualAccountsData();
    
    console.log(`[VIRTUAL] Added ${amount} ${tokenTicker} to user ${userId} in guild ${guildId}. New balance: ${newBalance.toString()}`);
    
    return {
      success: true,
      newBalance: newBalance.toString(),
      transaction: transaction
    };
  } catch (error) {
    console.error(`[VIRTUAL] Error adding funds to account:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Deduct funds from user account (for tips, games, etc.)
function deductFundsFromAccount(guildId, userId, tokenTicker, amount, description, gameType = null) {
  try {
    const account = getUserAccount(guildId, userId);
    
    // Find existing token with case-insensitive matching
    const availableTokens = Object.keys(account.balances);
    const existingToken = availableTokens.find(token => 
      token.toLowerCase() === tokenTicker.toLowerCase()
    );
    
    // Use existing token key if found, otherwise use the provided tokenTicker
    const tokenKey = existingToken || tokenTicker;
    
    // Check if user has sufficient balance
    if (!account.balances[tokenKey]) {
      account.balances[tokenKey] = '0';
    }
    
    const currentBalance = new BigNumber(account.balances[tokenKey]);
    const deductionAmount = new BigNumber(amount);
    
    if (currentBalance.isLessThan(deductionAmount)) {
      return {
        success: false,
        error: 'Insufficient balance',
        currentBalance: currentBalance.toString(),
        requiredAmount: amount
      };
    }
    
    // Deduct funds
    const newBalance = currentBalance.minus(deductionAmount);
    account.balances[tokenKey] = newBalance.toString();
    
    // Record transaction
    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'deduction',
      token: tokenKey,
      amount: amount,
      balanceBefore: currentBalance.toString(),
      balanceAfter: newBalance.toString(),
      description: description,
      gameType: gameType,
      timestamp: Date.now()
    };
    
    account.transactions.push(transaction);
    account.lastUpdated = Date.now();
    
    saveVirtualAccountsData();
    
    console.log(`[VIRTUAL] Deducted ${amount} ${tokenTicker} from user ${userId} in guild ${guildId}. New balance: ${newBalance.toString()}`);
    
    return {
      success: true,
      newBalance: newBalance.toString(),
      transaction: transaction
    };
  } catch (error) {
    console.error(`[VIRTUAL] Error deducting funds from account:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Transfer funds between users (for tips)
function transferFundsBetweenUsers(guildId, fromUserId, toUserId, tokenTicker, amount, description) {
  try {
    // Deduct from sender
    const deductionResult = deductFundsFromAccount(guildId, fromUserId, tokenTicker, amount, `Tip to user: ${description}`, 'tip');
    if (!deductionResult.success) {
      return deductionResult;
    }
    
    // Add to recipient
    const additionResult = addFundsToAccount(guildId, toUserId, tokenTicker, amount, null, 'tip');
    if (!additionResult.success) {
      // If adding to recipient fails, refund the sender
      addFundsToAccount(guildId, fromUserId, tokenTicker, amount, null, 'refund');
      return {
        success: false,
        error: 'Failed to add funds to recipient',
        refunded: true
      };
    }
    
    return {
      success: true,
      fromUserNewBalance: deductionResult.newBalance,
      toUserNewBalance: additionResult.newBalance,
      amount: amount,
      token: tokenTicker
    };
  } catch (error) {
    console.error(`[VIRTUAL] Error transferring funds between users:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Get user transaction history
function getUserTransactionHistory(guildId, userId, limit = 20) {
  try {
    const account = getUserAccount(guildId, userId);
    const transactions = account.transactions || [];
    
    // Sort by timestamp (newest first) and limit results
    return transactions
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch (error) {
    console.error(`[VIRTUAL] Error getting transaction history:`, error.message);
    return [];
  }
}

// Clean up old transaction history (keep only last 100 transactions per user)
function cleanupOldTransactions() {
  try {
    let totalCleaned = 0;
    let usersProcessed = 0;
    
    for (const guildId in virtualAccountsData) {
      const guildData = virtualAccountsData[guildId];
      for (const userId in guildData) {
        const account = guildData[userId];
        if (account.transactions && account.transactions.length > 100) {
          const oldCount = account.transactions.length;
          // Keep only the last 100 transactions (newest first)
          account.transactions = account.transactions
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100);
          totalCleaned += (oldCount - account.transactions.length);
          usersProcessed++;
        }
      }
    }
    
    if (totalCleaned > 0) {
      saveVirtualAccountsData();
    }
    
    return { totalCleaned, usersProcessed };
  } catch (error) {
    console.error(`[VIRTUAL] Error cleaning up old transactions:`, error.message);
    return { totalCleaned: 0, usersProcessed: 0 };
  }
}

// Get server-wide virtual accounts summary
function getServerVirtualAccountsSummary(guildId) {
  try {
    const serverAccounts = virtualAccountsData[guildId] || {};
    const totalUsers = Object.keys(serverAccounts).length;
    
    let totalBalances = {};
    let activeUsers = 0;
    
    for (const [userId, account] of Object.entries(serverAccounts)) {
      if (Object.keys(account.balances).length > 0) {
        activeUsers++;
        
        for (const [token, balance] of Object.entries(account.balances)) {
          if (!totalBalances[token]) {
            totalBalances[token] = new BigNumber(0);
          }
          totalBalances[token] = totalBalances[token].plus(new BigNumber(balance));
        }
      }
    }
    
    // Convert BigNumber totals to strings
    const formattedTotals = {};
    for (const [token, total] of Object.entries(totalBalances)) {
      formattedTotals[token] = total.toString();
    }
    
    return {
      totalUsers,
      activeUsers,
      totalBalances: formattedTotals
    };
  } catch (error) {
    console.error(`[VIRTUAL] Error getting server summary:`, error.message);
    return {
      totalUsers: 0,
      activeUsers: 0,
      totalBalances: {}
    };
  }
}

// Process blockchain deposit event
function processBlockchainDeposit(guildId, senderWallet, receiverWallet, tokenTicker, amount, txHash) {
  try {
    // Load server data to find user by wallet address
    const serverData = JSON.parse(fs.readFileSync('server-data.json', 'utf8'));
    const guildData = serverData[guildId];
    
    if (!guildData || !guildData.userWallets) {
      console.log(`[VIRTUAL] No user wallets found for guild ${guildId}`);
      return {
        success: false,
        error: 'Guild not found or no user wallets configured'
      };
    }
    
    // Find user by wallet address
    let userId = null;
    for (const [uid, wallet] of Object.entries(guildData.userWallets)) {
      if (wallet.toLowerCase() === senderWallet.toLowerCase()) {
        userId = uid;
        break;
      }
    }
    
    if (!userId) {
      console.log(`[VIRTUAL] No user found for wallet ${senderWallet} in guild ${guildId}`);
      return {
        success: false,
        error: 'User not found for wallet address'
      };
    }
    
    console.log(`[VIRTUAL] Found user ${userId} for wallet ${senderWallet} in guild ${guildId}`);
    
    // Try to get username from Discord (optional - don't fail if we can't get it)
    let username = null;
    try {
      // The blockchain listener doesn't have direct access to Discord client
      // Username will be updated when user runs Discord commands or admin runs /update-usernames
      username = null;
      console.log(`[VIRTUAL] Username will be updated when user runs Discord commands. User ID: ${userId}`);
    } catch (error) {
      console.log(`[VIRTUAL] Could not fetch username for user ${userId}:`, error.message);
    }
    
    // Add funds to user account (with username if available)
    const result = addFundsToAccount(guildId, userId, tokenTicker, amount, txHash, 'blockchain_deposit', username);
    
    if (result.success) {
      console.log(`[VIRTUAL] Successfully processed blockchain deposit: ${amount} ${tokenTicker} for user ${userId} in guild ${guildId}`);
      console.log(`[VIRTUAL] Account created/updated with username: ${username || 'null (will be updated on next Discord command)'}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[VIRTUAL] Error processing blockchain deposit:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Load data on startup
loadVirtualAccountsData();

// Force reload function for debugging
function forceReloadData() {
  console.log('[VIRTUAL] 🔄 Force reloading virtual accounts data...');
  loadVirtualAccountsData();
  console.log('[VIRTUAL] ✅ Data reloaded successfully');
}

// Update username for a user account
function updateUserUsername(guildId, userId, username) {
  try {
    const account = getUserAccount(guildId, userId, username);
    if (account.username !== username) {
      const oldUsername = account.username;
      account.username = username;
      account.lastUpdated = Date.now();
      saveVirtualAccountsData();
      console.log(`[VIRTUAL] Updated username for user ${userId}: "${oldUsername}" → "${username}"`);
    } else {
      console.log(`[VIRTUAL] Username for user ${userId} is already up to date: "${username}"`);
    }
    return { success: true };
  } catch (error) {
    console.error(`[VIRTUAL] Error updating username:`, error.message);
    return { success: false, error: error.message };
  }
}

// Update usernames for all users in a guild (called from Discord bot)
function updateAllUsernamesInGuild(guildId, userMap) {
  try {
    if (!virtualAccountsData[guildId]) {
      console.log(`[VIRTUAL] No virtual accounts found for guild ${guildId}`);
      return { success: true, updated: 0 };
    }
    
    let updated = 0;
    for (const [userId, account] of Object.entries(virtualAccountsData[guildId])) {
      if (userMap[userId] && account.username !== userMap[userId]) {
        account.username = userMap[userId];
        account.lastUpdated = Date.now();
        updated++;
        console.log(`[VIRTUAL] Updated username for user ${userId} to ${userMap[userId]}`);
      }
    }
    
    if (updated > 0) {
      saveVirtualAccountsData();
      console.log(`[VIRTUAL] Updated ${updated} usernames in guild ${guildId}`);
    }
    
    return { success: true, updated };
  } catch (error) {
    console.error(`[VIRTUAL] Error updating usernames in guild:`, error.message);
    return { success: false, error: error.message };
  }
}

// Export functions
module.exports = {
  loadVirtualAccountsData,
  saveVirtualAccountsData,
  initializeVirtualAccounts,
  getUserAccount,
  getUserBalance,
  getAllUserBalances,
  addFundsToAccount,
  deductFundsFromAccount,
  transferFundsBetweenUsers,
  getUserTransactionHistory,
  getServerVirtualAccountsSummary,
  processBlockchainDeposit,
  forceReloadData,
  updateUserUsername,
  updateAllUsernamesInGuild,
  cleanupOldTransactions
};
