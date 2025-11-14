const BigNumber = require('bignumber.js');
const dbVirtualAccounts = require('./db/virtual-accounts');

// Get or create user account
async function getUserAccount(guildId, userId, username = null) {
  try {
    return await dbVirtualAccounts.getUserAccount(guildId, userId, username);
  } catch (error) {
    console.error('[VIRTUAL] Error getting user account:', error);
    throw error;
  }
}

// Get user balance for a specific token
async function getUserBalance(guildId, userId, tokenTicker) {
  try {
    return await dbVirtualAccounts.getAccountBalance(guildId, userId, tokenTicker);
  } catch (error) {
    console.error('[VIRTUAL] Error getting user balance:', error);
    return '0';
  }
}

// Get all user balances
async function getAllUserBalances(guildId, userId) {
  try {
    return await dbVirtualAccounts.getAllUserBalances(guildId, userId);
  } catch (error) {
    console.error('[VIRTUAL] Error getting all user balances:', error);
    return {};
  }
}

// Add funds to user account (from blockchain deposit)
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f") or ticker for backward compatibility
async function addFundsToAccount(guildId, userId, tokenIdentifier, amount, txHash, source = 'deposit', username = null) {
  try {
    // Get current account to find existing token key
    const account = await getUserAccount(guildId, userId, username);
    const balances = account.balances || {};
    
    // Validate tokenIdentifier format - must be full identifier (TICKER-6hexchars)
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      throw new Error(`Invalid token identifier: "${tokenIdentifier}". Must be full identifier format: TICKER-6hexchars (e.g., "USDC-c76f1f"). Tickers are not allowed for security.`);
    }
    
    // Find existing token by identifier only (no ticker matching)
    const availableTokens = Object.keys(balances);
    const existingToken = availableTokens.find(token => 
      token.toLowerCase() === tokenIdentifier.toLowerCase()
    );
    
    // Calculate new balance
    const currentBalance = new BigNumber(balances[tokenIdentifier] || '0');
    const newBalance = currentBalance.plus(new BigNumber(amount));
    
    // Update balance in database (always use identifier)
    await dbVirtualAccounts.updateAccountBalance(guildId, userId, tokenIdentifier, amount);
    
    // Record transaction
    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'deposit',
      token: tokenIdentifier,
      amount: amount,
      balanceBefore: currentBalance.toString(),
      balanceAfter: newBalance.toString(),
      txHash: txHash,
      source: source,
      timestamp: Date.now(),
      description: `Deposit of ${amount} ${tokenIdentifier}`
    };
    
    await dbVirtualAccounts.addTransaction(guildId, userId, transaction);
    
    console.log(`[VIRTUAL] Added ${amount} ${tokenIdentifier} to user ${userId} in guild ${guildId}. New balance: ${newBalance.toString()}`);
    
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
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f") or ticker for backward compatibility
async function deductFundsFromAccount(guildId, userId, tokenIdentifier, amount, description, gameType = null) {
  try {
    // Validate and convert amount to string
    const amountNum = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return {
        success: false,
        error: `Invalid amount: ${amount}`,
        currentBalance: '0',
        requiredAmount: amount
      };
    }
    const amountStr = amountNum.toString();
    
    // Get current account to find existing token key
    const account = await getUserAccount(guildId, userId);
    const balances = account.balances || {};
    
    // Validate tokenIdentifier format - must be full identifier (TICKER-6hexchars)
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      return {
        success: false,
        error: `Invalid token identifier: "${tokenIdentifier}". Must be full identifier format: TICKER-6hexchars (e.g., "USDC-c76f1f"). Tickers are not allowed for security.`
      };
    }
    
    // Extract ticker from identifier (e.g., "USDC-c76f1f" -> "USDC")
    const tokenTicker = tokenIdentifier.split('-')[0];
    
    // Check if balance exists under ticker (legacy data) and migrate to identifier
    const balanceByTicker = balances[tokenTicker];
    const balanceByIdentifier = balances[tokenIdentifier] || '0';
    
    if (balanceByTicker && new BigNumber(balanceByTicker).isGreaterThan(0)) {
      console.log(`[VIRTUAL] Found legacy balance under ticker "${tokenTicker}": ${balanceByTicker}. Migrating to identifier "${tokenIdentifier}".`);
      
      // Migrate ticker balance to identifier by adding it
      const tickerBalance = new BigNumber(balanceByTicker);
      const identifierBalance = new BigNumber(balanceByIdentifier);
      const totalBalance = tickerBalance.plus(identifierBalance);
      
      // Calculate the amount to add to identifier (difference between total and current identifier balance)
      const amountToAdd = totalBalance.minus(identifierBalance);
      
      // Update identifier balance with the migrated amount
      await dbVirtualAccounts.updateAccountBalance(guildId, userId, tokenIdentifier, amountToAdd.toString());
      
      console.log(`[VIRTUAL] Migrated ${balanceByTicker} from ticker "${tokenTicker}" to identifier "${tokenIdentifier}". New identifier balance: ${totalBalance.toString()}`);
      
      // Reload account to get updated balances
      const updatedAccount = await getUserAccount(guildId, userId);
      balances[tokenIdentifier] = totalBalance.toString();
      // Note: ticker balance remains in DB but will be ignored in future operations
      
      // Use the updated balance for the rest of the function
      balances[tokenIdentifier] = updatedAccount.balances?.[tokenIdentifier] || totalBalance.toString();
    }
    
    // Check if user has sufficient balance (after migration)
    const currentBalance = new BigNumber(balances[tokenIdentifier] || '0');
    const deductionAmount = new BigNumber(amountStr);
    
    if (currentBalance.isLessThan(deductionAmount)) {
      return {
        success: false,
        error: 'Insufficient balance',
        currentBalance: currentBalance.toString(),
        requiredAmount: amountStr
      };
    }
    
    // Deduct funds (using negative amount)
    const negativeAmount = deductionAmount.negated().toString();
    const newBalanceStr = await dbVirtualAccounts.updateAccountBalance(guildId, userId, tokenIdentifier, negativeAmount);
    const newBalance = new BigNumber(newBalanceStr);
    
    // Record transaction
    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'deduction',
      token: tokenIdentifier,
      amount: amountStr, // Ensure amount is always a valid string
      balanceBefore: currentBalance.toString(),
      balanceAfter: newBalance.toString(),
      description: description,
      gameType: gameType,
      timestamp: Date.now()
    };
    
    await dbVirtualAccounts.addTransaction(guildId, userId, transaction);
    
    console.log(`[VIRTUAL] Deducted ${amountStr} ${tokenIdentifier} from user ${userId} in guild ${guildId}. New balance: ${newBalance.toString()}`);
    
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
async function transferFundsBetweenUsers(guildId, fromUserId, toUserId, tokenIdentifier, amount, description) {
  try {
    // Deduct from sender
    const deductionResult = await deductFundsFromAccount(guildId, fromUserId, tokenIdentifier, amount, `Tip to user: ${description}`, 'tip');
    if (!deductionResult.success) {
      return deductionResult;
    }
    
    // Add to recipient
    const additionResult = await addFundsToAccount(guildId, toUserId, tokenIdentifier, amount, null, 'tip');
    if (!additionResult.success) {
      // If adding to recipient fails, refund the sender
      await addFundsToAccount(guildId, fromUserId, tokenIdentifier, amount, null, 'refund');
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
      token: tokenIdentifier
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
async function getUserTransactionHistory(guildId, userId, limit = 20) {
  try {
    return await dbVirtualAccounts.getTransactionHistory(guildId, userId, limit);
  } catch (error) {
    console.error(`[VIRTUAL] Error getting transaction history:`, error.message);
    return [];
  }
}

// Get server-wide virtual accounts summary
async function getServerVirtualAccountsSummary(guildId) {
  try {
    return await dbVirtualAccounts.getServerVirtualAccountsSummary(guildId);
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
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f") or ticker for backward compatibility
async function processBlockchainDeposit(guildId, senderWallet, receiverWallet, tokenIdentifier, amount, txHash) {
  try {
    // Load server data to find user by wallet address
    const dbServerData = require('./db/server-data');
    const userWallets = await dbServerData.getUserWallets(guildId);
    
    if (!userWallets || Object.keys(userWallets).length === 0) {
      console.log(`[VIRTUAL] No user wallets found for guild ${guildId}`);
      return {
        success: false,
        error: 'Guild not found or no user wallets configured'
      };
    }
    
    // Find user by wallet address
    let userId = null;
    for (const [uid, wallet] of Object.entries(userWallets)) {
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
    const result = await addFundsToAccount(guildId, userId, tokenIdentifier, amount, txHash, 'blockchain_deposit', username);
    
    if (result.success) {
      console.log(`[VIRTUAL] Successfully processed blockchain deposit: ${amount} ${tokenIdentifier} for user ${userId} in guild ${guildId}`);
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

// Force reload function for debugging (no-op with database)
function forceReloadData() {
  console.log('[VIRTUAL] 🔄 Database always has latest data, no reload needed');
}

// Update username for a user account
async function updateUserUsername(guildId, userId, username) {
  try {
    // getUserAccount automatically updates username if provided and different
    await dbVirtualAccounts.getUserAccount(guildId, userId, username);
    return { success: true };
  } catch (error) {
    console.error(`[VIRTUAL] Error updating username:`, error.message);
    return { success: false, error: error.message };
  }
}

// Update usernames for all users in a guild (called from Discord bot)
async function updateAllUsernamesInGuild(guildId, userMap) {
  try {
    let updated = 0;
    for (const [userId, username] of Object.entries(userMap)) {
      try {
        await dbVirtualAccounts.getUserAccount(guildId, userId, username);
        updated++;
      } catch (error) {
        console.error(`[VIRTUAL] Error updating username for user ${userId}:`, error.message);
      }
    }
    
    if (updated > 0) {
      console.log(`[VIRTUAL] Updated ${updated} usernames in guild ${guildId}`);
    }
    
    return { success: true, updated };
  } catch (error) {
    console.error(`[VIRTUAL] Error updating usernames in guild:`, error.message);
    return { success: false, error: error.message };
  }
}

// Get all virtual accounts with balances for a guild
async function getAllVirtualAccountsWithBalances(guildId) {
  try {
    return await dbVirtualAccounts.getAllVirtualAccountsWithBalances(guildId);
  } catch (error) {
    console.error('[VIRTUAL] Error getting all virtual accounts with balances:', error);
    throw error;
  }
}

// Export functions
module.exports = {
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
  getAllVirtualAccountsWithBalances
};
