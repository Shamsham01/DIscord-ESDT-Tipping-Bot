require('dotenv').config();
console.log('Starting Multi-Server ESDT Tipping Bot with Virtual Accounts...');
console.log('Environment variables:', {
  TOKEN: process.env.TOKEN ? 'Set' : 'Missing',
  API_BASE_URL: process.env.API_BASE_URL ? 'Set' : 'Missing',
  API_TOKEN: process.env.API_TOKEN ? 'Set' : 'Missing',
  FD_TOKEN: process.env.FD_TOKEN ? 'Set' : 'Missing',
  API_BASE_URL: process.env.API_BASE_URL ? 'Set' : 'Missing',
});

const { Client, IntentsBitField, EmbedBuilder, PermissionsBitField, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const BigNumber = require('bignumber.js');

// Import virtual accounts and blockchain listener
const virtualAccounts = require('./virtual-accounts.js');
const blockchainListener = require('./blockchain-listener.js');

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.User,
    Partials.GuildMember,
  ],
});

// Constants
const API_BASE_URL = process.env.API_BASE_URL;
const API_TOKEN = process.env.API_TOKEN; // For MultiversX API
const FD_TOKEN = process.env.FD_TOKEN; // For Football-Data.org API

// Global state variables - organized by server
let serverData = {};
const SERVER_DATA_FILE = 'server-data.json';

// Remove rpsChallenges and usedTxHashes from serverData
// Add new files for RPS games and used tx hashes
const RPS_GAMES_FILE = 'rps-games.json';
const USED_TX_HASHES_FILE = 'used-tx-hashes.json';

// Football game data files
const FOOTBALL_MATCHES_FILE = 'data/matches.json';
const FOOTBALL_BETS_FILE = 'data/bets.json';
const FOOTBALL_LEADERBOARD_FILE = 'data/leaderboard.json';

let rpsGamesData = {};
let usedTxHashesData = {};
let footballMatchesData = {};
let footballBetsData = {};
let footballLeaderboardData = {};

// Load server data from disk
function loadServerData() {
  try {
    if (fs.existsSync(SERVER_DATA_FILE)) {
      serverData = JSON.parse(fs.readFileSync(SERVER_DATA_FILE, 'utf8'));
      console.log(`Loaded data for ${Object.keys(serverData).length} servers`);
    }
  } catch (error) {
    console.error('Error loading server data:', error.message);
    serverData = {};
  }
}

// Save server data to disk
function saveServerData() {
  try {
    fs.writeFileSync(SERVER_DATA_FILE, JSON.stringify(serverData, null, 2));
  } catch (error) {
    console.error('Error saving server data:', error.message);
  }
}

// Initialize server data if it doesn't exist
function initializeServerData(guildId) {
  if (!serverData[guildId]) {
    serverData[guildId] = {
      userWallets: {},
      projects: {},
      usedTxHashes: {}, // Store used transaction hashes
      communityFundQR: {}, // Store QR code URLs for community fund projects
      createdAt: Date.now()
    };
    saveServerData();
  }
}

// Get user wallets for a specific server
function getUserWallets(guildId) {
  initializeServerData(guildId);
  return serverData[guildId].userWallets;
}

// Get projects for a specific server
function getProjects(guildId) {
  initializeServerData(guildId);
  return serverData[guildId].projects;
}

// Get RPS challenges for a specific server (using rps-games.json)
function getRPSChallenges(guildId) {
  if (!rpsGamesData[guildId]) {
    rpsGamesData[guildId] = {};
    saveRpsGamesData();
  }
  return rpsGamesData[guildId];
}

// Generate a unique challenge ID
function generateChallengeId() {
  return 'rps_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Verify transaction hash format
function isValidTransactionHash(txHash) {
  return txHash && typeof txHash === 'string' && txHash.length >= 64;
}

// Determine RPS winner
function determineRPSWinner(player1Choice, player2Choice) {
  if (player1Choice === player2Choice) {
    return 'draw';
  }
  
  const rules = {
    'rock': 'scissors',
    'paper': 'rock',
    'scissors': 'paper'
  };
  
  return rules[player1Choice] === player2Choice ? 'player1' : 'player2';
}

// Clean up expired challenges (30 minutes timeout)
async function cleanupExpiredChallenges() {
  const now = Date.now();
  let changed = false;
  
  for (const guildId in rpsGamesData) {
    const challenges = rpsGamesData[guildId];
    const expiredChallengeIds = [];
    
    for (const [challengeId, challenge] of Object.entries(challenges)) {
      if (challenge.status === 'waiting' && now > challenge.expiresAt) {
        // Mark as expired
        challenge.status = 'expired';
        changed = true;
        
        // Refund challenger to virtual account
        try {
          if (challenge.humanAmount && challenge.token) {
            const memo = `RPS refund: challenge expired (${challengeId})`;
            const refundResult = virtualAccounts.addFundsToAccount(
              guildId,
              challenge.challengerId,
              challenge.token,
              challenge.humanAmount,
              null, // No transaction hash for virtual refund
              'rps_refund',
              null // Username will be updated when user runs commands
            );
            
            if (refundResult) {
              console.log(`[RPS CLEANUP] Refunded challenger for expired challenge ${challengeId}: ${challenge.humanAmount} ${challenge.token}`);
              
              // Send notifications for successful refund
              await sendExpiredChallengeNotifications(guildId, challengeId, challenge);
            }
          }
        } catch (refundError) {
          console.error(`[RPS CLEANUP] Failed to refund challenger for expired challenge ${challengeId}:`, refundError.message);
        }
        
        // Mark for cleanup
        expiredChallengeIds.push(challengeId);
      }
    }
    
    // Remove expired challenges
    for (const challengeId of expiredChallengeIds) {
      delete challenges[challengeId];
      changed = true;
    }
  }
  
  if (changed) {
    saveRpsGamesData();
    console.log(`[RPS CLEANUP] Processed expired challenges and refunds`);
  }
}

// Send notifications for expired RPS challenges
async function sendExpiredChallengeNotifications(guildId, challengeId, challenge) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`[RPS CLEANUP] Guild not found: ${guildId}`);
      return;
    }

    // Get the original channel where the challenge was created
    const originalChannel = guild.channels.cache.get(challenge.channelId);
    if (!originalChannel) {
      console.error(`[RPS CLEANUP] Original channel not found: ${challenge.channelId}`);
      return;
    }

    // Create refund notification embed
    const refundEmbed = new EmbedBuilder()
      .setTitle('🕐 RPS Challenge Expired - Refund Issued')
      .setDescription(`The RPS challenge has expired due to inactivity and the challenger has been refunded.`)
      .addFields([
        { name: 'Challenge ID', value: challengeId, inline: true },
        { name: 'Challenger', value: `<@${challenge.challengerId}>`, inline: true },
        { name: 'Challenged User', value: challenge.challengedTag, inline: true },
        { name: 'Amount Refunded', value: `${challenge.humanAmount} ${challenge.token}`, inline: true },
        { name: 'Reason', value: 'Challenge expired after 30 minutes of inactivity', inline: false }
      ])
      .setColor(0xffa500) // Orange color for timeout
      .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
      .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
      .setTimestamp();

    // Send channel announcement
    try {
      const botMember = guild.members.cache.get(client.user.id);
      const hasChannelPermissions = botMember?.permissionsIn(originalChannel).has([
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks
      ]);

      if (hasChannelPermissions) {
        await originalChannel.send({ 
          content: `🕐 **RPS Challenge Timeout** 🕐`,
          embeds: [refundEmbed]
        });
        console.log(`[RPS CLEANUP] Sent channel notification for expired challenge ${challengeId}`);
      } else {
        console.warn(`[RPS CLEANUP] Bot lacks permissions to send messages in channel ${originalChannel.id}`);
      }
    } catch (channelError) {
      console.error(`[RPS CLEANUP] Failed to send channel notification:`, channelError.message);
    }

    // Send DM to challenger
    try {
      const challenger = await client.users.fetch(challenge.challengerId);
      if (challenger) {
        const dmEmbed = new EmbedBuilder()
          .setTitle('💰 RPS Challenge Refund')
          .setDescription(`Your RPS challenge has been refunded due to inactivity.`)
          .addFields([
            { name: 'Challenge ID', value: challengeId, inline: true },
            { name: 'Challenged User', value: challenge.challengedTag, inline: true },
            { name: 'Amount Refunded', value: `${challenge.humanAmount} ${challenge.token}`, inline: true },
            { name: 'Reason', value: 'Challenge expired after 30 minutes of inactivity', inline: false },
            { name: 'Refund Status', value: '✅ Successfully refunded to your virtual account', inline: false }
          ])
          .setColor(0x4d55dc)
          .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();

        await challenger.send({ embeds: [dmEmbed] });
        console.log(`[RPS CLEANUP] Sent DM to challenger for expired challenge ${challengeId}`);
      }
    } catch (dmError) {
      console.error(`[RPS CLEANUP] Failed to send DM to challenger:`, dmError.message);
    }

  } catch (error) {
    console.error(`[RPS CLEANUP] Error sending notifications for challenge ${challengeId}:`, error.message);
  }
}

// Clean up expired tx hashes (older than 24h)
function cleanupExpiredTxHashes() {
  const now = Date.now();
  const expireMs = 24 * 60 * 60 * 1000; // 24 hours
  for (const guildId in usedTxHashesData) {
    const hashes = usedTxHashesData[guildId];
    if (hashes) {
      for (const txHash in hashes) {
        if (now - hashes[txHash].usedAt > expireMs) {
          delete hashes[txHash];
        }
      }
    }
  }
  saveUsedTxHashesData();
}

// Clean up FINISHED football matches (once a day)
function cleanupFinishedMatches() {
  try {
    let removedCount = 0;
    
    for (const [matchId, match] of Object.entries(footballMatchesData)) {
      if (match.status === 'FINISHED') {
        delete footballMatchesData[matchId];
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      saveFootballMatchesData();
      console.log(`[FOOTBALL CLEANUP] Removed ${removedCount} FINISHED matches from matches.json`);
    }
  } catch (error) {
    console.error('[FOOTBALL CLEANUP] Error cleaning up finished matches:', error.message);
  }
}

// Verify transaction details from MultiversX explorer API
async function verifyTransaction(txHash, expectedRecipient, expectedAmount, expectedToken, expectedSender) {
  try {
    console.log('[RPS VERIFY] txHash:', txHash);
    console.log('[RPS VERIFY] expectedRecipient:', expectedRecipient);
    console.log('[RPS VERIFY] expectedAmount:', expectedAmount);
    console.log('[RPS VERIFY] expectedToken:', expectedToken);
    console.log('[RPS VERIFY] expectedSender:', expectedSender);
    // Fetch from MultiversX explorer
    const response = await fetch(`https://api.multiversx.com/transactions/${txHash}`);
    if (!response.ok) throw new Error('Transaction not found');
    const tx = await response.json();
    if (tx.status !== 'success') throw new Error('Transaction not confirmed');
    if (!tx.operations || !Array.isArray(tx.operations) || tx.operations.length === 0) throw new Error('No ESDT transfer found');
    console.log('[RPS VERIFY] operations:', JSON.stringify(tx.operations, null, 2));
    // Find ESDT transfer operation
    const op = tx.operations.find(op => {
      const typeMatch = op.type === 'esdt';
      const tokenMatch = !expectedToken || op.identifier === expectedToken;
      const recipientMatch = !expectedRecipient || op.receiver === expectedRecipient;
      const senderMatch = !expectedSender || op.sender === expectedSender;
      const amountMatch = !expectedAmount || op.value === expectedAmount;
      console.log(`[RPS VERIFY] op: type=${op.type}, identifier=${op.identifier}, sender=${op.sender}, receiver=${op.receiver}, value=${op.value}`);
      console.log(`[RPS VERIFY]   typeMatch=${typeMatch}, tokenMatch=${tokenMatch}, recipientMatch=${recipientMatch}, senderMatch=${senderMatch}, amountMatch=${amountMatch}`);
      return typeMatch && tokenMatch && recipientMatch && senderMatch && amountMatch;
    });
    if (!op) throw new Error('Matching ESDT transfer not found');
    // Check amount if required
    if (expectedAmount && op.value !== expectedAmount) throw new Error('Amount mismatch');
    return {
      success: true,
      amount: op.value,
      token: op.identifier,
      recipient: op.receiver,
      sender: op.sender,
      decimals: op.decimals
    };
  } catch (error) {
    console.error('[RPS VERIFY] Error:', error.message);
    return { success: false, errorMessage: error.message };
  }
}

// Load data on startup
console.log('📂 Loading server data...');
loadServerData();
console.log('🎮 Loading RPS games data...');
loadRpsGamesData();
console.log('🔗 Loading used transaction hashes...');
loadUsedTxHashesData();
console.log('⚽ Loading football games data...');
loadFootballData();
console.log('💰 Loading virtual accounts data...');
virtualAccounts.loadVirtualAccountsData();

// Helper functions
function isValidPemFormat(pemContent) {
  if (!pemContent || typeof pemContent !== 'string') return false;

  // Remove leading/trailing whitespace and normalize all whitespace to single spaces
  const pem = pemContent.trim().replace(/[\r\n]+/g, ' ').replace(/ +/g, ' ');

  // Match the PEM structure, allowing for single-line or multiline, with or without spaces
  const pemRegex = /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END (?:EC |RSA )?PRIVATE KEY-----/;
  const match = pem.match(pemRegex);
  if (!match) return false;

  // Validate base64 content (remove all whitespace for the check)
  const base64 = match[1].replace(/\s+/g, '');
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(base64);
}

// Debug function to check if a specific user is in the autocomplete list
function debugUserInAutocomplete(userId, guildId, commandName) {
  const userWallets = getUserWallets(guildId);
  const userWalletEntries = Object.entries(userWallets);
  
  console.log(`[DEBUG] Checking user ${userId} in ${commandName} autocomplete for guild ${guildId}`);
  console.log(`[DEBUG] Total registered users: ${userWalletEntries.length}`);
  
  const userIndex = userWalletEntries.findIndex(([id, wallet]) => id === userId);
  if (userIndex !== -1) {
    console.log(`[DEBUG] User ${userId} found at index ${userIndex} (within first 100 users: ${userIndex < 100})`);
    console.log(`[DEBUG] User wallet: ${userWalletEntries[userIndex][1]}`);
  } else {
    console.log(`[DEBUG] User ${userId} NOT found in registered wallets`);
  }
  
  return userIndex !== -1 && userIndex < 100;
}

// Get user wallet address for a specific server
async function getUserWallet(userId, guildId) {
  try {
    const userWallets = getUserWallets(guildId);
    if (userWallets[userId]) {
      return userWallets[userId];
    }
    throw new Error('Wallet address not registered. Use /set-wallet to register.');
  } catch (error) {
    console.error(`Error fetching wallet for user ${userId} in guild ${guildId}:`, error.message);
    throw error;
  }
}

// Get Discord user by wallet address for a specific server
async function getUserByWallet(walletAddress, guildId) {
  try {
    if (!walletAddress) {
      return { userId: null, user: null };
    }
    
    const normalizedWallet = walletAddress.toLowerCase();
    const userWallets = getUserWallets(guildId);
    
    for (const [userId, userWallet] of Object.entries(userWallets)) {
      if (userWallet.toLowerCase() === normalizedWallet) {
        try {
          const user = await client.users.fetch(userId);
          return { userId, user };
        } catch (fetchError) {
          console.error(`Found userId ${userId} for wallet ${walletAddress} but could not fetch user:`, fetchError.message);
          return { userId, user: null };
        }
      }
    }
    
    return { userId: null, user: null };
  } catch (error) {
    console.error(`Error looking up user by wallet ${walletAddress} in guild ${guildId}:`, error.message);
    return { userId: null, user: null };
  }
}

// Transfer ESDT tokens using project wallet
async function transferESDT(recipientWallet, tokenTicker, amount, projectName, guildId) {
  try {
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    const projects = getProjects(guildId);
    const project = projects[projectName];
    
    if (!project) {
      throw new Error(`Project "${projectName}" not found. Use /register-project to add it.`);
    }

    if (!project.walletPem) {
      throw new Error(`Project "${projectName}" has no wallet configured.`);
    }

    if (!project.supportedTokens || !project.supportedTokens.includes(tokenTicker)) {
      const supportedTokens = project.supportedTokens || [];
      throw new Error(`Token "${tokenTicker}" is not supported by project "${projectName}". Supported tokens: ${supportedTokens.join(', ') || 'None configured'}`);
    }
    
    // Restore PEM line breaks if needed
    let pemToSend = project.walletPem;
    if (!pemToSend.includes('\n')) {
      // Replace the spaces between the header/footer and base64 with line breaks
      pemToSend = pemToSend
        .replace(/-----BEGIN ([A-Z ]+)-----\s*/, '-----BEGIN $1-----\n')
        .replace(/\s*-----END ([A-Z ]+)-----/, '\n-----END $1-----')
        .replace(/ ([A-Za-z0-9+/=]{64})/g, '\n$1') // Break base64 into lines of 64 chars
        .replace(/ ([A-Za-z0-9+/=]+)-----END/, '\n$1-----END'); // Final line before footer
    }

    const requestBody = {
      recipient: recipientWallet,
      amount: amount,
      tokenTicker: tokenTicker,
      walletPem: pemToSend,
    };
    
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/esdtTransfer` 
      : `${API_BASE_URL}/execute/esdtTransfer`;
    
    console.log(`Transferring ${amount} ${tokenTicker} tokens to: ${recipientWallet} using project: ${projectName}`);
    console.log(`API endpoint: ${fullEndpoint}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    try {
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      console.log(`API response status: ${response.status}`);
      console.log(`API response for transfer: ${responseText}`);
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Error parsing API response:', parseError.message);
        parsedResponse = { success: response.ok, message: responseText };
      }
      
      let txHash = null;
      let txStatus = null;
      
      if (parsedResponse.txHash) {
        txHash = parsedResponse.txHash;
      } else if (parsedResponse.result && parsedResponse.result.txHash) {
        txHash = parsedResponse.result.txHash;
      } else if (parsedResponse.data && parsedResponse.data.txHash) {
        txHash = parsedResponse.data.txHash;
      } else if (parsedResponse.transaction && parsedResponse.transaction.txHash) {
        txHash = parsedResponse.transaction.txHash;
      }
      
      // Check for transaction status in the response
      if (parsedResponse.result && parsedResponse.result.status) {
        txStatus = parsedResponse.result.status;
      } else if (parsedResponse.status) {
        txStatus = parsedResponse.status;
      }
      
      const errorMessage = parsedResponse.error || 
                          (parsedResponse.result && parsedResponse.result.error) ||
                          (parsedResponse.data && parsedResponse.data.error) ||
                          (!response.ok ? `API error (${response.status})` : null);
      
      // Only treat as success if status is 'success', HTTP is OK, and txHash exists
      const isApiSuccess = (response.ok || parsedResponse.success === true) && txStatus === 'success' && !!txHash;
      
      const result = {
        success: isApiSuccess,
        txHash: txHash,
        errorMessage: errorMessage || (txStatus && txStatus !== 'success' ? `Transaction status: ${txStatus}` : null),
        rawResponse: parsedResponse,
        httpStatus: response.status
      };
      
      if (result.success) {
        console.log(`Successfully sent ${amount} ${tokenTicker} to: ${recipientWallet} using project: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`API reported failure for ${tokenTicker} transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`Transaction hash was returned (${txHash}), but transaction failed (status: ${txStatus}).`);
        }
      }
      
      return result;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('Transfer API request timed out after 60 seconds');
        throw new Error('API request timed out after 60 seconds');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`Error transferring ESDT:`, error.message);
    throw error;
  }
}

// Transfer ESDT from Community Fund (without supported tokens restriction)
async function transferESDTFromCommunityFund(recipientWallet, tokenTicker, amount, projectName, guildId) {
  try {
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    const projects = getProjects(guildId);
    const project = projects[projectName];
    
    if (!project) {
      throw new Error(`Project "${projectName}" not found. Use /register-project to add it.`);
    }

    if (!project.walletPem) {
      throw new Error(`Project "${projectName}" has no wallet configured.`);
    }
    
    // Restore PEM line breaks if needed
    let pemToSend = project.walletPem;
    if (!pemToSend.includes('\n')) {
      // Replace the spaces between the header/footer and base64 with line breaks
      pemToSend = pemToSend
        .replace(/-----BEGIN ([A-Z ]+)-----\s*/, '-----BEGIN $1-----\n')
        .replace(/\s*-----END ([A-Z ]+)-----/, '\n-----END $1-----')
        .replace(/ ([A-Za-z0-9+/=]{64})/g, '\n$1') // Break base64 into lines of 64 chars
        .replace(/ ([A-Za-z0-9+/=]+)-----END/, '\n$1-----END'); // Final line before footer
    }

    const requestBody = {
      recipient: recipientWallet,
      amount: amount,
      tokenTicker: tokenTicker,
      walletPem: pemToSend,
    };
    
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/esdtTransfer` 
      : `${API_BASE_URL}/execute/esdtTransfer`;
    
    console.log(`[WITHDRAW] Transferring ${amount} ${tokenTicker} tokens to: ${recipientWallet} using Community Fund: ${projectName}`);
    console.log(`[WITHDRAW] API endpoint: ${fullEndpoint}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    try {
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      console.log(`[WITHDRAW] API response status: ${response.status}`);
      console.log(`[WITHDRAW] API response for transfer: ${responseText}`);
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[WITHDRAW] Error parsing API response:', parseError.message);
        parsedResponse = { success: response.ok, message: responseText };
      }
      
      let txHash = null;
      let txStatus = null;
      
      if (parsedResponse.txHash) {
        txHash = parsedResponse.txHash;
      } else if (parsedResponse.result && parsedResponse.result.txHash) {
        txHash = parsedResponse.result.txHash;
      } else if (parsedResponse.data && parsedResponse.data.txHash) {
        txHash = parsedResponse.data.txHash;
      } else if (parsedResponse.transaction && parsedResponse.transaction.txHash) {
        txHash = parsedResponse.transaction.txHash;
      }
      
      // Check for transaction status in the response
      if (parsedResponse.result && parsedResponse.result.status) {
        txStatus = parsedResponse.result.status;
      } else if (parsedResponse.status) {
        txStatus = parsedResponse.status;
      }
      
      const errorMessage = parsedResponse.error || 
                          (parsedResponse.result && parsedResponse.result.error) ||
                          (parsedResponse.data && parsedResponse.data.error) ||
                          (!response.ok ? `API error (${response.status})` : null);
      
      // Only treat as success if status is 'success', HTTP is OK, and txHash exists
      const isApiSuccess = (response.ok || parsedResponse.success === true) && txStatus === 'success' && !!txHash;
      
      const result = {
        success: isApiSuccess,
        txHash: txHash,
        errorMessage: errorMessage || (txStatus && txStatus !== 'success' ? `Transaction status: ${txStatus}` : null),
        rawResponse: parsedResponse,
        httpStatus: response.status
      };
      
      if (result.success) {
        console.log(`[WITHDRAW] Successfully sent ${amount} ${tokenTicker} to: ${recipientWallet} using Community Fund: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`[WITHDRAW] API reported failure for ${tokenTicker} transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`[WITHDRAW] Transaction hash was returned (${txHash}), but transaction failed (status: ${txStatus}).`);
        }
      }
      
      return result;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('[WITHDRAW] Transfer API request timed out after 60 seconds');
        throw new Error('API request timed out after 60 seconds');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`[WITHDRAW] Error transferring ESDT:`, error.message);
    throw error;
  }
}

// Handle bot interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const guildId = interaction.guildId;

  if (commandName === 'set-wallet') {
    try {
      const wallet = interaction.options.getString('wallet');
      if (!wallet.startsWith('erd1') || wallet.length !== 62) {
        await interaction.reply({ content: 'Invalid wallet address. Must be a valid MultiversX address (erd1..., 62 characters).', flags: [MessageFlags.Ephemeral] });
        return;
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const userWallets = getUserWallets(guildId);
      
      // Create backup
      const backupFileName = `user-wallets-backup-${guildId}-${Date.now()}.json`;
      if (fs.existsSync('user-wallets.json')) {
        fs.copyFileSync('user-wallets.json', backupFileName);
        console.log(`Created backup of user wallets: ${backupFileName}`);
      }
      
      const previousWallets = JSON.parse(JSON.stringify(userWallets));
      
      userWallets[interaction.user.id] = wallet;
      
      try {
        saveServerData();
        console.log(`Wallet for user ${interaction.user.tag} (${interaction.user.id}) in guild ${guildId} set to: ${wallet}`);
      } catch (writeError) {
        userWallets = previousWallets;
        console.error(`Failed to save user wallets for guild ${guildId}:`, writeError.message);
        throw new Error(`Failed to save wallet address: ${writeError.message}`);
      }

      await interaction.editReply({ content: 'Wallet address registered successfully.' });
    } catch (error) {
      console.error(`Error setting wallet for ${interaction.user.tag} in guild ${guildId}:`, error.message);
      
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error registering wallet: ${error.message}` });
      } else {
        await interaction.reply({ content: `Error registering wallet: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'register-project') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can register projects.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const walletAddress = interaction.options.getString('wallet-address');
      const walletPem = interaction.options.getString('wallet-pem');
      const supportedTokensStr = interaction.options.getString('supported-tokens');
      const qrCodeUrl = interaction.options.getString('qr-code-url');
      const userInput = interaction.options.getString('user-input') || '';

      // Validate wallet address format
      if (!walletAddress.startsWith('erd1') || walletAddress.length !== 62) {
        await interaction.editReply({ content: 'Invalid wallet address format. Please provide a valid MultiversX wallet address (erd1...).', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const pemValid = isValidPemFormat(walletPem);
      if (!pemValid) {
        await interaction.editReply({ content: 'Invalid PEM format. Please provide a valid MultiversX wallet PEM file content.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Validate and parse supported tokens
      if (!supportedTokensStr || supportedTokensStr.trim() === '') {
        await interaction.editReply({ content: 'Supported tokens are required. Please provide a comma-separated list of token tickers.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const supportedTokens = supportedTokensStr.split(',').map(token => token.trim()).filter(token => token.length > 0);
      if (supportedTokens.length === 0) {
        await interaction.editReply({ content: 'No valid tokens provided. Please provide at least one token ticker.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projects = getProjects(guildId);
      
      // Check if project already exists
      if (projects[projectName]) {
        await interaction.editReply({ 
          content: `⚠️ **Warning:** Project "${projectName}" already exists!\n\nThis will **overwrite** the existing project with new credentials.\n\nIf you want to update specific fields instead, use \`/update-project\`.\n\nTo proceed with overwriting, run this command again.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      projects[projectName] = {
        walletAddress: walletAddress,
        walletPem: walletPem,
        supportedTokens: supportedTokens,
        qrCodeUrl: qrCodeUrl,
        userInput: userInput,
        registeredBy: interaction.user.id,
        registeredAt: Date.now()
      };

      saveServerData();

      const embed = new EmbedBuilder()
        .setTitle('Project Registered Successfully')
        .setDescription(`Project **${projectName}** has been registered for this server.`)
        .addFields([
          { name: 'Wallet Address', value: `\`${walletAddress}\``, inline: false },
          { name: 'Supported Tokens', value: supportedTokens.join(', '), inline: false },
          { name: 'Registered By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Status', value: '✅ Active', inline: true }
        ])
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      // Add user input field if provided
      if (userInput) {
        embed.addFields({ name: 'Notes', value: userInput, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
      
      // Fetch and store token metadata for all supported tokens with rate limiting
      console.log(`[TOKEN] Fetching metadata for ${supportedTokens.length} tokens: ${supportedTokens.join(', ')}`);
      let metadataSuccessCount = 0;
      let metadataFailCount = 0;
      
      for (let i = 0; i < supportedTokens.length; i++) {
        const tokenTicker = supportedTokens[i];
        try {
          // Rate limiting: wait 500ms between requests (2 requests/second max)
          if (i > 0) {
            console.log(`[TOKEN] Rate limiting: waiting 500ms before next request...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Get token identifier from ticker
          const tokenIdentifier = await getTokenIdentifier(tokenTicker);
          if (tokenIdentifier) {
            const success = await updateTokenMetadata(guildId, tokenIdentifier);
            if (success) {
              metadataSuccessCount++;
              console.log(`[TOKEN] ✅ Successfully stored metadata for ${tokenIdentifier}`);
            } else {
              metadataFailCount++;
              console.log(`[TOKEN] ❌ Failed to store metadata for ${tokenIdentifier}`);
            }
          } else {
            metadataFailCount++;
            console.log(`[TOKEN] ❌ Could not find identifier for ticker ${tokenTicker}`);
          }
        } catch (error) {
          metadataFailCount++;
          console.error(`[TOKEN] Error fetching metadata for ${tokenTicker}:`, error.message);
        }
      }
      
      console.log(`[TOKEN] Metadata fetch complete: ${metadataSuccessCount} success, ${metadataFailCount} failed`);
      console.log(`Project "${projectName}" registered for guild ${guildId} by ${interaction.user.tag}`);
    } catch (error) {
      console.error('Error registering project:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error registering project: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error registering project: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'update-project') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can update projects.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const newProjectName = interaction.options.getString('new-project-name');
      const walletAddress = interaction.options.getString('wallet-address');
      const walletPem = interaction.options.getString('wallet-pem');
      const supportedTokensStr = interaction.options.getString('supported-tokens');
      const qrCodeUrl = interaction.options.getString('qr-code-url');
      const userInput = interaction.options.getString('user-input');

      const projects = getProjects(guildId);
      
      if (!projects[projectName]) {
        await interaction.editReply({ content: `Project "${projectName}" not found. Use /register-project to create it first.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if new project name already exists (if renaming)
      if (newProjectName && newProjectName !== projectName && projects[newProjectName]) {
        await interaction.editReply({ content: `Project "${newProjectName}" already exists. Choose a different name.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      const currentProject = projects[projectName];
      let hasChanges = false;
      const changes = [];

      // Update project name if provided
      if (newProjectName && newProjectName !== projectName) {
        projects[newProjectName] = {
          ...currentProject,
          registeredAt: Date.now()
        };
        delete projects[projectName];
        changes.push(`Project name: "${projectName}" → "${newProjectName}"`);
        hasChanges = true;
      }

      // Update wallet address if provided
      if (walletAddress) {
        if (!walletAddress.startsWith('erd1') || walletAddress.length !== 62) {
          await interaction.editReply({ content: 'Invalid wallet address format. Please provide a valid MultiversX wallet address (erd1...).', flags: [MessageFlags.Ephemeral] });
          return;
        }
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.walletAddress = walletAddress;
        changes.push(`Wallet address updated to: ${walletAddress}`);
        hasChanges = true;
      }

      // Update wallet PEM if provided
      if (walletPem) {
        const pemValid = isValidPemFormat(walletPem);
        if (!pemValid) {
          await interaction.editReply({ content: 'Invalid PEM format. Please provide a valid MultiversX wallet PEM file content.', flags: [MessageFlags.Ephemeral] });
          return;
        }
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.walletPem = walletPem;
        changes.push('Wallet PEM updated');
        hasChanges = true;
      }

      // Update supported tokens if provided
      if (supportedTokensStr !== null) {
        if (supportedTokensStr.trim() === '') {
          await interaction.editReply({ content: 'Supported tokens cannot be empty. Please provide a comma-separated list of token tickers.', flags: [MessageFlags.Ephemeral] });
          return;
        }
        
        const supportedTokens = supportedTokensStr.split(',').map(token => token.trim()).filter(token => token.length > 0);
        if (supportedTokens.length === 0) {
          await interaction.editReply({ content: 'No valid tokens provided. Please provide at least one token ticker.', flags: [MessageFlags.Ephemeral] });
          return;
        }
        
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.supportedTokens = supportedTokens;
        changes.push(`Supported tokens updated to: ${supportedTokens.join(', ')}`);
        hasChanges = true;
      }



      // Update QR code URL if provided
      if (qrCodeUrl !== null) {
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.qrCodeUrl = qrCodeUrl;
        changes.push(`QR code URL updated: ${qrCodeUrl || 'Removed'}`);
        hasChanges = true;
      }

      // Update user input if provided
      if (userInput !== null) {
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.userInput = userInput;
        changes.push(`Notes updated: ${userInput}`);
        hasChanges = true;
      }

      if (!hasChanges) {
        await interaction.editReply({ content: 'No changes provided. Please specify at least one field to update.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      saveServerData();

      const finalProjectName = newProjectName || projectName;
      const embed = new EmbedBuilder()
        .setTitle('Project Updated Successfully')
        .setDescription(`Project **${finalProjectName}** has been updated.`)
        .addFields([
          { name: 'Changes Made', value: changes.join('\n'), inline: false },
          { name: 'Updated By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Status', value: '✅ Active', inline: true }
        ])
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      await interaction.editReply({ embeds: [embed] });
      
      // Fetch and store token metadata for updated supported tokens with rate limiting
      const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
      if (targetProject.supportedTokens && targetProject.supportedTokens.length > 0) {
        console.log(`[TOKEN] Fetching metadata for ${targetProject.supportedTokens.length} tokens: ${targetProject.supportedTokens.join(', ')}`);
        let metadataSuccessCount = 0;
        let metadataFailCount = 0;
        
        for (let i = 0; i < targetProject.supportedTokens.length; i++) {
          const tokenTicker = targetProject.supportedTokens[i];
          try {
            // Rate limiting: wait 500ms between requests (2 requests/second max)
            if (i > 0) {
              console.log(`[TOKEN] Rate limiting: waiting 500ms before next request...`);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Get token identifier from ticker
            const tokenIdentifier = await getTokenIdentifier(tokenTicker);
            if (tokenIdentifier) {
              const success = await updateTokenMetadata(guildId, tokenIdentifier);
              if (success) {
                metadataSuccessCount++;
                console.log(`[TOKEN] ✅ Successfully stored metadata for ${tokenIdentifier}`);
              } else {
                metadataFailCount++;
                console.log(`[TOKEN] ❌ Failed to store metadata for ${tokenIdentifier}`);
              }
            } else {
              metadataFailCount++;
              console.log(`[TOKEN] ❌ Could not find identifier for ticker ${tokenTicker}`);
            }
          } catch (error) {
            metadataFailCount++;
            console.error(`[TOKEN] Error fetching metadata for ${tokenTicker}:`, error.message);
          }
        }
        
        console.log(`[TOKEN] Metadata fetch complete: ${metadataSuccessCount} success, ${metadataFailCount} failed`);
      }
      
      console.log(`Project "${finalProjectName}" updated for guild ${guildId} by ${interaction.user.tag}`);
    } catch (error) {
      console.error('Error updating project:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error updating project: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error updating project: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'send-esdt') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can send ESDT tokens.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const userTag = interaction.options.getString('user-tag');
      const tokenTicker = interaction.options.getString('token-ticker');
      const amount = interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || 'No memo provided';

      if (amount <= 0) {
        await interaction.editReply({ content: 'Amount must be greater than 0.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Get available projects for this server
      const projects = getProjects(guildId);
      const communityFundProject = serverData[guildId]?.communityFundProject;
      
      if (!projects[projectName]) {
        await interaction.editReply({ 
          content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Prevent using community fund project for /send-esdt
      if (projectName === communityFundProject) {
        await interaction.editReply({ 
          content: `❌ **Cannot use Community Fund project for /send-esdt!**\n\nThe project "${projectName}" is configured as the Community Fund and is used for virtual account deposits.\n\nPlease select a different project for admin transfers.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Check if the selected project supports the requested token
      const projectSupportedTokens = projects[projectName].supportedTokens || [];
      if (!projectSupportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ 
          content: `Project "${projectName}" does not support token "${tokenTicker}".\n\nSupported tokens for this project: ${projectSupportedTokens.join(', ') || 'None configured'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      let targetUserId = null;
      let targetUser = null;
      let recipientWallet = null;

      try {
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        
        const targetMember = members.find(member => 
          member.user.tag === userTag || 
          member.user.username === userTag ||
          (member.nickname && member.nickname === userTag)
        );

        if (targetMember) {
          targetUserId = targetMember.user.id;
          targetUser = targetMember.user;
          recipientWallet = getUserWallets(guildId)[targetUserId];
        }
      } catch (fetchError) {
        console.error('Error fetching guild members:', fetchError.message);
      }

      if (!recipientWallet) {
        await interaction.editReply({ 
          content: `User ${userTag} not found or has no registered wallet. Ask them to register with /set-wallet.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      if (!recipientWallet.startsWith('erd1') || recipientWallet.length !== 62) {
        await interaction.editReply({ 
          content: `User ${userTag} has an invalid wallet address: ${recipientWallet}. Ask them to update it with /set-wallet.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      await interaction.editReply({ 
        content: `Preparing to send ${amount} ${tokenTicker} to ${userTag} using project ${projectName}...\nMemo: ${memo}`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
      console.log(`Admin ${interaction.user.tag} (${interaction.user.id}) is sending ${amount} ${tokenTicker} to ${userTag} (${recipientWallet}) using project ${projectName}`);
      console.log(`Transfer memo: ${memo}`);
      
      const transferResult = await transferESDT(recipientWallet, tokenTicker, amount, projectName, guildId);
      
      if (transferResult.success) {
        const explorerUrl = transferResult.txHash
          ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
          : null;
        const txHashFieldValue = transferResult.txHash
          ? `[${transferResult.txHash}](${explorerUrl})`
          : 'Not available';

        const successEmbed = new EmbedBuilder()
          .setTitle('ESDT Transfer Successful')
          .setDescription(`Successfully sent **${amount} ${tokenTicker}** to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: 'Project Used', value: projectName, inline: true },
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Initiated By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '✅ Success', inline: true }
          ])
          .setColor(0x4d55dc)
          .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();
        
        await interaction.editReply({ 
          content: `Transfer completed successfully! Posting public announcement...`, 
          flags: [MessageFlags.Ephemeral] 
        });
        
        // Check if bot has permission to send messages in this channel
        const channel = interaction.channel;
        const botMember = interaction.guild?.members.cache.get(client.user.id);
        const hasSendMessages = botMember?.permissionsIn(channel).has(PermissionsBitField.Flags.SendMessages);
        const hasEmbedLinks = botMember?.permissionsIn(channel).has(PermissionsBitField.Flags.EmbedLinks);
        
        if (hasSendMessages && hasEmbedLinks) {
          try {
            await channel.send({ 
              content: `🪙 **Token Transfer Notification** 🪙`,
              embeds: [successEmbed]
            });
          } catch (channelError) {
            console.error('Error sending channel notification:', channelError.message);
            await interaction.followUp({ 
              content: `⚠️ Transfer completed but failed to post public notification: ${channelError.message}`, 
              flags: [MessageFlags.Ephemeral] 
            });
          }
        } else {
          console.warn('Bot lacks permissions to send messages or embed links in channel:', channel.id);
          await interaction.followUp({ 
            content: `⚠️ Transfer completed but bot lacks permissions to post public notification in this channel. Required: Send Messages + Embed Links`, 
            flags: [MessageFlags.Ephemeral] 
          });
        }
        
        try {
          if (interaction.guild) {
            const logChannel = interaction.guild.channels.cache.find((channel) => channel.name === 'transfer-logs');
            if (logChannel) {
              const botMember = interaction.guild.members.cache.get(client.user.id);
              const hasLogPermissions = botMember?.permissionsIn(logChannel).has([
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks
              ]);
              
              if (hasLogPermissions) {
                await logChannel.send({ embeds: [successEmbed] });
              } else {
                console.warn('Bot lacks permissions to post in log channel:', logChannel.id);
              }
            }
          }
        } catch (logError) {
          console.error('Error posting to log channel:', logError.message);
        }
        
        try {
          if (targetUser) {
            const dmEmbed = new EmbedBuilder()
              .setTitle('You Received ESDT Tokens!')
              .setDescription(`You have received **${amount} ${tokenTicker}** from an administrator.`)
              .addFields([
                { name: 'Project Used', value: projectName, inline: true },
                { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
                { name: 'Memo', value: memo, inline: false },
                { name: 'Sender', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Status', value: '✅ Success', inline: true }
              ])
              .setColor(0x4d55dc)
              .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
              .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
              .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
            console.log(`Sent DM notification to ${userTag} about received tokens`);
          }
        } catch (dmError) {
          console.error(`Could not send DM to ${userTag}:`, dmError.message);
        }
      } else {
        const errorEmbed = new EmbedBuilder()
          .setTitle('ESDT Transfer Failed')
          .setDescription(`Failed to send **${amount} ${tokenTicker}** to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: 'Project Used', value: projectName, inline: true },
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: transferResult.txHash ? `\`${transferResult.txHash}\`` : 'Not available', inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Initiated By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '❌ Failed', inline: true }
          ])
          .setColor('#FF0000')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
          
        await interaction.editReply({ 
          content: `Transfer failed: ${transferResult.errorMessage || 'Unknown error'}`, 
          embeds: [errorEmbed],
          flags: [MessageFlags.Ephemeral] 
        });
        
        try {
          if (interaction.guild) {
            const logChannel = interaction.guild.channels.cache.find((channel) => channel.name === 'transfer-logs');
            if (logChannel) {
              await logChannel.send({ embeds: [errorEmbed] });
            }
          }
        } catch (logError) {
          console.error('Error posting to log channel:', logError.message);
        }
      }
    } catch (error) {
      console.error('Error sending ESDT tokens:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error sending ESDT tokens: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error sending ESDT tokens: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'set-community-fund') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can set the Community Tip Fund.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      const projectName = interaction.options.getString('project-name');
      const qrCodeUrl = interaction.options.getString('qr-code-url');
      const confirm = interaction.options.getString('confirm');
      const projects = getProjects(guildId);
      if (!projects[projectName]) {
        await interaction.editReply({ content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      const currentFund = serverData[guildId]?.communityFundProject;
      if (currentFund && currentFund !== projectName && confirm !== 'CONFIRM') {
        await interaction.editReply({ content: `⚠️ Warning: This will replace the current Community Tip Fund (**${currentFund}**) with **${projectName}**.\n\nIf you are sure, run the command again and type CONFIRM in the confirm field.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Initialize communityFundQR if it doesn't exist
      if (!serverData[guildId].communityFundQR) {
        serverData[guildId].communityFundQR = {};
      }
      
      // Set the community fund project
      serverData[guildId].communityFundProject = projectName;
      
      // Store the QR code URL if provided
      if (qrCodeUrl) {
        serverData[guildId].communityFundQR[projectName] = qrCodeUrl;
        // Also store it in the project itself for consistency
        projects[projectName].qrCodeUrl = qrCodeUrl;
        console.log(`QR code URL stored for project ${projectName}: ${qrCodeUrl}`);
      }
      
      saveServerData();
      
      let replyMessage = `Community Tip Fund set to project: **${projectName}**. All /tip transactions will use this wallet.`;
      if (qrCodeUrl) {
        replyMessage += `\n\n✅ QR code URL has been saved and will be used as thumbnail in game embeds.`;
      }
      
      await interaction.editReply({ content: replyMessage, flags: [MessageFlags.Ephemeral] });
      console.log(`Community Tip Fund set to ${projectName} for guild ${guildId}${qrCodeUrl ? ` with QR code URL` : ''}`);
    } catch (error) {
      console.error('Error setting Community Tip Fund:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }


  } else if (commandName === 'list-wallets') {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ 
          content: 'Only administrators can list registered wallets.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const filter = interaction.options.getString('filter')?.toLowerCase() || '';
      const page = interaction.options.getInteger('page') || 1;
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const entriesPerPage = 20;
      const startIndex = (page - 1) * entriesPerPage;
      
      console.log(`Admin ${interaction.user.tag} is listing wallets with filter: '${filter}', page: ${page}, public: ${isPublic}`);
      
      try {
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        const userWallets = getUserWallets(guildId);
        
        const walletEntries = [];
        
        for (const [userId, wallet] of Object.entries(userWallets)) {
          try {
            const member = members.get(userId);
            const userTag = member ? member.user.tag : 'Unknown User';
            
            if (!filter || userTag.toLowerCase().includes(filter)) {
              walletEntries.push({
                userId,
                userTag,
                wallet
              });
            }
          } catch (error) {
            console.error(`Error processing user ${userId}:`, error.message);
            if (!filter || 'Unknown User'.toLowerCase().includes(filter)) {
              walletEntries.push({
                userId,
                userTag: 'Unknown User',
                wallet
              });
            }
          }
        }
        
        walletEntries.sort((a, b) => a.userTag.localeCompare(b.userTag));
        
        const totalEntries = walletEntries.length;
        const totalPages = Math.ceil(totalEntries / entriesPerPage);
        const currentPageEntries = walletEntries.slice(startIndex, startIndex + entriesPerPage);
        
        const embed = new EmbedBuilder()
          .setTitle('Registered Wallet Addresses')
          .setDescription(`${totalEntries} registered wallet${totalEntries !== 1 ? 's' : ''}${filter ? ` matching filter '${filter}'` : ''}`)
          .setColor('#0099FF')
          .setFooter({ 
            text: `Page ${page}/${totalPages || 1} • ${entriesPerPage} entries per page • Requested by ${interaction.user.tag}`
          })
          .setTimestamp();
        
        if (totalPages > 1) {
          embed.addFields({ 
            name: 'Pagination', 
            value: `Showing results ${startIndex + 1}-${Math.min(startIndex + entriesPerPage, totalEntries)} of ${totalEntries}`,
            inline: false
          });
        }
        
        if (currentPageEntries.length > 0) {
          let userList = '';
          let walletList = '';
          
          currentPageEntries.forEach(entry => {
            userList += `<@${entry.userId}> (${entry.userTag})\n`;
            const wallet = entry.wallet;
            let formattedWallet = wallet;
            if (wallet && wallet.length > 10) {
              formattedWallet = `${wallet.slice(0, 5)}...${wallet.slice(-5)}`;
            }
            walletList += `\`${formattedWallet}\`\n`;
          });
          
          embed.addFields([
            { name: 'Discord User', value: userList, inline: true },
            { name: 'Wallet Address', value: walletList, inline: true }
          ]);
        } else {
          embed.setDescription(`No wallets found${filter ? ` matching filter '${filter}'` : ''}.`);
        }
        
        await interaction.editReply({ 
          embeds: [embed],
          flags: isPublic ? [] : [MessageFlags.Ephemeral]
        });
        
        console.log(`Listed ${currentPageEntries.length} wallets (${isPublic ? 'public' : 'private'} response)`);
        
      } catch (fetchError) {
        console.error('Error fetching guild members:', fetchError.message);
        await interaction.editReply({ 
          content: `Error fetching guild members: ${fetchError.message}. Displaying wallets with unknown user tags.`,
          flags: isPublic ? [] : [MessageFlags.Ephemeral]
        });
        
        const userWallets = getUserWallets(guildId);
        const walletEntries = Object.entries(userWallets).map(([userId, wallet]) => ({ 
          userId, 
          userTag: 'Unknown User', 
          wallet 
        })).filter(entry => !filter || entry.userTag.toLowerCase().includes(filter));
        
        const totalEntries = walletEntries.length;
        const totalPages = Math.ceil(totalEntries / entriesPerPage);
        const currentPageEntries = walletEntries.slice(startIndex, startIndex + entriesPerPage);
        
        const embed = new EmbedBuilder()
          .setTitle('Registered Wallet Addresses (Limited Info)')
          .setDescription(`${totalEntries} registered wallet${totalEntries !== 1 ? 's' : ''}${filter ? ` matching filter '${filter}'` : ''}`)
          .setColor('#FF9900')
          .setFooter({ 
            text: `Page ${page}/${totalPages || 1} • ${entriesPerPage} entries per page • Requested by ${interaction.user.tag}`
          })
          .setTimestamp();
        
        if (currentPageEntries.length > 0) {
          let walletList = '';
          currentPageEntries.forEach(entry => {
            const wallet = entry.wallet;
            let formattedWallet = wallet;
            if (wallet && wallet.length > 10) {
              formattedWallet = `${wallet.slice(0, 5)}...${wallet.slice(-5)}`;
            }
            walletList += `User ID: ${entry.userId}\nWallet: \`${formattedWallet}\`\n\n`;
          });
          
          embed.addFields({ name: 'Wallets', value: walletList, inline: false });
        } else {
          embed.setDescription(`No wallets found${filter ? ` matching filter '${filter}'` : ''}.`);
        }
        
        await interaction.editReply({ 
          embeds: [embed],
          flags: isPublic ? [] : [MessageFlags.Ephemeral]
        });
      }
    } catch (error) {
      console.error('Error listing wallets:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error listing wallets: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error listing wallets: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'list-projects') {
    try {
      // Remove admin check so all users can use this command
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      console.log(`User ${interaction.user.tag} is listing projects, public: ${isPublic}`);
      const projects = getProjects(guildId);
      const projectNames = Object.keys(projects);
      const communityFund = serverData[guildId]?.communityFundProject;
      if (projectNames.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('No Projects Registered')
          .setDescription('No projects are currently registered for this server.')
          .addFields([
            { name: 'Next Steps', value: 'Use `/register-project` to add your first project.', inline: false }
          ])
          .setColor('#FF9900')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('Registered Projects')
        .setDescription(`${projectNames.length} project${projectNames.length !== 1 ? 's' : ''} registered for this server`)
        .setColor('#0099FF')
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();
      for (const projectName of projectNames) {
        const project = projects[projectName];
        const registeredBy = project.registeredBy ? `<@${project.registeredBy}>` : 'Unknown';
        const registeredAt = project.registeredAt ? new Date(project.registeredAt).toLocaleDateString() : 'Unknown';
        const isFund = communityFund === projectName;
        
        const supportedTokens = project.supportedTokens || [];
        let projectValue = `**Supported Tokens:** ${supportedTokens.join(', ') || 'None configured'}\n**Registered By:** ${registeredBy}\n**Registered:** ${registeredAt}`;
        
        // Add wallet address if available
        if (project.walletAddress) {
          projectValue += `\n**Wallet:** \`${project.walletAddress}\``;
        }
        
        // Add user input if available
        if (project.userInput) {
          projectValue += `\n**Notes:** ${project.userInput}`;
        }
        
        embed.addFields({
          name: `${isFund ? '💰 ' : ''}📁 ${projectName}${isFund ? ' (Community Fund)' : ''}`,
          value: projectValue,
          inline: false
        });
      }
      await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      console.log(`Listed ${projectNames.length} projects (${isPublic ? 'public' : 'private'} response)`);
    } catch (error) {
      console.error('Error listing projects:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error listing projects: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error listing projects: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'challenge-rps') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      console.log('[RPS DEBUG] challenge-rps guildId:', guildId);
      
      const userTag = interaction.options.getString('user-tag');
      const tokenTicker = interaction.options.getString('token-ticker');
      const amount = interaction.options.getString('amount');
      const memo = interaction.options.getString('memo') || 'No memo provided';
      
      // Check if community fund is set
      const fundProject = serverData[guildId]?.communityFundProject;
      if (!fundProject) {
        await interaction.editReply({ content: 'No Community Tip Fund is set for this server. Please ask an admin to run /set-community-fund.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const projects = getProjects(guildId);
      if (!projects[fundProject]) {
        await interaction.editReply({ content: `The Community Tip Fund project ("${fundProject}") no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        await interaction.editReply({ content: '❌ Invalid amount. Please provide a positive number.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if user has sufficient virtual balance
      const currentBalance = virtualAccounts.getUserBalance(guildId, interaction.user.id, tokenTicker);
      if (new BigNumber(currentBalance).isLessThan(amountNum)) {
        await interaction.editReply({ 
          content: `❌ **Insufficient virtual balance!**\n\nYou have: **${currentBalance}** ${tokenTicker}\nRequired: **${amountNum}** ${tokenTicker}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Find target user
      let targetUserId = null;
      let targetUser = null;
      let recipientWallet = null;
      
      try {
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        
        const targetMember = members.find(member => 
          member.user.tag === userTag || 
          member.user.username === userTag ||
          (member.nickname && member.nickname === userTag)
        );
        
        if (targetMember) {
          targetUserId = targetMember.user.id;
          targetUser = targetMember.user;
          recipientWallet = getUserWallets(guildId)[targetUserId];
        }
      } catch (fetchError) {
        console.error('Error fetching guild members:', fetchError.message);
      }
      
      if (!recipientWallet) {
        await interaction.editReply({ content: `User ${userTag} not found or has no registered wallet. Ask them to register with /set-wallet.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Prevent self-challenge
      if (targetUserId === interaction.user.id) {
        await interaction.editReply({ content: `❌ **Self-challenge is not allowed!** You cannot challenge yourself to Rock, Paper, Scissors.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if the token is supported by the community fund
      const fundSupportedTokens = projects[fundProject].supportedTokens || [];
      if (!fundSupportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ 
          content: `❌ **Unsupported token!**\n\nToken "${tokenTicker}" is not supported by the Community Fund.\n\nSupported tokens: ${fundSupportedTokens.join(', ') || 'None configured'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Deduct funds from virtual account
      const deductionResult = virtualAccounts.deductFundsFromAccount(
        guildId, 
        interaction.user.id, 
        tokenTicker, 
        amountNum.toString(), 
        `RPS challenge vs ${userTag}`
      );
      
      if (!deductionResult.success) {
        await interaction.editReply({ 
          content: `❌ **Failed to deduct funds!** ${deductionResult.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
        
      // Create the challenge
      const challengeId = generateChallengeId();
      const challenges = getRPSChallenges(guildId);
      if (!challenges) {
        rpsGamesData[guildId] = {};
        saveRpsGamesData();
        console.log('[RPS DEBUG] rpsGamesData was undefined, re-initialized!');
      }
      // Now safe to set challenge
      challenges[challengeId] = {
        challengerId: interaction.user.id,
        challengerTag: interaction.user.tag,
        challengerWallet: getUserWallets(guildId)[interaction.user.id],
        challengedId: targetUserId,
        challengedTag: userTag,
        challengedWallet: recipientWallet,
        amount: amountNum.toString(), // virtual amount
        humanAmount: amountNum.toString(), // human value (string)
        amountWei: amountNum.toString(), // wei amount for virtual accounts (same as amount for virtual)
        decimals: 0, // Virtual amounts don't need decimals
        token: tokenTicker,
        transactionHash: null, // No blockchain transaction needed
        memo: memo,
        status: 'waiting', // waiting, active, completed, expired
        createdAt: Date.now(),
        expiresAt: Date.now() + (30 * 60 * 1000), // 30 minutes
        rounds: [],
        currentRound: 1,
        virtualChallenge: true, // Mark as virtual challenge
        channelId: interaction.channel.id // Store channel ID for notifications
      };
        
        saveRpsGamesData();
        
      const embed = new EmbedBuilder()
        .setTitle('🎮 Rock, Paper, Scissors Challenge Created!')
        .setDescription(`${interaction.user.tag} has challenged ${userTag} to a game!`)
        .addFields([
          { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
          { name: 'Prize Amount', value: `${amountNum} ${tokenTicker}`, inline: true },
          { name: 'Total Prize', value: `${amountNum * 2} ${tokenTicker}`, inline: true },
          { name: 'Challenger', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Challenged', value: `<@${targetUserId}>`, inline: true },
          { name: 'Status', value: '⏳ Waiting for opponent', inline: true },
          { name: 'Expires', value: '<t:' + Math.floor((Date.now() + (30 * 60 * 1000)) / 1000) + ':R>', inline: true },
          { name: 'Memo', value: memo, inline: false }
        ])
        .setColor('#FF6B35')
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
        
        // Use RPS GIF as thumbnail
        embed.setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif');
        
        // Create Join Challenge button
        const joinButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`join-rps-modal:${challengeId}`)
              .setLabel('Join Challenge')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('🎯')
          );
        
      await interaction.editReply({ 
        content: `✅ Challenge created: ${challengeId} | ${amountNum} ${tokenTicker} vs ${userTag}`,
        flags: [MessageFlags.Ephemeral] 
      });
      
      // Post public announcement with button
      await interaction.channel.send({ 
        content: `🎮 **Rock, Paper, Scissors Challenge!** 🎮`,
        embeds: [embed],
        components: [joinButton]
      });
      
      // Send DM to challenged user
      try {
        if (targetUser) {
          // Use RPS GIF as thumbnail for DM
          const dmThumbnail = 'https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif';
          
          const dmEmbed = new EmbedBuilder()
            .setTitle('🎮 You have been challenged!')
            .setDescription(`${interaction.user.tag} has challenged you to Rock, Paper, Scissors!`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Prize Amount', value: `${amountNum} ${tokenTicker}`, inline: true },
              { name: 'Total Prize', value: `${amountNum * 2} ${tokenTicker}`, inline: true },
              { name: 'Expires', value: '<t:' + Math.floor((Date.now() + (30 * 60 * 1000)) / 1000) + ':R>', inline: true },
              { name: 'To Join', value: `Click the "Join Challenge" button in the challenge post or use \`/join-rps challenge-id:${challengeId}\``, inline: false },
              { name: 'Memo', value: memo, inline: false }
            ])
            .setColor('#FF6B35')
            .setThumbnail(dmThumbnail)
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          await targetUser.send({ embeds: [dmEmbed] });
          console.log(`Sent RPS challenge DM to ${userTag}`);
        }
      } catch (dmError) {
        console.error(`Could not send DM to ${userTag}:`, dmError.message);
      }
      
      console.log(`RPS challenge created: ${challengeId} by ${interaction.user.tag} challenging ${userTag} for ${amountNum} ${tokenTicker}`);
      
    } catch (error) {
      console.error('Error creating RPS challenge:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error creating challenge: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error creating challenge: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'join-rps') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      console.log('[RPS DEBUG] join-rps guildId:', guildId);
      
      const challengeId = interaction.options.getString('challenge-id');
      
      // Check if community fund is set
      const fundProject = serverData[guildId]?.communityFundProject;
      if (!fundProject) {
        await interaction.editReply({ content: 'No Community Tip Fund is set for this server. Please ask an admin to run /set-community-fund.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const projects = getProjects(guildId);
      if (!projects[fundProject]) {
        await interaction.editReply({ content: `The Community Tip Fund project ("${fundProject}") no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Get the challenge
      const challenges = getRPSChallenges(guildId);
      const challenge = challenges[challengeId];
      
      if (!challenge) {
        await interaction.editReply({ content: `Challenge ID "${challengeId}" not found or has expired.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (challenge.status !== 'waiting') {
        await interaction.editReply({ content: `Challenge "${challengeId}" is no longer accepting participants. Status: ${challenge.status}`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if user is the challenged person
      if (challenge.challengedId !== interaction.user.id) {
        await interaction.editReply({ content: `This challenge is for ${challenge.challengedTag}, not you.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if challenge has expired
      if (Date.now() > challenge.expiresAt) {
        challenge.status = 'expired';
        saveServerData();
        await interaction.editReply({ content: `Challenge "${challengeId}" has expired.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if user has sufficient virtual balance
      const currentBalance = virtualAccounts.getUserBalance(guildId, interaction.user.id, challenge.token);
      const requiredAmount = parseFloat(challenge.amount);
      
      if (new BigNumber(currentBalance).isLessThan(requiredAmount)) {
        await interaction.editReply({ 
          content: `❌ **Insufficient virtual balance!**\n\nYou have: **${currentBalance}** ${challenge.token}\nRequired: **${requiredAmount}** ${challenge.token}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Deduct funds from virtual account
      const deductionResult = virtualAccounts.deductFundsFromAccount(
        guildId, 
        interaction.user.id, 
        challenge.token, 
        requiredAmount.toString(), 
        `RPS challenge join: ${challengeId}`
      );
      
      console.log(`[RPS DEBUG] Joining challenge - User: ${interaction.user.id}, Token: ${challenge.token}, Amount: ${requiredAmount}`);
      console.log(`[RPS DEBUG] Deduction result:`, deductionResult);
      
      if (!deductionResult.success) {
        await interaction.editReply({ 
          content: `❌ **Failed to deduct funds!** ${deductionResult.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
        
      // Update challenge status
      challenge.status = 'active';
      challenge.joinedAt = Date.now();
      challenge.joinerTransactionHash = null; // No blockchain transaction needed
      saveServerData();

        // Create the embed first
        const embed = new EmbedBuilder()
          .setTitle('🎮 Rock, Paper, Scissors Challenge Joined!')
          .setDescription(`${interaction.user.tag} has joined the challenge!`)
          .addFields([
            { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
            { name: 'Prize Amount', value: `${challenge.humanAmount} ${challenge.token}`, inline: true },
            { name: 'Total Prize', value: `${Number(challenge.humanAmount) * 2} ${challenge.token}`, inline: true },
            { name: 'Challenger', value: `<@${challenge.challengerId}>`, inline: true },
            { name: 'Challenged', value: `<@${challenge.challengedId}>`, inline: true },
            { name: 'Status', value: '🎯 Game Active', inline: true },
            { name: 'Memo', value: challenge.memo, inline: false }
          ])
          .setColor('#00FF00')
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();
        
        // Use RPS GIF as thumbnail
        embed.setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif');
        
        await interaction.editReply({ 
          content: `✅ Successfully joined the challenge!`, 
          embeds: [embed],
          flags: [MessageFlags.Ephemeral] 
        });
        
        // Post public announcement
        await interaction.channel.send({ 
          content: `🎮 **Rock, Paper, Scissors Challenge Started!** 🎮`,
          embeds: [embed],
          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(`rps-move:${challengeId}:rock`)
                  .setLabel('🪨 Rock')
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`rps-move:${challengeId}:paper`)
                  .setLabel('📄 Paper')
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`rps-move:${challengeId}:scissors`)
                  .setLabel('✂️ Scissors')
                  .setStyle(ButtonStyle.Primary)
              )
          ]
        });
        
      console.log(`RPS challenge joined: ${challengeId} by ${interaction.user.tag}`);
      
    } catch (error) {
      console.error('Error joining RPS challenge:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error joining challenge: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error joining challenge: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'list-rps-challenges') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const challenges = getRPSChallenges(guildId);
      let changed = false;
      const now = Date.now();
      // Collect expired challenge IDs for cleanup
      const expiredChallengeIds = [];
      for (const [challengeId, challenge] of Object.entries(challenges)) {
        if (challenge.status === 'waiting' && now > challenge.expiresAt) {
          // Mark as expired
          challenge.status = 'expired';
          changed = true;
          // Refund challenger to virtual account
          try {
            if (challenge.humanAmount && challenge.token) {
              const memo = `RPS refund: challenge expired (${challengeId})`;
              const refundResult = virtualAccounts.addFundsToAccount(
                guildId,
                challenge.challengerId,
                challenge.token,
                challenge.humanAmount,
                null, // No transaction hash for virtual refund
                'rps_refund',
                null // Username will be updated when user runs commands
              );
              // DM notification to challenger
              try {
                const guild = interaction.guild || await client.guilds.fetch(guildId);
                const member = await guild.members.fetch(challenge.challengerId).catch(() => null);
                if (member) {
                  // Get updated virtual balance
                  const newBalance = virtualAccounts.getUserBalance(guildId, challenge.challengerId, challenge.token);
                  
                  await member.send({
                    embeds: [
                      new EmbedBuilder()
                        .setTitle('RPS Challenge Refund')
                        .setDescription(`Your RPS challenge expired and your entry has been refunded to your virtual account.`)
                        .addFields([
                          { name: 'Amount Refunded', value: `${challenge.humanAmount} ${challenge.token}`, inline: true },
                          { name: 'New Virtual Balance', value: `${newBalance} ${challenge.token}`, inline: true },
                          { name: 'Reason', value: 'Challenge expired (no opponent joined in time)', inline: false },
                          { name: 'Challenge ID', value: challengeId, inline: false }
                        ])
                        .setColor('#FF9900')
                        .setTimestamp()
                        .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
                        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
                    ]
                  });
                }
              } catch (dmError) {
                console.error(`[RPS] Could not send refund DM to challenger for challenge ${challengeId}:`, dmError.message);
              }
              // Channel notification for refund
              try {
                if (interaction.guild) {
                  const channel = interaction.channel || interaction.guild.channels.cache.find((c) => c.isTextBased && c.viewable);
                  if (channel) {
                    await channel.send({
                      embeds: [
                        new EmbedBuilder()
                          .setTitle('RPS Challenge Refund Issued')
                          .setDescription(`A refund has been issued for an expired RPS challenge.`)
                          .addFields([
                            { name: 'Challenger', value: `<@${challenge.challengerId}>`, inline: true },
                            { name: 'Amount Refunded', value: `${challenge.humanAmount} ${challenge.token}`, inline: true },
                            { name: 'Challenge ID', value: challengeId, inline: false },
                            ...(txHash ? [{ name: 'Transaction Hash', value: `[${txHash}](${explorerUrl})`, inline: false }] : [])
                          ])
                          .setColor('#FF9900')
                          .setTimestamp()
                          .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
                          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
                      ]
                    });
                  }
                }
              } catch (chanError) {
                console.error(`[RPS] Could not send refund notification in channel for challenge ${challengeId}:`, chanError.message);
              }
              console.log(`[RPS] Refunded challenger for expired challenge ${challengeId}`);
            }
          } catch (refundError) {
            console.error(`[RPS] Failed to refund challenger for expired challenge ${challengeId}:`, refundError.message);
          }
          // Mark for cleanup
          expiredChallengeIds.push(challengeId);
        }
      }
      // Remove expired challenges from rpsGamesData
      for (const challengeId of expiredChallengeIds) {
        delete challenges[challengeId];
        changed = true;
      }
      if (changed) saveRpsGamesData();
      // Only show non-expired, non-completed challenges
      const activeChallenges = Object.entries(challenges).filter(([id, challenge]) => 
        (challenge.status === 'waiting' || challenge.status === 'active')
      );
      if (activeChallenges.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('No Active RPS Challenges')
          .setDescription('There are no active Rock, Paper, Scissors challenges at the moment.')
          .setColor('#FF9900')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('Active Rock, Paper, Scissors Challenges')
        .setDescription(`${activeChallenges.length} active challenge${activeChallenges.length !== 1 ? 's' : ''}`)
        .setColor('#0099FF')
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();
      for (const [challengeId, challenge] of activeChallenges) {
        const statusEmoji = challenge.status === 'waiting' ? '⏳' : '🎯';
        const statusText = challenge.status === 'waiting' ? 'Waiting for opponent' : 'Game Active';
        const expiresIn = Math.floor((challenge.expiresAt - Date.now()) / 1000);
        const expiresText = expiresIn > 0 ? `<t:${Math.floor(Date.now() / 1000) + expiresIn}:R>` : 'Expired';
        embed.addFields({
          name: `${statusEmoji} Challenge ${challengeId}`,
          value: `**Challenger:** ${challenge.challengerTag}\n**Challenged:** ${challenge.challengedTag}\n**Prize:** ${challenge.humanAmount} ${challenge.token}\n**Total Prize:** ${Number(challenge.humanAmount) * 2} ${challenge.token}\n**Status:** ${statusText}\n**Expires:** ${expiresText}\n**Memo:** ${challenge.memo}`,
          inline: false
        });
      }
      await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
    } catch (error) {
      console.error('Error listing RPS challenges:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error listing challenges: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error listing challenges: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'show-community-fund-address') {
    try {
      await interaction.deferReply();
      
      const guildId = interaction.guildId;
      
      if (!serverData[guildId] || !serverData[guildId].communityFundProject) {
        await interaction.editReply({ 
          content: '❌ No community fund project is configured for this server. Please contact an administrator to set up a community fund project.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const communityFundProject = serverData[guildId].communityFundProject;
      const projects = getProjects(guildId);
      const project = projects[communityFundProject];
      
      if (!project) {
        await interaction.editReply({ 
          content: `❌ Community fund project "${communityFundProject}" not found. Please contact an administrator to fix this configuration.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      if (!project.walletAddress) {
        await interaction.editReply({ 
          content: `❌ Community fund project "${communityFundProject}" has no wallet address configured. Please contact an administrator to fix this configuration.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Community Fund Deposit Address')
        .setDescription(`Send tokens to the community fund to participate in games and activities!`)
        .addFields([
          { name: 'Project Name', value: `**${communityFundProject}**`, inline: true },
          { name: 'Wallet Address', value: `\`${project.walletAddress}\``, inline: false },
          { name: 'How to Deposit', value: '1. Copy the wallet address above\n2. Send your tokens to this address\n3. Your virtual account will be automatically updated\n4. Use `/check-balance` to verify your deposit', inline: false }
        ])
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Add QR code as thumbnail if available
      if (project.qrCodeUrl) {
        embed.setThumbnail(project.qrCodeUrl);
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error showing community fund address:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error showing community fund address: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error showing community fund address: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'delete-project') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can delete projects.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const confirm = interaction.options.getString('confirm');

      if (confirm !== 'DELETE') {
        await interaction.editReply({ 
          content: `❌ **Deletion Cancelled**\n\nTo delete project "${projectName}", you must type "DELETE" in the confirm field.\n\nThis is a safety measure to prevent accidental deletions.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const projects = getProjects(guildId);
      
      if (!projects[projectName]) {
        await interaction.editReply({ content: `Project "${projectName}" not found.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Store project info for logging before deletion
      const projectInfo = projects[projectName];
      const supportedTokens = projectInfo.supportedTokens.join(', ');
      const registeredBy = projectInfo.registeredBy ? `<@${projectInfo.registeredBy}>` : 'Unknown';
      const registeredAt = projectInfo.registeredAt ? new Date(projectInfo.registeredAt).toLocaleDateString() : 'Unknown';
      const walletAddress = projectInfo.walletAddress || 'Not set';
      const userInput = projectInfo.userInput || 'No notes';

      // Delete the project
      delete projects[projectName];
      saveServerData();

      const embed = new EmbedBuilder()
        .setTitle('Project Deleted Successfully')
        .setDescription(`Project **${projectName}** has been permanently deleted from this server.`)
        .addFields([
          { name: 'Deleted Project', value: projectName, inline: true },
          { name: 'Wallet Address', value: `\`${walletAddress}\``, inline: true },
          { name: 'Supported Tokens', value: supportedTokens || 'None', inline: true },
          { name: 'Originally Registered By', value: registeredBy, inline: true },
          { name: 'Originally Registered', value: registeredAt, inline: true },
          { name: 'Deleted By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Status', value: '🗑️ Deleted', inline: true }
        ])
        .setColor('#FF0000')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      await interaction.editReply({ embeds: [embed] });
      
      console.log(`Project "${projectName}" deleted from guild ${guildId} by ${interaction.user.tag}`);
      
      // Send notification to log channel if it exists
      try {
        if (interaction.guild) {
          const logChannel = interaction.guild.channels.cache.find((channel) => channel.name === 'transfer-logs');
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('⚠️ Project Deleted')
              .setDescription(`Project **${projectName}** was deleted by ${interaction.user.tag}`)
              .addFields([
                { name: 'Supported Tokens', value: supportedTokens || 'None', inline: true },
                { name: 'Deleted By', value: `<@${interaction.user.id}>`, inline: true }
              ])
              .setColor('#FF0000')
              .setTimestamp()
              .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
            
            await logChannel.send({ embeds: [logEmbed] });
          }
        }
      } catch (logError) {
        console.error('Error posting to log channel:', logError.message);
      }
      
    } catch (error) {
      console.error('Error deleting project:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error deleting project: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error deleting project: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'play-rps') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const challengeId = interaction.options.getString('challenge-id');
      const move = interaction.options.getString('move');
      const guildId = interaction.guildId;
      const challenges = getRPSChallenges(guildId);
      const challenge = challenges[challengeId];
      if (!challenge || challenge.status !== 'active') {
        await interaction.editReply({ content: 'This challenge is not active or does not exist.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      if (![challenge.challengerId, challenge.challengedId].includes(interaction.user.id)) {
        await interaction.editReply({ content: 'You are not a participant in this game.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      const isChallenger = challenge.challengerId === interaction.user.id;
      const playerChoiceKey = isChallenger ? 'challengerChoice' : 'challengedChoice';
      if (!challenge.rounds[challenge.currentRound - 1]) {
        challenge.rounds[challenge.currentRound - 1] = {
          round: challenge.currentRound,
          challengerChoice: null,
          challengedChoice: null,
          winner: null,
          result: null
        };
      }
      const currentRound = challenge.rounds[challenge.currentRound - 1];
      if (currentRound[playerChoiceKey]) {
        await interaction.editReply({ content: 'You have already made your choice for this round.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      if (!['rock', 'paper', 'scissors'].includes(move)) {
        await interaction.editReply({ content: 'Invalid move. Please choose rock, paper, or scissors.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      currentRound[playerChoiceKey] = move;
      saveRpsGamesData();
      // Send game state embed to user after their move
      const moveEmbed = new EmbedBuilder()
        .setTitle('🎮 RPS Move Submitted')
        .setDescription(`You played **${move.charAt(0).toUpperCase() + move.slice(1)}** for round ${challenge.currentRound}.`)
        .addFields([
          { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
          { name: 'Round', value: `${challenge.currentRound}`, inline: true },
          { name: 'Your Choice', value: move, inline: true },
          { name: 'Opponent', value: isChallenger ? `<@${challenge.challengedId}>` : `<@${challenge.challengerId}>`, inline: true },
          { name: 'Opponent Choice', value: currentRound[isChallenger ? 'challengedChoice' : 'challengerChoice'] ? currentRound[isChallenger ? 'challengedChoice' : 'challengerChoice'] : 'Not picked yet', inline: true },
          { name: 'Status', value: 'Waiting for both players to pick', inline: false }
        ])
        .setColor('#4d55dc')
        .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      await interaction.editReply({ embeds: [moveEmbed], flags: [MessageFlags.Ephemeral] });
      if (currentRound.challengerChoice && currentRound.challengedChoice) {
        const winner = determineRPSWinner(currentRound.challengerChoice, currentRound.challengedChoice);
        currentRound.winner = winner;
        if (winner === 'draw') {
          currentRound.result = 'draw';
          challenge.currentRound++;
          challenge.rounds[challenge.currentRound - 1] = {
            round: challenge.currentRound,
            challengerChoice: null,
            challengedChoice: null,
            winner: null,
            result: null
          };
          saveRpsGamesData();
          const roundEmbed = new EmbedBuilder()
            .setTitle('🎮 RPS Round Draw!')
            .setDescription(`Round ${currentRound.round} ended in a draw! Both players, choose again for round ${challenge.currentRound}.`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Round', value: `${challenge.currentRound}`, inline: true },
              { name: 'Challenger', value: `<@${challenge.challengerId}>`, inline: true },
              { name: 'Challenged', value: `<@${challenge.challengedId}>`, inline: true }
            ])
            .setColor('#FFD700')
            .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          await interaction.channel.send({ 
            embeds: [roundEmbed],
            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:rock`)
                    .setLabel('🪨 Rock')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:paper`)
                    .setLabel('📄 Paper')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:scissors`)
                    .setLabel('✂️ Scissors')
                    .setStyle(ButtonStyle.Primary)
                )
            ]
          });
        } else {
          currentRound.result = 'winner';
          challenge.status = 'completed';
          // Determine winner/loser IDs and tags
          const winnerId = winner === 'player1' ? challenge.challengerId : challenge.challengedId;
          const winnerTag = winner === 'player1' ? challenge.challengerTag : challenge.challengedTag;
          const winnerWallet = winner === 'player1' ? challenge.challengerWallet : challenge.challengedWallet;
          const loserId = winner === 'player1' ? challenge.challengedId : challenge.challengerId;
          const loserTag = winner === 'player1' ? challenge.challengedTag : challenge.challengerTag;
          challenge.winner = winner;
          challenge.winnerId = winnerId;
          challenge.winnerTag = winnerTag;
          challenge.loserId = loserId;
          challenge.loserTag = loserTag;
          challenge.completedAt = Date.now();
          saveRpsGamesData();
          
          // Get balances BEFORE adding prize to ensure we have correct loser balance
          virtualAccounts.forceReloadData();
          const loserBalance = virtualAccounts.getUserBalance(guildId, loserId, challenge.token);
          const winnerBalanceBeforePrize = virtualAccounts.getUserBalance(guildId, winnerId, challenge.token);
          
          console.log(`[RPS DEBUG] Before prize - Winner: ${winnerId}, Loser: ${loserId}, Token: ${challenge.token}`);
          console.log(`[RPS DEBUG] Winner balance before prize: ${winnerBalanceBeforePrize}, Loser balance: ${loserBalance}`);
          
          // Prize transfer to virtual account
          const totalPrizeHuman = Number(challenge.humanAmount) * 2;
          let prizeResult = null;
          if (challenge.humanAmount && challenge.token) {
            try {
              prizeResult = virtualAccounts.addFundsToAccount(
                guildId,
                winnerId,
                challenge.token,
                totalPrizeHuman.toString(),
                null, // No transaction hash for virtual prize
                'rps_prize',
                null // Username will be updated when user runs commands
              );
            } catch (err) {
              console.error('[RPS] Error adding prize to virtual account:', err.message);
            }
          }
          
          // Get winner's final balance after prize
          const winnerBalance = virtualAccounts.getUserBalance(guildId, winnerId, challenge.token);
          
          console.log(`[RPS DEBUG] After prize - Winner final balance: ${winnerBalance}, Loser balance: ${loserBalance}`);
          
          // Winner embed for channel
          const winnerEmbed = new EmbedBuilder()
            .setTitle('🎉 RPS Game Complete!')
            .setDescription(`**${winnerTag} wins the game!**`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Winner', value: `<@${winnerId}>`, inline: true },
              { name: 'Loser', value: `<@${loserId}>`, inline: true },
              { name: 'Prize Won', value: `${totalPrizeHuman} ${challenge.token}`, inline: true },
              { name: 'Winner New Balance', value: `${winnerBalance} ${challenge.token}`, inline: true },
              { name: 'Loser New Balance', value: `${loserBalance} ${challenge.token}`, inline: true }
            ])
            .setColor('#00FF00')
            .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          await interaction.channel.send({ embeds: [winnerEmbed] });
          // DM winner
          try {
            const winnerUser = await client.users.fetch(winnerId);
            if (winnerUser) {
              const winnerDMEmbed = new EmbedBuilder()
                .setTitle('🎉 You Won Rock, Paper, Scissors!')
                .setDescription(`Congratulations! You won the RPS game and received **${totalPrizeHuman} ${challenge.token}** in your virtual account.`)
                .addFields([
                  { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
                  { name: 'Prize Won', value: `${totalPrizeHuman} ${challenge.token}`, inline: true },
                  { name: 'Your New Balance', value: `${winnerBalance} ${challenge.token}`, inline: true }
                ])
                .setColor('#00FF00')
                .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
                .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
                .setTimestamp();
              await winnerUser.send({ embeds: [winnerDMEmbed] });
            }
          } catch (dmError) {
            console.error('[RPS] Could not send DM to winner:', dmError.message);
          }
        }
      }
    } catch (err) {
      console.error('Error handling /play-rps command:', err, err.stack);
      await interaction.editReply({ content: 'An error occurred handling your move. Please try again.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (commandName === 'debug-server-config') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can use debug commands.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const guildId = interaction.guildId;
      
      // Get server configuration
      const serverConfig = serverData[guildId] || {};
      const projects = getProjects(guildId);
      const fundProject = serverConfig.communityFundProject;
      const fundProjectData = fundProject ? projects[fundProject] : null;
      
      // Build debug embed
      const debugEmbed = new EmbedBuilder()
        .setTitle('🔍 Server Configuration Debug')
        .setDescription(`Debug information for server: ${interaction.guild.name}`)
        .addFields([
          { name: 'Server ID', value: guildId, inline: true },
          { name: 'Community Fund Project', value: fundProject || '❌ Not set', inline: true },
          { name: 'Total Projects', value: Object.keys(projects).length.toString(), inline: true },
          { name: 'Total Users', value: Object.keys(serverConfig.userWallets || {}).length.toString(), inline: true }
        ])
        .setColor(fundProject ? '#00FF00' : '#FF0000')
        .setTimestamp();
      
      // Add project details
      if (Object.keys(projects).length > 0) {
        let projectDetails = '';
        for (const [projectName, project] of Object.entries(projects)) {
          const isFund = projectName === fundProject;
          projectDetails += `${isFund ? '💰 ' : '📁 '}**${projectName}**\n`;
          projectDetails += `• Wallet: \`${project.walletAddress ? project.walletAddress.slice(0, 10) + '...' : 'Not set'}\`\n`;
          projectDetails += `• Tokens: ${project.supportedTokens?.join(', ') || 'None'}\n`;
          projectDetails += `• Registered: <t:${Math.floor(project.registeredAt / 1000)}:R>\n\n`;
        }
        debugEmbed.addFields({ name: 'Projects', value: projectDetails, inline: false });
      }
      
      // Add community fund details
      if (fundProject && fundProjectData) {
        debugEmbed.addFields([
          { name: 'Community Fund Details', value: `**Project:** ${fundProject}\n**Wallet:** \`${fundProjectData.walletAddress}\`\n**Supported Tokens:** ${fundProjectData.supportedTokens?.join(', ') || 'None'}`, inline: false }
        ]);
      } else {
        debugEmbed.addFields([
          { name: '⚠️ Community Fund Issue', value: 'No Community Tip Fund is configured. This will prevent:\n• `/create-fixtures` from working\n• `/tip` from working\n• Football betting from working\n\nUse `/set-community-fund` to fix this.', inline: false }
        ]);
      }
      
      await interaction.editReply({ embeds: [debugEmbed] });
      
      // Log debug info
      console.log(`[DEBUG] Server config debug for guild ${guildId}:`, {
        communityFundProject: fundProject,
        totalProjects: Object.keys(projects).length,
        totalUsers: Object.keys(serverConfig.userWallets || {}).length,
        fundProjectData: fundProjectData
      });
      
    } catch (error) {
      console.error('Error in debug-server-config command:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'debug-user') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can use debug commands.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const userId = interaction.options.getString('user-id');
      const guildId = interaction.guildId;
      
      // Get user wallets for this server
      const userWallets = getUserWallets(guildId);
      const userWallet = userWallets[userId];
      
      // Get guild member info
      let memberInfo = null;
      try {
        const guild = interaction.guild;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          memberInfo = {
            tag: member.user.tag,
            username: member.user.username,
            nickname: member.nickname,
            joinedAt: member.joinedAt,
            isInGuild: true
          };
        }
      } catch (error) {
        console.error(`Error fetching member ${userId}:`, error.message);
      }
      
      // Check if user is in autocomplete range
      const userWalletEntries = Object.entries(userWallets);
      const userIndex = userWalletEntries.findIndex(([id, wallet]) => id === userId);
      const isInAutocompleteRange = userIndex !== -1 && userIndex < 100;
      
      // Build debug embed
      const debugEmbed = new EmbedBuilder()
        .setTitle('🔍 User Debug Information')
        .setDescription(`Debug information for user ID: \`${userId}\``)
        .addFields([
          { name: 'Wallet Registered', value: userWallet ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Wallet Address', value: userWallet ? `\`${userWallet}\`` : 'Not registered', inline: false },
          { name: 'In Guild', value: memberInfo ? '✅ Yes' : '❌ No', inline: true },
          { name: 'User Tag', value: memberInfo?.tag || 'Unknown', inline: true },
          { name: 'Nickname', value: memberInfo?.nickname || 'None', inline: true },
          { name: 'Joined Server', value: memberInfo?.joinedAt ? `<t:${Math.floor(memberInfo.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true },
          { name: 'Total Registered Users', value: `${userWalletEntries.length}`, inline: true },
          { name: 'User Index in List', value: userIndex !== -1 ? `${userIndex + 1}` : 'Not found', inline: true },
          { name: 'In Autocomplete Range', value: isInAutocompleteRange ? '✅ Yes (first 100)' : '❌ No (beyond first 100)', inline: true }
        ])
        .setColor(isInAutocompleteRange ? '#00FF00' : '#FF0000')
        .setTimestamp()
        .setFooter({ text: 'Debug Command', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      await interaction.editReply({ embeds: [debugEmbed] });
      
      // Log debug info
      console.log(`[DEBUG] User ${userId} debug info:`, {
        walletRegistered: !!userWallet,
        walletAddress: userWallet,
        inGuild: !!memberInfo,
        userTag: memberInfo?.tag,
        totalUsers: userWalletEntries.length,
        userIndex: userIndex,
        inAutocompleteRange: isInAutocompleteRange
      });
      
    } catch (error) {
      console.error('Error in debug-user command:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'create-fixtures') {
    try {
      console.log('[FOOTBALL] create-fixtures command started');
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        console.log('[FOOTBALL] User is not an administrator');
        await interaction.editReply({ content: 'Only administrators can create football fixtures.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      console.log('[FOOTBALL] User is administrator, proceeding with command');

      const competition = interaction.options.getString('competition');
      const tokenTicker = interaction.options.getString('token');
      const amount = interaction.options.getNumber('amount');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      
      console.log(`[FOOTBALL] Command parameters: competition=${competition}, token=${tokenTicker}, amount=${amount}, channel=${channel.name}`);
      
      // Check if bot has permission to create threads in this channel
      if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.CreatePublicThreads)) {
        await interaction.editReply({ 
          content: `❌ I don't have permission to create threads in ${channel}. Please ensure I have "Create Public Threads" permission or choose a different channel.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Check if community fund is set
      const fundProject = serverData[guildId]?.communityFundProject;
      if (!fundProject) {
        const availableProjects = Object.keys(getProjects(guildId));
        await interaction.editReply({ 
          content: `❌ **No Community Tip Fund configured!**\n\nThis server needs a Community Tip Fund to create football fixtures.\n\n**To fix this:**\n1. Ask an admin to run \`/set-community-fund\`\n2. Select a project that supports the tokens you want to use for betting\n\n**Current projects:** ${availableProjects.length > 0 ? availableProjects.join(', ') : 'None'}\n\n**Example:** \`/set-community-fund project-name:YourProjectName\``, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const projects = getProjects(guildId);
      if (!projects[fundProject]) {
        await interaction.editReply({ content: `The Community Tip Fund project ("${fundProject}") no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Validate token is supported by community fund
      const fundSupportedTokens = projects[fundProject].supportedTokens || [];
      if (!fundSupportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ content: `Token "${tokenTicker}" is not supported by the Community Fund. Supported tokens: ${fundSupportedTokens.join(', ') || 'None configured'}`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Get token identifier and decimals
      const tokenIdentifier = await getTokenIdentifier(tokenTicker);
      if (!tokenIdentifier) {
        await interaction.editReply({ content: `Could not find token identifier for "${tokenTicker}". Please check the token ticker.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      const decimals = await getTokenDecimals(tokenIdentifier);
      const requiredAmountWei = toBlockchainAmount(amount, decimals);

      // Fetch today's fixtures for the competition
      await interaction.editReply({ content: `🔍 Fetching today's fixtures for competition ${competition}...`, flags: [MessageFlags.Ephemeral] });

      try {
        console.log(`[FOOTBALL] Fetching fixtures for competition: ${competition}`);
        let fixtures = await fdGetTodayFixtures(competition);
        console.log(`[FOOTBALL] Received fixtures response:`, fixtures);
        
        // If no fixtures today, try to get fixtures for the next few days
        if (!fixtures.matches || fixtures.matches.length === 0) {
          await interaction.editReply({ content: `No fixtures today for competition ${competition}. Checking next few days...`, flags: [MessageFlags.Ephemeral] });
          
          // Try to get fixtures for the next 7 days
          const today = new Date();
          const nextWeek = new Date(today);
          nextWeek.setDate(today.getDate() + 7);
          
          const dateFrom = today.toISOString().split('T')[0];
          const dateTo = nextWeek.toISOString().split('T')[0];
          
          console.log(`[FOOTBALL] Trying to get fixtures from ${dateFrom} to ${dateTo}`);
          
          const response = await fetch(`https://api.football-data.org/v4/competitions/${competition}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED`, {
            headers: {
              'X-Auth-Token': process.env.FD_TOKEN
            }
          });
          
          if (response.ok) {
            fixtures = await response.json();
            if (fixtures.matches && fixtures.matches.length > 0) {
              await interaction.editReply({ content: `Found ${fixtures.matches.length} upcoming fixtures for ${competition}. Creating games for the next available matches...`, flags: [MessageFlags.Ephemeral] });
            } else {
              await interaction.editReply({ content: `No upcoming fixtures found for competition ${competition} in the next week. This competition may not have matches scheduled or may be inactive.`, flags: [MessageFlags.Ephemeral] });
              return;
            }
          } else {
            await interaction.editReply({ content: `No fixtures today for competition ${competition} and unable to fetch upcoming fixtures. Choose a different competition or try again later.`, flags: [MessageFlags.Ephemeral] });
            return;
          }
        }

        // Store last competition used
        if (!serverData[guildId]) serverData[guildId] = {};
        serverData[guildId].lastCompetition = competition;
        saveServerData();

        // Initialize football data for this guild
        initializeFootballData(guildId);

        let createdMatches = 0;
        let skippedMatches = 0;
        let newMatches = 0;
        const matchEmbeds = [];

        for (const fixture of fixtures.matches) {
          const matchId = fixture.id.toString();
          const kickoffTime = new Date(fixture.utcDate);
          
          // Check if match already exists (multi-server support)
          const existingMatch = footballMatchesData[matchId];
          
          // Check if this match already has an embed for this guild
          const hasEmbedForGuild = existingMatch && 
            existingMatch.embeds && 
            existingMatch.embeds[guildId] && 
            existingMatch.embeds[guildId].messageId;
          
          if (hasEmbedForGuild) {
            // Match already exists and has embed for this guild - skip to avoid duplication
            console.log(`[FOOTBALL] Match ${matchId} already exists with embed for guild ${guildId}, skipping`);
            skippedMatches++;
            continue;
          }
          
          if (existingMatch) {
            // Match exists but no embed for this guild - add this guild to the existing match
            console.log(`[FOOTBALL] Match ${matchId} already exists, adding guild ${guildId} to existing match`);
            
            // Add guild to guildIds if not already present
            if (!existingMatch.guildIds.includes(guildId)) {
              existingMatch.guildIds.push(guildId);
            }
            
            // Initialize embeds for this guild if not exists
            if (!existingMatch.embeds) {
              existingMatch.embeds = {};
            }
            // Don't clear existing embed data - only initialize if it doesn't exist
            if (!existingMatch.embeds[guildId]) {
              existingMatch.embeds[guildId] = {};
            }
            
            // Initialize requiredAmountWeiPerGuild if not exists (migration from old format)
            if (!existingMatch.requiredAmountWeiPerGuild) {
              existingMatch.requiredAmountWeiPerGuild = {};
              // Migrate existing global requiredAmountWei to per-guild format
              if (existingMatch.requiredAmountWei) {
                for (const existingGuildId of existingMatch.guildIds) {
                  existingMatch.requiredAmountWeiPerGuild[existingGuildId] = existingMatch.requiredAmountWei;
                }
              }
            }
            
            // Store guild-specific stake (preserve other guilds' stakes)
            existingMatch.requiredAmountWeiPerGuild[guildId] = requiredAmountWei;
            
            // Update token info if different (use the latest)
            existingMatch.token = { 
              ticker: tokenTicker, 
              identifier: tokenIdentifier, 
              decimals: decimals 
            };
            
            // Keep old requiredAmountWei for backward compatibility, but use it only if no per-guild data exists
            // Don't overwrite it, as it might be from another guild
            
            console.log(`[FOOTBALL] Updated existing match ${matchId} for guild ${guildId}. Total guilds: ${existingMatch.guildIds.length}`);
          } else {
            // New match - create fresh match data
          const matchData = {
            matchId: matchId,
            compCode: competition,
            compName: fixtures.competition?.name || competition,
            home: fixture.homeTeam.name,
            away: fixture.awayTeam.name,
            kickoffISO: kickoffTime.toISOString(),
            token: { 
              ticker: tokenTicker, 
              identifier: tokenIdentifier, 
              decimals: decimals 
            },
            requiredAmountWeiPerGuild: {
              [guildId]: requiredAmountWei
            },
            requiredAmountWei: requiredAmountWei, // Keep for backward compatibility
            status: 'SCHEDULED',
              ftScore: { home: 0, away: 0 },
              guildIds: [guildId],
              embeds: {}
            };

            // Save new match
            footballMatchesData[matchId] = matchData;
            console.log(`[FOOTBALL] Created new match ${matchId} for guild ${guildId}`);
            newMatches++;
          }

          // Create match embed (only if we got here, meaning no duplicate embed exists)
          const matchEmbed = new EmbedBuilder()
            .setTitle(`⚽ ${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`)
            .setDescription(`**${fixtures.competition?.name || competition}** • Game ID: \`${matchId}\``)
            .addFields([
              { name: '🏆 Competition', value: fixtures.competition?.name || competition, inline: true },
              { name: '🎮 Game ID', value: matchId, inline: true },
              { name: '💰 Stake', value: `${amount} ${tokenTicker}`, inline: true },
              { name: '🏆 Pot Size', value: `0 ${tokenTicker}`, inline: true },
              { name: '⏰ Kickoff', value: `<t:${Math.floor(kickoffTime.getTime() / 1000)}:f>\n(<t:${Math.floor(kickoffTime.getTime() / 1000)}:R>)`, inline: false }
            ])
            .setColor('#00FF00')
            .setFooter({ text: 'Click Bet below to place your bet!', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          // Add QR code as thumbnail if available
          const communityFundQR = serverData[guildId]?.communityFundQR?.[fundProject];
          if (communityFundQR) {
            matchEmbed.setThumbnail(communityFundQR);
          }

          // Create Bet button
          const betButton = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`bet:${matchId}`)
                .setLabel('Bet')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⚽')
            );

          // Post match embed
          const matchMessage = await channel.send({ embeds: [matchEmbed], components: [betButton] });
          
          // Create thread
          try {
            const thread = await matchMessage.startThread({
              name: `Match: ${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`,
              autoArchiveDuration: 60
            });

            // Update match data with message and thread IDs
            footballMatchesData[matchId].embeds[guildId] = {
              messageId: matchMessage.id,
              threadId: thread.id
            };
            
            console.log(`[FOOTBALL] Created thread ${thread.id} for match ${matchId}`);
            
            // Add 1 second delay between thread creations to avoid Discord API rate limits
            if (createdMatches < fixtures.matches.length - skippedMatches - 1) {
              console.log(`[FOOTBALL] Waiting 1 second before creating next thread...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } catch (threadError) {
            console.error(`[FOOTBALL] Error creating thread for match ${matchId}:`, threadError.message);
            // Continue with other matches even if thread creation fails
          }
          
          createdMatches++;
        }

        // Save all matches
        saveFootballMatchesData();

        let resultMessage = `✅ **Football fixtures created successfully!**\n\n**Competition:** ${competition}\n**Matches Created:** ${createdMatches}\n**Channel:** ${channel}\n**Stake:** ${amount} ${tokenTicker}`;
        
        if (skippedMatches > 0) {
          resultMessage += `\n\n⚠️ **Skipped ${skippedMatches} match(es) that were already created for this server.**`;
        }
        
        if (newMatches > 0 && skippedMatches > 0) {
          resultMessage += `\n**New matches:** ${newMatches} | **Already existed:** ${skippedMatches}`;
        }
        
        resultMessage += `\n\nAll matches have been posted with betting enabled. Users can click the "Bet" button to place their bets!`;

        await interaction.editReply({ 
          content: resultMessage, 
          flags: [MessageFlags.Ephemeral] 
        });

      } catch (error) {
        console.error('[FOOTBALL] Error creating fixtures:', error.message);
        console.error('[FOOTBALL] Full error details:', error);
        await interaction.editReply({ 
          content: `❌ **Error creating football fixtures:**\n\n${error.message}\n\nPlease check:\n• Competition code is correct\n• Football API token is valid\n• Bot has proper permissions`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('[FOOTBALL] Error in create-fixtures command:', error.message);
      console.error('[FOOTBALL] Full error details:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'bet-virtual') {
    try {
      const matchId = interaction.options.getString('match-id');
      const outcome = interaction.options.getString('outcome').toUpperCase();
      const guildId = interaction.guildId;

      // Validate outcome
      if (!['H', 'A', 'D'].includes(outcome)) {
        await interaction.reply({ content: '❌ Invalid outcome. Please use H (Home), A (Away), or D (Draw).', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if match still exists and is accepting bets
      const match = footballMatchesData[matchId];
      if (!match || !match.guildIds.includes(guildId)) {
        await interaction.reply({ content: '❌ Match not found or no longer available for betting.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      if (match.status !== 'SCHEDULED' && match.status !== 'TIMED') {
        await interaction.reply({ content: '❌ This match is no longer accepting bets.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const kickoffTime = new Date(match.kickoffISO);
      if (Date.now() >= kickoffTime.getTime()) {
        await interaction.reply({ content: '❌ Betting has closed for this match. Kickoff time has passed.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if user has sufficient virtual balance
      const requiredAmountWei = getMatchStakeForGuild(match, guildId);
      const requiredAmount = new BigNumber(requiredAmountWei).dividedBy(new BigNumber(10).pow(match.token.decimals)).toString();
      const currentBalance = virtualAccounts.getUserBalance(guildId, interaction.user.id, match.token.ticker);
      
      if (new BigNumber(currentBalance).isLessThan(requiredAmount)) {
        await interaction.reply({ 
          content: `❌ **Insufficient virtual balance!**\n\nYou have: **${currentBalance}** ${match.token.ticker}\nRequired: **${requiredAmount}** ${match.token.ticker}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      await interaction.editReply({ content: '💸 Processing your virtual bet...', flags: [MessageFlags.Ephemeral] });
      
      // Deduct funds from virtual account
      const deductionResult = virtualAccounts.deductFundsFromAccount(
        guildId, 
        interaction.user.id, 
        match.token.ticker, 
        requiredAmount, 
        `Football bet: ${match.home} vs ${match.away} (${outcome})`
      );
      
      if (!deductionResult.success) {
        await interaction.editReply({ 
          content: `❌ **Failed to deduct funds!** ${deductionResult.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Create bet
      const betId = generateBetId(matchId, interaction.user.id);
      const betAmountWei = getMatchStakeForGuild(match, guildId);
      const betData = {
        betId: betId,
        matchId: matchId,
        userId: interaction.user.id,
        outcome: outcome,
        token: match.token,
        amountWei: betAmountWei,
        txHash: null, // No blockchain transaction needed
        createdAtISO: new Date().toISOString(),
        status: 'ACCEPTED',
        virtualBet: true // Mark as virtual bet
      };

      // Save bet
      initializeFootballData(guildId);
      footballBetsData[guildId][betId] = betData;
      saveFootballBetsData();

      // Track bet amount for PNL calculation
      trackBetAmount(guildId, interaction.user.id, betAmountWei, match.token.ticker);

      // Update the main match embed with new pot size
      try {
        console.log(`[FOOTBALL] Updating pot size for match ${matchId} in guild ${guildId} (bet-virtual command)`);
        const channel = interaction.channel;
        const matchMessage = await channel.messages.fetch(match.embeds[guildId].messageId);
        if (matchMessage && matchMessage.embeds && matchMessage.embeds.length > 0) {
          // Calculate current pot size using utility function
          const potSize = calculateMatchPotSize(guildId, matchId);
          console.log(`[FOOTBALL] Calculated pot size: ${potSize.totalPotHuman} ${match.token.ticker} (bet-virtual command)`);
          
          // Update the embed - handle both fetched message embeds and EmbedBuilder
          let updatedEmbed;
          if (matchMessage.embeds[0].data) {
            // This is already an EmbedBuilder
            updatedEmbed = matchMessage.embeds[0];
          } else {
            // This is a fetched message embed, convert to EmbedBuilder
            updatedEmbed = EmbedBuilder.from(matchMessage.embeds[0]);
          }
          
          // Check if fields exist and find the pot size field
          if (updatedEmbed.data && updatedEmbed.data.fields && Array.isArray(updatedEmbed.data.fields)) {
            const potSizeField = updatedEmbed.data.fields.find(field => field.name === '🏆 Pot Size');
            if (potSizeField) {
              potSizeField.value = `${potSize.totalPotHuman} ${match.token.ticker}`;
              
              await matchMessage.edit({ embeds: [updatedEmbed] });
              console.log(`[FOOTBALL] Updated match embed pot size to ${potSize.totalPotHuman} ${match.token.ticker} for match ${matchId} (bet-virtual command)`);
            } else {
              console.log(`[FOOTBALL] Pot size field not found in embed for match ${matchId}. Available fields:`, updatedEmbed.data.fields.map(f => f.name));
            }
          } else {
            console.log(`[FOOTBALL] Embed fields not accessible for match ${matchId}. Fields type:`, typeof updatedEmbed.data?.fields);
          }
        } else {
          console.log(`[FOOTBALL] Match message or embed not found for match ${matchId}. Message:`, !!matchMessage, 'Embeds:', matchMessage?.embeds?.length);
        }
      } catch (updateError) {
        console.error('[FOOTBALL] Error updating match embed pot size:', updateError.message);
        console.error('[FOOTBALL] Full error details:', updateError);
      }

      // Post confirmation in match thread
      if (match.embeds[guildId].threadId) {
        try {
          const thread = await interaction.guild.channels.fetch(match.embeds[guildId].threadId);
          if (thread) {
            const confirmationEmbed = new EmbedBuilder()
              .setTitle('✓ Virtual Bet Accepted!')
              .setDescription(`${interaction.user} placed a virtual bet on **${match.home} vs ${match.away}**`)
              .addFields([
                { name: 'Outcome', value: outcome === 'H' ? 'Home Win' : outcome === 'A' ? 'Away Win' : 'Draw', inline: true },
                { name: 'Amount', value: `${requiredAmount} ${match.token.ticker}`, inline: true },
                { name: 'Type', value: 'Virtual Balance', inline: true }
              ])
              .setColor('#00FF00')
              .setTimestamp();
            
            await thread.send({ embeds: [confirmationEmbed] });
          }
        } catch (threadError) {
          console.error('[FOOTBALL] Error posting confirmation in thread:', threadError.message);
        }
      }

      await interaction.editReply({ 
        content: `✅ **Virtual bet placed successfully!**\n\n**Match:** ${match.home} vs ${match.away}\n**Outcome:** ${outcome === 'H' ? 'Home Win' : outcome === 'A' ? 'Away Win' : 'Draw'}\n**Amount:** ${requiredAmount} ${match.token.ticker}\n\nGood luck! 🍀`, 
        flags: [MessageFlags.Ephemeral] 
      });

    } catch (error) {
      console.error('[FOOTBALL] Error in bet-virtual command:', error.message);
      console.error('[FOOTBALL] Full error details:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `❌ Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `❌ Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'current-bets') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      
      if (!isPublic) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.deferReply();
      }

      // Initialize football data for this guild
      initializeFootballData(guildId);

      const guildBets = footballBetsData[guildId] || {};

      // Get matches for this guild from flat structure
      const guildMatches = Object.values(footballMatchesData).filter(match => 
        match.guildIds.includes(guildId)
      );

      if (guildMatches.length === 0) {
        await interaction.editReply({ 
          content: '❌ **No football matches found for this server!**\n\nUse `/create-fixtures` to create new matches first.', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Get current matches and their bets
      const currentMatches = Object.values(guildMatches).filter(match => match.status === 'SCHEDULED' || match.status === 'TIMED');
      
      if (currentMatches.length === 0) {
        await interaction.editReply({ 
          content: '❌ **No active football matches found!**\n\nAll matches have either finished or been cancelled.', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('⚽ Current Football Bets')
        .setDescription(`**${currentMatches.length}** active matches found`)
        .setColor('#00FF00')
        .setTimestamp();

      for (const match of currentMatches) {
        const matchBets = Object.values(guildBets).filter(bet => bet.matchId === match.matchId);
        const potSize = calculateMatchPotSize(guildId, match.matchId);
        
        const kickoffTime = new Date(match.kickoffISO);
        const timeUntilKickoff = kickoffTime.getTime() - Date.now();
        
        let statusText = '🟢 Active';
        if (timeUntilKickoff < 0) {
          statusText = '🔴 Past Kickoff';
        } else if (timeUntilKickoff < 300000) { // 5 minutes
          statusText = '🟡 Starting Soon';
        }

        embed.addFields({
          name: `${match.home} vs ${match.away}`,
          value: `**Game ID:** \`${match.matchId}\`\n**Status:** ${statusText}\n**Pot Size:** ${potSize.totalPotHuman} ${match.token.ticker}\n**Bets:** ${matchBets.length}\n**Kickoff:** <t:${Math.floor(kickoffTime.getTime() / 1000)}:R>`,
          inline: true
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[FOOTBALL] Error in current-bets command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'get-competition') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      const lastCompetition = serverData[guildId]?.lastCompetition;
      
      if (!lastCompetition) {
        await interaction.editReply({ 
          content: '❌ **No competition has been used yet!**\n\nUse `/create-fixtures` to create your first football fixtures.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

              const embed = new EmbedBuilder()
          .setTitle('🏆 Last Competition Used')
          .setDescription(`**Competition Code:** \`${lastCompetition}\``)
          .setColor('#00FF00')
          .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[FOOTBALL] Error in get-competition command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'help') {
    try {
      await interaction.deferReply();

      const embed = new EmbedBuilder()
        .setTitle('📚 Bot Commands Library')
        .setDescription('All available commands organized by category')
        .setColor('#4d55dc')
        .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();

      // Define command categories
      const categories = {
        '👛 Virtual Accounts': [
          '`/check-balance` - View your virtual account balance',
          '`/balance-history` - View your transaction history',
          '`/tip-virtual` - Tip another user with virtual balance',
          '`/withdraw` - Withdraw funds to your wallet'
        ],
        '⚽ Football Betting': [
          '`/create-fixtures` 🔴 Admin - Create football matches for betting',
          '`/bet-virtual` - Place a bet on a football match',
          '`/current-bets` - View active betting matches',
          '`/leaderboard` - View betting leaderboard',
          '`/leaderboard-filtered` - View leaderboard for date range',
          '`/my-stats` - View your betting statistics & PNL',
          '`/leaderboard-reset` 🔴 Admin - Reset the leaderboard'
        ],
        '🎮 Rock Paper Scissors': [
          '`/challenge-rps` - Challenge someone to RPS',
          '`/join-rps` - Join an RPS challenge',
          '`/play-rps` - Play your move',
          '`/list-rps-challenges` - List active challenges'
        ],
        '💼 Wallet & Project Management': [
          '`/set-wallet` - Register your MultiversX wallet',
          '`/register-project` 🔴 Admin - Register a new project',
          '`/update-project` 🔴 Admin - Update project settings',
          '`/list-projects` 🔴 Admin - View all projects',
          '`/delete-project` 🔴 Admin - Delete a project',
          '`/set-community-fund` 🔴 Admin - Set community fund project'
        ],
        '💰 Token Transfers': [
          '`/send-esdt` 🔴 Admin - Send tokens to a user',
          '`/house-tip` 🔴 Admin - Tip from house balance',
          '`/list-wallets` 🔴 Admin - List registered wallets',
          '`/show-community-fund-address` - View community fund address'
        ],
        '🔧 Utilities & Debug': [
          '`/update-token-metadata` 🔴 Admin - Update token info',
          '`/blockchain-status` 🔴 Admin - Check blockchain listener',
          '`/server-balances` 🔴 Admin - View server balances',
          '`/house-balance` 🔴 Admin - View house balance (no-winner matches)',
          '`/update-usernames` 🔴 Admin - Update Discord usernames',
          '`/get-competition` - View last used competition',
          '`/test-football-api` 🔴 Admin - Test API connectivity',
          '`/force-close-games` 🔴 Admin - Fix stuck games',
          '`/debug-server-config` 🔴 Admin - Debug server config',
          '`/debug-user` 🔴 Admin - Debug user info'
        ]
      };

      // Add each category as a field
      for (const [category, commands] of Object.entries(categories)) {
        let commandsText = commands.map(cmd => cmd.replace('🔴 Admin', '**🔴 Admin Only**')).join('\n');
        embed.addFields({
          name: category,
          value: commandsText,
          inline: false
        });
      }

      // Add help note
      embed.addFields({
        name: 'ℹ️ How to Use',
        value: 'Type `/` in Discord to see all commands. Commands marked **🔴 Admin Only** require administrator permissions. Most commands support both private and public responses.',
        inline: false
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[HELP] Error in help command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}` });
      } else {
        await interaction.reply({ content: `Error: ${error.message}` });
      }
    }
  } else if (commandName === 'test-football-api') {
    try {
      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      // Test API connectivity
      try {
        const testCompetition = 'PL'; // Premier League as test
        const response = await fetch(`https://api.football-data.org/v4/competitions/${testCompetition}`, {
          headers: {
            'X-Auth-Token': FD_TOKEN
          }
        });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        const embed = new EmbedBuilder()
          .setTitle('🔌 Football API Test Results')
          .setDescription('✅ **API Connection Successful!**')
          .addFields(
            { name: 'Status', value: '🟢 Connected', inline: true },
            { name: 'Response Time', value: '✅ Normal', inline: true },
            { name: 'Test Competition', value: data.name || 'Premier League', inline: true },
            { name: 'API Token', value: FD_TOKEN ? '✅ Valid' : '❌ Missing', inline: true }
          )
          .setColor('#00FF00')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (apiError) {
        const embed = new EmbedBuilder()
          .setTitle('🔌 Football API Test Results')
          .setDescription('❌ **API Connection Failed!**')
          .addFields(
            { name: 'Error', value: apiError.message, inline: false },
            { name: 'API Token', value: FD_TOKEN ? '✅ Present' : '❌ Missing', inline: true },
            { name: 'Token Length', value: FD_TOKEN ? `${FD_TOKEN.length} characters` : 'N/A', inline: true }
          )
          .setColor('#FF0000')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[FOOTBALL] Error in test-football-api command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'leaderboard') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      
      if (!isPublic) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.deferReply();
      }

      // Initialize football data for this guild
      initializeFootballData(guildId);

      const guildLeaderboard = footballLeaderboardData[guildId] || {};
      
      if (Object.keys(guildLeaderboard).length === 0) {
        await interaction.editReply({ 
          content: '❌ **No leaderboard data found!**\n\nNo one has won any matches yet. Start betting to see the leaderboard!', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Sort users by points (descending), then by wins (descending), then by total earnings (descending)
      const sortedUsers = Object.entries(guildLeaderboard)
        .filter(([userId]) => userId !== 'HOUSE') // Exclude HOUSE from user leaderboard
        .map(([userId, data]) => ({
          userId,
          ...data
        }))
        .sort((a, b) => {
          // First sort by points
          if (b.points !== a.points) {
            return b.points - a.points;
          }
          // Then by wins
          if (b.wins !== a.wins) {
            return b.wins - a.wins;
          }
          // Then by total earnings
          return new BigNumber(b.totalEarningsWei || 0).minus(new BigNumber(a.totalEarningsWei || 0)).toNumber();
        })
        .slice(0, 10); // Top 10 players

      const embed = new EmbedBuilder()
        .setTitle('🏆 Football Betting Leaderboard')
        .setDescription(`**Top ${sortedUsers.length} players** based on points, wins, and earnings`)
        .setColor('#FFD700')
        .setTimestamp();

      for (let i = 0; i < sortedUsers.length; i++) {
        const user = sortedUsers[i];
        const userMember = await interaction.guild.members.fetch(user.userId).catch(() => null);
        const username = userMember ? userMember.user.username : `User ${user.userId}`;
        
        // Calculate total earnings in human-readable format using stored token metadata
        let totalEarningsHuman = '0.00';
        if (user.tokenEarnings && Object.keys(user.tokenEarnings).length > 0) {
          // New format: show earnings per token with stored decimals only
          const tokenEarningsList = [];
          for (const [tokenTicker, earningsWei] of Object.entries(user.tokenEarnings)) {
            // Get stored decimals for this token - NO FALLBACKS
            const storedDecimals = getStoredTokenDecimals(interaction.guildId, tokenTicker);
            if (storedDecimals !== null) {
              const earningsHuman = new BigNumber(earningsWei || 0).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
              if (parseFloat(earningsHuman) > 0) {
                tokenEarningsList.push(`${earningsHuman} ${tokenTicker}`);
              }
            } else {
              // Token metadata not found - show error
              tokenEarningsList.push(`❌ ${tokenTicker} (metadata missing)`);
            }
          }
          totalEarningsHuman = tokenEarningsList.length > 0 ? tokenEarningsList.join(', ') : '0.00 tokens';
        } else {
          // Old format: try to use stored metadata for REWARD-cf6eac
          const storedDecimals = getStoredTokenDecimals(interaction.guildId, 'REWARD-cf6eac');
          if (storedDecimals !== null) {
            totalEarningsHuman = new BigNumber(user.totalEarningsWei || 0).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          } else {
            // No metadata available - show error
            totalEarningsHuman = '❌ Token metadata missing - run /update-token-metadata';
          }
        }
        
        // Get emoji for position
        let positionEmoji = '🥉';
        if (i === 0) positionEmoji = '🥇';
        else if (i === 1) positionEmoji = '🥈';
        else if (i === 2) positionEmoji = '🥉';
        else positionEmoji = `${i + 1}.`;
        
        embed.addFields({
          name: `${positionEmoji} ${username}`,
          value: `**Points:** ${user.points || 0} | **Wins:** ${user.wins || 0} | **Total Earnings:** ${totalEarningsHuman}`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[FOOTBALL] Error in leaderboard command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'my-stats') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });

      // Initialize football data for this guild
      initializeFootballData(guildId);

      const guildLeaderboard = footballLeaderboardData[guildId] || {};
      const userData = guildLeaderboard[interaction.user.id];

      if (!userData) {
        await interaction.editReply({ 
          content: '❌ **No betting data found!**\n\nYou haven\'t placed any bets yet. Start betting to see your statistics!', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📊 Your Football Betting Statistics')
        .setColor('#00FF00')
        .setTimestamp();

      // Display overall stats
      const userMember = interaction.member;
      const username = userMember.user.username;
      
      embed.setDescription(`**${username}'s** Football Betting Statistics`);

      // Calculate win rate based on finished matches only
      const userBets = Object.values(footballBetsData[guildId] || {}).filter(bet => bet.userId === interaction.user.id);
      const userMatchIds = [...new Set(userBets.map(bet => bet.matchId))];
      
      // Count finished matches - check multiple indicators:
      // 1. Matches still in footballMatchesData with status FINISHED
      const finishedMatchesByStatus = userMatchIds.filter(matchId => {
        const match = footballMatchesData[matchId];
        return match && match.status === 'FINISHED';
      }).length;
      
      // 2. Count unique match IDs where at least one bet from that match has a prize
      // (This indicates the match finished and prizes were distributed, even if match was cleaned up)
      const matchesWithPrizes = new Set();
      userBets.forEach(bet => {
        if (bet.prizeSent === true || bet.prizeAmount !== undefined) {
          matchesWithPrizes.add(bet.matchId);
        }
      });
      
      // 3. For matches with prizes, also check if other users' bets from same match have prizes
      // This helps identify finished matches even if this user lost
      const allBetsForMatches = Object.values(footballBetsData[guildId] || {});
      userMatchIds.forEach(matchId => {
        const matchBets = allBetsForMatches.filter(bet => bet.matchId === matchId);
        // If any bet from this match has a prize, the match finished
        if (matchBets.some(bet => bet.prizeSent === true || bet.prizeAmount !== undefined)) {
          matchesWithPrizes.add(matchId);
        }
      });
      
      const finishedMatchesByPrizes = matchesWithPrizes.size;
      
      // Use the higher count (covers both cases: matches still in data and cleaned up matches)
      // Also ensure we count at least as many matches as wins (since wins = finished matches where user won)
      const finishedMatches = Math.max(
        finishedMatchesByStatus,
        finishedMatchesByPrizes,
        userData.wins || 0 // At minimum, if they have wins, they played in that many finished matches
      );
      
      // Calculate win rate: wins / finished matches * 100
      const winRate = finishedMatches > 0 
        ? ((userData.wins || 0) / finishedMatches * 100).toFixed(1)
        : '0.0';
      
      // Points and Wins
      embed.addFields({
        name: '📈 Performance',
        value: `**Points:** ${userData.points || 0}\n**Wins:** ${userData.wins || 0}\n**Win Rate:** ${winRate}%${finishedMatches > 0 ? ` (${userData.wins || 0}/${finishedMatches} finished)` : ' (no finished matches yet)'}`,
        inline: true
      });

      // Calculate total bets and PNL
      const totalBetsWei = new BigNumber(userData.totalBetsWei || '0');
      const totalEarningsWei = new BigNumber(userData.totalEarningsWei || '0');
      const pnlWei = totalEarningsWei.minus(totalBetsWei);

      // Get all tokens with metadata
      const allTokens = new Set();
      if (userData.tokenEarnings) {
        Object.keys(userData.tokenEarnings).forEach(token => allTokens.add(token));
      }
      if (userData.tokenBets) {
        Object.keys(userData.tokenBets).forEach(token => allTokens.add(token));
      }

      // Display token-specific stats
      const tokenStats = [];
      for (const tokenTicker of allTokens) {
        const tokenBets = new BigNumber(userData.tokenBets?.[tokenTicker] || '0');
        const tokenEarnings = new BigNumber(userData.tokenEarnings?.[tokenTicker] || '0');
        const tokenPNL = tokenEarnings.minus(tokenBets);

        const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
        
        if (storedDecimals !== null) {
          const betsHuman = new BigNumber(tokenBets).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const earningsHuman = new BigNumber(tokenEarnings).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const pnlHuman = new BigNumber(tokenPNL).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const pnlSign = tokenPNL.isGreaterThan(0) ? '+' : '';
          const pnlEmoji = tokenPNL.isGreaterThanOrEqualTo(0) ? '🟢' : '🔴';

          tokenStats.push({
            token: tokenTicker,
            bets: betsHuman,
            earnings: earningsHuman,
            pnl: pnlHuman,
            pnlSign: pnlSign,
            pnlEmoji: pnlEmoji
          });
        }
      }

      if (tokenStats.length > 0) {
        let tokenStatsText = '';
        for (const stat of tokenStats) {
          tokenStatsText += `**${stat.token}:**\n`;
          tokenStatsText += `  Bet: ${stat.bets}\n`;
          tokenStatsText += `  Won: ${stat.earnings}\n`;
          tokenStatsText += `  PNL: ${stat.pnlEmoji} ${stat.pnlSign}${stat.pnl}\n\n`;
        }

        embed.addFields({
          name: '💰 Profit & Loss (PNL)',
          value: tokenStatsText || 'No data',
          inline: false
        });
      }

      // Last win
      if (userData.lastWinISO) {
        const lastWinDate = new Date(userData.lastWinISO);
        embed.addFields({
          name: '🎯 Last Win',
          value: `<t:${Math.floor(lastWinDate.getTime() / 1000)}:R>`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
    } catch (error) {
      console.error('[FOOTBALL] Error in my-stats command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'house-balance') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });

      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ 
          content: '❌ **Admin Only!** This command is restricted to server administrators.', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Initialize football data for this guild
      initializeFootballData(guildId);

      const guildLeaderboard = footballLeaderboardData[guildId] || {};
      const houseData = guildLeaderboard['HOUSE'];

      if (!houseData) {
        await interaction.editReply({ 
          content: '💰 **House Balance: 0**\n\nNo bets have been collected by the house yet (no matches with no winners).', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🏛️ House Balance (No-Winner Prizes)')
        .setDescription('Total earnings from matches with no winners')
        .setColor('#8B5CF6')
        .setTimestamp();

      // Get all tokens with earnings
      const allTokens = new Set();
      if (houseData.tokenEarnings) {
        Object.keys(houseData.tokenEarnings).forEach(token => allTokens.add(token));
      }

      // Display token-specific house balance (earnings - spending)
      if (allTokens.size > 0) {
        for (const tokenTicker of allTokens) {
          const tokenEarnings = new BigNumber(houseData.tokenEarnings?.[tokenTicker] || '0');
          const tokenSpending = new BigNumber(houseData.tokenBets?.[tokenTicker] || '0');
          const netBalance = tokenEarnings.minus(tokenSpending);
          const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
          
          if (storedDecimals !== null) {
            const earningsHuman = new BigNumber(tokenEarnings).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const spendingHuman = new BigNumber(tokenSpending).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const balanceHuman = new BigNumber(netBalance).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            
            let statusEmoji = '🟢';
            if (netBalance.isLessThan(0)) statusEmoji = '🔴';
            else if (netBalance.isEqualTo(0)) statusEmoji = '⚪';
            
            embed.addFields({
              name: `${statusEmoji} ${tokenTicker}`,
              value: `**Balance:** ${balanceHuman}\n*Earned: ${earningsHuman} | Spent: ${spendingHuman}*`,
              inline: true
            });
          }
        }
      }

      embed.addFields({
        name: 'ℹ️ How it Works',
        value: '**Balance = Earnings - Spending**\n\n• **Earnings**: From matches with no winners\n• **Spending**: When house pays prizes for competitions\n• **Balance**: Current available house funds',
        inline: false
      });
      
      // Show overall summary if we have multiple tokens
      if (allTokens.size > 1) {
        const totalEarnings = new BigNumber(houseData.totalEarningsWei || '0');
        const totalSpending = new BigNumber(houseData.totalBetsWei || '0');
        const totalBalance = totalEarnings.minus(totalSpending);
        
        embed.addFields({
          name: '📊 Overall Summary',
          value: `**Total Balance:** ${totalBalance.toFixed(2)}\n*Earned: ${totalEarnings.toFixed(2)} | Spent: ${totalSpending.toFixed(2)}*`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
    } catch (error) {
      console.error('[FOOTBALL] Error in house-balance command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'house-tip') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const targetUser = interaction.options.getUser('user');
      const tokenTicker = interaction.options.getString('token');
      const amount = interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || 'House prize';
      const guildId = interaction.guildId;

      if (amount <= 0) {
        await interaction.editReply({ content: 'Amount must be greater than 0.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if community fund is set
      const communityFundProject = serverData[guildId]?.communityFundProject;
      if (!communityFundProject) {
        await interaction.editReply({ content: 'No Community Fund is set for this server. Please set it with /set-community-fund.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projects = getProjects(guildId);
      if (!projects[communityFundProject]) {
        await interaction.editReply({ content: `The Community Fund project ("${communityFundProject}") no longer exists. Please update it.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Get user's wallet
      const userWallets = getUserWallets(guildId);
      const recipientWallet = userWallets[targetUser.id];
      
      if (!recipientWallet) {
        await interaction.editReply({ 
          content: `❌ User ${targetUser.tag} has not registered a wallet yet. They must run \`/set-wallet\` first.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Check house balance
      initializeFootballData(guildId);
      const guildLeaderboard = footballLeaderboardData[guildId] || {};
      const houseData = guildLeaderboard['HOUSE'];
      
      if (!houseData || !houseData.tokenPNL || !houseData.tokenPNL[tokenTicker]) {
        await interaction.editReply({ content: '❌ House has no balance for this token yet. No matches have had zero winners.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const houseBalance = new BigNumber(houseData.tokenPNL[tokenTicker] || '0');
      const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
      if (storedDecimals === null) {
        await interaction.editReply({ content: `❌ Token metadata missing for ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      const amountWei = toBlockchainAmount(amount, storedDecimals);
      
      // Check if house has enough balance
      if (houseBalance.isLessThan(amountWei)) {
        const currentBalance = houseBalance.dividedBy(new BigNumber(10).pow(storedDecimals)).toString();
        await interaction.editReply({ 
          content: `❌ **Insufficient house balance!**\n\nCurrent house balance: **${currentBalance}** ${tokenTicker}\nRequired: **${amount}** ${tokenTicker}\n\nHouse needs more no-winner matches to accumulate funds.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      await interaction.editReply({ content: '💸 Transferring tokens from house balance...', flags: [MessageFlags.Ephemeral] });

      // Transfer from community fund to user
      const transferResult = await transferESDTFromCommunityFund(
        recipientWallet,
        tokenTicker,
        amount,
        communityFundProject,
        guildId
      );

      if (transferResult.success) {
        // Track house spending
        trackHouseSpending(guildId, amountWei, tokenTicker, memo);
        
        // Add to recipient's virtual account as well
        virtualAccounts.addFundsToAccount(
          guildId,
          targetUser.id,
          tokenTicker,
          amount,
          transferResult.txHash,
          'house_tip',
          targetUser.tag
        );

        const embed = new EmbedBuilder()
          .setTitle('💰 House Tip Completed')
          .setDescription(`Sent **${amount} ${tokenTicker}** to ${targetUser.tag} from house balance`)
          .addFields([
            { name: 'Recipient', value: `<@${targetUser.id}>`, inline: true },
            { name: 'Amount', value: `${amount} ${tokenTicker}`, inline: true },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Transaction', value: `[\`${transferResult.txHash}\`](https://explorer.multiversx.com/transactions/${transferResult.txHash})`, inline: false },
            { name: 'From', value: '🏛️ House Balance', inline: true },
            { name: 'Sent By', value: `<@${interaction.user.id}>`, inline: true }
          ])
          .setColor('#8B5CF6')
          .setTimestamp();

        await interaction.editReply({ 
          content: `✅ **Success!** House tip sent to ${targetUser.tag}`, 
          embeds: [embed],
          flags: [MessageFlags.Ephemeral] 
        });
      } else {
        await interaction.editReply({ 
          content: `❌ Transfer failed: ${transferResult.errorMessage || 'Unknown error'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('[HOUSE-TIP] Error in house-tip command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'leaderboard-filtered') {
    try {
      const startDate = interaction.options.getString('start-date');
      const endDate = interaction.options.getString('end-date');
      const competition = interaction.options.getString('competition');
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      // Parse dates - support both YYYY-MM-DD and DD-MM-YYYY formats
      function parseDate(dateStr) {
        // Try US format first (YYYY-MM-DD)
        let date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.getTime();
        }
        
        // Try EU format (DD-MM-YYYY)
        const euPattern = /^(\d{2})-(\d{2})-(\d{4})$/;
        const match = dateStr.match(euPattern);
        if (match) {
          const [, day, month, year] = match;
          date = new Date(`${year}-${month}-${day}`);
          if (!isNaN(date.getTime())) {
            return date.getTime();
          }
        }
        
        return null;
      }
      
      const startTime = parseDate(startDate);
      const endTime = parseDate(endDate);
      
      if (startTime === null || endTime === null) {
        await interaction.editReply({ 
          content: '❌ **Invalid date format!** Please use YYYY-MM-DD (US) or DD-MM-YYYY (EU) format.\n\nExamples: `2025-01-15` or `15-01-2025`', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      if (startTime > endTime) {
        await interaction.editReply({ 
          content: '❌ **Invalid date range!** Start date must be before end date.', 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Initialize football data
      initializeFootballData(guildId);
      
      // Get all bets for this guild in the date range
      const guildBets = footballBetsData[guildId] || {};
      const guildMatches = footballMatchesData;
      
      // Filter bets by date range and competition
      const filteredBets = Object.values(guildBets).filter(bet => {
        const betTime = new Date(bet.createdAtISO).getTime();
        const inRange = betTime >= startTime && betTime <= endTime;
        
        if (!inRange) return false;
        
        // Filter by competition if specified
        if (competition) {
          const match = guildMatches[bet.matchId];
          if (!match || match.compCode !== competition) return false;
        }
        
        return true;
      });
      
      if (filteredBets.length === 0) {
        await interaction.editReply({ 
          content: `❌ **No bets found** for the specified date range${competition ? ` and competition ${competition}` : ''}.`, 
          flags: isPublic ? [] : [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Calculate stats for each user
      const userStats = {};
      
      for (const bet of filteredBets) {
        const match = guildMatches[bet.matchId];
        if (!match) continue;
        
        const userId = bet.userId;
        
        if (!userStats[userId]) {
          userStats[userId] = {
            userId: userId,
            points: 0,
            wins: 0,
            totalBets: 0,
            totalEarnings: 0,
            matches: 0,
            tokenStats: {}
          };
        }
        
        // Track bet amount
        const betAmountWei = new BigNumber(bet.amountWei || '0');
        const tokenTicker = match.token.ticker;
        
        if (!userStats[userId].tokenStats[tokenTicker]) {
          userStats[userId].tokenStats[tokenTicker] = {
            bets: 0,
            earnings: 0
          };
        }
        
        userStats[userId].totalBets += betAmountWei.toNumber();
        userStats[userId].matches += 1;
        userStats[userId].tokenStats[tokenTicker].bets += betAmountWei.toNumber();
        
        // Check if bet won
        if (bet.prizeSent && bet.prizeAmount) {
          const prizeAmountWei = toBlockchainAmount(bet.prizeAmount, match.token.decimals);
          userStats[userId].totalEarnings += new BigNumber(prizeAmountWei).toNumber();
          userStats[userId].tokenStats[tokenTicker].earnings += new BigNumber(prizeAmountWei).toNumber();
          userStats[userId].wins += 1;
          userStats[userId].points += 3;
        }
      }
      
      // Convert to array and sort
      const sortedUsers = Object.values(userStats).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.totalEarnings - a.totalEarnings;
      }).slice(0, 20); // Top 20
      
      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('🏆 Filtered Leaderboard')
        .setDescription(`**Top ${sortedUsers.length} players** from ${startDate} to ${endDate}${competition ? ` in ${competition}` : ''}`)
        .setColor('#FFD700')
        .setTimestamp();
      
      for (let i = 0; i < sortedUsers.length; i++) {
        const user = sortedUsers[i];
        const userMember = await interaction.guild.members.fetch(user.userId).catch(() => null);
        const username = userMember ? userMember.user.username : `User ${user.userId}`;
        
        // Calculate PNL (in human format for display)
        const pnlTokens = [];
        for (const [tokenTicker, stats] of Object.entries(user.tokenStats)) {
          const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
          if (storedDecimals !== null) {
            const tokenBetsHuman = new BigNumber(stats.bets).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const tokenEarningsHuman = new BigNumber(stats.earnings).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const tokenPNL = stats.earnings - stats.bets;
            const tokenPNLHuman = new BigNumber(tokenPNL).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const pnlEmoji = tokenPNL >= 0 ? '🟢' : '🔴';
            const pnlSign = tokenPNL >= 0 ? '+' : '';
            pnlTokens.push(`${pnlEmoji} ${tokenPNLHuman} ${tokenTicker}`);
          }
        }
        
        let positionEmoji = '🥉';
        if (i === 0) positionEmoji = '🥇';
        else if (i === 1) positionEmoji = '🥈';
        else if (i === 2) positionEmoji = '🥉';
        else positionEmoji = `${i + 1}.`;
        
        embed.addFields({
          name: `${positionEmoji} ${username}`,
          value: `**Points:** ${user.points} | **Wins:** ${user.wins} | **Bets:** ${user.matches}\n**PNL:** ${pnlTokens.join(', ') || 'N/A'}`,
          inline: false
        });
      }
      
      await interaction.editReply({ embeds: [embed], flags: isPublic ? [] : [MessageFlags.Ephemeral] });
    } catch (error) {
      console.error('[FOOTBALL] Error in leaderboard-filtered command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'leaderboard-reset') {
    try {
      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const confirmText = interaction.options.getString('confirm');
      
      if (confirmText !== 'RESET') {
        await interaction.reply({ 
          content: '❌ **Confirmation Required!**\n\nTo reset the leaderboard, type `/leaderboard-reset confirm:RESET`', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      // Reset leaderboard for this guild
      if (footballLeaderboardData[interaction.guildId]) {
        footballLeaderboardData[interaction.guildId] = {};
        saveLeaderboardData();
        console.log(`[FOOTBALL] Leaderboard reset for guild ${interaction.guildId}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('🔄 Leaderboard Reset')
        .setDescription('✅ **Football betting leaderboard has been reset successfully!**\n\nAll player points, wins, and earnings have been cleared. The leaderboard is now empty and ready for new data.')
        .setColor('#00FF00')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[FOOTBALL] Error in leaderboard-reset command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'update-token-metadata') {
    try {
      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      const guildId = interaction.guildId;
      
      // Get all supported tokens from all projects in this guild
      const allTokens = new Set();
      if (serverData[guildId] && serverData[guildId].projects) {
        for (const project of Object.values(serverData[guildId].projects)) {
          if (project.supportedTokens) {
            project.supportedTokens.forEach(token => allTokens.add(token));
          }
        }
      }

      if (allTokens.size === 0) {
        await interaction.editReply({ 
          content: '❌ **No supported tokens found!**\n\nPlease register a project with supported tokens first.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const tokenList = Array.from(allTokens);
      console.log(`[TOKEN] Updating metadata for ${tokenList.length} tokens: ${tokenList.join(', ')}`);

      let successCount = 0;
      let failCount = 0;
      const results = [];

      // Update metadata for each token with rate limiting
      for (let i = 0; i < tokenList.length; i++) {
        const tokenIdentifier = tokenList[i];
        try {
          // Rate limiting: wait 500ms between requests (2 requests/second max)
          if (i > 0) {
            console.log(`[TOKEN] Rate limiting: waiting 500ms before next request...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          const success = await updateTokenMetadata(guildId, tokenIdentifier);
          if (success) {
            successCount++;
            results.push(`✅ ${tokenIdentifier}`);
          } else {
            failCount++;
            results.push(`❌ ${tokenIdentifier}`);
          }
        } catch (error) {
          failCount++;
          results.push(`❌ ${tokenIdentifier} (${error.message})`);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('🔄 Token Metadata Update')
        .setDescription(`**Updated metadata for ${tokenList.length} tokens**\n\n**Results:**\n${results.join('\n')}`)
        .addFields(
          { name: '✅ Success', value: successCount.toString(), inline: true },
          { name: '❌ Failed', value: failCount.toString(), inline: true },
          { name: '📊 Total', value: tokenList.length.toString(), inline: true }
        )
        .setColor(successCount > 0 ? '#00FF00' : '#FF0000')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('[TOKEN] Error in update-token-metadata command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'check-balance') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      console.log(`[CHECK-BALANCE DEBUG] Guild ID: ${guildId}, User ID: ${userId}`);
      
      // Force reload virtual accounts data
      virtualAccounts.forceReloadData();
      
      // Update username for this user
      virtualAccounts.updateUserUsername(guildId, userId, interaction.user.tag);
      
      // Get user's virtual account balances
      const balances = virtualAccounts.getAllUserBalances(guildId, userId);
      
      console.log(`[CHECK-BALANCE DEBUG] Retrieved balances:`, balances);
      
      if (Object.keys(balances).length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('💰 Virtual Account Balance')
          .setDescription('You have no tokens in your virtual account yet.')
          .addFields([
            { name: '💡 How to get started', value: 'Make a transfer to any Community Fund wallet address to top up your virtual account!', inline: false },
            { name: '🔍 Debug Info', value: `Guild ID: ${guildId}\nUser ID: ${userId}`, inline: false }
          ])
          .setColor('#FF9900')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Virtual Account Balance')
        .setDescription(`Balance for ${interaction.user.tag}`)
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      for (const [token, balance] of Object.entries(balances)) {
        embed.addFields({
          name: `${token}`,
          value: `**${balance}** tokens`,
          inline: true
        });
      }
      
      // Add debug info
      embed.addFields({
        name: '🔍 Debug Info',
        value: `Guild ID: ${guildId}\nUser ID: ${userId}`,
        inline: false
      });
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in check-balance command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'balance-history') {
    try {
      const limit = Math.min(interaction.options.getInteger('limit') || 10, 50);
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Get user's transaction history
      const transactions = virtualAccounts.getUserTransactionHistory(guildId, userId, limit);
      
      if (transactions.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('📊 Transaction History')
          .setDescription('No transactions found for your account.')
          .setColor('#FF9900')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Transaction History')
        .setDescription(`Last ${transactions.length} transactions for ${interaction.user.tag}`)
        .setColor('#0099FF')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      for (const tx of transactions) {
        const emoji = tx.type === 'deposit' ? '💰' : tx.type === 'deduction' ? '💸' : '🔄';
        const timestamp = `<t:${Math.floor(tx.timestamp / 1000)}:R>`;
        
        embed.addFields({
          name: `${emoji} ${tx.description || tx.type}`,
          value: `**Amount:** ${tx.amount} ${tx.token}\n**Balance:** ${tx.balanceBefore} → ${tx.balanceAfter}\n**Time:** ${timestamp}`,
          inline: false
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in balance-history command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'blockchain-status') {
    try {
      // Check if user has admin permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ 
          content: '❌ **Admin Only!** This command is restricted to server administrators.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const status = blockchainListener.getListenerStatus();
      
      if (status.success) {
        const embed = new EmbedBuilder()
          .setTitle('🔗 Blockchain Listener Status')
          .setColor(status.isRunning ? '#00ff00' : '#ff0000')
          .addFields([
            { name: 'Status', value: status.isRunning ? '🟢 Running' : '🔴 Stopped', inline: true },
            { name: 'Polling Interval', value: `${status.pollingInterval / 1000}s`, inline: true },
            { name: 'Monitored Wallets', value: status.monitoredWallets.toString(), inline: true },
            { name: 'Processed Transactions', value: status.processedTransactions.toString(), inline: true },
            { name: 'Last Updated', value: new Date(status.timestamp).toLocaleString(), inline: false }
          ])
          .setFooter({ text: 'Blockchain monitoring status', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ 
          content: `❌ Error getting blockchain listener status: ${status.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('Error in blockchain-status command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: `❌ An error occurred while checking blockchain listener status: ${error.message}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      } else {
        await interaction.reply({ 
          content: `❌ An error occurred while checking blockchain listener status: ${error.message}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    }
  } else if (commandName === 'server-balances') {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      
      // Get server-wide virtual accounts summary
      const summary = virtualAccounts.getServerVirtualAccountsSummary(guildId);
      
      const embed = new EmbedBuilder()
        .setTitle('🏦 Server Virtual Accounts Summary')
        .setDescription(`Virtual accounts overview for ${interaction.guild.name}`)
        .addFields([
          { name: '👥 Total Users', value: summary.totalUsers.toString(), inline: true },
          { name: '💰 Active Users', value: summary.activeUsers.toString(), inline: true },
          { name: '📊 Total Balances', value: Object.keys(summary.totalBalances).length.toString(), inline: true }
        ])
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Add token balances
      for (const [token, total] of Object.entries(summary.totalBalances)) {
        embed.addFields({
          name: `${token} Total`,
          value: `**${total}** tokens`,
          inline: true
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in server-balances command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'update-usernames') {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      
      // Get all members in the guild
      const members = await interaction.guild.members.fetch();
      const userMap = {};
      
      members.forEach(member => {
        userMap[member.id] = member.user.tag;
      });
      
      // Update usernames in virtual accounts
      const result = virtualAccounts.updateAllUsernamesInGuild(guildId, userMap);
      
      if (result.success) {
        const embed = new EmbedBuilder()
          .setColor('#4ecdc4')
          .setTitle('✅ Username Update Complete')
          .setDescription(`Successfully updated **${result.updated}** usernames in virtual accounts.`)
          .setFooter({ text: 'Usernames are now linked to Discord user IDs for easier debugging.' });
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ 
          content: `❌ **Error updating usernames:** ${result.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('Error in update-usernames command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'withdraw') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const tokenTicker = interaction.options.getString('token-ticker');
      const amountStr = interaction.options.getString('amount');
      const memo = interaction.options.getString('memo') || 'Withdrawal from virtual account';
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Force reload virtual accounts data
      virtualAccounts.forceReloadData();
      
      // Update username for this user
      virtualAccounts.updateUserUsername(guildId, userId, interaction.user.tag);
      
      // Check if user has any balance for the selected token
      const currentBalance = virtualAccounts.getUserBalance(guildId, userId, tokenTicker);
      
      if (new BigNumber(currentBalance).isLessThanOrEqualTo(0)) {
        await interaction.editReply({ 
          content: `❌ **No balance available!**\n\nYou have **0** ${tokenTicker} in your virtual account.\n\nDeposit funds to a Community Fund wallet to add tokens to your virtual account.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Parse amount - handle "MAX" or "ALL" options
      let withdrawAmount;
      if (amountStr.toUpperCase() === 'MAX' || amountStr.toUpperCase() === 'ALL') {
        withdrawAmount = currentBalance;
      } else {
        withdrawAmount = parseFloat(amountStr);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
          await interaction.editReply({ 
            content: `❌ **Invalid amount!**\n\nPlease provide a valid number or use "MAX"/"ALL" to withdraw your entire balance.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }
      
      // Check if user has sufficient balance
      if (new BigNumber(withdrawAmount).isGreaterThan(currentBalance)) {
        await interaction.editReply({ 
          content: `❌ **Insufficient balance!**\n\nYou have: **${currentBalance}** ${tokenTicker}\nRequested: **${withdrawAmount}** ${tokenTicker}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get user's wallet address
      const userWallets = getUserWallets(guildId);
      const userWallet = userWallets[userId];
      
      if (!userWallet) {
        await interaction.editReply({ 
          content: `❌ **No wallet registered!**\n\nPlease register your wallet address using \`/set-wallet\` before withdrawing funds.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      if (!userWallet.startsWith('erd1') || userWallet.length !== 62) {
        await interaction.editReply({ 
          content: `❌ **Invalid wallet address!**\n\nYour registered wallet address is invalid. Please update it using \`/set-wallet\`.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check if community fund is set
      const fundProject = serverData[guildId]?.communityFundProject;
      if (!fundProject) {
        await interaction.editReply({ 
          content: `❌ **No Community Fund configured!**\n\nPlease ask an admin to set up a Community Fund using \`/set-community-fund\`.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const projects = getProjects(guildId);
      if (!projects[fundProject]) {
        await interaction.editReply({ 
          content: `❌ **Community Fund not found!**\n\nThe Community Fund project "${fundProject}" no longer exists. Please ask an admin to reconfigure it.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      await interaction.editReply({ 
        content: `🔄 **Processing withdrawal...**\n\nWithdrawing **${withdrawAmount}** ${tokenTicker} to your wallet...\nMemo: ${memo}`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
      console.log(`User ${interaction.user.tag} (${userId}) is withdrawing ${withdrawAmount} ${tokenTicker} to wallet ${userWallet} using Community Fund (${fundProject})`);
      
      // Perform the blockchain transfer
      const transferResult = await transferESDTFromCommunityFund(userWallet, tokenTicker, withdrawAmount, fundProject, guildId);
      
      if (transferResult.success) {
        // Deduct funds from virtual account
        const deductResult = virtualAccounts.deductFundsFromAccount(guildId, userId, tokenTicker, withdrawAmount, 'withdrawal', memo);
        
        if (deductResult.success) {
          const explorerUrl = transferResult.txHash
            ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
            : null;
          const txHashFieldValue = transferResult.txHash
            ? `[${transferResult.txHash}](${explorerUrl})`
            : 'Not available';
          
          const successEmbed = new EmbedBuilder()
            .setTitle('💰 Withdrawal Successful!')
            .setDescription(`Successfully withdrew **${withdrawAmount}** ${tokenTicker} to your wallet`)
            .addFields([
              { name: 'Amount Withdrawn', value: `${withdrawAmount} ${tokenTicker}`, inline: true },
              { name: 'Remaining Balance', value: `${deductResult.newBalance} ${tokenTicker}`, inline: true },
              { name: 'Recipient Wallet', value: `\`${userWallet}\``, inline: false },
              { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
              { name: 'Memo', value: memo, inline: false },
              { name: 'Status', value: '✅ Success', inline: true }
            ])
            .setColor('#00FF00')
            .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          await interaction.editReply({ 
            content: `✅ **Withdrawal completed successfully!**`, 
            embeds: [successEmbed], 
            flags: [MessageFlags.Ephemeral] 
          });
          
          console.log(`Withdrawal successful: ${withdrawAmount} ${tokenTicker} sent to ${userWallet}, new balance: ${deductResult.newBalance}`);
        } else {
          await interaction.editReply({ 
            content: `❌ **Withdrawal failed!**\n\nBlockchain transaction succeeded but failed to update virtual account: ${deductResult.error}`, 
            flags: [MessageFlags.Ephemeral] 
          });
        }
      } else {
        await interaction.editReply({ 
          content: `❌ **Withdrawal failed!**\n\nBlockchain transaction failed: ${transferResult.errorMessage || 'Unknown error'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('Error in withdraw command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'tip-virtual') {
    try {
      await interaction.deferReply();
      
      const userTag = interaction.options.getString('user-tag');
      const tokenTicker = interaction.options.getString('token-ticker');
      const amount = interaction.options.getString('amount');
      const memo = interaction.options.getString('memo') || 'No memo provided';
      
      const guildId = interaction.guildId;
      const fromUserId = interaction.user.id;
      
      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        await interaction.editReply({ content: '❌ Invalid amount. Please provide a positive number.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Find target user
      let targetUserId = null;
      let targetUser = null;
      
      try {
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        
        const targetMember = members.find(member => 
          member.user.tag === userTag || 
          member.user.username === userTag ||
          (member.nickname && member.nickname === userTag)
        );
        
        if (targetMember) {
          targetUserId = targetMember.user.id;
          targetUser = targetMember.user;
        }
      } catch (fetchError) {
        console.error('Error fetching guild members:', fetchError.message);
      }
      
      if (!targetUserId) {
        await interaction.editReply({ content: `❌ User ${userTag} not found.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Prevent self-tipping
      if (targetUserId === fromUserId) {
        await interaction.editReply({ content: '❌ **Self-tipping is not allowed!**', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Force reload virtual accounts data
      virtualAccounts.forceReloadData();
      
      // Update usernames for both users
      virtualAccounts.updateUserUsername(guildId, fromUserId, interaction.user.tag);
      if (targetUserId) {
        virtualAccounts.updateUserUsername(guildId, targetUserId, targetUser ? targetUser.tag : userTag);
      }
      
      // Check if user has sufficient balance
      const currentBalance = virtualAccounts.getUserBalance(guildId, fromUserId, tokenTicker);
      console.log(`[TIP-VIRTUAL DEBUG] Guild ID: ${guildId}, User ID: ${fromUserId}, Token: ${tokenTicker}, Balance: ${currentBalance}, Required: ${amountNum}`);
      
      if (new BigNumber(currentBalance).isLessThan(amountNum)) {
        await interaction.editReply({ 
          content: `❌ **Insufficient balance!**\n\nYou have: **${currentBalance}** ${tokenTicker}\nRequired: **${amountNum}** ${tokenTicker}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Transfer funds between users
      const transferResult = virtualAccounts.transferFundsBetweenUsers(
        guildId, 
        fromUserId, 
        targetUserId, 
        tokenTicker, 
        amountNum.toString(), 
        memo
      );
      
      if (transferResult.success) {
        const embed = new EmbedBuilder()
          .setTitle('💸 Virtual Tip Sent!')
          .setDescription(`Successfully tipped **${amountNum} ${tokenTicker}** to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: '💰 Amount', value: `${amountNum} ${tokenTicker}`, inline: true },
            { name: '📝 Memo', value: memo, inline: true },
            { name: '💳 Your New Balance', value: `${transferResult.fromUserNewBalance} ${tokenTicker}`, inline: true },
            { name: '🎯 Recipient New Balance', value: `${transferResult.toUserNewBalance} ${tokenTicker}`, inline: true }
          ])
          .setColor('#00FF00')
          .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        await interaction.editReply({ embeds: [embed] });
        
        // Send DM to recipient
        try {
          if (targetUser) {
            const recipientEmbed = new EmbedBuilder()
              .setTitle('💸 You Received a Virtual Tip!')
              .setDescription(`You received **${amountNum} ${tokenTicker}** from ${interaction.user.tag}`)
              .addFields([
                { name: '💰 Amount', value: `${amountNum} ${tokenTicker}`, inline: true },
                { name: '📝 Memo', value: memo, inline: true },
                { name: '💳 Your New Balance', value: `${transferResult.toUserNewBalance} ${tokenTicker}`, inline: true }
              ])
              .setColor('#00FF00')
              .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
              .setTimestamp()
              .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
            
            await targetUser.send({ embeds: [recipientEmbed] });
          }
        } catch (dmError) {
          console.error(`Could not send DM to ${userTag}:`, dmError.message);
        }
        
      } else {
        await interaction.editReply({ 
          content: `❌ **Tip failed!** ${transferResult.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
      
    } catch (error) {
      console.error('Error in tip-virtual command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  }

  // FORCE CLOSE STUCK GAMES COMMAND
  if (commandName === 'force-close-games') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      initializeFootballData(guildId);
      
      // Get matches for this guild from flat structure
      const guildMatches = Object.entries(footballMatchesData).filter(([matchId, match]) => 
        match.guildIds.includes(guildId)
      );
      const stuckMatches = guildMatches.filter(([matchId, match]) => 
        (match.status === 'SCHEDULED' || match.status === 'TIMED') && 
        match.ftScore && 
        match.ftScore.home !== undefined && 
        match.ftScore.away !== undefined
      );
      
      if (stuckMatches.length === 0) {
        await interaction.editReply({ 
          content: '✅ No stuck games found. All scheduled games either have no scores or are properly finished.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      let processedCount = 0;
      let errorCount = 0;
      
      for (const [matchId, match] of stuckMatches) {
        try {
          console.log(`[FORCE-CLOSE] Processing stuck match ${matchId}: ${match.home} vs ${match.away}`);
          
          // Mark match as finished
          match.status = 'FINISHED';
          
          // Update the embed to show finished status
          await updateMatchEmbed(guildId, matchId);
          
          // Process prizes
          await processMatchPrizes(guildId, matchId);
          
          processedCount++;
          console.log(`[FORCE-CLOSE] Successfully processed match ${matchId}`);
          
        } catch (error) {
          console.error(`[FORCE-CLOSE] Error processing match ${matchId}:`, error.message);
          errorCount++;
        }
      }
      
      // Save the updated data
      saveFootballMatchesData();
      
      await interaction.editReply({ 
        content: `✅ **Force Close Complete!**\n\n**Processed:** ${processedCount} games\n**Errors:** ${errorCount} games\n\nAll stuck games have been marked as finished and prizes distributed to virtual accounts.`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
    } catch (error) {
      console.error('[FORCE-CLOSE] Error in force-close-games command:', error.message);
      await interaction.editReply({ 
        content: `❌ Error processing force close: ${error.message}`, 
        flags: [MessageFlags.Ephemeral] 
      });
    }
  }
});

// Combined autocomplete handler for send-esdt command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isAutocomplete()) return;
  
  // Helper function to safely respond to autocomplete
  const safeRespond = async (interaction, choices) => {
    try {
      await interaction.respond(choices);
    } catch (error) {
      // Ignore interaction timeout errors (code 10062)
      if (error.code !== 10062) {
        console.error('Autocomplete response error:', error);
      }
    }
  };

  // PROJECT NAME AUTOCOMPLETE FOR SEND-ESDT
  if (interaction.commandName === 'send-esdt' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      const communityFundProject = serverData[guildId]?.communityFundProject;
      
      // Exclude community fund project from /send-esdt options
      const availableProjects = Object.keys(projects).filter(projectName => 
        projectName !== communityFundProject
      );
      
      const filtered = availableProjects.filter(projectName =>
        projectName.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // USER AUTOCOMPLETE
  if (interaction.commandName === 'send-esdt' && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      
      // Debug: Check if specific user is in autocomplete list
      debugUserInAutocomplete('726473528731500615', guildId, 'send-esdt');
      
      let choices = [];
      const userWallets = getUserWallets(guildId);
      // Increase limit to 100 users to ensure more users are available for autocomplete
      const userWalletEntries = Object.entries(userWallets).slice(0, 100);

      if (userWalletEntries.length > 0) {
        const walletUserPromises = userWalletEntries.map(async ([userId, wallet]) => {
          try {
            let member = guild.members.cache.get(userId);
            if (!member) {
              member = await guild.members.fetch(userId).catch(() => null);
            }
            if (member) {
              return {
                name: member.user.tag,
                value: member.user.tag
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        });
        const walletUsers = (await Promise.all(walletUserPromises)).filter(Boolean);
        choices = walletUsers;
      }

      // Filter by user input
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE
  if (interaction.commandName === 'send-esdt' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      
      // Get the selected project from the interaction
      const selectedProject = interaction.options.getString('project-name');
      
      let supportedTokens = [];
      if (selectedProject && projects[selectedProject]) {
        // If a project is selected, only show tokens supported by that project
        supportedTokens = projects[selectedProject].supportedTokens || [];
      } else {
        // If no project is selected, show all tokens from all projects
        const availableProjects = Object.keys(projects);
        for (const projectName of availableProjects) {
          const project = projects[projectName];
          if (project && Array.isArray(project.supportedTokens)) {
            supportedTokens.push(...project.supportedTokens);
          }
        }
        supportedTokens = [...new Set(supportedTokens)];
      }
      
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // PROJECT NAME AUTOCOMPLETE FOR UPDATE-PROJECT
  if (interaction.commandName === 'update-project' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      const availableProjects = Object.keys(projects);
      
      const filtered = availableProjects.filter(projectName =>
        projectName.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // COMPETITION AUTOCOMPLETE FOR LEADERBOARD-FILTERED
  if (interaction.commandName === 'leaderboard-filtered' && interaction.options.getFocused(true).name === 'competition') {
    try {
      const focusedValue = interaction.options.getFocused();
      
      // Common football competition codes
      const competitions = [
        { name: 'Premier League', value: 'PL' },
        { name: 'UEFA Champions League', value: 'CL' },
        { name: 'Championship', value: 'ELC' },
        { name: 'UEFA Europa League', value: 'EL' },
        { name: 'Bundesliga', value: 'BL1' },
        { name: 'La Liga', value: 'PD' },
        { name: 'Serie A', value: 'SA' },
        { name: 'Ligue 1', value: 'FL1' },
        { name: 'Major League Soccer', value: 'MLS' }
      ];
      
      const filtered = competitions.filter(comp =>
        comp.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
        comp.value.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(comp => ({ name: `${comp.value} (${comp.name})`, value: comp.value }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // PROJECT NAME AUTOCOMPLETE FOR DELETE-PROJECT
  if (interaction.commandName === 'delete-project' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      const availableProjects = Object.keys(projects);
      
      const filtered = availableProjects.filter(projectName =>
        projectName.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // PROJECT NAME AUTOCOMPLETE FOR SET-COMMUNITY-FUND
  if (interaction.commandName === 'set-community-fund' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      const availableProjects = Object.keys(projects);
      const filtered = availableProjects.filter(projectName =>
        projectName.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction,
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR SET-TIP-LIMITS
  if (interaction.commandName === 'set-tip-limits' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const fundProject = serverData[guildId]?.communityFundProject;
      let supportedTokens = [];
      const projects = getProjects(guildId);
      if (fundProject && projects[fundProject]) {
        supportedTokens = projects[fundProject].supportedTokens || [];
      }
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // USER AUTOCOMPLETE FOR TIP
  if (interaction.commandName === 'tip' && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      
      // Debug: Check if specific user is in autocomplete list
      debugUserInAutocomplete('726473528731500615', guildId, 'tip');
      
      let choices = [];
      const userWallets = getUserWallets(guildId);
      // Increase limit to 100 users to ensure more users are available for autocomplete
      const userWalletEntries = Object.entries(userWallets).slice(0, 100);
      if (userWalletEntries.length > 0) {
        console.log(`[AUTOCOMPLETE] Processing ${userWalletEntries.length} users for tip user-tag autocomplete`);
        const walletUserPromises = userWalletEntries.map(async ([userId, wallet]) => {
          try {
            let member = guild.members.cache.get(userId);
            if (!member) {
              console.log(`[AUTOCOMPLETE] Fetching member ${userId} from Discord API`);
              member = await guild.members.fetch(userId).catch((error) => {
                console.log(`[AUTOCOMPLETE] Failed to fetch member ${userId}:`, error.message);
                return null;
              });
            }
            if (member) {
              return {
                name: member.user.tag,
                value: member.user.tag
              };
            }
            return null;
          } catch (error) {
            console.log(`[AUTOCOMPLETE] Error processing user ${userId}:`, error.message);
            return null;
          }
        });
        const walletUsers = (await Promise.all(walletUserPromises)).filter(Boolean);
        console.log(`[AUTOCOMPLETE] Successfully processed ${walletUsers.length} users out of ${userWalletEntries.length}`);
        choices = walletUsers;
      }
      // Filter by user input
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR TIP
  if (interaction.commandName === 'tip' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const fundProject = serverData[guildId]?.communityFundProject;
      let supportedTokens = [];
      const projects = getProjects(guildId);
      if (fundProject && projects[fundProject]) {
        supportedTokens = projects[fundProject].supportedTokens || [];
      }
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR HOUSE-TIP
  if (interaction.commandName === 'house-tip' && interaction.options.getFocused(true).name === 'token') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      
      // Get tokens that house has balance for
      initializeFootballData(guildId);
      const guildLeaderboard = footballLeaderboardData[guildId] || {};
      const houseData = guildLeaderboard['HOUSE'];
      
      let supportedTokens = [];
      if (houseData && houseData.tokenPNL) {
        // Only show tokens that have positive house balance
        supportedTokens = Object.keys(houseData.tokenPNL).filter(token => {
          const balance = new BigNumber(houseData.tokenPNL[token] || '0');
          return balance.isGreaterThan(0);
        });
      }
      
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR CHALLENGE-RPS
  if (interaction.commandName === 'challenge-rps' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const fundProject = serverData[guildId]?.communityFundProject;
      let supportedTokens = [];
      const projects = getProjects(guildId);
      if (fundProject && projects[fundProject]) {
        supportedTokens = projects[fundProject].supportedTokens || [];
      }
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ 
          name: `${token.includes('-') ? token.split('-')[0] : token} (${token})`, 
          value: token 
        }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // USER AUTOCOMPLETE FOR TIP-VIRTUAL
  if (interaction.commandName === 'tip-virtual' && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      
      let choices = [];
      const userWallets = getUserWallets(guildId);
      const userWalletEntries = Object.entries(userWallets).slice(0, 100);

      if (userWalletEntries.length > 0) {
        const walletUserPromises = userWalletEntries.map(async ([userId, wallet]) => {
          try {
            let member = guild.members.cache.get(userId);
            if (!member) {
              member = await guild.members.fetch(userId).catch(() => null);
            }
            if (member) {
              return {
                name: member.user.tag,
                value: member.user.tag
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        });
        const walletUsers = (await Promise.all(walletUserPromises)).filter(Boolean);
        choices = walletUsers;
      }

      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR TIP-VIRTUAL
  if (interaction.commandName === 'tip-virtual' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const fundProject = serverData[guildId]?.communityFundProject;
      let supportedTokens = [];
      const projects = getProjects(guildId);
      if (fundProject && projects[fundProject]) {
        supportedTokens = projects[fundProject].supportedTokens || [];
      }
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ 
          name: `${token.includes('-') ? token.split('-')[0] : token} (${token})`, 
          value: token 
        }))
      );
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR WITHDRAW (based on user's actual holdings)
  if (interaction.commandName === 'withdraw' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Force reload virtual accounts data
      virtualAccounts.forceReloadData();
      
      // Get user's actual token holdings
      const userBalances = virtualAccounts.getAllUserBalances(guildId, userId);
      const userTokens = Object.keys(userBalances).filter(token => 
        new BigNumber(userBalances[token]).isGreaterThan(0)
      );
      
      const filtered = userTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ 
          name: `${token.includes('-') ? token.split('-')[0] : token} (${token}) - Balance: ${userBalances[token]}`, 
          value: token 
        }))
      );
    } catch (error) {
      console.error('Error in withdraw token autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // MATCH ID AUTOCOMPLETE FOR BET-VIRTUAL
  if (interaction.commandName === 'bet-virtual' && interaction.options.getFocused(true).name === 'match-id') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      
      // Initialize football data for this guild
      initializeFootballData(guildId);
      
      // Get matches for this guild from flat structure
      const guildMatches = Object.values(footballMatchesData).filter(match => 
        match.guildIds.includes(guildId)
      );
      const currentMatches = guildMatches.filter(match => match.status === 'SCHEDULED' || match.status === 'TIMED');
      
      const matchChoices = currentMatches.map(match => ({
        name: `${match.home} vs ${match.away} (${match.matchId})`,
        value: match.matchId
      })).filter(choice => 
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      ).slice(0, 25);

      await safeRespond(interaction, matchChoices);
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // USER AUTOCOMPLETE FOR CHALLENGE-RPS
  if (interaction.commandName === 'challenge-rps') {
    const focusedOption = interaction.options.getFocused(true);
    if (!focusedOption || focusedOption.name !== 'user-tag') return;
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      let choices = [];
      const userWallets = getUserWallets(guildId);
      // Increase limit to 100 users to ensure more users are available for autocomplete
      const userWalletEntries = Object.entries(userWallets).slice(0, 100);

      if (userWalletEntries.length > 0) {
        console.log(`[AUTOCOMPLETE] Processing ${userWalletEntries.length} users for challenge-rps user-tag autocomplete`);
        const walletUserPromises = userWalletEntries.map(async ([userId, wallet]) => {
          try {
            let member = guild.members.cache.get(userId);
            if (!member) {
              console.log(`[AUTOCOMPLETE] Fetching member ${userId} from Discord API`);
              member = await guild.members.fetch(userId).catch((error) => {
                console.log(`[AUTOCOMPLETE] Failed to fetch member ${userId}:`, error.message);
                return null;
              });
            }
            if (member) {
              return {
                name: member.user.tag,
                value: member.user.tag
              };
            }
            return null;
          } catch (error) {
            console.log(`[AUTOCOMPLETE] Error processing user ${userId}:`, error.message);
            return null;
          }
        });
        const walletUsers = (await Promise.all(walletUserPromises)).filter(Boolean);
        console.log(`[AUTOCOMPLETE] Successfully processed ${walletUsers.length} users out of ${userWalletEntries.length}`);
        choices = walletUsers;
      }

      // Filter by user input
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // CHALLENGE ID AUTOCOMPLETE FOR JOIN-RPS
  if (interaction.commandName === 'join-rps') {
    const focusedOption = interaction.options.getFocused(true);
    if (!focusedOption || focusedOption.name !== 'challenge-id') return;
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const challenges = getRPSChallenges(guildId);
      const waitingChallenges = Object.entries(challenges)
        .filter(([id, challenge]) => challenge.status === 'waiting')
        .map(([id, challenge]) => ({
          name: `${id} - ${challenge.challengerTag} vs ${challenge.challengedTag} (${challenge.amount} ${challenge.token})`,
          value: id
        }))
        .filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()))
        .slice(0, 25);

      await safeRespond(interaction, waitingChallenges);
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // CHALLENGE ID AUTOCOMPLETE FOR PLAY-RPS
  if (interaction.commandName === 'play-rps') {
    const focusedOption = interaction.options.getFocused(true);
    if (!focusedOption || focusedOption.name !== 'challenge-id') return;
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const challenges = getRPSChallenges(guildId);
      const activeChallenges = Object.entries(challenges)
        .filter(([id, challenge]) => challenge.status === 'active')
        .map(([id, challenge]) => ({
          name: `${id} - ${challenge.challengerTag} vs ${challenge.challengedTag} (${challenge.amount} ${challenge.token})`,
          value: id
        }))
        .filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()))
        .slice(0, 25);

      await safeRespond(interaction, activeChallenges);
    } catch (error) {
      await safeRespond(interaction, []);
    }
    return;
  }

  // FOOTBALL AUTOCOMPLETE FOR CREATE-FIXTURES
  if (interaction.commandName === 'create-fixtures') {
    const focusedOption = interaction.options.getFocused(true);
    
    console.log('[AUTOCOMPLETE] create-fixtures autocomplete triggered, focused field:', focusedOption?.name);
    console.log('[AUTOCOMPLETE] Full focusedOption object:', JSON.stringify(focusedOption, null, 2));
    console.log('[AUTOCOMPLETE] Interaction options:', JSON.stringify(interaction.options, null, 2));
    
    // Competition autocomplete
    if (focusedOption.name === 'competition') {
      try {
        const focusedValue = interaction.options.getFocused();
        console.log('[AUTOCOMPLETE] Received autocomplete for command: create-fixtures, focused field: competition');
        console.log('[AUTOCOMPLETE] Processing football competition autocomplete');
        console.log('[AUTOCOMPLETE] Focused value:', focusedValue);
        
        // Available football competitions
        const competitions = [
          { code: 'PL', name: 'Premier League' },
          { code: 'CL', name: 'UEFA Champions League' },
          { code: 'ELC', name: 'Championship' },
          { code: 'EL', name: 'UEFA Europa League' },
          { code: 'SA', name: 'Serie A' },
          { code: 'BL1', name: 'Bundesliga' },
          { code: 'FL1', name: 'Ligue 1' },
          { code: 'PD', name: 'La Liga' },
          { code: 'NL1', name: 'Eredivisie' },
          { code: 'PPL', name: 'Primeira Liga' }
        ];
        
        const filtered = competitions
          .filter(comp => 
            comp.code.toLowerCase().includes(focusedValue.toLowerCase()) ||
            comp.name.toLowerCase().includes(focusedValue.toLowerCase())
          )
          .map(comp => ({
            name: `${comp.code} - ${comp.name}`,
            value: comp.code
          }))
          .slice(0, 25);
        
        console.log('[AUTOCOMPLETE] Available competitions:', competitions.map(c => c.code));
        console.log('[AUTOCOMPLETE] Sending', filtered.length, 'competition choices');
        
        await safeRespond(interaction, filtered);
      } catch (error) {
        console.error('[AUTOCOMPLETE] Error in competition autocomplete:', error.message);
        await safeRespond(interaction, []);
      }
      return;
    }
    
    // Token autocomplete
    if (focusedOption.name === 'token') {
      console.log('[AUTOCOMPLETE] Token autocomplete handler reached!');
      try {
        const focusedValue = interaction.options.getFocused();
        const guildId = interaction.guildId;
        
        console.log('[AUTOCOMPLETE] Football token autocomplete for guild:', guildId);
        console.log('[AUTOCOMPLETE] Focused value:', focusedValue);
        
        // Get community fund project and its supported tokens
        const fundProject = serverData[guildId]?.communityFundProject;
        const projects = getProjects(guildId);
        
        console.log('[AUTOCOMPLETE] Fund project:', fundProject);
        console.log('[AUTOCOMPLETE] Available projects:', Object.keys(projects));
        
        let supportedTokens = [];
        if (fundProject && projects[fundProject]) {
          supportedTokens = projects[fundProject].supportedTokens || [];
          console.log('[AUTOCOMPLETE] Supported tokens from project:', supportedTokens);
        } else {
          console.log('[AUTOCOMPLETE] No community fund project found or project not accessible');
        }
        
        // If no tokens found, try to get tokens from any available project
        if (supportedTokens.length === 0) {
          console.log('[AUTOCOMPLETE] No Community Fund tokens found, trying to get tokens from any project');
          
          // Get tokens from any available project
          for (const [projectName, project] of Object.entries(projects)) {
            if (project.supportedTokens && project.supportedTokens.length > 0) {
              supportedTokens = project.supportedTokens;
              console.log('[AUTOCOMPLETE] Using tokens from project:', projectName, supportedTokens);
              break;
            }
          }
          
          // If still no tokens, show a helpful message
          if (supportedTokens.length === 0) {
            console.log('[AUTOCOMPLETE] No supported tokens found in any project, sending empty response');
            await safeRespond(interaction, []);
            return;
          }
        }
        
        const filtered = supportedTokens
          .filter(token => token.toLowerCase().includes(focusedValue.toLowerCase()))
          .map(token => ({ name: token, value: token }))
          .slice(0, 25);
        
        console.log('[AUTOCOMPLETE] Filtered tokens:', filtered);
        console.log('[AUTOCOMPLETE] Sending', filtered.length, 'token choices');
        
        await safeRespond(interaction, filtered);
        console.log('[AUTOCOMPLETE] Token autocomplete response sent successfully');
      } catch (error) {
        console.error('[AUTOCOMPLETE] Error in football token autocomplete:', error.message);
        console.error('[AUTOCOMPLETE] Full error:', error);
        await safeRespond(interaction, []);
      }
      return;
    }
  }
});

// Button interaction handler for football betting
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId } = interaction;
  const guildId = interaction.guildId;

  if (customId.startsWith('bet:')) {
    try {
      const matchId = customId.split(':')[1];
      const match = footballMatchesData[matchId];
      
      if (!match || !match.guildIds.includes(guildId)) {
        await interaction.reply({ content: '❌ Match not found or no longer available for betting.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      if (match.status !== 'SCHEDULED' && match.status !== 'TIMED') {
        await interaction.reply({ content: '❌ This match is no longer accepting bets.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const kickoffTime = new Date(match.kickoffISO);
      if (Date.now() >= kickoffTime.getTime()) {
        await interaction.reply({ content: '❌ Betting has closed for this match. Kickoff time has passed.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Create betting modal with shortened club names
      const shortenClubName = (name) => {
        if (name.length <= 15) return name;
        // Try to keep the most recognizable part (usually the first part)
        const parts = name.split(' ');
        if (parts.length > 1) {
          // Keep first part and truncate if needed
          return parts[0].length > 15 ? parts[0].substring(0, 15) : parts[0];
        }
        // Single word, truncate
        return name.substring(0, 15);
      };

      const homeShort = shortenClubName(match.home);
      const awayShort = shortenClubName(match.away);
      const modalTitle = `Bet: ${homeShort} vs ${awayShort}`;
      
      // Ensure title doesn't exceed Discord's limit (45 characters)
      const finalTitle = modalTitle.length > 45 ? modalTitle.substring(0, 42) + '...' : modalTitle;

      const modal = new ModalBuilder()
        .setCustomId(`betting-modal:${matchId}`)
        .setTitle(finalTitle);

      const outcomeInput = new TextInputBuilder()
        .setCustomId('outcome')
        .setLabel('Betting Outcome')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('H for Home Win, A for Away Win, D for Draw')
        .setRequired(true)
        .setMaxLength(1);

      const firstActionRow = new ActionRowBuilder().addComponents(outcomeInput);
      modal.addComponents(firstActionRow);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('[FOOTBALL] Error showing betting modal:', error.message);
      await interaction.reply({ content: '❌ An error occurred while opening the betting form. Please try again.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (customId.startsWith('join-rps-modal:')) {
    try {
      const startTime = Date.now();
      console.log('[RPS MODAL] Button clicked, processing join-rps-modal at', new Date(startTime).toISOString());
      const challengeId = customId.split(':')[1];
      console.log('[RPS MODAL] Challenge ID:', challengeId);
      
      console.log('[RPS MODAL] Guild ID:', guildId);
      const challenges = getRPSChallenges(guildId);
      console.log('[RPS MODAL] Available challenges:', Object.keys(challenges));
      console.log('[RPS MODAL] Challenges object type:', typeof challenges);
      console.log('[RPS MODAL] Challenges is array:', Array.isArray(challenges));
      console.log('[RPS MODAL] Challenges is object:', challenges && typeof challenges === 'object');
      console.log('[RPS MODAL] Global rpsGamesData keys:', Object.keys(rpsGamesData));
      console.log('[RPS MODAL] Global rpsGamesData for this guild:', rpsGamesData[guildId]);
      
      const challenge = challenges[challengeId];
      console.log('[RPS MODAL] Challenge found:', !!challenge);
      console.log('[RPS MODAL] Challenge data:', challenge ? {
        status: challenge.status,
        challengerTag: challenge.challengerTag,
        challengedTag: challenge.challengedTag,
        challengedId: challenge.challengedId,
        expiresAt: challenge.expiresAt
      } : 'null');
      
      if (!challenge) {
        await interaction.reply({ content: '❌ Challenge not found or has expired.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Validate challenge data structure
      if (!challenge.challengerTag || !challenge.challengedTag || !challenge.challengedId || !challenge.expiresAt) {
        console.error('[RPS MODAL] Challenge data is malformed:', challenge);
        await interaction.reply({ content: '❌ Challenge data is corrupted. Please try again or contact an administrator.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      console.log('[RPS MODAL] Challenge status:', challenge.status);
      console.log('[RPS MODAL] Challenge expires at:', challenge.expiresAt);
      console.log('[RPS MODAL] Current user ID:', interaction.user.id);
      console.log('[RPS MODAL] Challenged user ID:', challenge.challengedId);
      
      if (challenge.status !== 'waiting') {
        await interaction.reply({ content: '❌ This challenge is no longer accepting participants.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if challenge has expired
      if (Date.now() > challenge.expiresAt) {
        await interaction.reply({ content: '❌ This challenge has expired.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if user is the challenged person
      if (challenge.challengedId !== interaction.user.id) {
        await interaction.reply({ content: '❌ This challenge is for someone else.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Create RPS join modal
      const modal = new ModalBuilder()
        .setCustomId(`rps-join-modal:${challengeId}`)
        .setTitle(`Join RPS Challenge`);

      const memoInput = new TextInputBuilder()
        .setCustomId('memo')
        .setLabel('Memo (Optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Add a memo for your entry')
        .setRequired(false)
        .setMaxLength(100);

      const firstActionRow = new ActionRowBuilder().addComponents(memoInput);
      modal.addComponents(firstActionRow);
      
      await interaction.showModal(modal);
    } catch (error) {
      console.error('[RPS] Error showing join modal:', error.message);
      await interaction.reply({ content: '❌ An error occurred while opening the join form. Please try again.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (customId.startsWith('rps-move:')) {
    try {
      const [, challengeId, move] = customId.split(':');
      const challenges = getRPSChallenges(guildId);
      const challenge = challenges[challengeId];
      
      if (!challenge || challenge.status !== 'active') {
        await interaction.reply({ content: '❌ This challenge is not active or does not exist.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (![challenge.challengerId, challenge.challengedId].includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ You are not a participant in this game.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const isChallenger = challenge.challengerId === interaction.user.id;
      const playerChoiceKey = isChallenger ? 'challengerChoice' : 'challengedChoice';
      
      if (!challenge.rounds[challenge.currentRound - 1]) {
        challenge.rounds[challenge.currentRound - 1] = {
          round: challenge.currentRound,
          challengerChoice: null,
          challengedChoice: null,
          winner: null,
          result: null
        };
      }
      
      const currentRound = challenge.rounds[challenge.currentRound - 1];
      
      if (currentRound[playerChoiceKey]) {
        await interaction.reply({ content: '❌ You have already made your choice for this round.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (!['rock', 'paper', 'scissors'].includes(move)) {
        await interaction.reply({ content: '❌ Invalid move. Please choose rock, paper, or scissors.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      currentRound[playerChoiceKey] = move;
      saveServerData();
      
      // Send game state embed to user after their move
      const moveEmbed = new EmbedBuilder()
        .setTitle('🎮 RPS Move Submitted')
        .setDescription(`You played **${move.charAt(0).toUpperCase() + move.slice(1)}** for round ${challenge.currentRound}.`)
        .addFields([
          { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
          { name: 'Round', value: `${challenge.currentRound}`, inline: true },
          { name: 'Your Choice', value: move, inline: true },
          { name: 'Opponent', value: isChallenger ? `<@${challenge.challengedId}>` : `<@${challenge.challengerId}>`, inline: true },
          { name: 'Opponent Choice', value: currentRound[isChallenger ? 'challengedChoice' : 'challengerChoice'] ? currentRound[isChallenger ? 'challengedChoice' : 'challengerChoice'] : 'Not picked yet', inline: true },
          { name: 'Status', value: 'Waiting for both players to pick', inline: false }
        ])
        .setColor('#4d55dc')
        .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      
      await interaction.reply({ embeds: [moveEmbed], flags: [MessageFlags.Ephemeral] });
      
      // Check if both players have made their moves
      if (currentRound.challengerChoice && currentRound.challengedChoice) {
        const winner = determineRPSWinner(currentRound.challengerChoice, currentRound.challengedChoice);
        currentRound.winner = winner;
        
        if (winner === 'draw') {
          currentRound.result = 'draw';
          challenge.currentRound++;
          challenge.rounds[challenge.currentRound - 1] = {
            round: challenge.currentRound,
            challengerChoice: null,
            challengedChoice: null,
            winner: null,
            result: null
          };
          saveServerData();
          
          const roundEmbed = new EmbedBuilder()
            .setTitle('🎮 RPS Round Draw!')
            .setDescription(`Round ${currentRound.round} ended in a draw! Both players, choose again for round ${challenge.currentRound}.`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Round', value: `${challenge.currentRound}`, inline: true },
              { name: 'Challenger', value: `<@${challenge.challengerId}>`, inline: true },
              { name: 'Challenged', value: `<@${challenge.challengedId}>`, inline: true }
            ])
            .setColor('#FFD700')
            .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          await interaction.channel.send({ 
            embeds: [roundEmbed],
            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:rock`)
                    .setLabel('🪨 Rock')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:paper`)
                    .setLabel('📄 Paper')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:scissors`)
                    .setLabel('✂️ Scissors')
                    .setStyle(ButtonStyle.Primary)
                )
            ]
          });
        } else {
          currentRound.result = 'winner';
          challenge.status = 'completed';
          
          // Determine winner/loser IDs and tags
          const winnerId = winner === 'player1' ? challenge.challengerId : challenge.challengedId;
          const winnerTag = winner === 'player1' ? challenge.challengerTag : challenge.challengedTag;
          const winnerWallet = winner === 'player1' ? challenge.challengerWallet : challenge.challengedWallet;
          const loserId = winner === 'player1' ? challenge.challengedId : challenge.challengerId;
          const loserTag = winner === 'player1' ? challenge.challengedTag : challenge.challengerTag;
          
          challenge.winner = winner;
          challenge.winnerId = winnerId;
          challenge.winnerTag = winnerTag;
          challenge.loserId = loserId;
          challenge.loserTag = loserTag;
          challenge.completedAt = Date.now();
          saveServerData();
          
          // Get balances BEFORE adding prize to ensure we have correct loser balance
          virtualAccounts.forceReloadData();
          const loserBalance = virtualAccounts.getUserBalance(guildId, loserId, challenge.token);
          const winnerBalanceBeforePrize = virtualAccounts.getUserBalance(guildId, winnerId, challenge.token);
          
          console.log(`[RPS DEBUG] Before prize (second handler) - Winner: ${winnerId}, Loser: ${loserId}, Token: ${challenge.token}`);
          console.log(`[RPS DEBUG] Winner balance before prize: ${winnerBalanceBeforePrize}, Loser balance: ${loserBalance}`);
          
          // Prize transfer to virtual account
          const totalPrizeHuman = Number(challenge.humanAmount) * 2;
          let prizeResult = null;
          
          if (challenge.humanAmount && challenge.token) {
            try {
              prizeResult = virtualAccounts.addFundsToAccount(
                guildId,
                winnerId,
                challenge.token,
                totalPrizeHuman.toString(),
                null, // No transaction hash for virtual prize
                'rps_prize',
                null // Username will be updated when user runs commands
              );
            } catch (err) {
              console.error('[RPS] Error adding prize to virtual account:', err.message);
            }
          }
          
          // Get winner's final balance after prize
          const winnerBalance = virtualAccounts.getUserBalance(guildId, winnerId, challenge.token);
          
          console.log(`[RPS DEBUG] After prize (second handler) - Winner final balance: ${winnerBalance}, Loser balance: ${loserBalance}`);
          
          // Winner embed for channel
          const winnerEmbed = new EmbedBuilder()
            .setTitle('🎉 RPS Game Complete!')
            .setDescription(`**${winnerTag} wins the game!**`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Winner', value: `<@${winnerId}>`, inline: true },
              { name: 'Loser', value: `<@${loserId}>`, inline: true },
              { name: 'Prize Won', value: `${totalPrizeHuman} ${challenge.token}`, inline: true },
              { name: 'Winner New Balance', value: `${winnerBalance} ${challenge.token}`, inline: true },
              { name: 'Loser New Balance', value: `${loserBalance} ${challenge.token}`, inline: true }
            ])
            .setColor('#00FF00')
            .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          await interaction.channel.send({ embeds: [winnerEmbed] });
          
          // DM winner
          try {
            const winnerUser = await client.users.fetch(winnerId);
            if (winnerUser) {
              const winnerDMEmbed = new EmbedBuilder()
                .setTitle('🎉 You Won Rock, Paper, Scissors!')
                .setDescription(`Congratulations! You won the RPS game and received **${totalPrizeHuman} ${challenge.token}** in your virtual account.`)
                .addFields([
                  { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
                  { name: 'Prize Won', value: `${totalPrizeHuman} ${challenge.token}`, inline: true },
                  { name: 'Your New Balance', value: `${winnerBalance} ${challenge.token}`, inline: true }
                ])
                .setColor('#00FF00')
                .setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif')
                .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
                .setTimestamp();
              
              await winnerUser.send({ embeds: [winnerDMEmbed] });
            }
          } catch (dmError) {
            console.error('[RPS] Could not send DM to winner:', dmError.message);
          }
        }
      }
    } catch (error) {
      console.error('[RPS] Error handling RPS move button:', error.message);
      await interaction.reply({ content: '❌ An error occurred while processing your move. Please try again.', flags: [MessageFlags.Ephemeral] });
    }
  }
});

// Modal submission handler for football betting
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  const { customId } = interaction;
  const guildId = interaction.guildId;

      if (customId.startsWith('betting-modal:')) {
        try {
          const matchId = customId.split(':')[1];
          const outcome = interaction.fields.getTextInputValue('outcome').toUpperCase();

          // Validate outcome
          if (!['H', 'A', 'D'].includes(outcome)) {
            await interaction.reply({ content: '❌ Invalid outcome. Please use H (Home), A (Away), or D (Draw).', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if match still exists and is accepting bets
          const match = footballMatchesData[matchId];
          if (!match || !match.guildIds.includes(guildId)) {
            await interaction.reply({ content: '❌ Match not found or no longer available for betting.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          if (match.status !== 'SCHEDULED' && match.status !== 'TIMED') {
            await interaction.reply({ content: '❌ This match is no longer accepting bets.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          const kickoffTime = new Date(match.kickoffISO);
          if (Date.now() >= kickoffTime.getTime()) {
            await interaction.reply({ content: '❌ Betting has closed for this match. Kickoff time has passed.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if user has sufficient virtual balance
          const requiredAmountWei = getMatchStakeForGuild(match, guildId);
          const requiredAmount = new BigNumber(requiredAmountWei).dividedBy(new BigNumber(10).pow(match.token.decimals)).toString();
          const currentBalance = virtualAccounts.getUserBalance(guildId, interaction.user.id, match.token.ticker);
          
          if (new BigNumber(currentBalance).isLessThan(requiredAmount)) {
            await interaction.reply({ 
              content: `❌ **Insufficient virtual balance!**\n\nYou have: **${currentBalance}** ${match.token.ticker}\nRequired: **${requiredAmount}** ${match.token.ticker}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }
          
          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          await interaction.editReply({ content: '💸 Processing your virtual bet...', flags: [MessageFlags.Ephemeral] });
          
          // Deduct funds from virtual account
          const deductionResult = virtualAccounts.deductFundsFromAccount(
            guildId, 
            interaction.user.id, 
            match.token.ticker, 
            requiredAmount, 
            `Football bet: ${match.home} vs ${match.away} (${outcome})`
          );
          
          if (!deductionResult.success) {
            await interaction.editReply({ 
              content: `❌ **Failed to deduct funds!** ${deductionResult.error}`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Create bet
          const betId = generateBetId(matchId, interaction.user.id);
          const betAmountWei = getMatchStakeForGuild(match, guildId);
          const betData = {
            betId: betId,
            matchId: matchId,
            userId: interaction.user.id,
            outcome: outcome,
            token: match.token,
            amountWei: betAmountWei,
            txHash: null, // No blockchain transaction needed
            createdAtISO: new Date().toISOString(),
            status: 'ACCEPTED',
            virtualBet: true // Mark as virtual bet
          };

          // Save bet
          initializeFootballData(guildId);
          footballBetsData[guildId][betId] = betData;
          saveFootballBetsData();

          // Track bet amount for PNL calculation
          trackBetAmount(guildId, interaction.user.id, betAmountWei, match.token.ticker);

          // No transaction hash needed for virtual bets

          // Update the main match embed with new pot size
          try {
            console.log(`[FOOTBALL] Updating pot size for match ${matchId} in guild ${guildId}`);
            const channel = interaction.channel;
            const matchMessage = await channel.messages.fetch(match.embeds[guildId].messageId);
            if (matchMessage && matchMessage.embeds && matchMessage.embeds.length > 0) {
              // Calculate current pot size using utility function
              const potSize = calculateMatchPotSize(guildId, matchId);
              console.log(`[FOOTBALL] Calculated pot size: ${potSize.totalPotHuman} ${match.token.ticker}`);
              
              // Update the embed - handle both fetched message embeds and EmbedBuilder
              let updatedEmbed;
              if (matchMessage.embeds[0].data) {
                // This is already an EmbedBuilder
                updatedEmbed = matchMessage.embeds[0];
              } else {
                // This is a fetched message embed, convert to EmbedBuilder
                updatedEmbed = EmbedBuilder.from(matchMessage.embeds[0]);
              }
              
              // Check if fields exist and find the pot size field
              if (updatedEmbed.data && updatedEmbed.data.fields && Array.isArray(updatedEmbed.data.fields)) {
                const potSizeField = updatedEmbed.data.fields.find(field => field.name === '🏆 Pot Size');
                if (potSizeField) {
                  potSizeField.value = `${potSize.totalPotHuman} ${match.token.ticker}`;
                  
                  await matchMessage.edit({ embeds: [updatedEmbed] });
                  console.log(`[FOOTBALL] Updated match embed pot size to ${potSize.totalPotHuman} ${match.token.ticker} for match ${matchId}`);
                } else {
                  console.log(`[FOOTBALL] Pot size field not found in embed for match ${matchId}. Available fields:`, updatedEmbed.data.fields.map(f => f.name));
                }
              } else {
                console.log(`[FOOTBALL] Embed fields not accessible for match ${matchId}. Fields type:`, typeof updatedEmbed.data?.fields);
              }
            } else {
              console.log(`[FOOTBALL] Match message or embed not found for match ${matchId}. Message:`, !!matchMessage, 'Embeds:', matchMessage?.embeds?.length);
            }
          } catch (updateError) {
            console.error('[FOOTBALL] Error updating match embed pot size:', updateError.message);
            console.error('[FOOTBALL] Full error details:', updateError);
          }

          // Post confirmation in match thread
          if (match.embeds[guildId].threadId) {
            try {
              const thread = await interaction.guild.channels.fetch(match.embeds[guildId].threadId);
              if (thread) {
                const confirmationEmbed = new EmbedBuilder()
                  .setTitle('✅ Virtual Bet Accepted!')
                  .setDescription(`${interaction.user} placed a virtual bet on **${match.home} vs ${match.away}**`)
                  .addFields([
                    { name: 'Outcome', value: outcome === 'H' ? 'Home Win' : outcome === 'A' ? 'Away Win' : 'Draw', inline: true },
                    { name: 'Amount', value: `${requiredAmount} ${match.token.ticker}`, inline: true },
                    { name: 'Type', value: 'Virtual Balance', inline: true }
                  ])
                  .setColor('#00FF00')
                  .setTimestamp();
                
                await thread.send({ embeds: [confirmationEmbed] });
              }
            } catch (threadError) {
              console.error('[FOOTBALL] Error posting to thread:', threadError.message);
            }
          }

          const betMessage = `✅ Virtual bet accepted successfully! Match: ${match.home} vs ${match.away}, Outcome: ${outcome === 'H' ? 'Home Win' : outcome === 'A' ? 'Away Win' : 'Draw'}, Amount: ${requiredAmount} ${match.token.ticker}`;
          
          await interaction.editReply({ 
            content: betMessage, 
            flags: [MessageFlags.Ephemeral] 
          });

          console.log(`[FOOTBALL] Virtual bet accepted: ${betId} for match ${matchId} by user ${interaction.user.tag}`);

        } catch (error) {
          console.error('[FOOTBALL] Error processing bet:', error.message);
          if (interaction.deferred) {
            await interaction.editReply({ content: `❌ Error processing bet: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          } else {
            await interaction.reply({ content: `❌ Error processing bet: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        }
      } else if (customId.startsWith('rps-join-modal:')) {
        try {
          const challengeId = customId.split(':')[1];
          const memo = interaction.fields.getTextInputValue('memo') || 'No memo provided';

          // Get the challenge
          const challenges = getRPSChallenges(guildId);
          const challenge = challenges[challengeId];
          
          if (!challenge) {
            await interaction.reply({ content: '❌ Challenge not found or has expired.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          if (challenge.status !== 'waiting') {
            await interaction.reply({ content: '❌ Challenge is no longer accepting participants.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if challenge has expired
          if (Date.now() > challenge.expiresAt) {
            await interaction.reply({ content: '❌ Challenge has expired.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if user is the challenged person
          if (challenge.challengedId !== interaction.user.id) {
            await interaction.reply({ content: '❌ This challenge is for someone else.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if community fund is set
          const fundProject = serverData[guildId]?.communityFundProject;
          if (!fundProject) {
            await interaction.reply({ content: 'No Community Tip Fund is set for this server. Please ask an admin to run /set-community-fund.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          const projects = getProjects(guildId);
          if (!projects[fundProject]) {
            await interaction.reply({ content: `The Community Tip Fund project ("${fundProject}") no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Get community fund wallet address
          const communityFundWallet = projects[fundProject]?.walletAddress;
          if (!communityFundWallet) {
            await interaction.reply({ content: 'Community Fund wallet address not found. Please ask an admin to update the project.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          await interaction.editReply({ content: '💸 Processing your virtual entry...', flags: [MessageFlags.Ephemeral] });

          // Deduct balance from challenged person's virtual account
          const deductionResult = virtualAccounts.deductFundsFromAccount(
            guildId, 
            interaction.user.id, 
            challenge.token, 
            challenge.amountWei, 
            `RPS Challenge: ${challenge.memo}`
          );

          if (!deductionResult.success) {
            await interaction.editReply({ 
              content: `❌ **Insufficient virtual balance!**\n\nYou have: **${deductionResult.currentBalance}** ${challenge.token}\nRequired: **${challenge.humanAmount}** ${challenge.token}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Update challenge status
          challenge.status = 'active';
          challenge.joinedAt = Date.now();
          challenge.joinerTransactionHash = null; // No blockchain transaction needed
          challenge.joinerMemo = memo;
          saveRpsGamesData();

          // Create the embed for game start
          const embed = new EmbedBuilder()
            .setTitle('🎮 Rock, Paper, Scissors Challenge Started!')
            .setDescription(`${interaction.user.tag} has joined the challenge!`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Prize Amount', value: `${challenge.humanAmount} ${challenge.token}`, inline: true },
              { name: 'Total Prize', value: `${Number(challenge.humanAmount) * 2} ${challenge.token}`, inline: true },
              { name: 'Challenger', value: `<@${challenge.challengerId}>`, inline: true },
              { name: 'Challenged', value: `<@${challenge.challengedId}>`, inline: true },
              { name: 'Status', value: '🎯 Game Active', inline: true },
              { name: 'Memo', value: challenge.memo, inline: false }
            ])
            .setColor('#00FF00')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          // Use RPS GIF as thumbnail
          embed.setThumbnail('https://i.ibb.co/W4Z5Zn0q/rock-paper-scissors.gif');

          await interaction.editReply({ 
            content: `✅ Successfully joined the challenge!`, 
            embeds: [embed],
            flags: [MessageFlags.Ephemeral] 
          });

          // Post public announcement
          await interaction.channel.send({ 
            content: `🎮 **Rock, Paper, Scissors Challenge Started!** 🎮`,
            embeds: [embed],
            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:rock`)
                    .setLabel('🪨 Rock')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:paper`)
                    .setLabel('📄 Paper')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`rps-move:${challengeId}:scissors`)
                    .setLabel('✂️ Scissors')
                    .setStyle(ButtonStyle.Primary)
                )
            ]
          });

          console.log(`RPS challenge joined via modal: ${challengeId} by ${interaction.user.tag}`);

        } catch (error) {
          console.error('Error processing RPS join via modal:', error);
          if (interaction.deferred) {
            await interaction.editReply({ content: `Error joining challenge: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          } else {
            await interaction.reply({ content: `Error joining challenge: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        }
      }
});

// Ready event
client.on('ready', async () => {
  console.log(`Multi-Server ESDT Tipping Bot with Virtual Accounts is ready with ID: ${client.user.tag}`);
  console.log('Bot is using partials for: Message, Channel, User, GuildMember');
  console.log(`Bot is in ${client.guilds.cache.size} servers`);
  
  // Start blockchain listener for automatic monitoring
  console.log('🚀 Starting blockchain listener for automatic monitoring...');
  blockchainListener.startBlockchainListener();
  
  // Set up periodic cleanup of expired RPS challenges
  setInterval(async () => {
    await cleanupExpiredChallenges();
    cleanupExpiredTxHashes();
  }, 5 * 60 * 1000); // Run every 5 minutes
  
  // Set up daily cleanup of FINISHED football matches
  setInterval(() => {
    cleanupFinishedMatches();
  }, 24 * 60 * 60 * 1000); // Run once a day

  // Set up weekly cleanup of old transaction history
  setInterval(() => {
    const cleanupResult = virtualAccounts.cleanupOldTransactions();
    if (cleanupResult.totalCleaned > 0) {
      console.log(`🧹 Weekly cleanup: Removed ${cleanupResult.totalCleaned} old transactions from ${cleanupResult.usersProcessed} users`);
    }
  }, 7 * 24 * 60 * 60 * 1000); // Run once a week
  
  console.log('RPS challenge cleanup scheduled (every 5 minutes)');
  console.log('Football match cleanup scheduled (once a day)');
  console.log('Transaction history cleanup scheduled (once a week)');
  
  // Clean up old transaction history on startup
  const cleanupResult = virtualAccounts.cleanupOldTransactions();
  if (cleanupResult.totalCleaned > 0) {
    console.log(`🧹 Cleanup: Removed ${cleanupResult.totalCleaned} old transactions from ${cleanupResult.usersProcessed} users`);
  }

  // Refresh football match pot sizes on startup (with delay to ensure data is loaded)
  setTimeout(() => {
    console.log('[FOOTBALL] 🚀 Starting football match pot size refresh...');
    refreshAllMatchPotSizes();
  }, 2000); // 2 second delay
});

// Global error handler
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
console.log('Attempting to connect to Discord...');
client.login(process.env.TOKEN).catch(error => {
  console.error('Failed to login:', error);
}); 

// --- RPS Games Data (rps-games.json) ---
function loadRpsGamesData() {
  try {
    if (fs.existsSync(RPS_GAMES_FILE)) {
      rpsGamesData = JSON.parse(fs.readFileSync(RPS_GAMES_FILE, 'utf8'));
      console.log(`[RPS] Loaded RPS games data for ${Object.keys(rpsGamesData).length} servers`);
    }
  } catch (error) {
    console.error('[RPS] Error loading RPS games data:', error.message);
    rpsGamesData = {};
  }
}

function saveRpsGamesData() {
  try {
    fs.writeFileSync(RPS_GAMES_FILE, JSON.stringify(rpsGamesData, null, 2));
  } catch (error) {
    console.error('[RPS] Error saving RPS games data:', error.message);
  }
}

function initializeRpsGamesData(guildId) {
  if (!rpsGamesData[guildId]) {
    rpsGamesData[guildId] = {};
    saveRpsGamesData();
  }
  return rpsGamesData[guildId];
}

// --- Used Transaction Hashes Data (used-tx-hashes.json) ---
function loadUsedTxHashesData() {
  try {
    if (fs.existsSync(USED_TX_HASHES_FILE)) {
      usedTxHashesData = JSON.parse(fs.readFileSync(USED_TX_HASHES_FILE, 'utf8'));
      console.log(`[RPS] Loaded used tx hashes for ${Object.keys(usedTxHashesData).length} servers`);
    }
  } catch (error) {
    console.error('[RPS] Error loading used tx hashes:', error.message);
    usedTxHashesData = {};
  }
}

function saveUsedTxHashesData() {
  try {
    fs.writeFileSync(USED_TX_HASHES_FILE, JSON.stringify(usedTxHashesData, null, 2));
  } catch (error) {
    console.error('[RPS] Error saving used tx hashes:', error.message);
  }
}

function getUsedTxHashes(guildId) {
  if (!usedTxHashesData[guildId]) {
    usedTxHashesData[guildId] = {};
    saveUsedTxHashesData();
  }
  return usedTxHashesData[guildId];
}

// --- Token Decimals Helpers ---
const tokenDecimalsCache = {};

async function getTokenDecimals(tokenIdentifier) {
  if (tokenDecimalsCache[tokenIdentifier] !== undefined) {
    return tokenDecimalsCache[tokenIdentifier];
  }
  const apiUrl = `https://api.multiversx.com/tokens/${tokenIdentifier}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch token info: ${response.statusText}`);
  }
  const tokenInfo = await response.json();
  const decimals = tokenInfo.decimals || 0;
  tokenDecimalsCache[tokenIdentifier] = decimals;
  return decimals;
}

// Function to get full token metadata from MultiversX API with retry logic
async function getTokenMetadata(tokenIdentifier, retryCount = 0, maxRetries = 3) {
  try {
    console.log(`[TOKEN] Fetching metadata for token: ${tokenIdentifier} (attempt ${retryCount + 1}/${maxRetries + 1})`);
    const response = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}`);
    
    if (response.ok) {
      const tokenData = await response.json();
      console.log(`[TOKEN] Successfully fetched metadata for ${tokenIdentifier}: ${tokenData.decimals} decimals`);
      return {
        identifier: tokenData.identifier,
        ticker: tokenData.ticker,
        name: tokenData.name,
        decimals: tokenData.decimals,
        isPaused: tokenData.isPaused,
        lastUpdated: new Date().toISOString()
      };
    } else if (response.status === 429) {
      // Rate limited - retry with exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        console.log(`[TOKEN] Rate limited for ${tokenIdentifier}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await getTokenMetadata(tokenIdentifier, retryCount + 1, maxRetries);
      } else {
        console.error(`[TOKEN] Max retries exceeded for ${tokenIdentifier}: ${response.status} ${response.statusText}`);
        return null;
      }
    } else {
      console.error(`[TOKEN] Failed to fetch metadata for ${tokenIdentifier}: ${response.status} ${response.statusText}`);
      return null;
    }
  } catch (error) {
    if (retryCount < maxRetries) {
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      console.log(`[TOKEN] Error fetching ${tokenIdentifier}, retrying in ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return await getTokenMetadata(tokenIdentifier, retryCount + 1, maxRetries);
    } else {
      console.error(`[TOKEN] Max retries exceeded for ${tokenIdentifier}:`, error.message);
      return null;
    }
  }
}

// Function to update token metadata in server-data.json
async function updateTokenMetadata(guildId, tokenIdentifier) {
  try {
    console.log(`[TOKEN] Updating metadata for token ${tokenIdentifier} in guild ${guildId}`);
    
    // Fetch token metadata
    const tokenMetadata = await getTokenMetadata(tokenIdentifier);
    if (!tokenMetadata) {
      console.error(`[TOKEN] Failed to fetch metadata for ${tokenIdentifier}`);
      return false;
    }
    
    // Initialize token metadata storage if it doesn't exist
    if (!serverData[guildId]) {
      serverData[guildId] = {};
    }
    if (!serverData[guildId].tokenMetadata) {
      serverData[guildId].tokenMetadata = {};
    }
    
    // Store the token metadata
    serverData[guildId].tokenMetadata[tokenIdentifier] = tokenMetadata;
    
    // Save to file
    saveServerData();
    
    console.log(`[TOKEN] Successfully stored metadata for ${tokenIdentifier}: ${tokenMetadata.decimals} decimals`);
    return true;
  } catch (error) {
    console.error(`[TOKEN] Error updating token metadata for ${tokenIdentifier}:`, error.message);
    return false;
  }
}

// Function to get token decimals from stored metadata
function getStoredTokenDecimals(guildId, tokenIdentifier) {
  try {
    if (serverData[guildId] && serverData[guildId].tokenMetadata && serverData[guildId].tokenMetadata[tokenIdentifier]) {
      return serverData[guildId].tokenMetadata[tokenIdentifier].decimals;
    }
    return null; // Not found in stored metadata
  } catch (error) {
    console.error(`[TOKEN] Error getting stored decimals for ${tokenIdentifier}:`, error.message);
    return null;
  }
}

function toBlockchainAmount(humanAmount, decimals) {
  return new BigNumber(humanAmount).multipliedBy(new BigNumber(10).pow(decimals)).toFixed(0);
}

function fromBlockchainAmount(blockchainAmount, decimals) {
  return new BigNumber(blockchainAmount).dividedBy(new BigNumber(10).pow(decimals)).toString(10);
}

// Get token identifier from ticker or full identifier
async function getTokenIdentifier(tokenTicker) {
  try {
    // Check if input is already a full ESDT identifier (format: TICKER-6hexchars)
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (esdtIdentifierRegex.test(tokenTicker)) {
      console.log(`[TOKEN] Input "${tokenTicker}" recognized as a full ESDT identifier.`);
      return tokenTicker;
    }
    
    console.log(`[TOKEN] Input "${tokenTicker}" treated as a ticker, searching for identifier.`);
    // This is a simplified version - you might want to implement a proper token registry
    const response = await fetch(`https://api.multiversx.com/tokens?search=${tokenTicker}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch token info for ticker "${tokenTicker}": ${response.statusText}`);
    }
    const tokens = await response.json();
    const token = tokens.find(t => t.ticker === tokenTicker);
    if (token) {
      console.log(`[TOKEN] Found identifier "${token.identifier}" for ticker "${tokenTicker}".`);
      return token.identifier;
    } else {
      console.log(`[TOKEN] No identifier found for ticker "${tokenTicker}".`);
      return null;
    }
  } catch (error) {
    console.error(`[TOKEN] Error getting token identifier for "${tokenTicker}":`, error.message);
    return null;
  }
}

// Football API functions
async function fdGetTodayFixtures(competition) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`https://api.football-data.org/v4/competitions/${competition}/matches?dateFrom=${today}&dateTo=${today}&status=SCHEDULED`, {
      headers: {
        'X-Auth-Token': FD_TOKEN
      }
    });
    
    if (!response.ok) {
      throw new Error(`Football API error: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[FOOTBALL] Error fetching fixtures:', error.message);
    throw error;
  }
}

// Generate unique bet ID
function generateBetId(matchId, userId) {
  return `bet_${matchId}_${userId}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get transaction timestamp
async function getTransactionTimestamp(txHash) {
  try {
    const response = await fetch(`https://api.multiversx.com/transactions/${txHash}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transaction: ${response.statusText}`);
    }
    const tx = await response.json();
    return tx.timestamp ? tx.timestamp * 1000 : null; // Convert to milliseconds
  } catch (error) {
    console.error(`Error getting transaction timestamp for ${txHash}:`, error.message);
    return null;
  }
}

// Validate transaction hash format
function isValidTransactionHash(txHash) {
  return /^[a-fA-F0-9]{64}$/.test(txHash);
}

// --- Football Games Data (data/matches.json, data/bets.json) ---
function loadFootballData() {
  console.log('[FOOTBALL] 🚀 Starting football data loading...');
  try {
    if (fs.existsSync(FOOTBALL_MATCHES_FILE)) {
      footballMatchesData = JSON.parse(fs.readFileSync(FOOTBALL_MATCHES_FILE, 'utf8'));
      console.log(`[FOOTBALL] ✅ Loaded football matches data: ${Object.keys(footballMatchesData).length} matches`);
      
      // Log details about loaded matches
      const scheduledMatches = Object.values(footballMatchesData).filter(match => match.status === 'SCHEDULED' || match.status === 'TIMED');
      console.log(`[FOOTBALL] 📍 Scheduled matches: ${scheduledMatches.length}`);
        
        // Log some match details
      scheduledMatches.forEach(match => {
        console.log(`[FOOTBALL] ⏰ Scheduled match: ${match.home} vs ${match.away} (ID: ${match.matchId}) - Guilds: ${match.guildIds.length}`);
      });
    } else {
      console.log('[FOOTBALL] ⚠️ No football matches file found, starting fresh');
      footballMatchesData = {};
    }
  } catch (error) {
    console.error('[FOOTBALL] ❌ Error loading football matches data:', error.message);
    footballMatchesData = {};
  }

  try {
    if (fs.existsSync(FOOTBALL_BETS_FILE)) {
      footballBetsData = JSON.parse(fs.readFileSync(FOOTBALL_BETS_FILE, 'utf8'));
      console.log(`[FOOTBALL] Loaded football bets data for ${Object.keys(footballBetsData).length} servers`);
    }
  } catch (error) {
    console.error('[FOOTBALL] Error loading football bets data:', error.message);
    footballBetsData = {};
  }

  try {
    if (fs.existsSync(USED_TX_HASHES_FILE)) {
      usedTxHashesData = JSON.parse(fs.readFileSync(USED_TX_HASHES_FILE, 'utf8'));
      console.log(`[FOOTBALL] Loaded used transaction hashes data for ${Object.keys(usedTxHashesData).length} servers`);
    }
  } catch (error) {
    console.error('[FOOTBALL] Error loading used transaction hashes data:', error.message);
    usedTxHashesData = {};
  }

  try {
    if (fs.existsSync(FOOTBALL_LEADERBOARD_FILE)) {
      footballLeaderboardData = JSON.parse(fs.readFileSync(FOOTBALL_LEADERBOARD_FILE, 'utf8'));
      console.log(`[FOOTBALL] Loaded leaderboard data for ${Object.keys(footballLeaderboardData).length} servers`);
    } else {
      console.log('[FOOTBALL] No leaderboard file found, starting fresh');
      footballLeaderboardData = {};
    }
  } catch (error) {
    console.error('[FOOTBALL] Error loading leaderboard data:', error.message);
    footballLeaderboardData = {};
  }
}

function saveFootballMatchesData() {
  try {
    fs.writeFileSync(FOOTBALL_MATCHES_FILE, JSON.stringify(footballMatchesData, null, 2));
  } catch (error) {
    console.error('[FOOTBALL] Error saving football matches data:', error.message);
  }
}

function saveFootballBetsData() {
  try {
    fs.writeFileSync(FOOTBALL_BETS_FILE, JSON.stringify(footballBetsData, null, 2));
  } catch (error) {
    console.error('[FOOTBALL] Error saving football bets data:', error.message);
  }
}

function saveLeaderboardData() {
  try {
    fs.writeFileSync(FOOTBALL_LEADERBOARD_FILE, JSON.stringify(footballLeaderboardData, null, 2));
  } catch (error) {
    console.error('[FOOTBALL] Error saving leaderboard data:', error.message);
  }
}



// Track house spending (when house pays prizes)
function trackHouseSpending(guildId, amountWei, tokenTicker, reason = 'manual_payout') {
  try {
    const houseUserId = 'HOUSE';
    
    if (!footballLeaderboardData[guildId]) {
      footballLeaderboardData[guildId] = {};
    }
    
    if (!footballLeaderboardData[guildId][houseUserId]) {
      footballLeaderboardData[guildId][houseUserId] = {
        points: 0,
        wins: 0,
        totalEarningsWei: '0',
        totalBetsWei: '0',
        pnlWei: '0',
        lastWinISO: null,
        tokenEarnings: {},
        tokenBets: {},
        tokenPNL: {},
        isHouse: true
      };
    }
    
    const houseData = footballLeaderboardData[guildId][houseUserId];
    
    // Track total spending (using totalBetsWei for HOUSE)
    const currentSpending = new BigNumber(houseData.totalBetsWei || '0');
    const newSpending = currentSpending.plus(new BigNumber(amountWei));
    houseData.totalBetsWei = newSpending.toString();
    
    // Track per-token spending (using tokenBets for HOUSE)
    if (!houseData.tokenBets[tokenTicker]) {
      houseData.tokenBets[tokenTicker] = '0';
    }
    const currentTokenSpending = new BigNumber(houseData.tokenBets[tokenTicker] || '0');
    const newTokenSpending = currentTokenSpending.plus(new BigNumber(amountWei));
    houseData.tokenBets[tokenTicker] = newTokenSpending.toString();
    
    // Recalculate PNL for this token (earnings - spending)
    const totalTokenEarnings = new BigNumber(houseData.tokenEarnings[tokenTicker] || '0');
    houseData.tokenPNL[tokenTicker] = totalTokenEarnings.minus(newTokenSpending).toString();
    
    // Recalculate total PNL
    const totalEarnings = new BigNumber(houseData.totalEarningsWei || '0');
    houseData.pnlWei = totalEarnings.minus(newSpending).toString();
    
    // Save updated leaderboard
    saveLeaderboardData();
    
    // Log spending
    const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
    const displayDecimals = storedDecimals !== null ? storedDecimals : 8;
    const humanAmount = new BigNumber(amountWei).dividedBy(new BigNumber(10).pow(displayDecimals)).toString();
    console.log(`[HOUSE] Tracked spending: -${humanAmount} ${tokenTicker} (Reason: ${reason})`);
    
    return {
      success: true,
      newBalance: houseData.tokenPNL[tokenTicker],
      totalSpent: houseData.totalBetsWei
    };
    
  } catch (error) {
    console.error(`[HOUSE] Error tracking house spending:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Track house earnings when no winners
function trackHouseEarnings(guildId, matchId, totalPotWei, tokenDecimals, tokenTicker) {
  try {
    // Use special "HOUSE" user ID to track house balance
    const houseUserId = 'HOUSE';
    
    if (!footballLeaderboardData[guildId]) {
      footballLeaderboardData[guildId] = {};
    }
    
    if (!footballLeaderboardData[guildId][houseUserId]) {
      footballLeaderboardData[guildId][houseUserId] = {
        points: 0,
        wins: 0,
        totalEarningsWei: '0',
        totalBetsWei: '0',
        pnlWei: '0',
        lastWinISO: null,
        tokenEarnings: {},
        tokenBets: {},
        tokenPNL: {},
        isHouse: true // Mark as house account
      };
    }
    
    const houseData = footballLeaderboardData[guildId][houseUserId];
    
    // Track house earnings (prizes not distributed)
    const currentEarnings = new BigNumber(houseData.totalEarningsWei || '0');
    const newEarnings = currentEarnings.plus(new BigNumber(totalPotWei));
    houseData.totalEarningsWei = newEarnings.toString();
    
    // Track per-token earnings
    if (!houseData.tokenEarnings[tokenTicker]) {
      houseData.tokenEarnings[tokenTicker] = '0';
    }
    const currentTokenEarnings = new BigNumber(houseData.tokenEarnings[tokenTicker] || '0');
    const newTokenEarnings = currentTokenEarnings.plus(new BigNumber(totalPotWei));
    houseData.tokenEarnings[tokenTicker] = newTokenEarnings.toString();
    
    // Calculate PNL (house has no bets, only earnings)
    const totalTokenBets = new BigNumber(houseData.tokenBets[tokenTicker] || '0');
    houseData.tokenPNL[tokenTicker] = newTokenEarnings.minus(totalTokenBets).toString();
    
    // Calculate total PNL (earnings - spending)
    const totalBets = new BigNumber(houseData.totalBetsWei || '0');
    houseData.pnlWei = newEarnings.minus(totalBets).toString();
    
    // Save updated leaderboard
    saveLeaderboardData();
    
    // Log house earnings
    const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
    const displayDecimals = storedDecimals !== null ? storedDecimals : tokenDecimals;
    const humanAmount = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(displayDecimals)).toString();
    console.log(`[HOUSE] Tracked earnings from match ${matchId}: +${humanAmount} ${tokenTicker} (House balance)`);
    
  } catch (error) {
    console.error(`[HOUSE] Error tracking house earnings for match ${matchId}:`, error.message);
  }
}

// Track bet amount when user places a bet
function trackBetAmount(guildId, userId, betAmountWei, tokenTicker) {
  try {
    if (!footballLeaderboardData[guildId]) {
      footballLeaderboardData[guildId] = {};
    }
    
    if (!footballLeaderboardData[guildId][userId]) {
      footballLeaderboardData[guildId][userId] = {
        points: 0,
        wins: 0,
        totalEarningsWei: '0',
        totalBetsWei: '0',
        pnlWei: '0',
        lastWinISO: null,
        tokenEarnings: {},
        tokenBets: {},
        tokenPNL: {}
      };
    }
    
    const userData = footballLeaderboardData[guildId][userId];
    
    // Track total bet amount
    const currentTotalBets = new BigNumber(userData.totalBetsWei || '0');
    const newTotalBets = currentTotalBets.plus(new BigNumber(betAmountWei));
    userData.totalBetsWei = newTotalBets.toString();
    
    // Track bet amount per token
    if (!userData.tokenBets[tokenTicker]) {
      userData.tokenBets[tokenTicker] = '0';
    }
    const currentTokenBets = new BigNumber(userData.tokenBets[tokenTicker] || '0');
    const newTokenBets = currentTokenBets.plus(new BigNumber(betAmountWei));
    userData.tokenBets[tokenTicker] = newTokenBets.toString();
    
    // Calculate PNL for this token (earnings - bets)
    const totalTokenEarnings = new BigNumber(userData.tokenEarnings[tokenTicker] || '0');
    userData.tokenPNL[tokenTicker] = totalTokenEarnings.minus(newTokenBets).toString();
    
    // Calculate total PNL
    const totalEarnings = new BigNumber(userData.totalEarningsWei || '0');
    userData.pnlWei = totalEarnings.minus(newTotalBets).toString();
    
    // Save updated leaderboard
    saveLeaderboardData();
    
    console.log(`[FOOTBALL] Tracked bet for user ${userId}: ${betAmountWei} wei of ${tokenTicker}`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error tracking bet amount for user ${userId}:`, error.message);
  }
}

// Update leaderboard when a user wins a match
function updateLeaderboard(guildId, userId, prizeAmountWei, tokenDecimals, tokenTicker = 'REWARD-cf6eac') {
  try {
    if (!footballLeaderboardData[guildId]) {
      footballLeaderboardData[guildId] = {};
    }
    
    if (!footballLeaderboardData[guildId][userId]) {
      footballLeaderboardData[guildId][userId] = {
        points: 0,
        wins: 0,
        totalEarningsWei: '0',
        totalBetsWei: '0', // NEW: Track total bet amounts
        pnlWei: '0', // NEW: Track profit/loss
        lastWinISO: null,
        tokenEarnings: {}, // Store earnings per token
        tokenBets: {}, // NEW: Store bet amounts per token
        tokenPNL: {} // NEW: Store PNL per token
      };
    }
    
    const userData = footballLeaderboardData[guildId][userId];
    
    // Add points (3 points per win)
    userData.points += 3;
    
    // Increment wins
    userData.wins += 1;
    
    // Add to total earnings (in wei) - keep for backward compatibility
    const currentEarnings = new BigNumber(userData.totalEarningsWei || '0');
    const newEarnings = currentEarnings.plus(new BigNumber(prizeAmountWei));
    userData.totalEarningsWei = newEarnings.toString();
    
    // Add to token-specific earnings
    if (!userData.tokenEarnings[tokenTicker]) {
      userData.tokenEarnings[tokenTicker] = '0';
    }
    const currentTokenEarnings = new BigNumber(userData.tokenEarnings[tokenTicker] || '0');
    const newTokenEarnings = currentTokenEarnings.plus(new BigNumber(prizeAmountWei));
    userData.tokenEarnings[tokenTicker] = newTokenEarnings.toString();
    
    // NEW: Calculate PNL for this token
    const totalTokenEarnings = new BigNumber(userData.tokenEarnings[tokenTicker] || '0');
    const totalTokenBets = new BigNumber(userData.tokenBets[tokenTicker] || '0');
    userData.tokenPNL[tokenTicker] = totalTokenEarnings.minus(totalTokenBets).toString();
    
    // Update last win timestamp
    userData.lastWinISO = new Date().toISOString();
    
    // Save updated leaderboard
    saveLeaderboardData();
    
    // Get stored decimals for accurate logging
    const storedDecimals = getStoredTokenDecimals(guildId, tokenTicker);
    const displayDecimals = storedDecimals !== null ? storedDecimals : tokenDecimals;
    console.log(`[FOOTBALL] Updated leaderboard for user ${userId}: +3 points, +1 win, +${new BigNumber(prizeAmountWei).dividedBy(new BigNumber(10).pow(displayDecimals)).toString()} ${tokenTicker}`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error updating leaderboard for user ${userId}:`, error.message);
  }
}

function initializeFootballData(guildId) {
  // Initialize bets and leaderboard data for this guild
  if (!footballBetsData[guildId]) {
    footballBetsData[guildId] = {};
    saveFootballBetsData();
  }
  if (!footballLeaderboardData[guildId]) {
    footballLeaderboardData[guildId] = {};
    saveLeaderboardData();
  }
  // Note: footballMatchesData is now flat structure, no guild-specific initialization needed
}

// Get guild-specific stake amount for a match
// Supports both old format (global requiredAmountWei) and new format (per-guild stakes)
function getMatchStakeForGuild(match, guildId) {
  // New format: per-guild stakes stored in requiredAmountWeiPerGuild
  if (match.requiredAmountWeiPerGuild && match.requiredAmountWeiPerGuild[guildId]) {
    return match.requiredAmountWeiPerGuild[guildId];
  }
  
  // Old format: global requiredAmountWei (backward compatibility)
  if (match.requiredAmountWei) {
    return match.requiredAmountWei;
  }
  
  // Fallback: return 0 if no stake found
  console.warn(`[FOOTBALL] No stake found for match ${match.matchId} in guild ${guildId}`);
  return '0';
}

// Calculate current pot size for a football match
function calculateMatchPotSize(guildId, matchId) {
  try {
    const allBets = Object.values(footballBetsData[guildId] || {});
    const matchBets = allBets.filter(bet => bet.matchId === matchId);
    
    const totalPotWei = matchBets.reduce((total, bet) => total + Number(bet.amountWei), 0);
    
    // Get match data to access token decimals
    const match = footballMatchesData[matchId];
    if (!match || !match.guildIds.includes(guildId)) return { totalPotWei: 0, totalPotHuman: '0' };
    
    const totalPotHuman = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(match.token.decimals)).toString();
    
    return {
      totalPotWei: totalPotWei,
      totalPotHuman: totalPotHuman
    };
  } catch (error) {
    console.error('[FOOTBALL] Error calculating pot size:', error.message);
    return { totalPotWei: 0, totalPotHuman: '0' };
  }
}

// Refresh all match pot sizes on bot startup
function refreshAllMatchPotSizes() {
  try {
    console.log('[FOOTBALL] Refreshing all match pot sizes...');
    let totalMatches = 0;
    let updatedMatches = 0;
    
    for (const matchId in footballMatchesData) {
      const match = footballMatchesData[matchId];
        totalMatches++;
        
      if (match.status === 'SCHEDULED' || match.status === 'TIMED') {
          try {
          // Calculate pot size for each guild that has this match
          for (const guildId of match.guildIds) {
            const potSize = calculateMatchPotSize(guildId, matchId);
            console.log(`[FOOTBALL] Match ${matchId} (${guildId}) pot size: ${potSize.totalPotHuman} ${match.token.ticker}`);
          }
          updatedMatches++;
          } catch (error) {
            console.error(`[FOOTBALL] Error calculating pot size for match ${matchId}:`, error.message);
        }
      }
    }
    
    console.log(`[FOOTBALL] Refreshed pot sizes for ${updatedMatches}/${totalMatches} matches`);
  } catch (error) {
    console.error('[FOOTBALL] Error refreshing match pot sizes:', error.message);
  }
}

// Check and update match results from football-data.org API
// Fixed checkAndUpdateMatchResults function
let isCheckingMatches = false;

async function checkAndUpdateMatchResults() {
  // Prevent multiple simultaneous API checks
  if (isCheckingMatches) {
    console.log('[FOOTBALL] ⏳ API check already in progress, skipping this cycle...');
    return 0;
  }
  
  isCheckingMatches = true;
  
  try {
    console.log('[FOOTBALL] 🔍 Starting periodic match result check...');
    console.log(`[FOOTBALL] 📊 FD_TOKEN available: ${FD_TOKEN ? '✅ Yes' : '❌ No'}`);
    
    if (!FD_TOKEN) {
      console.log('[FOOTBALL] ❌ No FD_TOKEN available, skipping API calls');
      return 0;
    }
    
    // Add initial delay to respect rate limits
    console.log('[FOOTBALL] Rate limiting: waiting 3 seconds before starting API calls...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    let totalMatches = 0;
    let updatedMatches = 0;
    
    // Get all unfinished matches
    const unfinishedMatches = Object.values(footballMatchesData).filter(match => 
      match.status !== 'FINISHED' && match.compCode
    );
    
    // Sort matches by kickoff time (earliest first) to prioritize matches that should be starting soon
    const sortedMatches = unfinishedMatches.sort((a, b) => {
      const timeA = new Date(a.kickoffISO).getTime();
      const timeB = new Date(b.kickoffISO).getTime();
      return timeA - timeB;
    });
    
    console.log(`[FOOTBALL] Checking ${sortedMatches.length} matches with exponential backoff retry system`);
    console.log(`[FOOTBALL] Match IDs to check: ${sortedMatches.map(m => m.matchId).join(', ')}`);
    
    for (const match of sortedMatches) {
        totalMatches++;
      
      try {
        console.log(`[FOOTBALL] ⚽ Checking match ${match.matchId} (${match.home} vs ${match.away}) - Status: ${match.status}`);
        
        // Exponential backoff retry system: 2s, 4s, 8s, 16s
        let apiData = null;
        let newStatus = null;
        let newScore = null;
        let success = false;
        
        for (let attempt = 1; attempt <= 4; attempt++) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
          
          if (attempt > 1) {
            console.log(`[FOOTBALL] 🔄 Attempt ${attempt}/4 for match ${match.matchId}, waiting ${delay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
              try {
                const response = await fetch(`https://api.football-data.org/v4/matches/${match.matchId}`, {
                  headers: {
                    'X-Auth-Token': FD_TOKEN
                  }
                });
                
                if (response.ok) {
              apiData = await response.json();
              newStatus = apiData.status;
              newScore = apiData.score?.fullTime;
              success = true;
              console.log(`[FOOTBALL] ✅ Match ${match.matchId} API success on attempt ${attempt}: status=${newStatus}, score=${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
              break;
            } else if (response.status === 429) {
              console.log(`[FOOTBALL] ⚠️ Rate limit hit for match ${match.matchId} on attempt ${attempt}`);
              if (attempt === 4) {
                console.log(`[FOOTBALL] ❌ All retry attempts failed for match ${match.matchId} due to rate limits`);
                break;
              }
                } else {
              console.log(`[FOOTBALL] ❌ API error for match ${match.matchId} on attempt ${attempt}: ${response.status} ${response.statusText}`);
              if (attempt === 4) {
                console.log(`[FOOTBALL] ❌ All retry attempts failed for match ${match.matchId}`);
                break;
              }
            }
          } catch (error) {
            console.log(`[FOOTBALL] ❌ Network error for match ${match.matchId} on attempt ${attempt}: ${error.message}`);
            if (attempt === 4) {
              console.log(`[FOOTBALL] ❌ All retry attempts failed for match ${match.matchId}`);
              break;
            }
          }
        }
        
        if (!success) {
          console.log(`[FOOTBALL] ⏭️ Skipping match ${match.matchId} - all retry attempts failed`);
          continue;
        }
        
        console.log(`[FOOTBALL] 📊 Match ${match.matchId} API result: status=${newStatus}, score=${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
        
        // Check if we have updates
        const statusChanged = newStatus !== match.status;
        const scoreChanged = newScore && newScore.home !== undefined && newScore.away !== undefined && 
          (match.ftScore.home !== newScore.home || match.ftScore.away !== newScore.away);
        
        console.log(`[FOOTBALL] Debug - Match ${match.matchId}: statusChanged=${statusChanged}, scoreChanged=${scoreChanged}`);
        console.log(`[FOOTBALL] Debug - Current: status=${match.status}, score=${match.ftScore.home}-${match.ftScore.away}`);
        console.log(`[FOOTBALL] Debug - New: status=${newStatus}, score=${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
        
        if (statusChanged || scoreChanged) {
          // Store old status before updating
          const oldStatus = match.status;
          
          // Update match data
          match.status = newStatus;
          
          if (newScore && newScore.home !== undefined && newScore.away !== undefined) {
            match.ftScore = { home: newScore.home, away: newScore.away };
          }
          
          // Update embeds if there was a status change OR score change
          if (oldStatus !== newStatus || scoreChanged) {
            console.log(`[FOOTBALL] ${oldStatus !== newStatus ? 'Status' : 'Score'} changed, updating embeds...`);
            for (const guildId of match.guildIds) {
              await updateMatchEmbed(guildId, match.matchId);
            }
          }
          
          // If match is finished, process prizes for all guilds
          if (newStatus === 'FINISHED') {
            console.log(`[FOOTBALL] 🏁 Match ${match.matchId} finished! Processing prizes...`);
            for (const guildId of match.guildIds) {
              await processMatchPrizes(guildId, match.matchId);
            }
          }
                
                updatedMatches++;
          console.log(`[FOOTBALL] ✅ Updated match ${match.matchId} - Status: ${newStatus}, Score: ${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
              } else {
          console.log(`[FOOTBALL] No updates for match ${match.matchId}`);
              }
        
          } catch (error) {
        console.error(`[FOOTBALL] Error updating match ${match.matchId}:`, error.message);
      }
    }
    
    if (updatedMatches > 0) {
      saveFootballMatchesData();
      console.log(`[FOOTBALL] Updated ${updatedMatches} finished matches`);
    }
    
    return updatedMatches;
  } catch (error) {
    console.error('[FOOTBALL] Error checking match results:', error.message);
    return 0;
  } finally {
    isCheckingMatches = false;
  }
}



// Update match embed to show finished status
async function updateMatchEmbed(guildId, matchId) {
  try {
    console.log(`[FOOTBALL] Updating embed for match ${matchId} in guild ${guildId}`);
    const match = footballMatchesData[matchId];
    if (!match) {
      console.log(`[FOOTBALL] Match ${matchId} not found in footballMatchesData`);
      return;
    }
    if (!match.embeds[guildId]) {
      console.log(`[FOOTBALL] No embed info found for match ${matchId} in guild ${guildId}`);
      return;
    }
    
    const embedInfo = match.embeds[guildId];
    const messageId = embedInfo.messageId;
    const threadId = embedInfo.threadId;
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    
    // Find the channel where the match was posted
    let matchChannel = null;
    for (const channel of guild.channels.cache.values()) {
      if (channel.type === 0) { // Text channel
        try {
          const message = await channel.messages.fetch(messageId);
          if (message) {
            matchChannel = channel;
            break;
          }
        } catch (error) {
          // Message not found in this channel, continue searching
        }
      }
    }
    
    if (!matchChannel) {
      console.error(`[FOOTBALL] Could not find channel for match ${matchId}`);
      return;
    }
    
    const message = await matchChannel.messages.fetch(messageId);
    if (!message) return;
    
    // Calculate final pot size
    const potSize = calculateMatchPotSize(guildId, matchId);
    
    // Create updated embed based on match status
    let title, statusText, color, footerText;
    
    if (match.status === 'FINISHED') {
      title = `🏁 ${match.home} vs ${match.away} - FINISHED`;
      statusText = '🏁 Match Finished';
      color = '#FF0000';
      footerText = 'Match finished - prizes will be distributed soon';
    } else if (match.status === 'CANCELED' || match.status === 'CANCELLED') {
      title = `❌ ${match.home} vs ${match.away} - CANCELED`;
      statusText = '❌ Match Canceled';
      color = '#FF0000';
      footerText = 'Match canceled - all bets will be refunded';
    } else if (match.status === 'IN_PLAY') {
      title = `⚽ ${match.home} vs ${match.away} - LIVE`;
      statusText = '🔴 Match In Progress';
      color = '#FFA500';
      footerText = 'Match is live - betting closed';
    } else if (match.status === 'PAUSED') {
      title = `⚽ ${match.home} vs ${match.away} - PAUSED`;
      statusText = '⏸️ Match Paused (Half Time)';
      color = '#FFA500';
      footerText = 'Match is paused - betting closed';
    } else if (match.status === 'SCHEDULED' || match.status === 'TIMED') {
      title = `⚽ ${match.home} vs ${match.away} - ${match.status === 'TIMED' ? 'TIMED' : 'SCHEDULED'}`;
      statusText = match.status === 'TIMED' ? '🟡 Starting Soon' : '📊 SCHEDULED';
      color = match.status === 'TIMED' ? '#FFA500' : '#00FF00'; // Orange for TIMED, Green for SCHEDULED
      footerText = 'Click Bet below to place your bet!';
    } else {
      title = `⚽ ${match.home} vs ${match.away} - ${match.status}`;
      statusText = `📊 ${match.status}`;
      color = '#00FF00';
      footerText = 'Click Bet below to place your bet!';
    }
    
    // Create fields array
    const stakeAmountWei = getMatchStakeForGuild(match, guildId);
    const stakeAmountHuman = new BigNumber(stakeAmountWei).dividedBy(new BigNumber(10).pow(match.token.decimals)).toString();
    const fields = [
        { name: '🏆 Competition', value: match.compName, inline: true },
        { name: '🎮 Game ID', value: matchId, inline: true },
        { name: '💰 Stake', value: `${stakeAmountHuman} ${match.token.ticker}`, inline: true },
      { name: '🏆 Pot Size', value: `${potSize.totalPotHuman} ${match.token.ticker}`, inline: true },
        { name: '📊 Score', value: `${match.ftScore.home} - ${match.ftScore.away}`, inline: true },
      { name: '⏰ Status', value: statusText, inline: true }
    ];
    
    // Add kickoff timer for SCHEDULED and TIMED matches
    if (match.status === 'SCHEDULED' || match.status === 'TIMED') {
      const kickoffTime = new Date(match.kickoffISO);
      fields.push({
        name: '⏰ Kickoff',
        value: `<t:${Math.floor(kickoffTime.getTime() / 1000)}:f>\n(<t:${Math.floor(kickoffTime.getTime() / 1000)}:R>)`,
        inline: false
      });
    }
    
    const updatedEmbed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(`**${match.compName}** • Game ID: \`${matchId}\``)
      .addFields(fields)
      .setColor(color)
      .setFooter({ text: footerText, iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
      .setTimestamp();
    
    // Remove the Bet button only for finished matches
    let newComponents = [];
    if (match.status === 'FINISHED') {
      newComponents = []; // Remove all buttons for finished matches
    } else {
      // Keep the Bet button for live/scheduled matches
      const betButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`bet:${matchId}`)
            .setLabel('Bet')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚽')
        );
      newComponents = [betButton];
    }
    
    await message.edit({ embeds: [updatedEmbed], components: newComponents });
    console.log(`[FOOTBALL] Updated embed for match ${matchId} (Status: ${match.status}, Score: ${match.ftScore.home}-${match.ftScore.away})`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error updating match embed ${matchId}:`, error.message);
  }
}

// Process prizes for a finished match
async function processMatchPrizes(guildId, matchId) {
  try {
    const match = footballMatchesData[matchId];
    if (!match || !match.guildIds.includes(guildId)) return;
    
    const guildBets = footballBetsData[guildId] || {};
    const matchBets = Object.values(guildBets).filter(bet => bet.matchId === matchId);
    
    if (matchBets.length === 0) {
      console.log(`[FOOTBALL] No bets found for match ${matchId}, skipping prize distribution`);
      return;
    }
    
    console.log(`[FOOTBALL] Processing prizes for match ${matchId} with ${matchBets.length} bets`);
    
    // Step 1: Use stored score (already fetched by checkAndUpdateMatchResults)
    let matchResult = null;
    
    // Use the stored score from the match data (already fetched by the periodic checker)
        if (match.ftScore && match.ftScore.home !== undefined && match.ftScore.away !== undefined) {
          matchResult = { score: { fullTime: { home: match.ftScore.home, away: match.ftScore.away } } };
          console.log(`[FOOTBALL] Using stored score for ${matchId}: ${match.ftScore.home}-${match.ftScore.away}`);
        } else {
          console.log(`[FOOTBALL] No score available for match ${matchId}, cannot determine winners`);
          return;
    }
    
    // Step 2: Determine the winning outcome
    let winningOutcome = null;
    if (matchResult && matchResult.score && matchResult.score.fullTime) {
      const homeScore = matchResult.score.fullTime.home;
      const awayScore = matchResult.score.fullTime.away;
      
      if (homeScore > awayScore) {
        winningOutcome = 'H'; // Home win
      } else if (awayScore > homeScore) {
        winningOutcome = 'A'; // Away win
      } else {
        winningOutcome = 'D'; // Draw
      }
      
      console.log(`[FOOTBALL] Match ${matchId} result: ${homeScore}-${awayScore}, winning outcome: ${winningOutcome}`);
      
      // Update stored score if we got it from API
      if (!match.ftScore || match.ftScore.home === undefined) {
        match.ftScore = { home: homeScore, away: awayScore };
        saveFootballMatchesData();
      }
    } else {
      console.log(`[FOOTBALL] No valid score data for match ${matchId}`);
      return;
    }
    
    // Step 3: Identify winners
    const winners = matchBets.filter(bet => bet.outcome === winningOutcome);
    const losers = matchBets.filter(bet => bet.outcome !== winningOutcome);
    
    console.log(`[FOOTBALL] Match ${matchId} winners: ${winners.length}, losers: ${losers.length}`);
    
    // Step 4: Calculate prize distribution
    const totalPotWei = matchBets.reduce((total, bet) => total + Number(bet.amountWei), 0);
    const totalPotHuman = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(match.token.decimals)).toString();
    
    if (winners.length === 0) {
      console.log(`[FOOTBALL] No winners for match ${matchId}, all bets lose`);
      
      // Track house earnings when no winners
      trackHouseEarnings(guildId, matchId, totalPotWei, match.token.decimals, match.token.ticker);
      
      // Send notification that all bets lost
      await sendNoWinnersNotification(guildId, matchId, losers, winningOutcome, totalPotHuman);
      return;
    }
    
    // Winners split the pot equally
    const prizePerWinnerWei = Math.floor(totalPotWei / winners.length);
    const prizePerWinnerHuman = new BigNumber(prizePerWinnerWei).dividedBy(new BigNumber(10).pow(match.token.decimals)).toString();
    
    console.log(`[FOOTBALL] Match ${matchId} total pot: ${totalPotHuman} ${match.token.ticker}`);
    console.log(`[FOOTBALL] Prize per winner: ${prizePerWinnerHuman} ${match.token.ticker}`);
    
    // Step 5: Distribute prizes to winners using virtual accounts
    console.log(`[FOOTBALL] Distributing prizes to virtual accounts for ${winners.length} winners`);
    
    for (const winner of winners) {
      try {
        console.log(`[FOOTBALL] Adding ${prizePerWinnerHuman} ${match.token.ticker} to virtual account for winner ${winner.userId}`);
        
        // Add prize to winner's virtual account
        const prizeResult = virtualAccounts.addFundsToAccount(
          guildId,
          winner.userId,
          match.token.ticker,
          prizePerWinnerHuman,
          null, // No transaction hash for virtual prize
          'football_prize'
        );
        
        if (prizeResult.success) {
          console.log(`[FOOTBALL] Successfully added prize to virtual account for ${winner.userId}: ${prizeResult.newBalance} ${match.token.ticker}`);
          
          // Update bet status to indicate prize sent
          if (!footballBetsData[guildId]) footballBetsData[guildId] = {};
          if (!footballBetsData[guildId][winner.betId]) footballBetsData[guildId][winner.betId] = {};
          footballBetsData[guildId][winner.betId].prizeSent = true;
          footballBetsData[guildId][winner.betId].prizeAmount = prizePerWinnerHuman;
          footballBetsData[guildId][winner.betId].prizeTxHash = 'VIRTUAL_PRIZE'; // Mark as virtual prize
          saveFootballBetsData();
          
          // Update leaderboard for this winner
          updateLeaderboard(guildId, winner.userId, prizePerWinnerWei, match.token.decimals, match.token.ticker);
          
        } else {
          console.error(`[FOOTBALL] Failed to add prize to virtual account for ${winner.userId}: ${prizeResult.error}`);
        }
        
      } catch (prizeError) {
        console.error(`[FOOTBALL] Error adding prize to virtual account for ${winner.userId}:`, prizeError.message);
      }
    }
    
    console.log(`[FOOTBALL] Completed virtual prize distribution for match ${matchId}`);
    
    // Step 6: Send winner notification to match thread
    await sendWinnerNotification(guildId, matchId, winners, losers, winningOutcome, totalPotHuman, prizePerWinnerHuman);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error processing prizes for match ${matchId}:`, error.message);
  }
}

// Send winner notification to match thread
async function sendWinnerNotification(guildId, matchId, winners, losers, winningOutcome, totalPotHuman, prizePerWinnerHuman) {
  try {
    const match = footballMatchesData[matchId];
    if (!match || !match.guildIds.includes(guildId) || !match.embeds[guildId]?.threadId) {
      console.log(`[FOOTBALL] No thread found for match ${matchId}, cannot send winner notification`);
      return;
    }
    
    // Get guild for thread access
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.log(`[FOOTBALL] Guild not found for ${guildId}, cannot send winner notification`);
      return;
    }
    
    // Fetch the thread
    const thread = await guild.channels.fetch(match.embeds[guildId].threadId);
    if (!thread) {
      console.log(`[FOOTBALL] Thread ${match.embeds[guildId].threadId} not found for match ${matchId}`);
      return;
    }
    
    // Get winner details with transaction hashes
    const winnerDetails = winners.map(winner => {
      const bet = Object.values(footballBetsData[guildId] || {}).find(b => b.betId === winner.betId);
      // prizeAmount is already stored in human-readable format, no need to divide by decimals again
      const prizeAmount = bet?.prizeAmount || prizePerWinnerHuman;
      const txHash = bet?.prizeTxHash || 'Processing...';
      
      return {
        userId: winner.userId,
        amount: prizeAmount,
        txHash: txHash
      };
    });
    
    // Create winner notification embed
    const winnerEmbed = new EmbedBuilder()
      .setTitle(`🏆 ${match.home} vs ${match.away} - WINNERS ANNOUNCED!`)
      .setDescription(`**${match.compName}** • Game ID: \`${matchId}\``)
      .addFields([
        { name: '📊 Final Score', value: `${match.ftScore.home} - ${match.ftScore.away}`, inline: true },
        { name: '🎯 Winning Outcome', value: winningOutcome, inline: true },
        { name: '💰 Total Pot', value: `${totalPotHuman} ${match.token.ticker}`, inline: true },
        { name: '🏆 Winners', value: `${winners.length} player(s)`, inline: true },
        { name: '💎 Prize per Winner', value: `${prizePerWinnerHuman} ${match.token.ticker}`, inline: true },
        { name: '❌ Losers', value: `${losers.length} player(s)`, inline: true }
      ])
      .setColor('#00FF00')
      .setFooter({ text: 'Prizes have been added to your virtual accounts! Use /check-balance to see your winnings.', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
      .setTimestamp();
    
    // Send the main winner announcement
    await thread.send({ embeds: [winnerEmbed] });
    
    // Send detailed winner list
    if (winnerDetails.length > 0) {
      const winnerListEmbed = new EmbedBuilder()
        .setTitle('👑 Winner Details')
        .setDescription('Here are the winners and their prize distribution details:')
        .setColor('#FFD700');
      
      for (const winner of winnerDetails) {
        const user = await client.users.fetch(winner.userId).catch(() => null);
        const username = user ? user.username : `User ${winner.userId}`;
        
        winnerListEmbed.addFields({
          name: `🏆 ${username}`,
          value: `**Prize:** ${winner.amount} ${match.token.ticker}\n**Status:** Added to virtual account`,
          inline: false
        });
      }
      
      await thread.send({ embeds: [winnerListEmbed] });
    }
    
    // Send loser summary if there are losers
    if (losers.length > 0) {
      const loserEmbed = new EmbedBuilder()
        .setTitle('😔 Better Luck Next Time!')
        .setDescription(`Unfortunately, ${losers.length} player(s) didn't win this match. Keep betting and good luck in future matches!`)
        .setColor('#FF6B6B')
        .setTimestamp();
      
      await thread.send({ embeds: [loserEmbed] });
    }
    
    console.log(`[FOOTBALL] Winner notification sent to thread ${match.embeds[guildId].threadId} for match ${matchId}`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error sending winner notification for match ${matchId}:`, error.message);
  }
}

// Send notification when no one wins (all bets lose)
async function sendNoWinnersNotification(guildId, matchId, losers, winningOutcome, totalPotHuman) {
  try {
    const match = footballMatchesData[matchId];
    if (!match || !match.guildIds.includes(guildId) || !match.embeds[guildId]?.threadId) {
      console.log(`[FOOTBALL] No thread found for match ${matchId}, cannot send no-winners notification`);
      return;
    }
    
    // Get guild for thread access
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.log(`[FOOTBALL] Guild not found for ${guildId}, cannot send no-winners notification`);
      return;
    }
    
    // Fetch the thread
    const thread = await guild.channels.fetch(match.embeds[guildId].threadId);
    if (!thread) {
      console.log(`[FOOTBALL] Thread ${match.embeds[guildId].threadId} not found for match ${matchId}`);
      return;
    }
    
    // Create no-winners notification embed
    const noWinnersEmbed = new EmbedBuilder()
      .setTitle(`😱 ${match.home} vs ${match.away} - NO WINNERS!`)
      .setDescription(`**${match.compName}** • Game ID: \`${matchId}\``)
      .addFields([
        { name: '📊 Final Score', value: `${match.ftScore.home} - ${match.ftScore.away}`, inline: true },
        { name: '🎯 Winning Outcome', value: winningOutcome, inline: true },
        { name: '💰 Total Pot', value: `${totalPotHuman} ${match.token.ticker}`, inline: true },
        { name: '❌ All Bets Lost', value: `${losers.length} player(s)`, inline: true },
        { name: '💸 House Takes All', value: 'No prizes distributed', inline: true }
      ])
      .setColor('#FF6B6B')
      .setFooter({ text: 'Better luck next time! The house keeps all stakes.', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
      .setTimestamp();
    
    // Send the no-winners announcement
    await thread.send({ embeds: [noWinnersEmbed] });
    
    // Send consolation message
    const consolationEmbed = new EmbedBuilder()
      .setTitle('😔 Tough Break!')
      .setDescription(`All ${losers.length} player(s) bet on the wrong outcome. The total pot of **${totalPotHuman} ${match.token.ticker}** will be kept by the house.\n\nDon't give up! Keep betting and your luck will turn around! 🍀`)
      .setColor('#FF6B6B')
      .setTimestamp();
    
    await thread.send({ embeds: [consolationEmbed] });
    
    console.log(`[FOOTBALL] No-winners notification sent to thread ${match.embeds[guildId].threadId} for match ${matchId}`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error sending no-winners notification for match ${matchId}:`, error.message);
  }
}

// Function to properly update used-tx-hashes.json
function updateUsedTxHashes(guildId, txHash) {
  try {
    if (!usedTxHashesData[guildId]) {
      usedTxHashesData[guildId] = {};
    }
    
    usedTxHashesData[guildId][txHash] = {
      timestamp: Date.now(),
      guildId: guildId
    };
    
    // Save to file
    fs.writeFileSync(USED_TX_HASHES_FILE, JSON.stringify(usedTxHashesData, null, 2));
    console.log(`[FOOTBALL] Updated used-tx-hashes.json with transaction ${txHash}`);
  } catch (error) {
    console.error('[FOOTBALL] Error updating used-tx-hashes.json:', error.message);
  }
}

// Set up simple round-robin match checking (every 15 seconds, one match at a time)
console.log('[FOOTBALL] ⏰ Setting up simple round-robin match checking every 15 seconds...');

let currentMatchIndex = 0;
let allMatches = [];

// Initialize the match list
function initializeMatchList() {
  const unfinishedMatches = Object.values(footballMatchesData).filter(match => 
    match.status !== 'FINISHED' && match.status !== 'CANCELED' && match.status !== 'CANCELLED' && match.compCode
  );
  
  // Sort matches by kickoff time (earliest first) to prioritize matches starting soon
  allMatches = unfinishedMatches.sort((a, b) => {
    const timeA = new Date(a.kickoffISO).getTime();
    const timeB = new Date(b.kickoffISO).getTime();
    return timeA - timeB;
  });
  
  console.log(`[FOOTBALL] 📋 Loaded ${allMatches.length} matches for round-robin checking (sorted by kickoff time)`);
  if (allMatches.length > 0) {
    console.log(`[FOOTBALL] 🕐 Next match: ${allMatches[0].home} vs ${allMatches[0].away} at ${allMatches[0].kickoffISO}`);
  }
}

// Check a single match
async function checkSingleMatch() {
  // Reinitialize match list every 10 cycles (2.5 minutes) to pick up new matches
  if (allMatches.length === 0 || (currentMatchIndex % 10 === 0)) {
    initializeMatchList();
    if (allMatches.length === 0) {
      return;
    }
  }
  
  if (currentMatchIndex >= allMatches.length) {
    currentMatchIndex = 0; // Reset to beginning
  }
  
  const match = allMatches[currentMatchIndex];
  currentMatchIndex++;
  
  try {
    console.log(`[FOOTBALL] ⚽ Checking match ${match.matchId} (${match.home} vs ${match.away}) - Status: ${match.status}`);
    
    const response = await fetch(`https://api.football-data.org/v4/matches/${match.matchId}`, {
      headers: {
        'X-Auth-Token': FD_TOKEN
      }
    });
    
    if (!response.ok) {
      console.log(`[FOOTBALL] ❌ API error for match ${match.matchId}: ${response.status} ${response.statusText}`);
      return;
    }
    
    const apiData = await response.json();
    const newStatus = apiData.status;
    const newScore = apiData.score?.fullTime;
    
    console.log(`[FOOTBALL] 📊 Match ${match.matchId} API result: status=${newStatus}, score=${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
    
    // Check if we have updates
    const statusChanged = newStatus !== match.status;
    const scoreChanged = newScore && newScore.home !== undefined && newScore.away !== undefined && 
      (match.ftScore.home !== newScore.home || match.ftScore.away !== newScore.away);
    
    if (statusChanged || scoreChanged) {
      // Store old status before updating
      const oldStatus = match.status;
      
      // Update match data
      match.status = newStatus;
      
      if (newScore && newScore.home !== undefined && newScore.away !== undefined) {
        match.ftScore = { home: newScore.home, away: newScore.away };
      }
      
      // Update embeds if there was a status change OR score change
      if (oldStatus !== newStatus || scoreChanged) {
        console.log(`[FOOTBALL] ${oldStatus !== newStatus ? 'Status' : 'Score'} changed, updating embeds...`);
        for (const guildId of match.guildIds) {
          await updateMatchEmbed(guildId, match.matchId);
        }
      }
      
      // If match is finished, process prizes for all guilds
      if (newStatus === 'FINISHED') {
        console.log(`[FOOTBALL] 🏁 Match ${match.matchId} finished! Processing prizes...`);
        for (const guildId of match.guildIds) {
          await processMatchPrizes(guildId, match.matchId);
        }
        // Remove finished match from the list
        allMatches = allMatches.filter(m => m.matchId !== match.matchId);
        if (currentMatchIndex >= allMatches.length) {
          currentMatchIndex = 0;
        }
      }
      
      console.log(`[FOOTBALL] ✅ Updated match ${match.matchId} - Status: ${newStatus}, Score: ${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
      saveFootballMatchesData();
    } else {
      console.log(`[FOOTBALL] No updates for match ${match.matchId}`);
    }
    
  } catch (error) {
    console.error(`[FOOTBALL] Error checking match ${match.matchId}:`, error.message);
  }
}

// Initialize match list on startup
setTimeout(() => {
  initializeMatchList();
}, 5000);

// Check one match every 15 seconds
setInterval(async () => {
  try {
    await checkSingleMatch();
  } catch (error) {
    console.error('[FOOTBALL] Error in single match check:', error.message);
  }
}, 15 * 1000); // 15 seconds