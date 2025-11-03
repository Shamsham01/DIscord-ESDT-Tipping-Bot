const fetch = require('node-fetch');
const fs = require('fs');
const BigNumber = require('bignumber.js');

// Import virtual accounts functions
let virtualAccounts;
try {
  virtualAccounts = require('./virtual-accounts.js');
  console.log('[BLOCKCHAIN] ✅ Virtual accounts module loaded successfully');
} catch (error) {
  console.error('[BLOCKCHAIN] ❌ Failed to load virtual accounts module:', error.message);
  virtualAccounts = null;
}

// Blockchain listener configuration
const POLLING_INTERVAL = 10000; // 10 seconds
const API_BASE_URL = 'https://api.multiversx.com';
const TIMESTAMP_FILE = 'timestamp.json';

// Track processed transactions to avoid duplicates
let processedTransactions = new Set();

// Load timestamps from file
function loadTimestamps() {
  try {
    if (fs.existsSync(TIMESTAMP_FILE)) {
      const data = JSON.parse(fs.readFileSync(TIMESTAMP_FILE, 'utf8'));
      console.log(`[BLOCKCHAIN] 📅 Loaded timestamps for ${Object.keys(data.wallets || {}).length} wallets`);
      return data.wallets || {};
    }
  } catch (error) {
    console.error('[BLOCKCHAIN] Error loading timestamps:', error.message);
  }
  return {};
}

// Save timestamps to file
function saveTimestamps(wallets) {
  try {
    const data = {
      wallets: wallets,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(TIMESTAMP_FILE, JSON.stringify(data, null, 2));
    console.log(`[BLOCKCHAIN] 💾 Saved timestamps for ${Object.keys(wallets).length} wallets`);
  } catch (error) {
    console.error('[BLOCKCHAIN] Error saving timestamps:', error.message);
  }
}

// Get or create timestamp for a wallet
function getWalletTimestamp(walletAddress, currentTimestamps) {
  if (currentTimestamps[walletAddress]) {
    return currentTimestamps[walletAddress];
  }
  
  // New wallet - start from current time
  const newTimestamp = Math.floor(Date.now() / 1000);
  currentTimestamps[walletAddress] = newTimestamp;
  console.log(`[BLOCKCHAIN] 🆕 New wallet ${walletAddress} - starting from timestamp: ${newTimestamp}`);
  return newTimestamp;
}

// Update timestamp for a wallet after processing transaction
function updateWalletTimestamp(walletAddress, transactionTimestamp, currentTimestamps) {
  // Increment by 1 second to avoid processing the same transaction again
  const newTimestamp = transactionTimestamp + 1;
  currentTimestamps[walletAddress] = newTimestamp;
  console.log(`[BLOCKCHAIN] ⏰ Updated timestamp for ${walletAddress}: ${transactionTimestamp} → ${newTimestamp}`);
}

// Get all community fund wallets from server data
function getAllCommunityFundWallets() {
  try {
    const serverData = JSON.parse(fs.readFileSync('server-data.json', 'utf8'));
    const wallets = new Set();
    
    for (const [guildId, server] of Object.entries(serverData)) {
      const projects = server.projects || {};
      const communityFundProject = server.communityFundProject;
      
      // Only monitor the community fund project wallet, not all project wallets
      if (communityFundProject && projects[communityFundProject] && projects[communityFundProject].walletAddress) {
        wallets.add({
          address: projects[communityFundProject].walletAddress,
          guildId: guildId,
          projectName: communityFundProject
        });
      }
    }
    
    console.log(`[BLOCKCHAIN] Found ${wallets.size} community fund wallets to monitor`);
    return Array.from(wallets);
  } catch (error) {
    console.error('[BLOCKCHAIN] Error reading server data:', error.message);
    return [];
  }
}

// Fetch latest transactions for a specific wallet
async function fetchLatestTransactions(walletAddress, fromTimestamp) {
  try {
    // Fetch transactions after the last known timestamp for this wallet
    const url = `${API_BASE_URL}/accounts/${walletAddress}/transactions?size=1&receiver=${walletAddress}&status=success&function=ESDTTransfer&order=desc&after=${fromTimestamp}`;
    
    console.log(`[BLOCKCHAIN] 🔗 Fetching: ${url}`);
    
    const response = await fetch(url);
    console.log(`[BLOCKCHAIN] 📡 Response status: ${response.status}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        // 404 means no ESDT transfers found - this is normal for empty wallets
        console.log(`[BLOCKCHAIN] 📭 404 - No ESDT transfers found for ${walletAddress} after timestamp ${fromTimestamp}`);
        return [];
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`[BLOCKCHAIN] 📊 Response data:`, JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error(`[BLOCKCHAIN] Error fetching transactions for ${walletAddress}:`, error.message);
    return null;
  }
}

// Process a blockchain transaction
function processTransaction(transaction, guildId, projectName) {
  try {
    console.log(`[BLOCKCHAIN] 🔍 Processing transaction for ${projectName}:`, {
      txHash: transaction.txHash,
      sender: transaction.sender,
      receiver: transaction.receiver,
      timestamp: transaction.timestamp,
      hasAction: !!transaction.action,
      hasArguments: !!(transaction.action && transaction.action.arguments),
      hasTransfers: !!(transaction.action && transaction.action.arguments && transaction.action.arguments.transfers)
    });
    
    // Check if we've already processed this transaction
    if (processedTransactions.has(transaction.txHash)) {
      return { processed: false, reason: 'Already processed' };
    }
    
    // Timestamp validation is now handled by the API call with 'after' parameter
    // This ensures we only get transactions newer than our last known timestamp
    
    // Validate transaction structure
    if (!transaction.action || !transaction.action.arguments || !transaction.action.arguments.transfers) {
      console.log(`[BLOCKCHAIN] ❌ Invalid transaction structure:`, {
        action: !!transaction.action,
        arguments: !!(transaction.action && transaction.action.arguments),
        transfers: !!(transaction.action && transaction.action.arguments && transaction.action.arguments.transfers)
      });
      return { processed: false, reason: 'Invalid transaction structure' };
    }
    
    const transfers = transaction.action.arguments.transfers;
    const results = [];
    
    for (const transfer of transfers) {
      if (transfer.type === 'FungibleESDT') {
        const tokenTicker = transfer.token || transfer.identifier || transfer.ticker;
        const amountWei = transfer.value;
        const decimals = transfer.decimals || 8;
        
        // Convert from wei to human readable amount
        const humanAmount = new BigNumber(amountWei).dividedBy(new BigNumber(10).pow(decimals)).toString();
        
        console.log(`[BLOCKCHAIN] Processing transfer: ${humanAmount} ${tokenTicker} to ${projectName} in guild ${guildId}`);
        console.log(`[BLOCKCHAIN] Sender: ${transaction.sender}, Receiver: ${transaction.receiver}`);
        
        // Process the deposit
        const depositResult = virtualAccounts.processBlockchainDeposit(
          guildId,
          transaction.sender,
          transaction.receiver,
          tokenTicker,
          humanAmount,
          transaction.txHash
        );
        
        if (depositResult.success) {
          console.log(`[BLOCKCHAIN] Successfully processed deposit: ${humanAmount} ${tokenTicker} for user in guild ${guildId}`);
          
          // Send Discord notification if possible
          try {
            sendDepositNotification(guildId, transaction.sender, tokenTicker, humanAmount, transaction.txHash, projectName);
          } catch (notifyError) {
            console.error('[BLOCKCHAIN] Error sending Discord notification:', notifyError.message);
          }
          
          results.push({
            token: tokenTicker,
            success: true,
            amount: humanAmount,
            txHash: transaction.txHash
          });
        } else {
          console.error(`[BLOCKCHAIN] Failed to process deposit:`, depositResult.error);
          results.push({
            token: tokenTicker,
            success: false,
            error: depositResult.error
          });
        }
      }
    }
    
    // Mark transaction as processed
    processedTransactions.add(transaction.txHash);
    
    // Keep processed transactions list manageable (max 1000)
    if (processedTransactions.size > 1000) {
      const transactionsArray = Array.from(processedTransactions);
      processedTransactions = new Set(transactionsArray.slice(-500));
    }
    
    return { processed: true, results };
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Error processing transaction:', error.message);
    return { processed: false, error: error.message };
  }
}

// Send deposit notification to Discord
async function sendDepositNotification(guildId, senderWallet, tokenTicker, amount, txHash, projectName) {
  try {
    // This function will be implemented in the main bot file
    // For now, we'll just log the notification
    console.log(`[BLOCKCHAIN] Would send Discord notification: User ${senderWallet} deposited ${amount} ${tokenTicker} to ${projectName} in guild ${guildId}`);
    
    // TODO: Implement actual Discord notification
    // This requires access to the Discord client from the main bot
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Error sending deposit notification:', error.message);
  }
}

// Main polling function
async function pollBlockchain() {
  try {
    const wallets = getAllCommunityFundWallets();
    
    if (wallets.length === 0) {
      console.log('[BLOCKCHAIN] No community fund wallets found to monitor');
      return;
    }
    
    console.log(`[BLOCKCHAIN] 🔍 Polling ${wallets.length} community fund wallets...`);
    
    // Load current timestamps
    const currentTimestamps = loadTimestamps();
    let timestampsChanged = false;
    
    for (const wallet of wallets) {
      try {
        // Get existing timestamp for this wallet (don't create new ones during polling)
        let walletTimestamp = currentTimestamps[wallet.address];
        
        if (!walletTimestamp) {
          // This is a new wallet that wasn't initialized yet - skip this poll cycle
          console.log(`[BLOCKCHAIN] ⏳ New wallet ${wallet.address} not yet initialized - skipping this poll cycle`);
          continue;
        }
        
        const transactions = await fetchLatestTransactions(wallet.address, walletTimestamp);
        
        if (transactions && Array.isArray(transactions) && transactions.length > 0) {
          console.log(`[BLOCKCHAIN] 📋 Found ${transactions.length} transactions for ${wallet.projectName}`);
          const latestTransaction = transactions[0]; // With order=desc, newest is first
          
          if (latestTransaction && latestTransaction.txHash) {
            console.log(`[BLOCKCHAIN] 🔍 Processing transaction: ${latestTransaction.txHash}`);
            console.log(`[BLOCKCHAIN] 📅 Transaction timestamp: ${latestTransaction.timestamp}`);
            console.log(`[BLOCKCHAIN] 🏁 Wallet last timestamp: ${walletTimestamp}`);
            
            const result = processTransaction(latestTransaction, wallet.guildId, wallet.projectName);
            
            if (result.processed) {
              console.log(`[BLOCKCHAIN] ✅ Processed transaction ${latestTransaction.txHash} for ${wallet.projectName}`);
              
              // Update timestamp for this wallet
              updateWalletTimestamp(wallet.address, latestTransaction.timestamp, currentTimestamps);
              timestampsChanged = true;
            } else {
              // Log why transaction wasn't processed (for debugging)
              if (result.reason === 'Already processed') {
                console.log(`[BLOCKCHAIN] 🔄 Skipped duplicate transaction ${latestTransaction.txHash} for ${wallet.projectName}`);
              } else {
                console.log(`[BLOCKCHAIN] ❌ Transaction not processed: ${result.reason || 'Unknown reason'}`);
              }
            }
          } else {
            console.log(`[BLOCKCHAIN] ⚠️ No txHash found in transaction:`, latestTransaction);
          }
        } else if (transactions && Array.isArray(transactions) && transactions.length === 0) {
          // Empty wallet - this is normal, no need to log every time
          if (Math.random() < 0.1) { // Log only 10% of the time to reduce spam
            console.log(`[BLOCKCHAIN] 📭 No ESDT transfers found for ${wallet.projectName} (${wallet.address})`);
          }
        } else {
          console.log(`[BLOCKCHAIN] ⚠️ Unexpected transactions format:`, transactions);
        }
        
        // Small delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`[BLOCKCHAIN] Error processing wallet ${wallet.address}:`, error.message);
      }
    }
    
    // Save timestamps if any changed
    if (timestampsChanged) {
      saveTimestamps(currentTimestamps);
    }
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Error in blockchain polling:', error.message);
  }
}

// Initialize timestamps for all wallets
function initializeWalletTimestamps() {
  try {
    console.log('[BLOCKCHAIN] 🔧 Initializing wallet timestamps...');
    
    const wallets = getAllCommunityFundWallets();
    const currentTimestamps = loadTimestamps();
    let timestampsChanged = false;
    
    for (const wallet of wallets) {
      if (!currentTimestamps[wallet.address]) {
        // Create new timestamp for this wallet
        const newTimestamp = Math.floor(Date.now() / 1000);
        currentTimestamps[wallet.address] = newTimestamp;
        console.log(`[BLOCKCHAIN] 🆕 Initialized wallet ${wallet.address} (${wallet.projectName}) with timestamp: ${newTimestamp}`);
        timestampsChanged = true;
      }
    }
    
    if (timestampsChanged) {
      saveTimestamps(currentTimestamps);
      console.log(`[BLOCKCHAIN] 💾 Saved initialized timestamps for ${Object.keys(currentTimestamps).length} wallets`);
    } else {
      console.log(`[BLOCKCHAIN] ✅ All wallets already have timestamps`);
    }
    
    return currentTimestamps;
  } catch (error) {
    console.error('[BLOCKCHAIN] Error initializing wallet timestamps:', error.message);
    return {};
  }
}

// Start the blockchain listener
function startBlockchainListener() {
  try {
    console.log('[BLOCKCHAIN] 🚀 Starting blockchain listener...');
    console.log(`[BLOCKCHAIN] 📡 Will poll every ${POLLING_INTERVAL / 1000} seconds`);
    console.log(`[BLOCKCHAIN] 🌐 Using API: ${API_BASE_URL}`);
    
    // Initialize timestamps for all wallets first
    const timestamps = initializeWalletTimestamps();
    console.log(`[BLOCKCHAIN] 📅 Initialized timestamps for ${Object.keys(timestamps).length} wallets`);
    
    // Initial poll
    pollBlockchain();
    
    // Set up periodic polling
    const pollInterval = setInterval(pollBlockchain, POLLING_INTERVAL);
    
    // Store interval reference for cleanup
    global.blockchainPollInterval = pollInterval;
    
    console.log('[BLOCKCHAIN] ✅ Blockchain listener started successfully');
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Failed to start blockchain listener:', error.message);
  }
}

// Stop the blockchain listener
function stopBlockchainListener() {
  try {
    if (global.blockchainPollInterval) {
      clearInterval(global.blockchainPollInterval);
      global.blockchainPollInterval = null;
      console.log('[BLOCKCHAIN] 🛑 Blockchain listener stopped');
    }
  } catch (error) {
    console.error('[BLOCKCHAIN] Error stopping blockchain listener:', error.message);
  }
}

// Get listener status
function getListenerStatus() {
  try {
    const wallets = getAllCommunityFundWallets();
    const timestamps = loadTimestamps();
    const isRunning = global.blockchainPollInterval !== null;
    
    return {
      success: true,
      isRunning: isRunning,
      pollingInterval: POLLING_INTERVAL,
      monitoredWallets: wallets.length,
      processedTransactions: processedTransactions.size,
      trackedWallets: Object.keys(timestamps).length,
      lastUpdated: timestamps.lastUpdated || 'Never',
      currentTimestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[BLOCKCHAIN] Shutting down blockchain listener...');
  stopBlockchainListener();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[BLOCKCHAIN] Shutting down blockchain listener...');
  stopBlockchainListener();
  process.exit(0);
});

// Export functions
module.exports = {
  startBlockchainListener,
  stopBlockchainListener,
  getListenerStatus,
  pollBlockchain
};

// Start listener if this file is run directly
if (require.main === module) {
  startBlockchainListener();
}
