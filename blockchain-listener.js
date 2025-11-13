const fetch = require('node-fetch');
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

// Import NFT virtual accounts functions
let virtualAccountsNFT;
try {
  virtualAccountsNFT = require('./db/virtual-accounts-nft');
  console.log('[BLOCKCHAIN] ✅ NFT virtual accounts module loaded successfully');
} catch (error) {
  console.error('[BLOCKCHAIN] ❌ Failed to load NFT virtual accounts module:', error.message);
  virtualAccountsNFT = null;
}

// Import Supabase client
const supabase = require('./supabase-client');

// Blockchain listener configuration
const POLLING_INTERVAL = 10000; // 10 seconds
const API_BASE_URL = 'https://api.multiversx.com';

// Track processed transactions to avoid duplicates
let processedTransactions = new Set();

// Load timestamps from Supabase
async function loadTimestamps() {
  try {
    const { data, error } = await supabase
      .from('wallet_timestamps')
      .select('wallet_address, last_timestamp');
    
    if (error) {
      console.error('[BLOCKCHAIN] Error loading timestamps from Supabase:', error.message);
      return {};
    }
    
    const wallets = {};
    if (data && Array.isArray(data)) {
      data.forEach(row => {
        wallets[row.wallet_address] = row.last_timestamp;
      });
    }
    
    console.log(`[BLOCKCHAIN] 📅 Loaded timestamps for ${Object.keys(wallets).length} wallets from Supabase`);
    return wallets;
  } catch (error) {
    console.error('[BLOCKCHAIN] Error loading timestamps:', error.message);
    return {};
  }
}

// Save timestamps to Supabase (upsert for each wallet)
async function saveTimestamps(wallets) {
  try {
    if (!wallets || Object.keys(wallets).length === 0) {
      return;
    }
    
    const records = Object.keys(wallets).map(walletAddress => ({
      wallet_address: walletAddress,
      last_timestamp: wallets[walletAddress],
      last_updated: new Date().toISOString()
    }));
    
    // Upsert in batches to avoid overwhelming the database
    const batchSize = 50;
    let saved = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('wallet_timestamps')
        .upsert(batch, { onConflict: 'wallet_address' });
      
      if (error) {
        console.error(`[BLOCKCHAIN] Error saving timestamp batch ${i / batchSize + 1}:`, error.message);
      } else {
        saved += batch.length;
      }
    }
    
    console.log(`[BLOCKCHAIN] 💾 Saved timestamps for ${saved} wallets to Supabase`);
  } catch (error) {
    console.error('[BLOCKCHAIN] Error saving timestamps:', error.message);
  }
}

// Get or create timestamp for a wallet
async function getWalletTimestamp(walletAddress, currentTimestamps) {
  if (currentTimestamps[walletAddress]) {
    return currentTimestamps[walletAddress];
  }
  
  // New wallet - start from current time
  const newTimestamp = Math.floor(Date.now() / 1000);
  currentTimestamps[walletAddress] = newTimestamp;
  
  // Save to Supabase immediately
  try {
    await supabase
      .from('wallet_timestamps')
      .upsert({
        wallet_address: walletAddress,
        last_timestamp: newTimestamp,
        last_updated: new Date().toISOString()
      }, { onConflict: 'wallet_address' });
  } catch (error) {
    console.error(`[BLOCKCHAIN] Error saving new wallet timestamp:`, error.message);
  }
  
  console.log(`[BLOCKCHAIN] 🆕 New wallet ${walletAddress} - starting from timestamp: ${newTimestamp}`);
  return newTimestamp;
}

// Update timestamp for a wallet after processing transaction
async function updateWalletTimestamp(walletAddress, transactionTimestamp, currentTimestamps) {
  // Increment by 1 second to avoid processing the same transaction again
  const newTimestamp = transactionTimestamp + 1;
  currentTimestamps[walletAddress] = newTimestamp;
  
  // Save to Supabase immediately
  try {
    await supabase
      .from('wallet_timestamps')
      .upsert({
        wallet_address: walletAddress,
        last_timestamp: newTimestamp,
        last_updated: new Date().toISOString()
      }, { onConflict: 'wallet_address' });
  } catch (error) {
    console.error(`[BLOCKCHAIN] Error updating wallet timestamp:`, error.message);
  }
  
  console.log(`[BLOCKCHAIN] ⏰ Updated timestamp for ${walletAddress}: ${transactionTimestamp} → ${newTimestamp}`);
}

// Get all community fund wallets from database
async function getAllCommunityFundWallets() {
  try {
    const dbServerData = require('./db/server-data');
    const supabase = require('./supabase-client');
    
    // Get all guild settings to find community fund projects
    const { data: guildSettings, error: settingsError } = await supabase
      .from('guild_settings')
      .select('guild_id, community_fund_project')
      .not('community_fund_project', 'is', null);
    
    if (settingsError) {
      console.error('[BLOCKCHAIN] Error fetching guild settings:', settingsError);
      return [];
    }
    
    if (!guildSettings || guildSettings.length === 0) {
      console.log('[BLOCKCHAIN] No community fund projects found');
      return [];
    }
    
    const wallets = new Set();
    
    // For each guild with a community fund project, get the project details
    for (const setting of guildSettings) {
      const guildId = setting.guild_id;
      const communityFundProject = setting.community_fund_project; // This is the fund name for display
      
      if (!communityFundProject) continue;
      
      // Get the project details (always use "Community Fund" as the project name)
      const project = await dbServerData.getProject(guildId, 'Community Fund');
      
      if (project && project.walletAddress) {
        wallets.add({
          address: project.walletAddress,
          guildId: guildId,
          projectName: communityFundProject
        });
      }
    }
    
    console.log(`[BLOCKCHAIN] Found ${wallets.size} community fund wallets to monitor`);
    return Array.from(wallets);
  } catch (error) {
    console.error('[BLOCKCHAIN] Error getting community fund wallets:', error.message);
    return [];
  }
}

// Fetch latest transactions for a specific wallet
async function fetchLatestTransactions(walletAddress, fromTimestamp) {
  try {
    // Fetch transactions after the last known timestamp for this wallet
    // Removed function filter to capture both ESDTTransfer and ESDTNFTTransfer
    const url = `${API_BASE_URL}/accounts/${walletAddress}/transactions?size=1&receiver=${walletAddress}&status=success&order=desc&after=${fromTimestamp}`;
    
    console.log(`[BLOCKCHAIN] 🔗 Fetching: ${url}`);
    
    const response = await fetch(url);
    console.log(`[BLOCKCHAIN] 📡 Response status: ${response.status}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        // 404 means no transfers found - this is normal for empty wallets
        console.log(`[BLOCKCHAIN] 📭 404 - No transfers found for ${walletAddress} after timestamp ${fromTimestamp}`);
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
async function processTransaction(transaction, guildId, projectName) {
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
        // Extract token identifier (full identifier like "USDC-c76f1f")
        // Priority: identifier > token > ticker (for backward compatibility)
        const tokenIdentifier = transfer.identifier || transfer.token || transfer.ticker;
        const amountWei = transfer.value;
        const decimals = transfer.decimals || 8;
        
        // Convert from wei to human readable amount
        const humanAmount = new BigNumber(amountWei).dividedBy(new BigNumber(10).pow(decimals)).toString();
        
        console.log(`[BLOCKCHAIN] Processing transfer: ${humanAmount} ${tokenIdentifier} to ${projectName} in guild ${guildId}`);
        console.log(`[BLOCKCHAIN] Sender: ${transaction.sender}, Receiver: ${transaction.receiver}`);
        
        // Process the deposit (await the async function)
        const depositResult = await virtualAccounts.processBlockchainDeposit(
          guildId,
          transaction.sender,
          transaction.receiver,
          tokenIdentifier,
          humanAmount,
          transaction.txHash
        );
        
        if (depositResult && depositResult.success) {
          console.log(`[BLOCKCHAIN] Successfully processed deposit: ${humanAmount} ${tokenIdentifier} for user in guild ${guildId}`);
          
          // Send Discord notification if possible
          try {
            sendDepositNotification(guildId, transaction.sender, tokenIdentifier, humanAmount, transaction.txHash, projectName);
          } catch (notifyError) {
            console.error('[BLOCKCHAIN] Error sending Discord notification:', notifyError.message);
          }
          
          results.push({
            token: tokenIdentifier,
            success: true,
            amount: humanAmount,
            txHash: transaction.txHash
          });
        } else {
          const errorMsg = depositResult?.error || 'Unknown error';
          console.error(`[BLOCKCHAIN] Failed to process deposit:`, errorMsg);
          results.push({
            token: tokenIdentifier,
            success: false,
            error: errorMsg
          });
        }
      } else if (transfer.type === 'NonFungibleESDT' || transfer.type === 'SemiFungibleESDT') {
        // Process NFT transfer
        const collection = transfer.collection || transfer.ticker;
        const identifier = transfer.identifier;
        
        // Extract nonce from identifier (format: COLLECTION-NONCE where nonce is hex)
        // Example: BASTURDS-2a4c51-0318 -> nonce is 0318 (hex) = 792 (decimal)
        let nonce = null;
        if (identifier && identifier.includes('-')) {
          const parts = identifier.split('-');
          if (parts.length >= 2) {
            // Nonce is the last part after the last hyphen
            const nonceHex = parts[parts.length - 1];
            // Convert hex to decimal
            nonce = parseInt(nonceHex, 16);
          }
        }
        
        // Fallback: try to get nonce from transfer object if available
        if (!nonce && transfer.nonce !== undefined) {
          nonce = typeof transfer.nonce === 'string' ? parseInt(transfer.nonce, 16) : transfer.nonce;
        }
        
        if (!nonce || !identifier || !collection) {
          console.error(`[BLOCKCHAIN] Invalid NFT transfer data:`, {
            collection,
            identifier,
            nonce,
            transfer
          });
          continue;
        }
        
        console.log(`[BLOCKCHAIN] Processing NFT transfer: ${identifier} (${collection}#${nonce}) to ${projectName} in guild ${guildId}`);
        console.log(`[BLOCKCHAIN] Sender: ${transaction.sender}, Receiver: ${transaction.receiver}`);
        
        // Process NFT deposit
        const nftDepositResult = await processNFTDeposit(
          guildId,
          transaction.sender,
          transaction.receiver,
          collection,
          identifier,
          nonce,
          transaction.txHash,
          projectName
        );
        
        if (nftDepositResult && nftDepositResult.success) {
          console.log(`[BLOCKCHAIN] Successfully processed NFT deposit: ${identifier} for user in guild ${guildId}`);
          
          results.push({
            nft: identifier,
            collection: collection,
            nonce: nonce,
            success: true,
            txHash: transaction.txHash
          });
        } else {
          const errorMsg = nftDepositResult?.error || 'Unknown error';
          console.error(`[BLOCKCHAIN] Failed to process NFT deposit:`, errorMsg);
          results.push({
            nft: identifier,
            success: false,
            error: errorMsg
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

// Process NFT deposit from blockchain
async function processNFTDeposit(guildId, senderWallet, receiverWallet, collection, identifier, nonce, txHash, projectName) {
  try {
    if (!virtualAccountsNFT) {
      console.error('[BLOCKCHAIN] NFT virtual accounts module not loaded');
      return { success: false, error: 'NFT module not available' };
    }
    
    // Load server data to find user by wallet address
    const dbServerData = require('./db/server-data');
    const userWallets = await dbServerData.getUserWallets(guildId);
    
    if (!userWallets || Object.keys(userWallets).length === 0) {
      console.log(`[BLOCKCHAIN] No user wallets found for guild ${guildId}`);
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
      console.log(`[BLOCKCHAIN] No user found for wallet ${senderWallet} in guild ${guildId}`);
      return {
        success: false,
        error: 'User not found for wallet address'
      };
    }
    
    console.log(`[BLOCKCHAIN] Found user ${userId} for wallet ${senderWallet} in guild ${guildId}`);
    
    // Fetch NFT metadata from MultiversX API
    let nftMetadata = {
      nft_name: null,
      nft_image_url: null,
      metadata: {}
    };
    
    try {
      const nftUrl = `https://api.multiversx.com/nfts/${identifier}`;
      const nftResponse = await fetch(nftUrl);
      
      if (nftResponse.ok) {
        const nftData = await nftResponse.json();
        nftMetadata.nft_name = nftData.name || null;
        
        // Extract image URL
        if (nftData.url) {
          nftMetadata.nft_image_url = nftData.url;
        } else if (nftData.media && nftData.media.length > 0) {
          nftMetadata.nft_image_url = nftData.media[0].url || nftData.media[0].thumbnailUrl || null;
        }
        
        // Store additional metadata
        nftMetadata.metadata = {
          collection: nftData.collection || collection,
          creator: nftData.creator || null,
          royalties: nftData.royalties || null,
          attributes: nftData.attributes || []
        };
      }
    } catch (fetchError) {
      console.error(`[BLOCKCHAIN] Error fetching NFT metadata for ${identifier}:`, fetchError.message);
      // Continue without metadata - we'll use basic info
    }
    
    // Add NFT to user's virtual account
    await virtualAccountsNFT.addNFTToAccount(
      guildId,
      userId,
      collection,
      identifier,
      nonce,
      nftMetadata
    );
    
    // Track NFT top-up to house balance
    await virtualAccountsNFT.trackNFTTopup(
      guildId,
      collection,
      identifier,
      nonce,
      userId,
      txHash,
      nftMetadata
    );
    
    // Create transaction record
    await virtualAccountsNFT.addNFTTransaction(guildId, userId, {
      id: `nft_deposit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'deposit',
      collection: collection,
      identifier: identifier,
      nonce: nonce,
      nft_name: nftMetadata.nft_name,
      tx_hash: txHash,
      source: 'blockchain_deposit',
      timestamp: Date.now(),
      description: `NFT deposit: ${nftMetadata.nft_name || identifier}`
    });
    
    console.log(`[BLOCKCHAIN] Successfully added NFT ${identifier} to user ${userId}'s virtual account`);
    
    return {
      success: true,
      userId: userId,
      nft: identifier,
      collection: collection,
      nonce: nonce
    };
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Error processing NFT deposit:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Send deposit notification to Discord
async function sendDepositNotification(guildId, senderWallet, tokenIdentifier, amount, txHash, projectName) {
  try {
    // This function will be implemented in the main bot file
    // For now, we'll just log the notification
    console.log(`[BLOCKCHAIN] Would send Discord notification: User ${senderWallet} deposited ${amount} ${tokenIdentifier} to ${projectName} in guild ${guildId}`);
    
    // TODO: Implement actual Discord notification
    // This requires access to the Discord client from the main bot
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Error sending deposit notification:', error.message);
  }
}

// Main polling function
async function pollBlockchain() {
  try {
    const wallets = await getAllCommunityFundWallets();
    
    if (wallets.length === 0) {
      console.log('[BLOCKCHAIN] No community fund wallets found to monitor');
      // Clean up orphaned timestamps if no wallets exist
      await cleanupOrphanedTimestamps();
      return;
    }
    
    console.log(`[BLOCKCHAIN] 🔍 Polling ${wallets.length} community fund wallets...`);
    
    // Load current timestamps from Supabase
    const currentTimestamps = await loadTimestamps();
    
    // Periodically clean up orphaned timestamps (every 10th poll cycle)
    if (Math.random() < 0.1) {
      await cleanupOrphanedTimestamps();
    }
    
    for (const wallet of wallets) {
      try {
        // Get existing timestamp for this wallet, or initialize if new
        let walletTimestamp = currentTimestamps[wallet.address];
        
        if (!walletTimestamp) {
          // This is a new wallet - initialize it now
          walletTimestamp = await getWalletTimestamp(wallet.address, currentTimestamps);
          console.log(`[BLOCKCHAIN] 🆕 Auto-initialized new wallet ${wallet.address} (${wallet.projectName}) - starting monitoring`);
        }
        
        const transactions = await fetchLatestTransactions(wallet.address, walletTimestamp);
        
        if (transactions && Array.isArray(transactions) && transactions.length > 0) {
          console.log(`[BLOCKCHAIN] 📋 Found ${transactions.length} transactions for ${wallet.projectName}`);
          const latestTransaction = transactions[0]; // With order=desc, newest is first
          
          if (latestTransaction && latestTransaction.txHash) {
            console.log(`[BLOCKCHAIN] 🔍 Processing transaction: ${latestTransaction.txHash}`);
            console.log(`[BLOCKCHAIN] 📅 Transaction timestamp: ${latestTransaction.timestamp}`);
            console.log(`[BLOCKCHAIN] 🏁 Wallet last timestamp: ${walletTimestamp}`);
            
            const result = await processTransaction(latestTransaction, wallet.guildId, wallet.projectName);
            
            if (result.processed) {
              console.log(`[BLOCKCHAIN] ✅ Processed transaction ${latestTransaction.txHash} for ${wallet.projectName}`);
              
              // Update timestamp for this wallet (saves to Supabase immediately)
              await updateWalletTimestamp(wallet.address, latestTransaction.timestamp, currentTimestamps);
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
    
  } catch (error) {
    console.error('[BLOCKCHAIN] Error in blockchain polling:', error.message);
  }
}

// Initialize timestamp for a single wallet
async function initializeWalletTimestamp(walletAddress, projectName = null) {
  try {
    // Check if timestamp already exists in Supabase
    const { data, error } = await supabase
      .from('wallet_timestamps')
      .select('last_timestamp')
      .eq('wallet_address', walletAddress)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" which is fine
      throw error;
    }
    
    if (data && data.last_timestamp) {
      console.log(`[BLOCKCHAIN] ✅ Wallet ${walletAddress} already has timestamp: ${data.last_timestamp}`);
      return data.last_timestamp;
    }
    
    // Create new timestamp for this wallet (use creation time)
    const newTimestamp = Math.floor(Date.now() / 1000);
    
    const { error: insertError } = await supabase
      .from('wallet_timestamps')
      .upsert({
        wallet_address: walletAddress,
        last_timestamp: newTimestamp,
        last_updated: new Date().toISOString()
      }, { onConflict: 'wallet_address' });
    
    if (insertError) {
      throw insertError;
    }
    
    console.log(`[BLOCKCHAIN] 🆕 Initialized wallet ${walletAddress}${projectName ? ` (${projectName})` : ''} with timestamp: ${newTimestamp}`);
    return newTimestamp;
  } catch (error) {
    console.error('[BLOCKCHAIN] Error initializing wallet timestamp:', error.message);
    return null;
  }
}

// Remove timestamp for a deleted wallet
async function removeWalletTimestamp(walletAddress, projectName = null) {
  try {
    const { error } = await supabase
      .from('wallet_timestamps')
      .delete()
      .eq('wallet_address', walletAddress);
    
    if (error) {
      throw error;
    }
    
    console.log(`[BLOCKCHAIN] 🗑️ Removed timestamp for deleted wallet ${walletAddress}${projectName ? ` (${projectName})` : ''}`);
    return true;
  } catch (error) {
    if (error.code === 'PGRST116') {
      console.log(`[BLOCKCHAIN] ℹ️ Wallet ${walletAddress} had no timestamp to remove`);
      return false;
    }
    console.error('[BLOCKCHAIN] Error removing wallet timestamp:', error.message);
    return false;
  }
}

// Clean up orphaned timestamps (wallets that no longer exist in database)
async function cleanupOrphanedTimestamps() {
  try {
    console.log('[BLOCKCHAIN] 🧹 Cleaning up orphaned timestamps...');
    
    const wallets = await getAllCommunityFundWallets();
    const currentTimestamps = await loadTimestamps();
    const activeWalletAddresses = new Set(wallets.map(w => w.address));
    let removedCount = 0;
    
    // Find timestamps for wallets that no longer exist
    for (const walletAddress of Object.keys(currentTimestamps)) {
      if (!activeWalletAddresses.has(walletAddress)) {
        const { error } = await supabase
          .from('wallet_timestamps')
          .delete()
          .eq('wallet_address', walletAddress);
        
        if (!error) {
          removedCount++;
          console.log(`[BLOCKCHAIN] 🗑️ Removed orphaned timestamp for wallet ${walletAddress}`);
        }
      }
    }
    
    if (removedCount > 0) {
      console.log(`[BLOCKCHAIN] 💾 Cleaned up ${removedCount} orphaned timestamp(s)`);
    } else {
      console.log(`[BLOCKCHAIN] ✅ No orphaned timestamps found`);
    }
    
    return removedCount;
  } catch (error) {
    console.error('[BLOCKCHAIN] Error cleaning up orphaned timestamps:', error.message);
    return 0;
  }
}

// Initialize timestamps for all wallets
async function initializeWalletTimestamps() {
  try {
    console.log('[BLOCKCHAIN] 🔧 Initializing wallet timestamps...');
    
    const wallets = await getAllCommunityFundWallets();
    const currentTimestamps = await loadTimestamps();
    let timestampsChanged = false;
    
    const recordsToInsert = [];
    
    for (const wallet of wallets) {
      if (!currentTimestamps[wallet.address]) {
        // Create new timestamp for this wallet
        const newTimestamp = Math.floor(Date.now() / 1000);
        currentTimestamps[wallet.address] = newTimestamp;
        recordsToInsert.push({
          wallet_address: wallet.address,
          last_timestamp: newTimestamp,
          last_updated: new Date().toISOString()
        });
        console.log(`[BLOCKCHAIN] 🆕 Initialized wallet ${wallet.address} (${wallet.projectName}) with timestamp: ${newTimestamp}`);
        timestampsChanged = true;
      }
    }
    
    if (timestampsChanged && recordsToInsert.length > 0) {
      // Insert new timestamps in batches
      const batchSize = 50;
      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        await supabase
          .from('wallet_timestamps')
          .upsert(batch, { onConflict: 'wallet_address' });
      }
      console.log(`[BLOCKCHAIN] 💾 Saved initialized timestamps for ${recordsToInsert.length} wallets to Supabase`);
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
async function startBlockchainListener() {
  try {
    console.log('[BLOCKCHAIN] 🚀 Starting blockchain listener...');
    console.log(`[BLOCKCHAIN] 📡 Will poll every ${POLLING_INTERVAL / 1000} seconds`);
    console.log(`[BLOCKCHAIN] 🌐 Using API: ${API_BASE_URL}`);
    
    // Initialize timestamps for all wallets first
    const timestamps = await initializeWalletTimestamps();
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
async function getListenerStatus() {
  try {
    const wallets = await getAllCommunityFundWallets();
    const timestamps = await loadTimestamps();
    const isRunning = global.blockchainPollInterval !== null;
    
    // Get last updated timestamp from Supabase
    const { data: lastUpdatedData } = await supabase
      .from('wallet_timestamps')
      .select('last_updated')
      .order('last_updated', { ascending: false })
      .limit(1)
      .single();
    
    return {
      success: true,
      isRunning: isRunning,
      pollingInterval: POLLING_INTERVAL,
      monitoredWallets: wallets.length,
      processedTransactions: processedTransactions.size,
      trackedWallets: Object.keys(timestamps).length,
      lastUpdated: lastUpdatedData?.last_updated || 'Never',
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
  pollBlockchain,
  initializeWalletTimestamp,
  removeWalletTimestamp,
  cleanupOrphanedTimestamps
};

// Start listener if this file is run directly
if (require.main === module) {
  startBlockchainListener();
}
