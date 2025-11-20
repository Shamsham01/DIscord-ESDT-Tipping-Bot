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
    // Note: This endpoint captures both ESDT transfers (FungibleESDT) and NFT transfers (NonFungibleESDT/SemiFungibleESDT)
    // The receiver filter ensures we only get incoming transfers to the Community Fund wallet
    // No function filter is needed - the API returns all transaction types, and we filter by transfer.type in processTransaction()
    // Fetch the 2 NEWEST transactions (order=desc) to handle cases where 2 people make transactions in the same second
    const url = `${API_BASE_URL}/accounts/${walletAddress}/transactions?size=2&receiver=${walletAddress}&status=success&order=desc&after=${fromTimestamp}`;
    
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
    
    // Log transaction types found for debugging
    if (data && Array.isArray(data) && data.length > 0) {
      const transferTypes = [];
      data.forEach(tx => {
        if (tx.action && tx.action.arguments && tx.action.arguments.transfers) {
          tx.action.arguments.transfers.forEach(t => {
            if (!transferTypes.includes(t.type)) transferTypes.push(t.type);
          });
        }
      });
      console.log(`[BLOCKCHAIN] 📊 Found ${data.length} transaction(s) with transfer types: ${transferTypes.join(', ')}`);
    }
    
    // Reverse the array to process chronologically (oldest first)
    // API returns newest first (desc), but we want to process oldest first to maintain chronological order
    if (data && Array.isArray(data) && data.length > 0) {
      return data.reverse();
    }
    
    return data || [];
  } catch (error) {
    console.error(`[BLOCKCHAIN] Error fetching transactions for ${walletAddress}:`, error.message);
    return null;
  }
}

// Process a blockchain transaction
async function processTransaction(transaction, guildId, projectName) {
  try {
    // CRITICAL: Validate txHash exists before processing
    if (!transaction.txHash) {
      console.error(`[BLOCKCHAIN] ❌ Transaction missing txHash, cannot process:`, transaction);
      return { processed: false, reason: 'Missing transaction hash' };
    }
    
    console.log(`[BLOCKCHAIN] 🔍 Processing transaction for ${projectName}:`, {
      txHash: transaction.txHash,
      sender: transaction.sender,
      receiver: transaction.receiver,
      timestamp: transaction.timestamp,
      hasAction: !!transaction.action,
      hasArguments: !!(transaction.action && transaction.action.arguments),
      hasTransfers: !!(transaction.action && transaction.action.arguments && transaction.action.arguments.transfers)
    });
    
    // CRITICAL: Check in-memory cache first (fast check for current session)
    if (processedTransactions.has(transaction.txHash)) {
      console.log(`[BLOCKCHAIN] 🔄 Skipped duplicate transaction ${transaction.txHash} (in-memory cache)`);
      return { processed: false, reason: 'Already processed (in-memory)' };
    }
    
    // CRITICAL: Check database for duplicates BEFORE any processing
    // This is bulletproof and survives crashes/restarts
    try {
      // Check NFT transactions table
      const { data: existingNftTx, error: nftCheckError } = await supabase
        .from('virtual_account_nft_transactions')
        .select('id, user_id, collection, nonce, type, tx_hash')
        .eq('tx_hash', transaction.txHash)
        .limit(1)
        .maybeSingle(); // Use maybeSingle() to avoid error if no record found
      
      if (nftCheckError && nftCheckError.code !== 'PGRST116') { // PGRST116 = no rows found, which is OK
        console.error(`[BLOCKCHAIN] ⚠️ Error checking NFT transactions for duplicate:`, nftCheckError.message);
        // Continue processing if database check fails (fail-open to avoid missing transactions)
      } else if (existingNftTx) {
        console.log(`[BLOCKCHAIN] 🔄 Skipped duplicate transaction ${transaction.txHash} (found in NFT transactions)`);
        console.log(`[BLOCKCHAIN] ℹ️ Already processed: user=${existingNftTx.user_id}, collection=${existingNftTx.collection}, nonce=${existingNftTx.nonce}, type=${existingNftTx.type}`);
        // Add to in-memory cache to avoid future database queries
        processedTransactions.add(transaction.txHash);
        return { processed: false, reason: 'Already processed (database - NFT)' };
      }
      
      // Check ESDT transactions table
      const { data: existingEsdtTx, error: esdtCheckError } = await supabase
        .from('virtual_account_transactions')
        .select('id, user_id, token, amount, type, tx_hash')
        .eq('tx_hash', transaction.txHash)
        .limit(1)
        .maybeSingle(); // Use maybeSingle() to avoid error if no record found
      
      if (esdtCheckError && esdtCheckError.code !== 'PGRST116') { // PGRST116 = no rows found, which is OK
        console.error(`[BLOCKCHAIN] ⚠️ Error checking ESDT transactions for duplicate:`, esdtCheckError.message);
        // Continue processing if database check fails (fail-open to avoid missing transactions)
      } else if (existingEsdtTx) {
        console.log(`[BLOCKCHAIN] 🔄 Skipped duplicate transaction ${transaction.txHash} (found in ESDT transactions)`);
        console.log(`[BLOCKCHAIN] ℹ️ Already processed: user=${existingEsdtTx.user_id}, token=${existingEsdtTx.token}, amount=${existingEsdtTx.amount}, type=${existingEsdtTx.type}`);
        // Add to in-memory cache to avoid future database queries
        processedTransactions.add(transaction.txHash);
        return { processed: false, reason: 'Already processed (database - ESDT)' };
      }
      
      console.log(`[BLOCKCHAIN] ✅ Transaction ${transaction.txHash} not found in database, proceeding with processing`);
    } catch (dbCheckError) {
      console.error(`[BLOCKCHAIN] ⚠️ Critical error during database duplicate check:`, dbCheckError.message);
      // Fail-open: Continue processing if database check fails completely
      // This prevents missing transactions due to temporary database issues
      // But log the error so we can investigate
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
    
    console.log(`[BLOCKCHAIN] Found ${transfers.length} transfer(s) in transaction ${transaction.txHash}`);
    
    for (const transfer of transfers) {
      console.log(`[BLOCKCHAIN] Processing transfer type: ${transfer.type}`, {
        hasCollection: !!transfer.collection,
        hasIdentifier: !!transfer.identifier,
        hasNonce: transfer.nonce !== undefined,
        hasTicker: !!transfer.ticker,
        hasToken: !!transfer.token
      });
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
        // Process NFT/SFT transfer
        // Extract collection - try multiple possible fields
        let collection = transfer.collection || transfer.ticker || transfer.token;
        const identifier = transfer.identifier || transfer.token;
        
        // Extract nonce - prioritize direct nonce field, then try to extract from identifier
        let nonce = null;
        
        // First, try to get nonce directly from transfer object (most reliable)
        if (transfer.nonce !== undefined && transfer.nonce !== null) {
          if (typeof transfer.nonce === 'string') {
            // Try parsing as hex first, then decimal
            nonce = transfer.nonce.startsWith('0x') 
              ? parseInt(transfer.nonce, 16) 
              : (isNaN(parseInt(transfer.nonce, 16)) ? parseInt(transfer.nonce, 10) : parseInt(transfer.nonce, 16));
          } else {
            nonce = Number(transfer.nonce);
          }
        }
        
        // If nonce not found, try to extract from identifier
        // Format examples: 
        // - COLLECTION-NONCE (e.g., "BASTURDS-2a4c51-0318" -> nonce is "0318")
        // - COLLECTION#NONCE (less common)
        if (!nonce && identifier) {
          if (identifier.includes('-')) {
            const parts = identifier.split('-');
            if (parts.length >= 2) {
              // Nonce is typically the last part after the last hyphen
              const nonceHex = parts[parts.length - 1];
              // Try parsing as hex first
              const parsedHex = parseInt(nonceHex, 16);
              if (!isNaN(parsedHex)) {
                nonce = parsedHex;
              } else {
                // Try parsing as decimal
                const parsedDec = parseInt(nonceHex, 10);
                if (!isNaN(parsedDec)) {
                  nonce = parsedDec;
                }
              }
            }
          }
          
          // Also try extracting collection from identifier if not found
          // Format: COLLECTION-NONCE, extract everything before the last hyphen
          if (!collection && identifier.includes('-')) {
            const parts = identifier.split('-');
            if (parts.length >= 2) {
              // Collection is everything except the last part (nonce)
              collection = parts.slice(0, -1).join('-');
            }
          }
        }
        
        // Extract amount for SFTs (SemiFungibleESDT has amount field)
        let amount = '1'; // Default for NFTs
        if (transfer.type === 'SemiFungibleESDT') {
          // SFTs have amount in value field (in wei/base units)
          if (transfer.value) {
            // Convert from wei/base units to human-readable amount
            // For SFTs, value is typically already in base units (like 1000000000000000000 for 1)
            // But we need to check if there's a decimals field or if it's already human-readable
            const decimals = transfer.decimals || 0;
            if (decimals > 0) {
              const amountBN = new BigNumber(transfer.value);
              amount = amountBN.dividedBy(new BigNumber(10).pow(decimals)).toString();
            } else {
              // If no decimals, assume it's already human-readable or treat as base units
              // Most SFTs don't use decimals, so value might be the actual amount
              amount = transfer.value.toString();
            }
          } else if (transfer.amount) {
            amount = transfer.amount.toString();
          }
          console.log(`[BLOCKCHAIN] SFT transfer detected with amount: ${amount}`);
        }
        
        // Validate required fields
        if (!nonce || !identifier || !collection) {
          console.error(`[BLOCKCHAIN] Invalid NFT transfer data:`, {
            collection,
            identifier,
            nonce,
            transferType: transfer.type,
            transfer: JSON.stringify(transfer, null, 2)
          });
          continue;
        }
        
        console.log(`[BLOCKCHAIN] Extracted NFT data: collection=${collection}, identifier=${identifier}, nonce=${nonce}, amount=${amount}`);
        
        const transferType = transfer.type === 'SemiFungibleESDT' ? 'SFT' : 'NFT';
        console.log(`[BLOCKCHAIN] Processing ${transferType} transfer: ${identifier} (${collection}#${nonce})${transfer.type === 'SemiFungibleESDT' ? ` amount: ${amount}` : ''} to ${projectName} in guild ${guildId}`);
        console.log(`[BLOCKCHAIN] Sender: ${transaction.sender}, Receiver: ${transaction.receiver}`);
        
        // Process NFT/SFT deposit (pass token type from blockchain transaction)
        const nftDepositResult = await processNFTDeposit(
          guildId,
          transaction.sender,
          transaction.receiver,
          collection,
          identifier,
          nonce,
          transaction.txHash,
          projectName,
          amount,
          transferType
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
async function processNFTDeposit(guildId, senderWallet, receiverWallet, collection, identifier, nonce, txHash, projectName, amount = 1, tokenType = 'NFT') {
  try {
    if (!virtualAccountsNFT) {
      console.error('[BLOCKCHAIN] NFT virtual accounts module not loaded');
      return { success: false, error: 'NFT module not available' };
    }
    
    // CRITICAL: Validate txHash exists
    if (!txHash) {
      console.error(`[BLOCKCHAIN] ❌ NFT deposit missing txHash, cannot process`);
      return { success: false, error: 'Missing transaction hash' };
    }
    
    // CRITICAL: Database duplicate check (redundant safety layer)
    // Main check happens in processTransaction() before calling this function
    if (txHash) {
      const { data: existingTx, error: checkError } = await supabase
        .from('virtual_account_nft_transactions')
        .select('id, user_id, collection, nonce, type')
        .eq('tx_hash', txHash)
        .limit(1)
        .maybeSingle(); // Use maybeSingle() to avoid error if no record found
      
      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found, which is OK
        console.error(`[BLOCKCHAIN] ⚠️ Error checking NFT duplicate in processNFTDeposit:`, checkError.message);
        // Continue processing if database check fails (fail-open to avoid missing transactions)
      } else if (existingTx) {
        console.log(`[BLOCKCHAIN] ⚠️ Transaction ${txHash} already processed (found in database), skipping`);
        console.log(`[BLOCKCHAIN] ℹ️ Already processed for user ${existingTx.user_id}, collection ${existingTx.collection}, nonce ${existingTx.nonce}`);
        return {
          success: false,
          error: 'Transaction already processed'
        };
      }
    }
    
    // Convert amount to number if string
    const amountNum = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    const finalAmount = isNaN(amountNum) || amountNum <= 0 ? 1 : amountNum;
    
    // Validate token type (must be 'NFT' or 'SFT')
    const validTokenType = (tokenType === 'SFT' || tokenType === 'NFT') ? tokenType : 'NFT';
    
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
      console.log(`[BLOCKCHAIN] ⚠️ No user found for wallet ${senderWallet} in guild ${guildId}`);
      console.log(`[BLOCKCHAIN] ℹ️ NFT deposit will be skipped. User must register wallet with /set-wallet before sending NFTs.`);
      console.log(`[BLOCKCHAIN] ℹ️ Transaction hash: ${txHash || 'N/A'}`);
      return {
        success: false,
        error: 'User not found for wallet address. Please register wallet with /set-wallet before sending NFTs.'
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
    
    // Add NFT/SFT to user's virtual account with amount and token type
    await virtualAccountsNFT.addNFTToAccount(
      guildId,
      userId,
      collection,
      identifier,
      nonce,
      nftMetadata,
      finalAmount,
      validTokenType
    );
    
    // Create transaction record
    const amountText = finalAmount > 1 ? ` (${finalAmount}x)` : '';
    await virtualAccountsNFT.addNFTTransaction(guildId, userId, {
      id: `nft_deposit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'deposit',
      collection: collection,
      identifier: identifier,
      nonce: nonce,
      nft_name: nftMetadata.nft_name,
      amount: finalAmount, // Store amount for SFTs
      token_type: validTokenType, // Use actual token_type from blockchain transfer, not inferred from amount
      tx_hash: txHash,
      source: 'blockchain_deposit',
      timestamp: Date.now(),
      description: `${validTokenType} deposit: ${nftMetadata.nft_name || identifier}${amountText}`
    });
    
    console.log(`[BLOCKCHAIN] Successfully added ${validTokenType} ${identifier}${amountText} to user ${userId}'s virtual account`);
    
    return {
      success: true,
      userId: userId,
      nft: identifier,
      collection: collection,
      nonce: nonce,
      amount: finalAmount,
      tokenType: validTokenType
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
          console.log(`[BLOCKCHAIN] 📋 Found ${transactions.length} transaction(s) for ${wallet.projectName}`);
          
          let latestTimestamp = walletTimestamp;
          let processedCount = 0;
          let skippedCount = 0;
          
          // Process ALL transactions in chronological order (oldest first)
          for (const transaction of transactions) {
            if (!transaction.txHash) {
              console.log(`[BLOCKCHAIN] ⚠️ Skipping transaction without txHash:`, transaction);
              continue;
            }
            
            console.log(`[BLOCKCHAIN] 🔍 Processing transaction: ${transaction.txHash}`);
            console.log(`[BLOCKCHAIN] 📅 Transaction timestamp: ${transaction.timestamp}`);
            console.log(`[BLOCKCHAIN] 🏁 Wallet last timestamp: ${walletTimestamp}`);
            
            const result = await processTransaction(transaction, wallet.guildId, wallet.projectName);
            
            if (result.processed) {
              processedCount++;
              console.log(`[BLOCKCHAIN] ✅ Processed transaction ${transaction.txHash} for ${wallet.projectName}`);
              
              // Track the latest timestamp processed
              if (transaction.timestamp > latestTimestamp) {
                latestTimestamp = transaction.timestamp;
              }
            } else {
              skippedCount++;
              // Log why transaction wasn't processed (for debugging)
              if (result.reason === 'Already processed') {
                console.log(`[BLOCKCHAIN] 🔄 Skipped duplicate transaction ${transaction.txHash} for ${wallet.projectName}`);
              } else {
                console.log(`[BLOCKCHAIN] ❌ Transaction not processed: ${result.reason || 'Unknown reason'}`);
              }
            }
            
            // Small delay between processing transactions to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Update timestamp to the latest processed transaction (or keep current if none were processed)
          if (latestTimestamp > walletTimestamp) {
            await updateWalletTimestamp(wallet.address, latestTimestamp, currentTimestamps);
            console.log(`[BLOCKCHAIN] 📅 Updated timestamp for ${wallet.projectName} to ${latestTimestamp} (processed ${processedCount}, skipped ${skippedCount})`);
          } else if (processedCount === 0 && skippedCount > 0) {
            console.log(`[BLOCKCHAIN] 📅 No new transactions processed for ${wallet.projectName} (all ${skippedCount} were duplicates or failed)`);
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

// Process pending transactions for a newly registered wallet
// This handles cases where user sent NFTs/tokens before registering
async function processPendingTransactionsForWallet(guildId, userId, walletAddress) {
  try {
    console.log(`[BLOCKCHAIN] 🔍 Processing pending transactions for newly registered wallet ${walletAddress} (user ${userId})`);
    
    // Get Community Fund wallet address
    const dbServerData = require('./db/server-data');
    const supabaseClient = require('./supabase-client');
    
    // Get community fund project name from guild settings
    const { data: guildSetting, error: settingsError } = await supabaseClient
      .from('guild_settings')
      .select('community_fund_project')
      .eq('guild_id', guildId)
      .single();
    
    if (settingsError || !guildSetting || !guildSetting.community_fund_project) {
      console.log(`[BLOCKCHAIN] No Community Fund configured for guild ${guildId}`);
      return { processed: 0, errors: [] };
    }
    
    // Get the Community Fund project (always use "Community Fund" as the project name)
    const communityFundProject = await dbServerData.getProject(guildId, 'Community Fund');
    
    if (!communityFundProject || !communityFundProject.walletAddress) {
      console.log(`[BLOCKCHAIN] No Community Fund wallet found for guild ${guildId}`);
      return { processed: 0, errors: [] };
    }
    
    const communityFundAddress = communityFundProject.walletAddress;
    const communityFundProjectName = guildSetting.community_fund_project;
    
    // Fetch transactions from last 30 days (to catch old deposits)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    const url = `${API_BASE_URL}/accounts/${communityFundAddress}/transactions?size=100&receiver=${communityFundAddress}&sender=${walletAddress}&status=success&order=asc&after=${thirtyDaysAgo}`;
    
    console.log(`[BLOCKCHAIN] 🔗 Fetching pending transactions: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[BLOCKCHAIN] No pending transactions found for wallet ${walletAddress}`);
        return { processed: 0, errors: [] };
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const transactions = await response.json();
    if (!Array.isArray(transactions) || transactions.length === 0) {
      console.log(`[BLOCKCHAIN] No pending transactions found for wallet ${walletAddress}`);
      return { processed: 0, errors: [] };
    }
    
    console.log(`[BLOCKCHAIN] Found ${transactions.length} potential pending transaction(s) for wallet ${walletAddress}`);
    
    let processedCount = 0;
    const errors = [];
    
    // Process each transaction
    for (const transaction of transactions) {
      if (!transaction.txHash) continue;
      
      // Check if already processed (by tx_hash)
      const { data: existingTx } = await supabase
        .from('virtual_account_nft_transactions')
        .select('id')
        .eq('tx_hash', transaction.txHash)
        .limit(1)
        .single();
      
      // Also check ESDT transactions
      const { data: existingEsdtTx } = await supabase
        .from('virtual_account_transactions')
        .select('id')
        .eq('tx_hash', transaction.txHash)
        .limit(1)
        .single();
      
      if (existingTx || existingEsdtTx) {
        console.log(`[BLOCKCHAIN] ⏭️ Transaction ${transaction.txHash} already processed, skipping`);
        continue;
      }
      
      // Process the transaction
      console.log(`[BLOCKCHAIN] 🔄 Processing pending transaction ${transaction.txHash}`);
      const result = await processTransaction(transaction, guildId, communityFundProjectName);
      
      if (result.processed) {
        processedCount++;
        console.log(`[BLOCKCHAIN] ✅ Processed pending transaction ${transaction.txHash}`);
      } else {
        const errorMsg = result.error || result.reason || 'Unknown error';
        errors.push({ txHash: transaction.txHash, error: errorMsg });
        console.log(`[BLOCKCHAIN] ❌ Failed to process pending transaction ${transaction.txHash}: ${errorMsg}`);
      }
      
      // Small delay between processing
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`[BLOCKCHAIN] ✅ Processed ${processedCount} pending transaction(s) for wallet ${walletAddress}`);
    if (errors.length > 0) {
      console.log(`[BLOCKCHAIN] ⚠️ ${errors.length} transaction(s) failed:`, errors);
    }
    
    return { processed: processedCount, errors };
  } catch (error) {
    console.error(`[BLOCKCHAIN] Error processing pending transactions for wallet ${walletAddress}:`, error.message);
    return { processed: 0, errors: [{ error: error.message }] };
  }
}

// Export functions
module.exports = {
  startBlockchainListener,
  stopBlockchainListener,
  getListenerStatus,
  pollBlockchain,
  initializeWalletTimestamp,
  removeWalletTimestamp,
  cleanupOrphanedTimestamps,
  processPendingTransactionsForWallet
};

// Start listener if this file is run directly
if (require.main === module) {
  startBlockchainListener();
}
