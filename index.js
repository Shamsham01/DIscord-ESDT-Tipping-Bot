require('dotenv').config();
console.log('Starting Multi-Server ESDT Tipping Bot with Virtual Accounts...');
console.log('Environment variables:', {
  TOKEN: process.env.TOKEN ? 'Set' : 'Missing',
  API_BASE_URL: process.env.API_BASE_URL ? 'Set' : 'Missing',
  API_TOKEN: process.env.API_TOKEN ? 'Set' : 'Missing',
  FD_TOKEN: process.env.FD_TOKEN ? 'Set' : 'Missing',
  API_BASE_URL: process.env.API_BASE_URL ? 'Set' : 'Missing',
});

const { Client, IntentsBitField, EmbedBuilder, PermissionsBitField, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ChannelType } = require('discord.js');
const fetch = require('node-fetch');
const BigNumber = require('bignumber.js');

// Import virtual accounts and blockchain listener
const virtualAccounts = require('./virtual-accounts.js');
const virtualAccountsNFT = require('./db/virtual-accounts-nft');
const blockchainListener = require('./blockchain-listener.js');

// Import database modules
const dbServerData = require('./db/server-data');
const dbRpsGames = require('./db/rps-games');
const dbFootball = require('./db/football');
const dbAuctions = require('./db/auctions');
const dbLeaderboard = require('./db/leaderboard');
const dbLottery = require('./db/lottery');

// Import lottery helpers
const lotteryHelpers = require('./utils/lottery-helpers');

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

// All data is now stored in Supabase database
// Wallet timestamps for blockchain listener are stored in Supabase (wallet_timestamps table)

// All server data is stored in Supabase database
// Use dbServerData module directly

// Removed - data is saved to database immediately when changed

// Initialize server data if it doesn't exist (async version using database)
async function initializeServerData(guildId) {
  try {
    const settings = await dbServerData.getGuildSettings(guildId);
    if (!settings) {
      // Create initial guild settings
      await dbServerData.updateGuildSettings(guildId, {
        createdAt: Date.now()
      });
    }
  } catch (error) {
    console.error(`[DB] Error initializing server data for guild ${guildId}:`, error.message);
  }
}

// Helper function to get community fund project name (for display)
async function getCommunityFundProject(guildId) {
  try {
    const settings = await dbServerData.getGuildSettings(guildId);
    return settings?.communityFundProject || null;
  } catch (error) {
    console.error(`[DB] Error getting community fund project:`, error.message);
    return null;
  }
}

// Helper function to get the actual project name for lookups (always "Community Fund")
function getCommunityFundProjectName() {
  return 'Community Fund';
}

// Helper function to create error embed for insufficient balances
async function createBalanceErrorEmbed(guildId, balanceCheck, commandName) {
  const embed = new EmbedBuilder()
    .setTitle('❌ Insufficient Community Fund Balances')
    .setDescription(`Cannot proceed with **${commandName}** due to insufficient balances in the Community Fund wallet.`)
    .setColor(0xFF0000)
    .setTimestamp()
    .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
  
  // Format REWARD balances to 2 decimal places
  const formatReward = (value) => {
    const num = parseFloat(value || '0');
    return isNaN(num) ? '0.00' : num.toFixed(2);
  };
  
  // Calculate totals and differences
  const onChainReward = parseFloat(balanceCheck.rewardBalanceOnChain || '0');
  const virtualAccountReward = parseFloat(balanceCheck.rewardBalanceVirtualAccount || '0');
  const houseBalanceReward = parseFloat(balanceCheck.rewardBalanceHouseBalance || '0');
  const totalInVirtualAccounts = virtualAccountReward + houseBalanceReward;
  const difference = onChainReward - totalInVirtualAccounts;
  const usageFeeReward = parseFloat(balanceCheck.requiredReward || '0');
  const neededToWithdraw = Math.max(0, -difference) + Math.ceil(usageFeeReward * 100) / 100; // Round up usage fee
  
  // Add simplified balance information
  embed.addFields([
    { name: '💰 EGLD Balance', value: `${balanceCheck.egldBalance} EGLD`, inline: true },
    { name: '📊 Required EGLD', value: `${balanceCheck.requiredEgld} EGLD`, inline: true },
    { name: '✅ EGLD Status', value: new BigNumber(balanceCheck.egldBalance).isGreaterThanOrEqualTo(new BigNumber(balanceCheck.requiredEgld)) ? '✅ Sufficient' : '❌ Insufficient', inline: true },
    { name: '💼 Total in Wallet (On-Chain)', value: `${formatReward(balanceCheck.rewardBalanceOnChain)} REWARD`, inline: false },
    { name: '📦 Total in Virtual Accounts', value: `${formatReward(totalInVirtualAccounts)} REWARD\n• Virtual Accounts: ${formatReward(virtualAccountReward)}\n• House Balance: ${formatReward(houseBalanceReward)}`, inline: false },
    { name: '📊 Difference', value: `${formatReward(difference)} REWARD`, inline: true },
    { name: '💵 1 Transfer Usage Fee', value: `${formatReward(Math.ceil(usageFeeReward * 100) / 100)} REWARD`, inline: true },
    { name: '⚠️ Needed to Perform Withdraw', value: `${formatReward(neededToWithdraw)} REWARD`, inline: true }
  ]);
  
  // Add informational note about transferring REWARD
  if (balanceCheck.walletAddress && neededToWithdraw > 0) {
    embed.addFields({
      name: 'ℹ️ How to Add REWARD',
      value: `A REWARD transfer of **${formatReward(neededToWithdraw)} REWARD** to the Community Fund wallet address is required:\n\`${balanceCheck.walletAddress}\`\n\n⚠️ **Important:** Transfer must be made from a wallet that is **NOT** registered with this bot.\n\n💡 Ask admins to supply the required tokens to enable withdrawals.`,
      inline: false
    });
  }
  
  // Add other errors (non-REWARD related, like EGLD issues)
  const otherErrors = balanceCheck.errors?.filter(e => !e.includes('REWARD')) || [];
  if (otherErrors.length > 0) {
    embed.addFields({
      name: '⚠️ Other Issues',
      value: otherErrors.map(e => `• ${e}`).join('\n'),
      inline: false
    });
  }
  
  // Get QR code URL if available
  try {
    const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
    const communityFundProjectName = getCommunityFundProjectName();
    const qrCodeUrl = communityFundQRData?.[communityFundProjectName];
    
    if (qrCodeUrl) {
      embed.setThumbnail(qrCodeUrl);
    }
  } catch (error) {
    console.error('[BALANCE-CHECK] Error getting QR code:', error.message);
  }
  
  return embed;
}

// Helper function to check Community Fund balances for withdrawals
// Returns: { sufficient: boolean, egldBalance: string, rewardBalance: string, requiredEgld: string, requiredReward: string, errors: string[] }
async function checkCommunityFundBalances(guildId, numberOfTransfers = 1) {
  try {
    const errors = [];
    
    // Get Community Fund project
    const projects = await getProjects(guildId);
    const communityFundProjectName = getCommunityFundProjectName();
    const communityFundProject = projects[communityFundProjectName];
    
    if (!communityFundProject || !communityFundProject.walletAddress) {
      return {
        sufficient: false,
        errors: ['Community Fund project not found or wallet address not configured.']
      };
    }
    
    const walletAddress = communityFundProject.walletAddress;
    
    // Constants
    const EGLD_DECIMALS = 18;
    const EGLD_PER_TX = 0.00025; // Conservative estimate
    const USAGE_FEE_USD = 0.03; // $0.03 per transfer
    
    // Calculate required amounts
    const requiredEgld = EGLD_PER_TX * numberOfTransfers;
    const requiredEgldWei = new BigNumber(requiredEgld).multipliedBy(new BigNumber(10).pow(EGLD_DECIMALS)).toString();
    
    // 1. Fetch EGLD balance
    let egldBalanceWei = '0';
    let egldBalanceHuman = '0';
    try {
      const egldResponse = await fetch(`https://api.multiversx.com/accounts/${walletAddress}`);
      if (egldResponse.ok) {
        const egldData = await egldResponse.json();
        egldBalanceWei = egldData.balance || '0';
        egldBalanceHuman = new BigNumber(egldBalanceWei).dividedBy(new BigNumber(10).pow(EGLD_DECIMALS)).toString();
      } else {
        errors.push(`Failed to fetch EGLD balance: ${egldResponse.status} ${egldResponse.statusText}`);
      }
    } catch (error) {
      errors.push(`Error fetching EGLD balance: ${error.message}`);
    }
    
    // 2. Fetch REWARD balance from API
    const REWARD_IDENTIFIER = 'REWARD-cf6eac';
    let rewardBalanceWei = '0';
    let rewardBalanceHuman = '0';
    let rewardPriceUsd = 0;
    let rewardDecimals = 8;
    let rewardFetchFailed = false;
    try {
      const rewardResponse = await fetch(`https://api.multiversx.com/accounts/${walletAddress}/tokens/${REWARD_IDENTIFIER}`);
      if (rewardResponse.ok) {
        const rewardData = await rewardResponse.json();
        rewardBalanceWei = rewardData.balance || '0';
        rewardDecimals = rewardData.decimals || 8;
        rewardPriceUsd = rewardData.price || 0;
        rewardBalanceHuman = new BigNumber(rewardBalanceWei).dividedBy(new BigNumber(10).pow(rewardDecimals)).toString();
      } else {
        // If REWARD token not found (404), balance is 0, but we still need to check price
        if (rewardResponse.status === 404) {
          rewardBalanceHuman = '0';
          // Try to get price from token metadata API
          try {
            const priceResponse = await fetch(`https://api.multiversx.com/tokens/${REWARD_IDENTIFIER}`);
            if (priceResponse.ok) {
              const priceData = await priceResponse.json();
              rewardPriceUsd = priceData.price || 0;
            }
          } catch (priceError) {
            console.error('[BALANCE-CHECK] Error fetching REWARD price:', priceError.message);
          }
        } else {
          errors.push(`Failed to fetch REWARD balance: ${rewardResponse.status} ${rewardResponse.statusText}`);
          rewardFetchFailed = true;
        }
      }
    } catch (error) {
      errors.push(`Error fetching REWARD balance: ${error.message}`);
      rewardFetchFailed = true;
    }
    
    // 3. Get Virtual Account REWARD balance from Supabase
    // Sum ALL REWARD balances across ALL users in the guild (not just Community Fund wallet user)
    let virtualAccountRewardBalance = '0';
    try {
      // Get all virtual accounts with balances for this guild
      const allAccounts = await virtualAccounts.getAllVirtualAccountsWithBalances(guildId);
      
      // Sum REWARD balances across all accounts
      // Check both identifier (REWARD-cf6eac) and ticker (REWARD) for backward compatibility
      const rewardTicker = REWARD_IDENTIFIER.split('-')[0]; // Extract "REWARD" from "REWARD-cf6eac"
      let totalRewardBalance = new BigNumber('0');
      
      for (const account of allAccounts) {
        const balances = account.balances || {};
        let accountRewardBalance = new BigNumber('0');
        
        // Check for full identifier first (preferred) - case-insensitive match
        for (const [tokenKey, balance] of Object.entries(balances)) {
          if (tokenKey.toLowerCase() === REWARD_IDENTIFIER.toLowerCase()) {
            accountRewardBalance = accountRewardBalance.plus(new BigNumber(balance || '0'));
            break; // Found identifier match, use it and skip ticker check
          }
        }
        
        // If no identifier match found, check for ticker-only key (backward compatibility)
        if (accountRewardBalance.isZero() && balances[rewardTicker]) {
          accountRewardBalance = accountRewardBalance.plus(new BigNumber(balances[rewardTicker] || '0'));
        }
        
        totalRewardBalance = totalRewardBalance.plus(accountRewardBalance);
      }
      
      virtualAccountRewardBalance = totalRewardBalance.toString();
      console.log(`[BALANCE-CHECK] Total Virtual Account REWARD balance across ${allAccounts.length} accounts: ${virtualAccountRewardBalance}`);
    } catch (error) {
      console.error('[BALANCE-CHECK] Error fetching Virtual Account REWARD balance:', error.message);
      // Don't add to errors, as this is optional
    }
    
    // 4. Get House Balance REWARD (betting + auction + lottery PNL)
    // House balances represent funds locked in the house system and shouldn't be available for withdrawals
    let houseBalanceRewardTotal = '0';
    try {
      const houseBalanceData = await getAllHouseBalances(guildId);
      const rewardTicker = REWARD_IDENTIFIER.split('-')[0]; // Extract "REWARD" from "REWARD-cf6eac"
      
      // Aggregate house balances similar to house-balance command
      const aggregatedBalances = {
        bettingPNL: {},
        auctionPNL: {},
        lotteryPNL: {}
      };
      
      // Aggregate PNL from all token records
      for (const [tokenIdentifier, tokenData] of Object.entries(houseBalanceData || {})) {
        // Merge betting PNL
        if (tokenData.bettingPNL) {
          for (const [token, amount] of Object.entries(tokenData.bettingPNL)) {
            if (!aggregatedBalances.bettingPNL[token]) {
              aggregatedBalances.bettingPNL[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingPNL[token] || '0');
            aggregatedBalances.bettingPNL[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction PNL
        if (tokenData.auctionPNL) {
          for (const [token, amount] of Object.entries(tokenData.auctionPNL)) {
            if (!aggregatedBalances.auctionPNL[token]) {
              aggregatedBalances.auctionPNL[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionPNL[token] || '0');
            aggregatedBalances.auctionPNL[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery PNL
        if (tokenData.lotteryPNL) {
          for (const [token, amount] of Object.entries(tokenData.lotteryPNL)) {
            if (!aggregatedBalances.lotteryPNL[token]) {
              aggregatedBalances.lotteryPNL[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotteryPNL[token] || '0');
            aggregatedBalances.lotteryPNL[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
      }
      
      // Calculate total house balance for REWARD
      // Check both identifier and ticker (for backward compatibility)
      const bettingPNLId = aggregatedBalances.bettingPNL[REWARD_IDENTIFIER] || '0';
      const bettingPNLTicker = aggregatedBalances.bettingPNL[rewardTicker] || '0';
      const bettingPNL = new BigNumber(bettingPNLId).plus(new BigNumber(bettingPNLTicker));
      
      const auctionPNLId = aggregatedBalances.auctionPNL[REWARD_IDENTIFIER] || '0';
      const auctionPNLTicker = aggregatedBalances.auctionPNL[rewardTicker] || '0';
      const auctionPNL = new BigNumber(auctionPNLId).plus(new BigNumber(auctionPNLTicker));
      
      const lotteryPNLId = aggregatedBalances.lotteryPNL[REWARD_IDENTIFIER] || '0';
      const lotteryPNLTicker = aggregatedBalances.lotteryPNL[rewardTicker] || '0';
      const lotteryPNL = new BigNumber(lotteryPNLId).plus(new BigNumber(lotteryPNLTicker));
      
      // Sum all PNL (this is the total house balance)
      const totalHousePNL = bettingPNL.plus(auctionPNL).plus(lotteryPNL);
      
      // Convert from wei to human-readable format
      houseBalanceRewardTotal = totalHousePNL.dividedBy(new BigNumber(10).pow(rewardDecimals)).toString();
      
      console.log(`[BALANCE-CHECK] House Balance REWARD: ${houseBalanceRewardTotal} (Betting: ${bettingPNL.dividedBy(new BigNumber(10).pow(rewardDecimals)).toString()}, Auction: ${auctionPNL.dividedBy(new BigNumber(10).pow(rewardDecimals)).toString()}, Lottery: ${lotteryPNL.dividedBy(new BigNumber(10).pow(rewardDecimals)).toString()})`);
    } catch (error) {
      console.error('[BALANCE-CHECK] Error fetching House Balance REWARD:', error.message);
      // Don't add to errors, continue with 0 house balance
    }
    
    // 5. Calculate available REWARD (on-chain minus virtual account minus house balance)
    const virtualAccountRewardBN = new BigNumber(virtualAccountRewardBalance || '0');
    const houseBalanceRewardBN = new BigNumber(houseBalanceRewardTotal || '0');
    const onChainRewardBN = new BigNumber(rewardBalanceHuman);
    const availableRewardBN = onChainRewardBN.minus(virtualAccountRewardBN).minus(houseBalanceRewardBN);
    // Ensure we don't return negative values
    const availableRewardHuman = availableRewardBN.isGreaterThan(0) ? availableRewardBN.toString() : '0';
    
    // 6. Calculate required REWARD based on usage fee
    let requiredRewardHuman = '0';
    let rewardPriceAvailable = false;
    
    // Try to get REWARD price if not already fetched
    if (rewardPriceUsd <= 0) {
      try {
        const priceResponse = await fetch(`https://api.multiversx.com/tokens/${REWARD_IDENTIFIER}`);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          rewardPriceUsd = priceData.price || 0;
        }
      } catch (priceError) {
        console.error('[BALANCE-CHECK] Error fetching REWARD price:', priceError.message);
      }
    }
    
    if (rewardPriceUsd > 0) {
      const requiredRewardUsd = USAGE_FEE_USD * numberOfTransfers;
      requiredRewardHuman = new BigNumber(requiredRewardUsd).dividedBy(rewardPriceUsd).toString();
      rewardPriceAvailable = true;
    } else {
      errors.push('REWARD token price not available, cannot calculate required amount. Transfer cannot proceed without REWARD price information.');
    }
    
    // 7. Check if balances are sufficient
    const egldSufficient = new BigNumber(egldBalanceWei).isGreaterThanOrEqualTo(new BigNumber(requiredEgldWei));
    
    // REWARD check: must have price available AND sufficient balance
    // If price is not available or fetch failed, fail the check
    let rewardSufficient = false;
    if (rewardFetchFailed) {
      // If REWARD balance fetch failed, we cannot verify balance - fail the check
      rewardSufficient = false;
      errors.push('REWARD balance check failed. Cannot verify if sufficient REWARD is available.');
    } else if (!rewardPriceAvailable) {
      // If price is not available, we cannot calculate required amount - fail the check
      rewardSufficient = false;
    } else {
      // Normal check: compare available REWARD with required REWARD
      rewardSufficient = new BigNumber(availableRewardHuman).isGreaterThanOrEqualTo(new BigNumber(requiredRewardHuman));
    }
    
    if (!egldSufficient) {
      errors.push(`Insufficient EGLD: Have ${egldBalanceHuman} EGLD, need ${requiredEgld} EGLD (${numberOfTransfers} transfer(s) × ${EGLD_PER_TX} EGLD)`);
    }
    
    if (!rewardSufficient && rewardPriceAvailable && !rewardFetchFailed) {
      errors.push(`Insufficient REWARD: Have ${availableRewardHuman} REWARD available (${rewardBalanceHuman} on-chain - ${virtualAccountRewardBalance} in Virtual Account - ${houseBalanceRewardTotal} in House Balance), need ${requiredRewardHuman} REWARD (${numberOfTransfers} transfer(s) × $${USAGE_FEE_USD} ÷ $${rewardPriceUsd.toFixed(8)} per REWARD)`);
    }
    
    return {
      sufficient: egldSufficient && rewardSufficient,
      walletAddress: walletAddress,
      egldBalance: egldBalanceHuman,
      rewardBalanceOnChain: rewardBalanceHuman,
      rewardBalanceVirtualAccount: virtualAccountRewardBalance,
      rewardBalanceHouseBalance: houseBalanceRewardTotal,
      rewardBalanceAvailable: availableRewardHuman,
      requiredEgld: requiredEgld.toString(),
      requiredReward: requiredRewardHuman,
      rewardPriceUsd: rewardPriceUsd,
      numberOfTransfers: numberOfTransfers,
      errors: errors
    };
  } catch (error) {
    console.error('[BALANCE-CHECK] Error checking Community Fund balances:', error);
    return {
      sufficient: false,
      errors: [`Error checking balances: ${error.message}`]
    };
  }
}

// Helper function to get project logo URL for DM notifications
// For admin-controlled projects: returns their project_logo_url
// For Community Fund: returns admin project logo (if available), then Community Fund QR logo, then default
async function getProjectLogoUrl(guildId, projectName) {
  try {
    const projects = await getProjects(guildId);
    
    // First, try to get the project by the provided name
    let project = projects[projectName];
    
    // If this is an admin-controlled project (not Community Fund) and has a logo, use it
    if (project && project.projectLogoUrl && projectName !== 'Community Fund') {
      return project.projectLogoUrl;
    }
    
    // For Community Fund or if the requested project has no logo:
    // 1. Try to find any admin-controlled project (not "Community Fund") with a logo
    //    This identifies which guild/project the notification is from
    let adminProjectLogo = null;
    for (const [name, proj] of Object.entries(projects)) {
      if (name !== 'Community Fund' && proj.projectLogoUrl) {
        adminProjectLogo = proj.projectLogoUrl;
        console.log(`[HELPER] Using admin project logo: ${name} for guild ${guildId}`);
        break;
      }
    }
    
    if (adminProjectLogo) {
      return adminProjectLogo;
    }
    
    // 2. If no admin project logo, try Community Fund QR logo
    if (projectName === 'Community Fund') {
      try {
        const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
        const communityFundProjectName = getCommunityFundProjectName();
        const qrLogoUrl = communityFundQRData?.[communityFundProjectName];
        
        if (qrLogoUrl) {
          console.log(`[HELPER] Using Community Fund QR logo for guild ${guildId}`);
          return qrLogoUrl;
        }
      } catch (qrError) {
        console.error('[HELPER] Error getting Community Fund QR logo:', qrError.message);
      }
    }
    
    // 3. Default thumbnail if no logo found
    return 'https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif';
  } catch (error) {
    console.error('[HELPER] Error getting project logo URL:', error.message);
    return 'https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif';
  }
}

// Helper function to get last competition
async function getLastCompetition(guildId) {
  try {
    const settings = await dbServerData.getGuildSettings(guildId);
    return settings?.lastCompetition || null;
  } catch (error) {
    console.error(`[DB] Error getting last competition:`, error.message);
    return null;
  }
}

// Mass refund function - refunds all virtual account balances to users' wallets
async function processMassRefund(guildId, communityFundProject, progressCallback = null) {
  try {
    console.log(`[MASS-REFUND] Starting mass refund for guild ${guildId} using project ${communityFundProject}`);
    
    // Get all virtual accounts with balances
    const accountsWithBalances = await virtualAccounts.getAllVirtualAccountsWithBalances(guildId);
    
    if (accountsWithBalances.length === 0) {
      console.log(`[MASS-REFUND] No accounts with balances found`);
      return {
        success: true,
        totalAccounts: 0,
        successfulRefunds: 0,
        failedRefunds: 0,
        results: []
      };
    }
    
    console.log(`[MASS-REFUND] Found ${accountsWithBalances.length} accounts with balances`);
    
    // Get all user wallets
    const userWallets = await getUserWallets(guildId);
    
    // Prepare refund queue
    const refundQueue = [];
    for (const account of accountsWithBalances) {
      const userWallet = userWallets[account.userId];
      if (!userWallet || !userWallet.startsWith('erd1') || userWallet.length !== 62) {
        console.log(`[MASS-REFUND] Skipping user ${account.userId} - invalid or missing wallet`);
        continue;
      }
      
      // Add each token balance as a separate refund
      for (const [tokenTicker, balance] of Object.entries(account.balances)) {
        const balanceBN = new BigNumber(balance);
        if (balanceBN.isGreaterThan(0)) {
          refundQueue.push({
            userId: account.userId,
            username: account.username || `User ${account.userId}`,
            wallet: userWallet,
            tokenTicker: tokenTicker,
            amount: balance,
            amountBN: balanceBN
          });
        }
      }
    }
    
    console.log(`[MASS-REFUND] Prepared ${refundQueue.length} refund transactions`);
    
    if (progressCallback) {
      await progressCallback({
        stage: 'prepared',
        total: refundQueue.length,
        message: `Prepared ${refundQueue.length} refund transactions`
      });
    }
    
    // Process refunds one by one
    const results = [];
    let successfulRefunds = 0;
    let failedRefunds = 0;
    
    for (let i = 0; i < refundQueue.length; i++) {
      const refund = refundQueue[i];
      const progress = i + 1;
      
      console.log(`[MASS-REFUND] Processing refund ${progress}/${refundQueue.length}: ${refund.amount} ${refund.tokenTicker} to ${refund.username} (${refund.wallet})`);
      
      if (progressCallback) {
        await progressCallback({
          stage: 'processing',
          current: progress,
          total: refundQueue.length,
          currentRefund: refund,
          message: `Processing refund ${progress}/${refundQueue.length}: ${refund.amount} ${refund.tokenTicker} to ${refund.username}`
        });
      }
      
      try {
        // Get token decimals
        const storedDecimals = await getStoredTokenDecimals(guildId, refund.tokenTicker);
        if (storedDecimals === null) {
          throw new Error(`Token metadata missing for ${refund.tokenTicker}`);
        }
        
        // Resolve token identifier from ticker/identifier BEFORE transfer
        const tokenIdentifier = await resolveTokenIdentifier(guildId, refund.tokenTicker);
        
        // Validate identifier format
        const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
        if (!esdtIdentifierRegex.test(tokenIdentifier)) {
          throw new Error(`Invalid token identifier for refund: "${refund.tokenTicker}" -> "${tokenIdentifier}". Must be full identifier format.`);
        }
        
        // Perform blockchain transfer
        const transferResult = await transferESDTFromCommunityFund(
          refund.wallet,
          tokenIdentifier,
          refund.amount,
          communityFundProject,
          guildId
        );
        
        if (transferResult.success && transferResult.txHash) {
          
          // Deduct from virtual account (using identifier)
          const deductResult = await virtualAccounts.deductFundsFromAccount(
            guildId,
            refund.userId,
            tokenIdentifier,
            refund.amount,
            'mass_refund',
            `Mass refund - server deletion`
          );
          
          if (deductResult.success) {
            successfulRefunds++;
            results.push({
              userId: refund.userId,
              username: refund.username,
              wallet: refund.wallet,
              tokenTicker: refund.tokenTicker,
              amount: refund.amount,
              txHash: transferResult.txHash,
              success: true
            });
            console.log(`[MASS-REFUND] ✅ Success: ${refund.amount} ${refund.tokenTicker} refunded to ${refund.username} (tx: ${transferResult.txHash})`);
          } else {
            failedRefunds++;
            results.push({
              userId: refund.userId,
              username: refund.username,
              wallet: refund.wallet,
              tokenTicker: refund.tokenTicker,
              amount: refund.amount,
              error: `Failed to update virtual account: ${deductResult.error}`,
              success: false
            });
            console.error(`[MASS-REFUND] ❌ Failed: Could not update virtual account for ${refund.username}`);
          }
        } else {
          failedRefunds++;
          results.push({
            userId: refund.userId,
            username: refund.username,
            wallet: refund.wallet,
            tokenTicker: refund.tokenTicker,
            amount: refund.amount,
            error: transferResult.errorMessage || 'Transaction failed',
            success: false
          });
          console.error(`[MASS-REFUND] ❌ Failed: Transaction failed for ${refund.username} - ${transferResult.errorMessage || 'Unknown error'}`);
        }
        
        // Small delay between transactions to avoid rate limiting
        if (i < refundQueue.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }
      } catch (error) {
        failedRefunds++;
        results.push({
          userId: refund.userId,
          username: refund.username,
          wallet: refund.wallet,
          tokenTicker: refund.tokenTicker,
          amount: refund.amount,
          error: error.message,
          success: false
        });
        console.error(`[MASS-REFUND] ❌ Error processing refund for ${refund.username}:`, error.message);
      }
    }
    
    console.log(`[MASS-REFUND] Completed: ${successfulRefunds} successful, ${failedRefunds} failed out of ${refundQueue.length} total`);
    
    return {
      success: failedRefunds === 0,
      totalAccounts: accountsWithBalances.length,
      totalRefunds: refundQueue.length,
      successfulRefunds: successfulRefunds,
      failedRefunds: failedRefunds,
      results: results
    };
  } catch (error) {
    console.error(`[MASS-REFUND] Error in mass refund process:`, error.message);
    throw error;
  }
}

// Helper function to get house balance
async function getHouseBalance(guildId, tokenIdentifier) {
  try {
    return await dbServerData.getHouseBalance(guildId, tokenIdentifier);
  } catch (error) {
    console.error(`[DB] Error getting house balance:`, error.message);
    return null;
  }
}

// Helper function to get all house balances for a guild
async function getAllHouseBalances(guildId) {
  try {
    return await dbServerData.getAllHouseBalances(guildId);
  } catch (error) {
    console.error(`[DB] Error getting all house balances:`, error.message);
    return {};
  }
}

// Get user wallets for a specific server (using database)
async function getUserWallets(guildId) {
  return await dbServerData.getUserWallets(guildId);
}

// Get projects for a specific server (using database)
async function getProjects(guildId) {
  return await dbServerData.getAllProjects(guildId);
}

// Get RPS challenges for a specific server (using database)
async function getRPSChallenges(guildId) {
  return await dbRpsGames.getRpsGames(guildId);
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
  
  try {
    // Get all guilds
    const allGuilds = await client.guilds.fetch();
    
    for (const [guildId, guild] of allGuilds) {
      try {
        // Get all games (both waiting and active) that might be expired
        const allGames = await dbRpsGames.getGamesByGuild(guildId);
        
        for (const [gameId, challenge] of Object.entries(allGames)) {
          // Check if challenge is expired (waiting or active status)
          if ((challenge.status === 'waiting' || challenge.status === 'active') && 
              challenge.expiresAt && 
              now > challenge.expiresAt) {
            
            // Mark as expired in database
            await dbRpsGames.updateGame(guildId, gameId, { status: 'expired' });
            changed = true;
            
            // Refund challenger to virtual account
            try {
              if (challenge.humanAmount && challenge.token) {
                const memo = `RPS refund: challenge expired (${gameId})`;
                const refundResult = await virtualAccounts.addFundsToAccount(
                  guildId,
                  challenge.challengerId,
                  challenge.token,
                  challenge.humanAmount,
                  null, // No transaction hash for virtual refund
                  'rps_refund',
                  null // Username will be updated when user runs commands
                );
                
                if (refundResult && refundResult.success) {
                  console.log(`[RPS CLEANUP] Refunded challenger for expired challenge ${gameId}: ${challenge.humanAmount} ${challenge.token}`);
                  
                  // Send notifications for successful refund
                  await sendExpiredChallengeNotifications(guildId, gameId, challenge);
                } else {
                  console.error(`[RPS CLEANUP] Refund failed for challenge ${gameId}:`, refundResult?.error || 'Unknown error');
                }
              }
            } catch (refundError) {
              console.error(`[RPS CLEANUP] Failed to refund challenger for expired challenge ${gameId}:`, refundError.message);
            }
          }
        }
      } catch (error) {
        console.error(`[RPS CLEANUP] Error processing guild ${guildId}:`, error.message);
      }
    }
    
    if (changed) {
      console.log(`[RPS CLEANUP] Processed expired challenges and refunds`);
    }
  } catch (error) {
    console.error('[RPS CLEANUP] Error during cleanup:', error.message);
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

    // Try to find a channel to send notification (challenges don't store channelId)
    // Try to find the first text channel where bot can send messages
    let originalChannel = null;
    if (challenge.channelId) {
      originalChannel = guild.channels.cache.get(challenge.channelId);
    }
    
    // If no channelId or channel not found, try to find any text channel
    if (!originalChannel) {
      originalChannel = guild.channels.cache.find((c) => 
        c.isTextBased() && 
        c.viewable && 
        c.permissionsFor(guild.members.me)?.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])
      );
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

    // Send channel announcement (if channel found)
    if (originalChannel) {
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
    } else {
      console.warn(`[RPS CLEANUP] No suitable channel found to send notification for expired challenge ${challengeId}`);
    }

    // Send DM to challenger
    try {
      const challenger = await client.users.fetch(challenge.challengerId);
      if (challenger) {
        // Get Community Fund project logo for RPS refund notification
        const communityFundProjectName = getCommunityFundProjectName();
        const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
        
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
          .setThumbnail(projectLogoUrl)
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

// Cleanup is handled by database - matches with status FINISHED remain in database for historical records

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

// Load data on startup (now using database - no file loading needed)
console.log('📂 Database connection ready (Supabase)');
console.log('✅ All data will be loaded from database on demand');

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
    const userWallets = await getUserWallets(guildId);
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
    const userWallets = await getUserWallets(guildId);
    
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
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f") - required for API
async function transferESDT(recipientWallet, tokenIdentifier, amount, projectName, guildId) {
  try {
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    // Validate token identifier format
    const identifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!identifierRegex.test(tokenIdentifier)) {
      throw new Error(`Invalid token identifier: "${tokenIdentifier}". Must be full identifier format: TICKER-6hexchars (e.g., "USDC-c76f1f").`);
    }

    const projects = await getProjects(guildId);
    const project = projects[projectName];
    
    if (!project) {
      throw new Error(`Project "${projectName}" not found. Use /register-project to add it.`);
    }

    if (!project.walletPem) {
      throw new Error(`Project "${projectName}" has no wallet configured.`);
    }

    // Extract ticker from identifier for supported tokens check
    const tokenTicker = tokenIdentifier.split('-')[0];
    
    // Normalize supported tokens list - extract tickers from identifiers if needed
    const supportedTokens = Array.isArray(project.supportedTokens) 
      ? project.supportedTokens.map(t => t.includes('-') ? t.split('-')[0] : t)
      : (project.supportedTokens || '').split(',').map(t => {
          const trimmed = t.trim();
          return trimmed.includes('-') ? trimmed.split('-')[0] : trimmed;
        });
    
    if (!supportedTokens.length || !supportedTokens.includes(tokenTicker)) {
      const displayTokens = Array.isArray(project.supportedTokens) 
        ? project.supportedTokens.join(', ')
        : (project.supportedTokens || 'None configured');
      throw new Error(`Token "${tokenTicker}" is not supported by project "${projectName}". Supported tokens: ${displayTokens}`);
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

    // Ensure amount is a number (API expects human-readable amount as number)
    const amountNum = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(amountNum)) {
      throw new Error(`Invalid amount format: "${amount}". Must be a valid number.`);
    }
    
    // Ensure tokenIdentifier is a plain string (remove any JSON stringification or quotes)
    let cleanTokenIdentifier = typeof tokenIdentifier === 'string' ? tokenIdentifier.trim() : String(tokenIdentifier).trim();
    cleanTokenIdentifier = cleanTokenIdentifier.replace(/^["']+|["']+$/g, ''); // Remove surrounding quotes
    cleanTokenIdentifier = cleanTokenIdentifier.replace(/\\"/g, '"'); // Remove JSON escape sequences
    
    // Validate cleaned identifier format (reuse the regex from above)
    if (!identifierRegex.test(cleanTokenIdentifier)) {
      throw new Error(`Invalid token identifier format after cleaning: "${cleanTokenIdentifier}". Expected format: TICKER-6hexchars`);
    }
    
    const requestBody = {
      recipient: recipientWallet,
      amount: amountNum, // Human-readable amount as number
      tokenTicker: cleanTokenIdentifier, // API expects field name "tokenTicker" but value should be full identifier
      walletPem: pemToSend,
    };
    
    // Old working code: API_BASE_URL was base URL, appended /execute/esdtTransfer
    // This matches the old implementation that was working
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/esdtTransfer` 
      : `${API_BASE_URL}/execute/esdtTransfer`;
    
    // Log the exact JSON payload for debugging
    const payloadForLogging = {
      recipient: recipientWallet,
      amount: amountNum,
      tokenTicker: cleanTokenIdentifier, // Field name is tokenTicker, but value is full identifier
      walletPem: '[REDACTED]'
    };
    
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
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f") - required for API
async function transferESDTFromCommunityFund(recipientWallet, tokenIdentifier, amount, projectName, guildId) {
  try {
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    // Validate token identifier format
    const identifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!identifierRegex.test(tokenIdentifier)) {
      throw new Error(`Invalid token identifier: "${tokenIdentifier}". Must be full identifier format: TICKER-6hexchars (e.g., "USDC-c76f1f").`);
    }

    const projects = await getProjects(guildId);
    const project = projects[projectName];
    
    if (!project) {
      throw new Error(`Project "${projectName}" not found. Use /register-project to add it.`);
    }

    if (!project.walletPem || project.walletPem.trim().length === 0) {
      console.error(`[WITHDRAW] Project "${projectName}" has empty PEM. Wallet address: ${project.walletAddress}`);
      throw new Error(`Project "${projectName}" has no wallet configured or PEM is empty. Please reconfigure the Community Fund using /set-community-fund.`);
    }
    
    // Validate PEM format
    if (!project.walletPem.includes('BEGIN') || !project.walletPem.includes('END')) {
      console.error(`[WITHDRAW] Project "${projectName}" has invalid PEM format. PEM length: ${project.walletPem.length} characters`);
      throw new Error(`Project "${projectName}" has an invalid PEM format. Please reconfigure the Community Fund using /set-community-fund.`);
    }
    
    // Log PEM info for debugging (no sensitive content)
    console.log(`[WITHDRAW] Using PEM for project "${projectName}". PEM length: ${project.walletPem.length} characters`);
    
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
    
    // Validate PEM after processing
    if (!pemToSend || pemToSend.trim().length === 0) {
      console.error(`[WITHDRAW] PEM became empty after processing for project "${projectName}"`);
      throw new Error(`PEM processing failed for project "${projectName}". Please reconfigure the Community Fund.`);
    }

    // Ensure amount is a number (API expects human-readable amount as number)
    const amountNum = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(amountNum)) {
      throw new Error(`Invalid amount format: "${amount}". Must be a valid number.`);
    }
    
    // Ensure tokenIdentifier is a plain string (remove any JSON stringification or quotes)
    let cleanTokenIdentifier = typeof tokenIdentifier === 'string' ? tokenIdentifier.trim() : String(tokenIdentifier).trim();
    cleanTokenIdentifier = cleanTokenIdentifier.replace(/^["']+|["']+$/g, ''); // Remove surrounding quotes
    cleanTokenIdentifier = cleanTokenIdentifier.replace(/\\"/g, '"'); // Remove JSON escape sequences
    
    // Validate cleaned identifier format (reuse the regex from above)
    if (!identifierRegex.test(cleanTokenIdentifier)) {
      throw new Error(`Invalid token identifier format after cleaning: "${cleanTokenIdentifier}". Expected format: TICKER-6hexchars`);
    }
    
    const requestBody = {
      recipient: recipientWallet,
      amount: amountNum, // Human-readable amount as number
      tokenTicker: cleanTokenIdentifier, // API expects field name "tokenTicker" but value should be full identifier
      walletPem: pemToSend,
    };
    
    // Old working code: API_BASE_URL was base URL, appended /execute/esdtTransfer
    // This matches the old implementation that was working
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/esdtTransfer` 
      : `${API_BASE_URL}/execute/esdtTransfer`;
    
    // Log the exact JSON payload for debugging
    const payloadForLogging = {
      recipient: recipientWallet,
      amount: amountNum,
      tokenTicker: cleanTokenIdentifier, // Field name is tokenTicker, but value is full identifier
      walletPem: '[REDACTED]'
    };
    
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
        console.log(`[WITHDRAW] Successfully sent ${amount} ${tokenIdentifier} to: ${recipientWallet} using Community Fund: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`[WITHDRAW] API reported failure for ${tokenIdentifier} transfer: ${errorMessage || 'Unknown error'}`);
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

// Transfer NFT using project wallet
async function transferNFT(recipientWallet, tokenIdentifier, tokenNonce, projectName, guildId) {
  try {
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    const projects = await getProjects(guildId);
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
      walletPem: pemToSend,
      recipient: recipientWallet,
      tokenIdentifier: tokenIdentifier,
      tokenNonce: Number(tokenNonce), // Ensure it's a number, not a string
    };
    
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/nftTransfer` 
      : `${API_BASE_URL}/execute/nftTransfer`;
    
    console.log(`Transferring NFT ${tokenIdentifier}#${tokenNonce} to: ${recipientWallet} using project: ${projectName}`);
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
      console.log(`API response for NFT transfer: ${responseText}`);
      
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
      
      // Handle error messages from API
      let errorMessage = null;
      if (!response.ok) {
        // Check for error message in various possible locations
        errorMessage = parsedResponse.message || 
                      parsedResponse.error || 
                      (parsedResponse.result && parsedResponse.result.error) ||
                      (parsedResponse.data && parsedResponse.data.error);
        
        // Add HTTP status context if no specific error message
        if (!errorMessage) {
          if (response.status === 400) {
            errorMessage = 'Bad Request - Invalid parameters or validation error';
          } else if (response.status === 401) {
            errorMessage = 'Unauthorized - Missing or invalid API token';
          } else if (response.status === 404) {
            errorMessage = 'Not Found - Invalid API endpoint';
          } else if (response.status === 500) {
            errorMessage = 'Internal Server Error - Transaction failed or server error';
          } else {
            errorMessage = `API error (${response.status})`;
          }
        }
      }
      
      // Only treat as success if status is 'success', HTTP is OK, and txHash exists
      const isApiSuccess = response.ok && txStatus === 'success' && !!txHash;
      
      const result = {
        success: isApiSuccess,
        txHash: txHash,
        errorMessage: errorMessage || (txStatus && txStatus !== 'success' ? `Transaction status: ${txStatus}` : null),
        rawResponse: parsedResponse,
        httpStatus: response.status
      };
      
      if (result.success) {
        console.log(`Successfully sent NFT ${tokenIdentifier}#${tokenNonce} to: ${recipientWallet} using project: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`API reported failure for NFT transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`Transaction hash was returned (${txHash}), but transaction failed (status: ${txStatus}).`);
        }
      }
      
      return result;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('NFT transfer API request timed out after 60 seconds');
        throw new Error('API request timed out after 60 seconds');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`Error transferring NFT:`, error.message);
    throw error;
  }
}

// Transfer SFT from Community Fund to user wallet
async function transferSFTFromCommunityFund(recipientWallet, tokenTicker, tokenNonce, amount, projectName, guildId) {
  try {
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    const projects = await getProjects(guildId);
    const project = projects[projectName];
    
    if (!project) {
      throw new Error(`Project "${projectName}" not found. Use /register-project to add it.`);
    }

    if (!project.walletPem || project.walletPem.trim().length === 0) {
      console.error(`[WITHDRAW-SFT] Project "${projectName}" has empty PEM. Wallet address: ${project.walletAddress}`);
      throw new Error(`Project "${projectName}" has no wallet configured or PEM is empty. Please reconfigure the Community Fund using /set-community-fund.`);
    }
    
    // Validate PEM format
    if (!project.walletPem.includes('BEGIN') || !project.walletPem.includes('END')) {
      console.error(`[WITHDRAW-SFT] Project "${projectName}" has invalid PEM format. PEM length: ${project.walletPem.length} characters`);
      throw new Error(`Project "${projectName}" has an invalid PEM format. Please reconfigure the Community Fund using /set-community-fund.`);
    }
    
    // Log PEM info for debugging (no sensitive content)
    console.log(`[WITHDRAW-SFT] Using PEM for project "${projectName}". PEM length: ${project.walletPem.length} characters`);
    
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
    
    // Validate PEM after processing
    if (!pemToSend || pemToSend.trim().length === 0) {
      console.error(`[WITHDRAW-SFT] PEM became empty after processing for project "${projectName}"`);
      throw new Error(`PEM processing failed for project "${projectName}". Please reconfigure the Community Fund.`);
    }

    // Convert amount to string
    const amountStr = amount.toString();

    const requestBody = {
      walletPem: pemToSend,
      recipient: recipientWallet,
      tokenTicker: tokenTicker,  // Collection ticker (e.g., "XPACHIEVE-5a0519")
      tokenNonce: Number(tokenNonce),  // Nonce (e.g., 15)
      amount: amountStr  // Amount to transfer
    };
    
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/sftTransfer` 
      : `${API_BASE_URL}/execute/sftTransfer`;
    
    console.log(`[WITHDRAW-SFT] Transferring SFT ${tokenTicker}#${tokenNonce} (amount: ${amountStr}) to: ${recipientWallet} using Community Fund: ${projectName}`);
    console.log(`[WITHDRAW-SFT] API endpoint: ${fullEndpoint}`);
    
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
      console.log(`[WITHDRAW-SFT] API response status: ${response.status}`);
      console.log(`[WITHDRAW-SFT] API response for SFT transfer: ${responseText}`);
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[WITHDRAW-SFT] Error parsing API response:', parseError.message);
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
      
      // Normalize txStatus - handle if it's an object
      let txStatusString = null;
      if (txStatus) {
        if (typeof txStatus === 'string') {
          txStatusString = txStatus;
        } else if (typeof txStatus === 'object') {
          // If status is an object, try to extract a meaningful status
          txStatusString = txStatus.status || txStatus.value || JSON.stringify(txStatus);
          console.log(`[WITHDRAW-SFT] Status is an object, extracted: ${txStatusString}`);
        } else {
          txStatusString = String(txStatus);
        }
      }
      
      const errorMessage = parsedResponse.error || 
                          (parsedResponse.result && parsedResponse.result.error) ||
                          (parsedResponse.data && parsedResponse.data.error) ||
                          (!response.ok ? `API error (${response.status})` : null);
      
      // Success criteria: 
      // 1. HTTP response is OK AND
      // 2. We have a txHash (transaction was submitted) AND
      // 3. Either status is 'success' OR no explicit error message
      // If we have a txHash and HTTP is OK, the transaction was submitted successfully
      // The actual blockchain status can be checked via explorer
      const hasTxHash = !!txHash;
      const isHttpOk = response.ok || parsedResponse.success === true;
      const isStatusSuccess = txStatusString === 'success' || txStatusString === 'Success' || txStatusString === 'SUCCESS';
      const hasNoError = !errorMessage;
      
      // Consider successful if: HTTP OK + has txHash + (status success OR no error)
      const isApiSuccess = isHttpOk && hasTxHash && (isStatusSuccess || hasNoError);
      
      const result = {
        success: isApiSuccess,
        txHash: txHash,
        errorMessage: errorMessage || (txStatusString && !isStatusSuccess && hasNoError ? `Transaction status: ${txStatusString}` : null),
        rawResponse: parsedResponse,
        httpStatus: response.status
      };
      
      if (result.success) {
        console.log(`[WITHDRAW-SFT] Successfully sent SFT ${tokenTicker}#${tokenNonce} (amount: ${amountStr}) to: ${recipientWallet} using Community Fund: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`[WITHDRAW-SFT] API reported failure for SFT transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`[WITHDRAW-SFT] Transaction hash was returned (${txHash}), but transaction failed (status: ${txStatus}).`);
        }
      }
      
      return result;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('[WITHDRAW-SFT] SFT transfer API request timed out after 60 seconds');
        throw new Error('API request timed out after 60 seconds');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`[WITHDRAW-SFT] Error transferring SFT:`, error.message);
    throw error;
  }
}

// Transfer NFT from Community Fund to user wallet
// Auto-detects SFT vs NFT based on token_type from database (bulletproof detection)
async function transferNFTFromCommunityFund(recipientWallet, tokenIdentifier, tokenNonce, projectName, guildId, amount = 1, tokenType = null) {
  try {
    // Convert amount to number
    const amountNum = typeof amount === 'string' ? parseInt(amount, 10) : Number(amount);
    const finalAmount = isNaN(amountNum) || amountNum <= 0 ? 1 : amountNum;
    
    // If tokenType not provided, try to infer from amount (fallback for backward compatibility)
    // But prefer explicit tokenType parameter when available
    let detectedTokenType = tokenType;
    if (!detectedTokenType) {
      // Fallback: use amount-based detection (not bulletproof, but better than nothing)
      detectedTokenType = finalAmount > 1 ? 'SFT' : 'NFT';
    }
    
    // Use token_type for reliable detection: if SFT, use SFT endpoint
    if (detectedTokenType === 'SFT') {
      console.log(`[WITHDRAW-NFT] Detected SFT (token_type: ${detectedTokenType}, amount: ${finalAmount}), routing to SFT transfer endpoint`);
      
      // Extract collection ticker from identifier
      // The tokenIdentifier might be:
      // 1. Full identifier with nonce: "OOXTCK-08aa7c-02" -> extract "OOXTCK-08aa7c"
      // 2. Collection ticker only: "OOXTCK-08aa7c" -> use as is
      let collectionTicker = tokenIdentifier;
      
      // Check if identifier contains nonce appended (format: COLLECTION-NONCE)
      // If tokenIdentifier has 3+ parts separated by '-', the last part is likely the nonce
      let extractedNonce = null;
      if (tokenIdentifier.includes('-')) {
        const parts = tokenIdentifier.split('-');
        // If we have 3+ parts, the last part is likely the nonce
        // Example: "OOXTCK-08aa7c-02" -> ["OOXTCK", "08aa7c", "02"]
        if (parts.length >= 3) {
          // Extract collection ticker by removing the last part (nonce)
          collectionTicker = parts.slice(0, -1).join('-');
          extractedNonce = parts[parts.length - 1];
          console.log(`[WITHDRAW-NFT] Extracted collection ticker "${collectionTicker}" and nonce "${extractedNonce}" from identifier "${tokenIdentifier}"`);
        }
      }
      
      // Use provided nonce if available, otherwise use extracted nonce
      const nonceToUse = tokenNonce !== null && tokenNonce !== undefined ? tokenNonce : extractedNonce;
      
      // Ensure tokenNonce is properly converted to number
      // Handle hex nonces (e.g., "02" in hex = 2, "0f" in hex = 15)
      let nonceValue = nonceToUse;
      if (nonceToUse !== null && nonceToUse !== undefined) {
        if (typeof nonceToUse === 'string') {
          // Try parsing as hex first (common format for nonces in MultiversX)
          const hexValue = parseInt(nonceToUse, 16);
          if (!isNaN(hexValue) && /^[0-9a-f]+$/i.test(nonceToUse)) {
            nonceValue = hexValue;
          } else {
            // Fall back to decimal
            const decValue = parseInt(nonceToUse, 10);
            nonceValue = isNaN(decValue) ? Number(nonceToUse) : decValue;
          }
        } else {
          nonceValue = Number(nonceToUse);
        }
      } else {
        throw new Error('Nonce is required for SFT transfer but was not provided');
      }
      
      console.log(`[WITHDRAW-NFT] Using collection ticker: "${collectionTicker}", nonce: ${nonceValue} (original: ${tokenNonce}, extracted: ${extractedNonce})`);
      return await transferSFTFromCommunityFund(recipientWallet, collectionTicker, nonceValue, finalAmount, projectName, guildId);
    }
    
    // NFT transfer (amount = 1)
    if (!API_BASE_URL || !API_TOKEN) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    const projects = await getProjects(guildId);
    const project = projects[projectName];
    
    if (!project) {
      throw new Error(`Project "${projectName}" not found. Use /register-project to add it.`);
    }

    if (!project.walletPem || project.walletPem.trim().length === 0) {
      console.error(`[WITHDRAW-NFT] Project "${projectName}" has empty PEM. Wallet address: ${project.walletAddress}`);
      throw new Error(`Project "${projectName}" has no wallet configured or PEM is empty. Please reconfigure the Community Fund using /set-community-fund.`);
    }
    
    // Validate PEM format
    if (!project.walletPem.includes('BEGIN') || !project.walletPem.includes('END')) {
      console.error(`[WITHDRAW-NFT] Project "${projectName}" has invalid PEM format. PEM length: ${project.walletPem.length} characters`);
      throw new Error(`Project "${projectName}" has an invalid PEM format. Please reconfigure the Community Fund using /set-community-fund.`);
    }
    
    // Log PEM info for debugging (no sensitive content)
    console.log(`[WITHDRAW-NFT] Using PEM for project "${projectName}". PEM length: ${project.walletPem.length} characters`);
    
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
    
    // Validate PEM after processing
    if (!pemToSend || pemToSend.trim().length === 0) {
      console.error(`[WITHDRAW-NFT] PEM became empty after processing for project "${projectName}"`);
      throw new Error(`PEM processing failed for project "${projectName}". Please reconfigure the Community Fund.`);
    }

    const requestBody = {
      walletPem: pemToSend,
      recipient: recipientWallet,
      tokenIdentifier: tokenIdentifier,
      tokenNonce: Number(tokenNonce), // Ensure it's a number, not a string
    };
    
    const fullEndpoint = API_BASE_URL.endsWith('/') 
      ? `${API_BASE_URL}execute/nftTransfer` 
      : `${API_BASE_URL}/execute/nftTransfer`;
    
    console.log(`[WITHDRAW-NFT] Transferring NFT ${tokenIdentifier}#${tokenNonce} to: ${recipientWallet} using Community Fund: ${projectName}`);
    console.log(`[WITHDRAW-NFT] API endpoint: ${fullEndpoint}`);
    
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
      console.log(`[WITHDRAW-NFT] API response status: ${response.status}`);
      console.log(`[WITHDRAW-NFT] API response for NFT transfer: ${responseText}`);
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[WITHDRAW-NFT] Error parsing API response:', parseError.message);
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
      
      // Normalize txStatus - handle if it's an object
      let txStatusString = null;
      if (txStatus) {
        if (typeof txStatus === 'string') {
          txStatusString = txStatus;
        } else if (typeof txStatus === 'object') {
          // If status is an object, try to extract a meaningful status
          txStatusString = txStatus.status || txStatus.value || JSON.stringify(txStatus);
          console.log(`[WITHDRAW-NFT] Status is an object, extracted: ${txStatusString}`);
        } else {
          txStatusString = String(txStatus);
        }
      }
      
      const errorMessage = parsedResponse.error || 
                          (parsedResponse.result && parsedResponse.result.error) ||
                          (parsedResponse.data && parsedResponse.data.error) ||
                          (!response.ok ? `API error (${response.status})` : null);
      
      // Success criteria: 
      // 1. HTTP response is OK AND
      // 2. We have a txHash (transaction was submitted) AND
      // 3. Either status is 'success' OR no explicit error message
      // If we have a txHash and HTTP is OK, the transaction was submitted successfully
      // The actual blockchain status can be checked via explorer
      const hasTxHash = !!txHash;
      const isHttpOk = response.ok || parsedResponse.success === true;
      const isStatusSuccess = txStatusString === 'success' || txStatusString === 'Success' || txStatusString === 'SUCCESS';
      const hasNoError = !errorMessage;
      
      // Consider successful if: HTTP OK + has txHash + (status success OR no error)
      const isApiSuccess = isHttpOk && hasTxHash && (isStatusSuccess || hasNoError);
      
      const result = {
        success: isApiSuccess,
        txHash: txHash,
        errorMessage: errorMessage || (txStatusString && !isStatusSuccess && hasNoError ? `Transaction status: ${txStatusString}` : null),
        rawResponse: parsedResponse,
        httpStatus: response.status
      };
      
      if (result.success) {
        console.log(`[WITHDRAW-NFT] Successfully sent NFT ${tokenIdentifier}#${tokenNonce} to: ${recipientWallet} using Community Fund: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`[WITHDRAW-NFT] API reported failure for NFT transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`[WITHDRAW-NFT] Transaction hash was returned (${txHash}), but transaction failed (status: ${txStatus}).`);
        }
      }
      
      return result;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('[WITHDRAW-NFT] NFT transfer API request timed out after 60 seconds');
        throw new Error('API request timed out after 60 seconds');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`[WITHDRAW-NFT] Error transferring NFT:`, error.message);
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
      
      try {
        await dbServerData.setUserWallet(guildId, interaction.user.id, wallet);
        
        // Initialize virtual account (this will create it if it doesn't exist)
        const dbVirtualAccounts = require('./db/virtual-accounts');
        await dbVirtualAccounts.getUserAccount(guildId, interaction.user.id, interaction.user.username);
        
        console.log(`Wallet for user ${interaction.user.tag} (${interaction.user.id}) in guild ${guildId} set to: ${wallet}`);
        
        // Process any pending transactions (NFTs/tokens sent before registration)
        try {
          const blockchainListener = require('./blockchain-listener');
          const pendingResult = await blockchainListener.processPendingTransactionsForWallet(
            guildId,
            interaction.user.id,
            wallet
          );
          
          if (pendingResult.processed > 0) {
            console.log(`[SET-WALLET] Processed ${pendingResult.processed} pending transaction(s) for user ${interaction.user.id}`);
          }
        } catch (pendingError) {
          console.error(`[SET-WALLET] Error processing pending transactions:`, pendingError.message);
          // Don't fail wallet registration if pending processing fails
        }
        
        // Get Community Fund wallet address and QR code
        let communityFundAddress = null;
        let qrCodeUrl = null;
        let supportedTokens = [];
        try {
          const projects = await getProjects(guildId);
          const communityFundProjectName = getCommunityFundProjectName();
          const communityFundProject = projects[communityFundProjectName];
          
          if (communityFundProject && communityFundProject.walletAddress) {
            communityFundAddress = communityFundProject.walletAddress;
            
            // Get QR code if available
            const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
            qrCodeUrl = communityFundQRData?.[communityFundProjectName] || null;
            
            // Extract supported tokens
            if (communityFundProject.supportedTokens) {
              if (Array.isArray(communityFundProject.supportedTokens)) {
                supportedTokens = communityFundProject.supportedTokens;
              } else if (typeof communityFundProject.supportedTokens === 'string') {
                supportedTokens = communityFundProject.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
              }
            }
          }
        } catch (error) {
          console.error(`[SET-WALLET] Error getting Community Fund info:`, error.message);
          // Continue without Community Fund info if there's an error
        }
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Wallet Registered Successfully!')
          .setDescription('Your wallet address has been registered and your virtual account has been set up.')
          .addFields([
            { name: 'Wallet Address', value: `\`${wallet}\``, inline: false }
          ])
          .setColor('#00FF00')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        // Add Community Fund address field if available
        if (communityFundAddress) {
          embed.addFields([
            { name: '💰 Community Fund Deposit Address', value: `\`${communityFundAddress}\``, inline: false }
          ]);
        }
        
        // Add supported tokens if available
        if (supportedTokens.length > 0) {
          embed.addFields([
            { name: 'Supported ESDT Tokens', value: supportedTokens.join(', '), inline: false }
          ]);
        }
        
        // Add NFT support information
        embed.addFields([
          { name: '📦 NFT Support', value: '**NFTs can also be added to your Virtual Account!**\n\nSimply send NFTs to the community fund wallet address above, and they will be automatically added to your virtual account balance. Use `/check-balance-nft` to view your NFT collection.', inline: false }
        ]);
        
        // Add QR code as thumbnail if available
        if (qrCodeUrl) {
          embed.setThumbnail(qrCodeUrl);
        }
        
        // Add Next Steps field
        const nextStepsValue = communityFundAddress 
          ? `1. Send **ESDT tokens or NFTs** to the Community Fund address above\n2. Your virtual account will be automatically updated\n3. Use \`/check-balance-esdt\` to view ESDT balances\n4. Use \`/check-balance-nft\` to view NFT collection`
          : `1. Send **ESDT tokens or NFTs** to the Community Fund address\n2. Your virtual account will be automatically updated\n3. Use \`/check-balance-esdt\` to view ESDT balances\n4. Use \`/check-balance-nft\` to view NFT collection`;
        
        embed.addFields([
          { name: 'Next Steps', value: nextStepsValue, inline: false }
        ]);
        
        await interaction.editReply({ embeds: [embed] });
      } catch (writeError) {
        console.error(`Failed to save user wallet for guild ${guildId}:`, writeError.message);
        throw new Error(`Failed to save wallet address: ${writeError.message}`);
      }
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
      const supportedTokensStr = interaction.options.getString('supported-tokens');
      const projectLogoUrl = interaction.options.getString('project-logo-url');
      const userInput = interaction.options.getString('user-input') || '';

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

      const projects = await getProjects(guildId);
      
      // Check if project already exists
      if (projects[projectName]) {
        await interaction.editReply({ 
          content: `⚠️ **Warning:** Project "${projectName}" already exists!\n\nThis will **overwrite** the existing project with new credentials.\n\nIf you want to update specific fields instead, use \`/update-project\`.\n\nTo proceed with overwriting, run this command again.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Generate wallet using MultiversX SDK
      const walletGenerator = require('./utils/wallet-generator');
      await interaction.editReply({ 
        content: '🔄 **Generating Project Wallet...**\n\nCreating a new MultiversX wallet using the SDK...', 
        flags: [MessageFlags.Ephemeral] 
      });
      
      const wallet = await walletGenerator.generateCompleteWallet();
      
      // Validate generated PEM before storing
      if (!wallet.pem || wallet.pem.trim().length === 0) {
        throw new Error('Failed to generate wallet: PEM is empty');
      }
      
      if (!wallet.pem.includes('BEGIN') || !wallet.pem.includes('END')) {
        throw new Error('Failed to generate wallet: Invalid PEM format');
      }
      
      // Validate PEM length (should be at least 90 characters)
      if (wallet.pem.length < 90) {
        console.error(`[REGISTER-PROJECT] Generated PEM is too short: ${wallet.pem.length} characters (expected 90+)`);
        throw new Error(`Failed to generate wallet: PEM is too short (${wallet.pem.length} chars, expected 90+). Please try again.`);
      }
      
      console.log(`[REGISTER-PROJECT] Generated wallet with address: ${wallet.address}, PEM length: ${wallet.pem.length} characters`);
      
      // Save project to database
      await dbServerData.setProject(guildId, projectName, {
        walletAddress: wallet.address,
        walletPem: wallet.pem,
        supportedTokens: supportedTokens,
        projectLogoUrl: projectLogoUrl,
        userInput: userInput,
        registeredBy: interaction.user.id,
        registeredAt: Date.now()
      });
      
      // Verify the PEM was stored correctly by reading it back
      console.log(`[REGISTER-PROJECT] Verifying stored PEM...`);
      const storedProject = await dbServerData.getProject(guildId, projectName);
      if (!storedProject || !storedProject.walletPem) {
        throw new Error('Failed to verify stored PEM: PEM not found after storage');
      }
      
      if (storedProject.walletPem.length !== wallet.pem.length) {
        console.error(`[REGISTER-PROJECT] PEM length mismatch! Original: ${wallet.pem.length}, Stored: ${storedProject.walletPem.length}`);
        throw new Error(`PEM length mismatch after storage! Original: ${wallet.pem.length}, Stored: ${storedProject.walletPem.length}`);
      }
      
      console.log(`[REGISTER-PROJECT] ✅ PEM verified successfully after storage (length: ${storedProject.walletPem.length} chars)`);

      // Build embed with wallet information
      const embed = new EmbedBuilder()
        .setTitle('✅ Project Wallet Created Successfully')
        .setDescription(`Project **${projectName}** has been registered with an auto-generated MultiversX wallet.`)
        .addFields([
          { name: '📍 Wallet Address', value: `\`${wallet.address}\``, inline: false },
          { name: '🔑 Seed Phrase', value: `\`${wallet.mnemonic}\``, inline: false },
          { name: '📝 PEM File Content', value: `\`\`\`\n${wallet.pem}\n\`\`\``, inline: false },
          { name: '📝 Supported Tokens', value: supportedTokens.join(', '), inline: false },
          { name: '🔐 Security', value: 'Wallet was generated by the bot using MultiversX SDK. PEM is encrypted in the database.', inline: false },
          { name: '⚠️ Important Instructions', value: '**Check your DMs for complete wallet details and PEM file!**\n\n**Next Steps:**\n1. Save the PEM file content to a secure location (e.g., `WalletKey.pem`)\n2. You can use the Seed Phrase to log in to xPortal or Extension wallet\n3. **Top up the wallet with:**\n   - **EGLD** for blockchain transaction fees\n   - **REWARD** tokens for MakeX API usage fees', inline: false }
        ])
        .setColor('#00FF00')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      // Add user input field if provided
      if (userInput) {
        embed.addFields({ name: '📋 Notes', value: userInput, inline: false });
      }
      
      // Add project logo if provided
      if (projectLogoUrl) {
        embed.setThumbnail(projectLogoUrl);
      }

      await interaction.editReply({ embeds: [embed] });
      
      // Send DM to admin with wallet details and PEM file
      try {
        const adminUser = await client.users.fetch(interaction.user.id);
        
        // Create DM embed
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔐 Project Wallet Details')
          .setDescription(`Here are the complete wallet details for project **${projectName}**`)
          .addFields([
            { name: '📍 Wallet Address', value: `\`${wallet.address}\``, inline: false },
            { name: '🔑 Seed Phrase (24 words)', value: `\`${wallet.mnemonic}\``, inline: false },
            { name: '📝 PEM File Content', value: `\`\`\`\n${wallet.pem}\n\`\`\``, inline: false },
            { name: '📝 Supported Tokens', value: supportedTokens.join(', '), inline: false },
            { name: '💾 How to Save PEM File', value: '1. Copy the PEM content above\n2. Open a text editor (Notepad, VS Code, etc.)\n3. Paste the PEM content\n4. Save as `WalletKey.pem` (or any name you prefer)\n5. Store in a secure location', inline: false },
            { name: '🔐 Using Seed Phrase', value: 'You can use the Seed Phrase to log in to:\n- xPortal mobile app\n- MultiversX Extension wallet\n- Any MultiversX wallet that supports seed phrase import', inline: false },
            { name: '⚠️ Important: Top Up Your Wallet', value: '**Before using this wallet, make sure to top it up with:**\n- **EGLD** - Required for blockchain transaction fees\n- **REWARD** tokens - Required for MakeX API usage fees ($0.03 per transaction)\n\nWithout these, the bot cannot send tokens or NFTs from this wallet.', inline: false }
          ])
          .setColor('#00FF00')
          .setTimestamp()
          .setFooter({ text: 'Keep this information secure!', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        // Try to send PEM file as attachment
        const fs = require('fs');
        const path = require('path');
        const tempPemPath = path.join(__dirname, `temp_${projectName}_${Date.now()}.pem`);
        
        try {
          // Write PEM to temporary file
          fs.writeFileSync(tempPemPath, wallet.pem, 'utf8');
          
          // Send DM with file attachment
          await adminUser.send({
            embeds: [dmEmbed],
            files: [{
              attachment: tempPemPath,
              name: `${projectName}_WalletKey.pem`,
              description: 'PEM file for your project wallet'
            }]
          });
          
          // Clean up temporary file
          fs.unlinkSync(tempPemPath);
          console.log(`[REGISTER-PROJECT] ✅ Sent DM with PEM file to admin ${interaction.user.tag}`);
        } catch (fileError) {
          // If file attachment fails, send without file
          console.error(`[REGISTER-PROJECT] Could not send PEM file, sending text only:`, fileError.message);
          
          // Clean up temp file if it exists
          if (fs.existsSync(tempPemPath)) {
            try {
              fs.unlinkSync(tempPemPath);
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
          }
          
          // Send DM without file attachment
          await adminUser.send({ embeds: [dmEmbed] });
          console.log(`[REGISTER-PROJECT] ✅ Sent DM (text only) to admin ${interaction.user.tag}`);
        }
      } catch (dmError) {
        console.error(`[REGISTER-PROJECT] Could not send DM to admin ${interaction.user.tag}:`, dmError.message);
        // Don't fail the command if DM fails - the embed already has the info
      }
      
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
      console.log(`Project "${projectName}" registered for guild ${guildId} by ${interaction.user.tag} with auto-generated wallet ${wallet.address}`);
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
      const projectLogoUrl = interaction.options.getString('project-logo-url');
      const qrCodeUrl = interaction.options.getString('qr-code-url');
      const userInput = interaction.options.getString('user-input');

      const projects = await getProjects(guildId);
      
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

      const finalProjectName = newProjectName || projectName;
      let updatedProject = { ...currentProject };
      
      // Update project name if provided
      if (newProjectName && newProjectName !== projectName) {
        changes.push(`Project name: "${projectName}" → "${newProjectName}"`);
        hasChanges = true;
      }

      // Update wallet address if provided
      if (walletAddress) {
        if (!walletAddress.startsWith('erd1') || walletAddress.length !== 62) {
          await interaction.editReply({ content: 'Invalid wallet address format. Please provide a valid MultiversX wallet address (erd1...).', flags: [MessageFlags.Ephemeral] });
          return;
        }
        updatedProject.walletAddress = walletAddress;
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
        updatedProject.walletPem = walletPem;
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
        
        updatedProject.supportedTokens = supportedTokens;
        changes.push(`Supported tokens updated to: ${supportedTokens.join(', ')}`);
        hasChanges = true;
      }

      // Check if this is a Community Fund project (hardcoded name)
      const isCommunityFund = projectName === getCommunityFundProjectName();
      
      // Block restricted fields for Community Fund projects
      if (isCommunityFund) {
        // Block renaming Community Fund project (would break the system)
        if (newProjectName && newProjectName !== projectName) {
          await interaction.editReply({ 
            content: `❌ **Cannot rename Community Fund project.**\n\nThe Community Fund project name is fixed and cannot be changed.\n\n**To change the fund display name:**\nThe fund name is stored separately in guild settings. If you need to change the display name, you would need to delete and recreate the Community Fund.\n\n**Note:** The internal project name must always be "Community Fund" for the system to work correctly.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Block wallet address changes (auto-generated, shouldn't be changed)
        if (walletAddress) {
          await interaction.editReply({ 
            content: `❌ **Cannot update wallet address for Community Fund.**\n\nThe Community Fund wallet is auto-generated and cannot be manually changed.\n\n**Why this is blocked:**\n• The wallet is automatically generated by the bot\n• Changing it would break Virtual Accounts tracking\n• The blockchain listener monitors the original wallet address\n\n**To change the wallet:**\nYou must delete the existing Community Fund and create a new one using \`/set-community-fund\`.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Block wallet PEM changes (auto-generated, shouldn't be changed)
        if (walletPem) {
          await interaction.editReply({ 
            content: `❌ **Cannot update wallet PEM for Community Fund.**\n\nThe Community Fund wallet PEM is auto-generated and encrypted. It cannot be manually changed.\n\n**Why this is blocked:**\n• The PEM is automatically generated by the bot\n• It's encrypted and stored securely in the database\n• Changing it would break wallet functionality\n\n**To change the wallet:**\nYou must delete the existing Community Fund and create a new one using \`/set-community-fund\`.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Block project logo URL (Community Fund uses QR codes instead)
        if (projectLogoUrl !== null) {
          await interaction.editReply({ 
            content: `⚠️ **Project Logo URL cannot be updated for Community Fund projects.**\n\nCommunity Fund projects use QR codes instead. Use the \`qr-code-url\` option to update the Community Fund QR code.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Block user input (Community Fund is auto-generated, notes shouldn't be stored in projects table)
        if (userInput !== null) {
          await interaction.editReply({ 
            content: `❌ **Cannot update user input/notes for Community Fund projects.**\n\nThe Community Fund is auto-generated and notes should not be stored in the projects table.\n\n**Why this is blocked:**\n• The Community Fund is automatically generated by the bot\n• Notes are not used for Community Fund projects\n• This field is intended for manually registered projects only`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }
      
      // Update project logo URL if provided (stored in projects table)
      // Only allowed for non-Community Fund projects
      if (projectLogoUrl !== null) {
        updatedProject.projectLogoUrl = projectLogoUrl;
        changes.push(`Project logo URL updated: ${projectLogoUrl || 'Removed'}`);
        hasChanges = true;
      }
      
      // Update QR code URL if provided (stored in community_fund_qr table)
      // Only allowed for Community Fund projects
      if (qrCodeUrl !== null) {
        if (!isCommunityFund) {
          await interaction.editReply({ 
            content: `⚠️ **QR Code URL can only be updated for Community Fund projects.**\n\nProject "${projectName}" is not the Community Fund.\n\nUse the \`project-logo-url\` option to update the project logo instead.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        // This is the Community Fund project, update the QR code
        // Use the internal project name "Community Fund" for the QR code lookup
        await dbServerData.setCommunityFundQR(guildId, getCommunityFundProjectName(), qrCodeUrl);
        changes.push(`Community Fund QR code URL updated: ${qrCodeUrl || 'Removed'}`);
        hasChanges = true;
      }

      // Update user input if provided
      // Only allowed for non-Community Fund projects
      if (userInput !== null) {
        updatedProject.userInput = userInput;
        changes.push(`Notes updated: ${userInput}`);
        hasChanges = true;
      }

      if (!hasChanges) {
        await interaction.editReply({ content: 'No changes provided. Please specify at least one field to update.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Save to database
      if (newProjectName && newProjectName !== projectName) {
        // Delete old project and create new one
        await dbServerData.deleteProject(guildId, projectName);
        await dbServerData.setProject(guildId, newProjectName, updatedProject);
      } else {
        await dbServerData.setProject(guildId, projectName, updatedProject);
      }

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
      // Use updatedProject which has the latest data (whether renamed or not)
      const targetProject = updatedProject;
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
      const projects = await getProjects(guildId);
      
      if (!projects[projectName]) {
        await interaction.editReply({ 
          content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Prevent using community fund project for /send-esdt
      // Check against internal project name "Community Fund"
      const communityFundProjectName = getCommunityFundProjectName();
      if (projectName === communityFundProjectName) {
        await interaction.editReply({ 
          content: `❌ **Cannot use Community Fund project for /send-esdt!**\n\nThe Community Fund is a hot wallet used for virtual account deposits and withdrawals.\n\n**Why this is blocked:**\n• The Community Fund holds user deposits for virtual accounts\n• Sending funds out would reduce available balance for withdrawals\n• This could cause users to lose funds when trying to withdraw\n\n**Please select a different project for admin transfers.**`, 
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
          const userWallets = await getUserWallets(guildId);
          recipientWallet = userWallets[targetUserId];
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
      
      // Resolve token identifier from ticker/identifier BEFORE transfer
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      
      // Validate identifier format
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (!esdtIdentifierRegex.test(tokenIdentifier)) {
        await interaction.editReply({ 
          content: `❌ **Invalid token identifier!**\n\nCould not resolve full token identifier for "${tokenTicker}". Please ensure token metadata is registered using /update-token-metadata.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const transferResult = await transferESDT(recipientWallet, tokenIdentifier, amount, projectName, guildId);
      
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
            const projectLogoUrl = await getProjectLogoUrl(guildId, projectName);
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
              .setThumbnail(projectLogoUrl)
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
  } else if (commandName === 'send-nft') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can send NFTs.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const collection = interaction.options.getString('collection');
      const nftName = interaction.options.getString('nft-name');
      const userTag = interaction.options.getString('user-tag');
      const memo = interaction.options.getString('memo') || 'No memo provided';

      // Get available projects for this server
      const projects = await getProjects(guildId);
      const communityFundProject = await getCommunityFundProject(guildId);
      
      if (!projects[projectName]) {
        await interaction.editReply({ 
          content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Prevent using community fund project for /send-nft
      if (projectName === communityFundProject) {
        await interaction.editReply({ 
          content: `❌ **Cannot use Community Fund project for /send-nft!**\n\nThe project "${projectName}" is configured as the Community Fund and is used for virtual account deposits.\n\nPlease select a different project for admin transfers.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const project = projects[projectName];
      const walletAddress = project.walletAddress;

      if (!walletAddress) {
        await interaction.editReply({ 
          content: `Project "${projectName}" has no wallet address configured.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Fetch NFT details to get nonce
      await interaction.editReply({ 
        content: `Fetching NFT details for ${nftName}...`, 
        flags: [MessageFlags.Ephemeral] 
      });

      const encodedNftName = encodeURIComponent(nftName);
      const nftDetailsUrl = `https://api.multiversx.com/accounts/${walletAddress}/nfts?search=${encodeURIComponent(collection)}&name=${encodedNftName}`;
      
      let nftDetails;
      try {
        const nftResponse = await fetch(nftDetailsUrl);
        if (!nftResponse.ok) {
          throw new Error(`Failed to fetch NFT details: ${nftResponse.status}`);
        }
        const nftData = await nftResponse.json();
        
        if (!Array.isArray(nftData) || nftData.length === 0) {
          throw new Error(`NFT "${nftName}" not found in collection "${collection}"`);
        }
        
        // Find the exact NFT match by name
        nftDetails = nftData.find(nft => nft.name === nftName) || nftData[0];
        
        if (!nftDetails || nftDetails.collection !== collection) {
          throw new Error(`NFT "${nftName}" not found in collection "${collection}"`);
        }

        if (!nftDetails.nonce && nftDetails.nonce !== 0) {
          throw new Error(`NFT "${nftName}" does not have a valid nonce`);
        }
      } catch (fetchError) {
        await interaction.editReply({ 
          content: `Error fetching NFT details: ${fetchError.message}`, 
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
          const userWallets = await getUserWallets(guildId);
          recipientWallet = userWallets[targetUserId];
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
      
      // Use the actual collection identifier from NFT details (canonical identifier from API)
      const collectionIdentifier = nftDetails.collection || collection;
      
      await interaction.editReply({ 
        content: `Preparing to send ${nftName} (${collectionIdentifier}#${nftDetails.nonce}) to ${userTag}...\nMemo: ${memo}`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
      console.log(`Admin ${interaction.user.tag} (${interaction.user.id}) is sending NFT ${nftName} (${collectionIdentifier}#${nftDetails.nonce}) to ${userTag} (${recipientWallet}) using project ${projectName}`);
      console.log(`Transfer memo: ${memo}`);
      
      const transferResult = await transferNFT(
        recipientWallet, 
        collectionIdentifier, // Use canonical collection identifier from API
        nftDetails.nonce, // tokenNonce
        projectName, 
        guildId
      );
      
      if (transferResult.success) {
        const explorerUrl = transferResult.txHash
          ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
          : null;
        const txHashFieldValue = transferResult.txHash
          ? `[${transferResult.txHash}](${explorerUrl})`
          : 'Not available';

        // Extract NFT image URL from API response
        let nftImageUrl = null;
        if (nftDetails.url) {
          nftImageUrl = nftDetails.url;
        } else if (nftDetails.media && nftDetails.media.length > 0 && nftDetails.media[0].url) {
          nftImageUrl = nftDetails.media[0].url;
        } else if (nftDetails.media && nftDetails.media.length > 0 && nftDetails.media[0].thumbnailUrl) {
          nftImageUrl = nftDetails.media[0].thumbnailUrl;
        }

        const successEmbed = new EmbedBuilder()
          .setTitle('NFT Transfer Successful')
          .setDescription(`Successfully sent **${nftName}** (${collectionIdentifier}#${nftDetails.nonce}) to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: 'NFT Name', value: nftName, inline: true },
            { name: 'Collection', value: collectionIdentifier, inline: true },
            { name: 'Nonce', value: String(nftDetails.nonce), inline: true },
            { name: 'Project Used', value: projectName, inline: true },
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Initiated By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '✅ Success', inline: true }
          ])
          .setColor(0x4d55dc)
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();
        
        // Set NFT image as thumbnail if available, otherwise use default thumbnail
        if (nftImageUrl) {
          successEmbed.setThumbnail(nftImageUrl);
        } else {
          successEmbed.setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif');
        }
        
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
              content: `🎨 **NFT Transfer Notification** 🎨`,
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
            const projectLogoUrl = await getProjectLogoUrl(guildId, projectName);
            const dmEmbed = new EmbedBuilder()
              .setTitle('You Received an NFT!')
              .setDescription(`You have received **${nftName}** (${collectionIdentifier}#${nftDetails.nonce}) from an administrator.`)
              .addFields([
                { name: 'NFT Name', value: nftName, inline: true },
                { name: 'Collection', value: collectionIdentifier, inline: true },
                { name: 'Nonce', value: String(nftDetails.nonce), inline: true },
                { name: 'Project Used', value: projectName, inline: true },
                { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
                { name: 'Memo', value: memo, inline: false },
                { name: 'Sender', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Status', value: '✅ Success', inline: true }
              ])
              .setColor(0x4d55dc)
              .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
              .setTimestamp();
            
            // Set NFT image as thumbnail if available, otherwise use project logo
            if (nftImageUrl) {
              dmEmbed.setThumbnail(nftImageUrl);
            } else {
              dmEmbed.setThumbnail(projectLogoUrl);
            }
            
            await targetUser.send({ embeds: [dmEmbed] });
            console.log(`Sent DM notification to ${userTag} about received NFT`);
          }
        } catch (dmError) {
          console.error(`Could not send DM to ${userTag}:`, dmError.message);
        }
      } else {
          const errorEmbed = new EmbedBuilder()
          .setTitle('NFT Transfer Failed')
          .setDescription(`Failed to send **${nftName}** (${collectionIdentifier}#${nftDetails.nonce}) to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: 'NFT Name', value: nftName, inline: true },
            { name: 'Collection', value: collectionIdentifier, inline: true },
            { name: 'Nonce', value: String(nftDetails.nonce), inline: true },
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
      console.error('Error sending NFT:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error sending NFT: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error sending NFT: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'create-auction') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const source = interaction.options.getString('source');
      
      // Only admins can create auctions from Project Wallet
      // Regular users can create auctions from their Virtual Account
      if (source === 'project_wallet') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.editReply({ 
            content: '❌ **Admin Only!**\n\nOnly administrators can create auctions from Project Wallet.\n\nTo auction your own NFTs, select "Virtual Account" as the source.', 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }

      const collection = interaction.options.getString('collection');
      const nftName = interaction.options.getString('nft-name');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const duration = interaction.options.getNumber('duration');
      const tokenTicker = interaction.options.getString('token-ticker');
      const startingAmount = interaction.options.getString('starting-amount');
      const minBidIncrease = interaction.options.getString('min-bid-increase');
      const amountOption = interaction.options.getNumber('amount');
      const amount = amountOption && amountOption > 0 ? amountOption : 1;
      
      // Validate amount
      if (amount <= 0 || !Number.isInteger(amount)) {
        await interaction.editReply({ 
          content: `❌ **Invalid amount!**\n\nAmount must be a positive integer.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      let projectName = null;
      let walletAddress = null;
      let sellerId = null;
      let nftDetails = null;
      
      // Handle different sources
      if (source === 'virtual_account') {
        // Virtual Account source: Get seller ID (use command user if not specified)
        sellerId = interaction.options.getString('seller-id') || userId;
        
        // Verify seller owns the NFT
        const userNFTs = await virtualAccountsNFT.getUserNFTBalances(guildId, sellerId, collection);
        
        if (!userNFTs || userNFTs.length === 0) {
          await interaction.editReply({ 
            content: `❌ **NFT not found!**\n\nYou don't own any NFTs in collection "${collection}" in your virtual account.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Find the specific NFT by name
        const nft = userNFTs.find(n => 
          (n.nft_name && n.nft_name.toLowerCase() === nftName.toLowerCase()) ||
          `${collection}#${n.nonce}` === nftName ||
          (n.nft_name && `${collection}#${n.nonce}`.toLowerCase() === nftName.toLowerCase())
        );
        
        if (!nft) {
          await interaction.editReply({ 
            content: `❌ **NFT not found!**\n\nNFT "${nftName}" not found in your collection "${collection}".`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // CRITICAL: Calculate available balance (total - active auctions - active listings)
        const totalBalance = nft.amount || 1;
        
        // Get active auctions for this NFT (collection + nonce) by this user
        const dbAuctions = require('./db/auctions');
        const activeAuctions = await dbAuctions.getUserActiveAuctions(guildId, sellerId, collection, nft.nonce);
        const lockedInAuctions = activeAuctions.reduce((sum, auction) => sum + (auction.amount || 1), 0);
        
        // Get active listings for this NFT (collection + nonce) by this user
        const activeListings = await virtualAccountsNFT.getUserListings(guildId, sellerId, 'ACTIVE');
        const listingsForThisNFT = activeListings.filter(listing => 
          listing.collection === collection && listing.nonce === nft.nonce
        );
        const lockedInListings = listingsForThisNFT.reduce((sum, listing) => sum + (listing.amount || 1), 0);
        
        // Calculate available balance
        const availableBalance = totalBalance - lockedInAuctions - lockedInListings;
        
        // Check if user has sufficient available balance
        if (amount > availableBalance) {
          const balanceTokenType = nft.token_type || 'NFT';
          const lockedTotal = lockedInAuctions + lockedInListings;
          
          let errorMessage = `❌ **Insufficient available balance!**\n\n`;
          errorMessage += `**Total Balance:** ${totalBalance} ${balanceTokenType}(s)\n`;
          if (lockedInAuctions > 0) {
            errorMessage += `**Locked in Auctions:** ${lockedInAuctions} ${balanceTokenType}(s)\n`;
          }
          if (lockedInListings > 0) {
            errorMessage += `**Locked in Listings:** ${lockedInListings} ${balanceTokenType}(s)\n`;
          }
          errorMessage += `**Available:** ${availableBalance} ${balanceTokenType}(s)\n`;
          errorMessage += `**Trying to auction:** ${amount} ${balanceTokenType}(s)`;
          
          await interaction.editReply({ 
            content: errorMessage, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Use NFT data from virtual account
        // IMPORTANT: Use token_type from database (bulletproof), only fallback to amount if token_type is truly missing
        // If token_type is NULL/undefined, check if we can infer from amount, but prefer explicit token_type
        const nftTokenType = nft.token_type;
        const inferredTokenType = amount > 1 ? 'SFT' : 'NFT';
        const finalTokenType = nftTokenType || inferredTokenType;
        
        // Log for debugging
        if (!nftTokenType) {
          console.log(`[AUCTIONS] Warning: NFT ${collection}#${nft.nonce} has no token_type set. Inferring from amount: ${amount} -> ${inferredTokenType}`);
        } else {
          console.log(`[AUCTIONS] Using token_type from database: ${nftTokenType} for NFT ${collection}#${nft.nonce}`);
        }
        
        nftDetails = {
          nonce: nft.nonce,
          identifier: nft.identifier || `${collection}-${nft.nonce}`,
          collection: collection,
          name: nft.nft_name || `${collection}#${nft.nonce}`,
          tokenType: finalTokenType
        };
        
        // Validate token is in Community Fund's supported tokens
        const projects = await getProjects(guildId);
        const communityFundProjectName = getCommunityFundProjectName();
        const communityFundProject = projects[communityFundProjectName];
        
        if (!communityFundProject) {
          await interaction.editReply({ 
            content: `❌ **Community Fund not configured!**\n\nPlease contact an administrator to set up the Community Fund.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        let supportedTokens = [];
        if (communityFundProject.supportedTokens) {
          if (Array.isArray(communityFundProject.supportedTokens)) {
            supportedTokens = communityFundProject.supportedTokens;
          } else if (typeof communityFundProject.supportedTokens === 'string') {
            supportedTokens = communityFundProject.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
          }
        }
        
        if (!supportedTokens.some(t => t.toLowerCase() === tokenTicker.toLowerCase())) {
          await interaction.editReply({ 
            content: `❌ **Token not supported!**\n\nToken "${tokenTicker}" is not supported by the Community Fund.\n\nSupported tokens: ${supportedTokens.join(', ') || 'None configured'}`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
      } else {
        // Project Wallet source: Get project name
        projectName = interaction.options.getString('project-name');
        
        if (!projectName) {
          await interaction.editReply({ 
            content: `❌ **Project required!**\n\nPlease select a project when using "Project Wallet" as the source.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        // Get available projects for this server
        const projects = await getProjects(guildId);
        const communityFundProjectName = getCommunityFundProjectName(); // Always "Community Fund"
        
        if (!projects[projectName]) {
          await interaction.editReply({ 
            content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }

        // Prevent using community fund project for auctions
        // Check by internal project name "Community Fund" to ensure it's always blocked
        if (projectName === communityFundProjectName) {
          await interaction.editReply({ 
            content: `❌ **Cannot use Community Fund project for auctions!**\n\nThe project "${projectName}" is configured as the Community Fund and is used for virtual account deposits.\n\nPlease select a different project for auctions.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }

        const project = projects[projectName];
        walletAddress = project.walletAddress;

        if (!walletAddress) {
          await interaction.editReply({ 
            content: `Project "${projectName}" has no wallet address configured.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }

        // Validate token is in project's supported tokens
        let supportedTokens = [];
        if (project.supportedTokens) {
          if (Array.isArray(project.supportedTokens)) {
            supportedTokens = project.supportedTokens;
          } else if (typeof project.supportedTokens === 'string') {
            supportedTokens = project.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
          }
        }
        
        if (!supportedTokens.some(t => t.toLowerCase() === tokenTicker.toLowerCase())) {
          await interaction.editReply({ 
            content: `Token "${tokenTicker}" is not supported by project "${projectName}". Supported tokens: ${supportedTokens.join(', ') || 'None configured'}`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }

      // Resolve token identifier from ticker/identifier
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      if (!tokenIdentifier) {
        await interaction.editReply({ 
          content: `❌ Could not resolve token identifier for "${tokenTicker}". Please ensure token metadata is registered.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Validate amounts
      try {
        const startingAmountBN = new BigNumber(startingAmount);
        const minBidIncreaseBN = new BigNumber(minBidIncrease);
        
        if (startingAmountBN.isLessThanOrEqualTo(0)) {
          throw new Error('Starting amount must be greater than 0');
        }
        if (minBidIncreaseBN.isLessThanOrEqualTo(0)) {
          throw new Error('Minimum bid increase must be greater than 0');
        }
      } catch (amountError) {
        await interaction.editReply({ 
          content: `Invalid amount: ${amountError.message}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Fetch NFT details based on source
      if (source === 'project_wallet') {
        // Fetch NFT details from project wallet
        await interaction.editReply({ 
          content: `Fetching NFT details for ${nftName}...`, 
          flags: [MessageFlags.Ephemeral] 
        });

        const encodedNftName = encodeURIComponent(nftName);
        const nftDetailsUrl = `https://api.multiversx.com/accounts/${walletAddress}/nfts?search=${encodeURIComponent(collection)}&name=${encodedNftName}`;
        
        try {
          const nftResponse = await fetch(nftDetailsUrl);
          if (!nftResponse.ok) {
            throw new Error(`Failed to fetch NFT details: ${nftResponse.status}`);
          }
          const nftData = await nftResponse.json();
          
          if (!Array.isArray(nftData) || nftData.length === 0) {
            throw new Error(`NFT "${nftName}" not found in collection "${collection}"`);
          }
          
          // Find the exact NFT match by name
          const fetchedNftDetails = nftData.find(nft => nft.name === nftName) || nftData[0];
          
          if (!fetchedNftDetails || fetchedNftDetails.collection !== collection) {
            throw new Error(`NFT "${nftName}" not found in collection "${collection}"`);
          }

          if (!fetchedNftDetails.nonce && fetchedNftDetails.nonce !== 0) {
            throw new Error(`NFT "${nftName}" does not have a valid nonce`);
          }
          
          nftDetails = fetchedNftDetails;
        } catch (fetchError) {
          await interaction.editReply({ 
            content: `Error fetching NFT details: ${fetchError.message}`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }
      // For virtual_account, nftDetails is already set above

      // Extract NFT image URL using robust fallback strategy
      let nftImageUrl = null;
      if (source === 'virtual_account') {
        // Get image from virtual account NFT data
        const nft = await virtualAccountsNFT.getUserNFTBalance(guildId, sellerId, collection, nftDetails.nonce);
        nftImageUrl = await extractNFTImageUrl(nftDetails, nft?.nft_image_url);
      } else {
        // Get image from API response using robust fallback
        nftImageUrl = await extractNFTImageUrl(nftDetails);
      }

      // Generate unique auction ID
      const auctionId = `auction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Calculate end time
      const endTime = Date.now() + (duration * 60 * 60 * 1000);
      
      // Fetch token price for USD valuation
      let tokenPriceUsd = 0;
      try {
        const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          tokenPriceUsd = priceData.price || 0;
        }
      } catch (error) {
        console.error('[AUCTIONS] Error fetching token price:', error.message);
      }
      
      // Calculate USD values
      const startingAmountUsd = tokenPriceUsd > 0 
        ? new BigNumber(startingAmount).multipliedBy(tokenPriceUsd).toFixed(2)
        : null;
      const minBidIncreaseUsd = tokenPriceUsd > 0 
        ? new BigNumber(minBidIncrease).multipliedBy(tokenPriceUsd).toFixed(2)
        : null;
      
      // Format display values
      const startingAmountDisplay = startingAmountUsd 
        ? `${startingAmount} ${tokenTicker} (≈ $${startingAmountUsd})`
        : `${startingAmount} ${tokenTicker}`;
      const currentBidDisplay = startingAmountUsd
        ? `${startingAmount} ${tokenTicker} (≈ $${startingAmountUsd}) (No bids yet)`
        : `${startingAmount} ${tokenTicker} (No bids yet)`;
      const minBidIncreaseDisplay = minBidIncreaseUsd
        ? `${minBidIncrease} ${tokenTicker} (≈ $${minBidIncreaseUsd})`
        : `${minBidIncrease} ${tokenTicker}`;
      
      // Create auction embed (use token_type from nftDetails if available)
      const embedTokenType = nftDetails.tokenType || (amount > 1 ? 'SFT' : 'NFT');
      const amountText = amount > 1 ? ` (${amount}x)` : '';
      const auctionEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n**${embedTokenType}:** ${nftName}${amountText}\n**Collection:** ${collection}\n**Nonce:** ${nftDetails.nonce}`)
        .addFields([
          { name: 'Starting Amount', value: startingAmountDisplay, inline: true },
          { name: 'Current Bid', value: currentBidDisplay, inline: true },
          { name: 'Minimum Increase', value: minBidIncreaseDisplay, inline: true },
          { name: 'Token', value: tokenTicker, inline: true },
          { name: 'Time Remaining', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
          { name: 'Status', value: '🟢 Active', inline: true }
        ])
        .setColor(0x00FF00)
        .setTimestamp(new Date(endTime))
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      if (nftImageUrl) {
        auctionEmbed.setThumbnail(nftImageUrl);
      } else {
        auctionEmbed.setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif');
      }

      // Create buttons
      const bidButton = new ButtonBuilder()
        .setCustomId(`bid:${auctionId}`)
        .setLabel('Place Bid')
        .setStyle(ButtonStyle.Primary);

      const quickBidButton = new ButtonBuilder()
        .setCustomId(`quick-bid:${auctionId}`)
        .setLabel('Quick Bid')
        .setStyle(ButtonStyle.Success);

      const buttonRow = new ActionRowBuilder()
        .addComponents(bidButton, quickBidButton);

      // Post auction embed
      const auctionMessage = await interaction.channel.send({ 
        embeds: [auctionEmbed], 
        components: [buttonRow] 
      });

      // Create thread (optional - continue even if it fails)
      let thread = null;
      let threadId = null;
      try {
        thread = await auctionMessage.startThread({
          name: `Auction: ${nftName}`,
          autoArchiveDuration: 60
        });
        threadId = thread.id;
        console.log(`[AUCTIONS] Successfully created thread ${threadId} for auction ${auctionId}`);
      } catch (threadError) {
        console.error(`[AUCTIONS] Error creating thread for auction ${auctionId}:`, threadError.message);
        console.error(`[AUCTIONS] Continuing without thread - auction will still be created`);
        // Don't return - continue without thread
      }

      // Store auction data in database
      console.log(`[AUCTIONS] Storing auction ${auctionId} in guild ${guildId}`);
      
      // Determine token type: use from nftDetails if available (virtual account), otherwise infer from amount
      // Use the same tokenType we used for the embed
      const dbTokenType = nftDetails.tokenType || (amount > 1 ? 'SFT' : 'NFT');
      
      await dbAuctions.createAuction(guildId, auctionId, {
        creatorId: interaction.user.id,
        creatorTag: interaction.user.tag,
        source: source, // Store source: 'virtual_account' or 'project_wallet'
        sellerId: sellerId, // Store seller ID for virtual account auctions
        projectName: projectName, // null for virtual_account, project name for project_wallet
        collection,
        nftName,
        nftIdentifier: nftDetails.identifier || `${collection}-${nftDetails.nonce}`,
        nftNonce: nftDetails.nonce,
        amount: amount,
        tokenType: dbTokenType,
        nftImageUrl,
        title,
        description,
        duration: duration * 60 * 60 * 1000,
        endTime,
        tokenTicker, // Keep for display
        tokenIdentifier, // Store identifier for operations
        startingAmount,
        minBidIncrease,
        currentBid: startingAmount,
        highestBidderId: null,
        highestBidderTag: null,
        messageId: auctionMessage.id,
        threadId: threadId,
        channelId: interaction.channel.id,
        status: 'ACTIVE',
        createdAt: Date.now()
      });
      
      console.log(`[AUCTIONS] Auction ${auctionId} stored successfully in database`);

      // Post initial message in thread (if thread was created)
      if (thread) {
        try {
          await thread.send(`🎉 **Auction created!** Bidding is now open. Use the buttons on the auction embed to place your bids.`);
        } catch (threadError) {
          console.error(`[AUCTIONS] Error posting to thread:`, threadError.message);
        }
      }

      await interaction.editReply({ 
        content: `✅ Auction created successfully! Auction ID: \`${auctionId}\``, 
        flags: [MessageFlags.Ephemeral] 
      });

      console.log(`[AUCTIONS] Created auction ${auctionId} by ${interaction.user.tag} for NFT ${nftName} (${collection}#${nftDetails.nonce})`);
    } catch (error) {
      console.error('Error creating auction:', error);
      
      // Check if it's a database schema error
      let errorMessage = error.message;
      if (error.message?.includes('seller_id') || error.message?.includes('source') || error.message?.includes('token_identifier')) {
        errorMessage = `Database migration required! Please run the migration SQL file (migration-add-auction-fields.sql) in your Supabase SQL editor to add the missing columns. The auction was created but some data may be missing.\n\nOriginal error: ${error.message}`;
      }
      
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error creating auction: ${errorMessage}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error creating auction: ${errorMessage}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'set-community-fund') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can set the Community Tip Fund.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const fundName = interaction.options.getString('fund-name');
      const supportedTokensInput = interaction.options.getString('supported-tokens');
      const qrCodeUrl = interaction.options.getString('qr-code-url');
      
      // Fixed project name for community fund (internal project name)
      const projectName = 'Community Fund';
      
      // Check if community fund already exists - prevent multiple community funds
      const currentFund = await getCommunityFundProject(guildId);
      const projects = await getProjects(guildId);
      const existingCommunityFundProject = projects[projectName];
      
      // Check if Community Fund already exists
      if (currentFund || existingCommunityFundProject) {
        const existingFundName = currentFund || 'Community Fund';
        const existingWalletAddress = existingCommunityFundProject?.walletAddress || 'Unknown';
        
        // Check if the existing PEM is valid
        let allowOverwrite = false;
        let invalidPemReason = null;
        
        if (existingCommunityFundProject) {
          const existingPem = existingCommunityFundProject.walletPem;
          
          // Check if PEM is missing or empty
          if (!existingPem || existingPem.trim().length === 0) {
            allowOverwrite = true;
            invalidPemReason = 'PEM is missing or empty';
          }
          // Check if PEM format is invalid
          else if (!existingPem.includes('BEGIN') || !existingPem.includes('END')) {
            allowOverwrite = true;
            invalidPemReason = 'PEM format is invalid (missing BEGIN/END markers)';
          }
          // Check if PEM is too short (less than 200 characters)
          else if (existingPem.length < 200) {
            allowOverwrite = true;
            invalidPemReason = `PEM is too short (${existingPem.length} chars, expected 200+)`;
          }
        }
        
        // If PEM is invalid, allow overwriting with a warning
        if (allowOverwrite) {
          console.log(`[COMMUNITY-FUND] Allowing overwrite of Community Fund due to invalid PEM: ${invalidPemReason}`);
          await interaction.editReply({ 
            content: `⚠️ **Warning: Invalid Community Fund PEM Detected**\n\nA Community Fund exists but has an **invalid PEM**: ${invalidPemReason}\n\n**Current Configuration:**\n• **Fund Name:** ${existingFundName}\n• **Wallet Address:** \`${existingWalletAddress}\`\n\n**This will be overwritten** with a new valid wallet.\n\n⚠️ **Important:**\n• The wallet address will change\n• Users will need to update their deposit addresses\n• Existing funds in the old wallet will NOT be transferred\n• Mass refund will work with the new valid PEM\n\nProceeding with wallet generation...`, 
            flags: [MessageFlags.Ephemeral] 
          });
          // Continue with wallet generation (don't return)
        } else {
          // PEM is valid, block overwriting
          await interaction.editReply({ 
            content: `❌ **Error: Community Fund Already Exists**\n\nA Community Tip Fund is already configured for this server.\n\n**Current Configuration:**\n• **Fund Name:** ${existingFundName}\n• **Wallet Address:** \`${existingWalletAddress}\`\n\n**Why this is blocked:**\n• Only one Community Fund is allowed per server\n• Multiple funds would cause issues with Virtual Accounts tracking\n• The blockchain listener monitors a single Community Fund wallet per guild\n\n**To change the Community Fund:**\n1. First delete the existing Community Fund project using \`/delete-project\`\n2. Then run \`/set-community-fund\` again\n\n⚠️ **Note:** Deleting the Community Fund will trigger a mass refund of all virtual account balances.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }
      
      // Parse supported tokens (required field)
      const supportedTokens = supportedTokensInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      
      if (supportedTokens.length === 0) {
        await interaction.editReply({ 
          content: '❌ **Invalid supported tokens!**\n\nPlease provide at least one valid token ticker (e.g., EGLD,USDC,USDT).', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Generate wallet using MultiversX SDK
      const walletGenerator = require('./utils/wallet-generator');
      await interaction.editReply({ 
        content: '🔄 **Generating Community Fund Wallet...**\n\nCreating a new MultiversX wallet using the SDK...', 
        flags: [MessageFlags.Ephemeral] 
      });
      
      const wallet = await walletGenerator.generateCompleteWallet();
      
      // Validate generated PEM before storing
      if (!wallet.pem || wallet.pem.trim().length === 0) {
        throw new Error('Failed to generate wallet: PEM is empty');
      }
      
      if (!wallet.pem.includes('BEGIN') || !wallet.pem.includes('END')) {
        throw new Error('Failed to generate wallet: Invalid PEM format');
      }
      
      // Validate PEM length (should be at least 90 characters)
      // Short PEM format (from seed phrase tools): ~98 chars (44 char base64 for 32-byte key)
      // Long PEM format (from SDK with address): ~250+ chars (address + secret key, multi-line base64)
      // Both formats are valid for signing MultiversX transactions
      if (wallet.pem.length < 90) {
        console.error(`[COMMUNITY-FUND] Generated PEM is too short: ${wallet.pem.length} characters (expected 90+)`);
        throw new Error(`Failed to generate wallet: PEM is too short (${wallet.pem.length} chars, expected 90+). Please try again.`);
      }
      
      // Validate PEM structure - must have BEGIN and END markers on separate lines
      const pemLines = wallet.pem.split('\n');
      const beginLine = pemLines.find(line => line.includes('BEGIN'));
      const endLine = pemLines.find(line => line.includes('END'));
      const base64Content = pemLines.filter(line => !line.includes('BEGIN') && !line.includes('END') && line.trim().length > 0).join('');
      
      if (!beginLine || !endLine) {
        console.error(`[COMMUNITY-FUND] PEM missing BEGIN or END markers`);
        throw new Error('Failed to generate wallet: PEM missing BEGIN or END markers');
      }
      
      // Validate base64 content (minimum 40 chars for 32-byte key, but can be longer with address)
      // Short PEM: ~44 chars base64 (secret key only)
      // Long PEM: ~192+ chars base64 (address + secret key)
      if (base64Content.length < 40) {
        console.error(`[COMMUNITY-FUND] PEM base64 content too short: ${base64Content.length} characters (expected 40+)`);
        throw new Error(`Failed to generate wallet: PEM base64 content too short (${base64Content.length} chars, expected 40+). Please try again.`);
      }
      
      console.log(`[COMMUNITY-FUND] Generated wallet with PEM length: ${wallet.pem.length} characters`);
      console.log(`[COMMUNITY-FUND] PEM structure: BEGIN marker: ${!!beginLine}, END marker: ${!!endLine}, Base64 length: ${base64Content.length}`);
      
      // Create/update the Community Fund project
      await dbServerData.setProject(guildId, projectName, {
        walletAddress: wallet.address,
        walletPem: wallet.pem,
        supportedTokens: supportedTokens,
        userInput: null,
        registeredBy: interaction.user.id,
        registeredAt: Date.now(),
        projectLogoUrl: null // Community Fund doesn't use project logo
      });
      
      // Verify the PEM was stored correctly by reading it back
      console.log(`[COMMUNITY-FUND] Verifying stored PEM...`);
      const storedProject = await dbServerData.getProject(guildId, projectName);
      if (!storedProject || !storedProject.walletPem) {
        throw new Error('Failed to verify stored PEM: PEM not found after storage');
      }
      
      if (storedProject.walletPem.length !== wallet.pem.length) {
        console.error(`[COMMUNITY-FUND] PEM length mismatch! Original: ${wallet.pem.length}, Stored: ${storedProject.walletPem.length}`);
        throw new Error(`PEM length mismatch after storage! Original: ${wallet.pem.length}, Stored: ${storedProject.walletPem.length}`);
      }
      
      if (storedProject.walletPem !== wallet.pem) {
        console.error(`[COMMUNITY-FUND] PEM content mismatch after storage!`);
        throw new Error('PEM content mismatch after storage! The PEM may have been corrupted during encryption/storage.');
      }
      
      console.log(`[COMMUNITY-FUND] ✅ PEM verified successfully after storage (length: ${storedProject.walletPem.length} chars)`);
      
      // Update guild settings to set this as community fund
      // Store the user-provided fund name in community_fund_project column
      await dbServerData.updateGuildSettings(guildId, {
        communityFundProject: fundName
      });
      
      // Store the QR code URL if provided
      if (qrCodeUrl) {
        await dbServerData.setCommunityFundQR(guildId, projectName, qrCodeUrl);
        console.log(`QR code URL stored for Community Fund: ${qrCodeUrl}`);
      }
      
      // Initialize wallet timestamp in blockchain listener immediately
      await blockchainListener.initializeWalletTimestamp(wallet.address, fundName);
      console.log(`[COMMUNITY-FUND] Wallet timestamp initialized for blockchain listener`);
      
      // Build success message
      const embed = new EmbedBuilder()
        .setTitle('✅ Community Fund Wallet Created')
        .setDescription('A new MultiversX wallet has been automatically generated and set as the Community Tip Fund.')
        .addFields(
          { name: '🏷️ Fund Name', value: fundName, inline: true },
          { name: '📍 Wallet Address', value: `\`${wallet.address}\``, inline: false },
          { name: '🔐 Security', value: 'Wallet was generated by the bot using MultiversX SDK. PEM is encrypted in the database.', inline: false },
          { name: '📝 Supported Tokens', value: supportedTokens.join(', '), inline: false }
        )
        .setColor(0x00FF00)
        .setTimestamp();
      
      
      if (qrCodeUrl) {
        embed.addFields({ name: '📱 QR Code', value: 'QR code URL has been saved and will be used in game embeds.', inline: false });
      }
      
      await interaction.editReply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
      console.log(`[COMMUNITY-FUND] Created Community Fund wallet for guild ${guildId}: ${wallet.address}`);
    } catch (error) {
      console.error('Error setting Community Tip Fund:', error);
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: `❌ **Error creating Community Fund wallet:**\n\n${error.message}\n\nPlease try again or contact support if the issue persists.`, 
          flags: [MessageFlags.Ephemeral] 
        });
      } else {
        await interaction.reply({ 
          content: `❌ **Error creating Community Fund wallet:**\n\n${error.message}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    }


  } else if (commandName === 'list-wallets') {
    try {
      const filter = interaction.options.getString('filter')?.toLowerCase() || '';
      const page = interaction.options.getInteger('page') || 1;
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const entriesPerPage = 20;
      const startIndex = (page - 1) * entriesPerPage;
      
      console.log(`User ${interaction.user.tag} is listing wallets with filter: '${filter}', page: ${page}, public: ${isPublic}`);
      
      try {
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        const userWallets = await getUserWallets(guildId);
        
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
        
        // Add button to register wallet for easier onboarding
        const registerButton = new ButtonBuilder()
          .setCustomId('register-wallet')
          .setLabel('Register My Wallet')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝');
        
        const buttonRow = new ActionRowBuilder()
          .addComponents(registerButton);
        
        await interaction.editReply({ 
          embeds: [embed],
          components: [buttonRow],
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
        
        // Add button to register wallet for easier onboarding
        const registerButton = new ButtonBuilder()
          .setCustomId('register-wallet')
          .setLabel('Register My Wallet')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝');
        
        const buttonRow = new ActionRowBuilder()
          .addComponents(registerButton);
        
        await interaction.editReply({ 
          embeds: [embed],
          components: [buttonRow],
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
      const projects = await getProjects(guildId);
      const projectNames = Object.keys(projects);
      const communityFund = await getCommunityFundProject(guildId);
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
        // Check if this is the Community Fund by comparing with internal project name
        const isFund = projectName === getCommunityFundProjectName();
        // Display the user-provided fund name if it's the Community Fund, otherwise use the project name
        const displayName = isFund && communityFund ? communityFund : projectName;
        
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
          name: `${isFund ? '💰 ' : ''}📁 ${displayName}${isFund ? ' (Community Fund)' : ''}`,
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
      const fundProject = await getCommunityFundProject(guildId);
      if (!fundProject) {
        await interaction.editReply({ content: 'No Community Tip Fund is set for this server. Please ask an admin to run /set-community-fund.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (!projects[projectName]) {
        await interaction.editReply({ content: `The Community Tip Fund project no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        await interaction.editReply({ content: '❌ Invalid amount. Please provide a positive number.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if user has sufficient virtual balance
      const currentBalance = await virtualAccounts.getUserBalance(guildId, interaction.user.id, tokenTicker);
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
          const userWallets = await getUserWallets(guildId);
          recipientWallet = userWallets[targetUserId];
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
      const fundSupportedTokens = projects[projectName].supportedTokens || [];
      if (!fundSupportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ 
          content: `❌ **Unsupported token!**\n\nToken "${tokenTicker}" is not supported by the Community Fund.\n\nSupported tokens: ${fundSupportedTokens.join(', ') || 'None configured'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Resolve token identifier from ticker/identifier
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      
      // Deduct funds from virtual account
      const deductionResult = await virtualAccounts.deductFundsFromAccount(
        guildId, 
        interaction.user.id, 
        tokenIdentifier, 
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
      const userWallets = await getUserWallets(guildId);
      
      // Create game in database
      await dbRpsGames.createGame(guildId, challengeId, {
        challengerId: interaction.user.id,
        challengerTag: interaction.user.tag,
        challengerWallet: userWallets[interaction.user.id],
        challengedId: targetUserId,
        challengedTag: userTag,
        challengedWallet: recipientWallet,
        amount: amountNum.toString(), // virtual amount
        humanAmount: amountNum.toString(), // human value (string)
        decimals: 0, // Virtual amounts don't need decimals
        token: tokenIdentifier, // Store identifier instead of ticker
        transactionHash: '', // No blockchain transaction needed
        memo: memo,
        status: 'waiting', // waiting, active, completed, expired
        createdAt: Date.now(),
        expiresAt: Date.now() + (30 * 60 * 1000), // 30 minutes
        rounds: [],
        currentRound: 1
      });
        
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
          // Get Community Fund project logo for RPS challenge notification
          const communityFundProjectName = getCommunityFundProjectName();
          const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
          
          const dmEmbed = new EmbedBuilder()
            .setTitle('🎮 You have been challenged!')
            .setDescription(`${interaction.user.tag} has challenged you to Rock, Paper, Scissors!`)
            .addFields([
              { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
              { name: 'Prize Amount', value: `${amountNum} ${tokenTicker}`, inline: true },
              { name: 'Total Prize', value: `${amountNum * 2} ${tokenTicker}`, inline: true },
              { name: 'Expires', value: '<t:' + Math.floor((Date.now() + (30 * 60 * 1000)) / 1000) + ':R>', inline: true },
              { name: 'To Join', value: `Click the "Join Challenge" button in the challenge post`, inline: false },
              { name: 'Memo', value: memo, inline: false }
            ])
            .setColor('#FF6B35')
            .setThumbnail(projectLogoUrl)
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
  } else if (commandName === 'list-rps-challenges') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const challenges = await getRPSChallenges(guildId);
      let changed = false;
      const now = Date.now();
      // Collect expired challenge IDs for cleanup
      const expiredChallengeIds = [];
      for (const [challengeId, challenge] of Object.entries(challenges)) {
        if (challenge.status === 'waiting' && now > challenge.expiresAt) {
          // Mark as expired in database
          await dbRpsGames.updateGame(guildId, challengeId, { status: 'expired' });
          changed = true;
          // Refund challenger to virtual account
          try {
            if (challenge.humanAmount && challenge.token) {
              const memo = `RPS refund: challenge expired (${challengeId})`;
              const refundResult = await virtualAccounts.addFundsToAccount(
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
                  const newBalance = await virtualAccounts.getUserBalance(guildId, challenge.challengerId, challenge.token);
                  
                  // Get Community Fund project logo for RPS refund notification
                  const communityFundProjectName = getCommunityFundProjectName();
                  const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
                  
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
                        .setThumbnail(projectLogoUrl)
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
      // Remove expired challenges from database
      for (const challengeId of expiredChallengeIds) {
        await dbRpsGames.deleteGame(guildId, challengeId);
        changed = true;
      }
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
      
      const communityFundProject = await getCommunityFundProject(guildId);
      if (!communityFundProject) {
        await interaction.editReply({ 
          content: '❌ No community fund project is configured for this server. Please contact an administrator to set up a community fund project.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      const projects = await getProjects(guildId);
      // Use fixed project name for lookup
      const projectName = getCommunityFundProjectName();
      const project = projects[projectName];
      
      if (!project) {
        await interaction.editReply({ 
          content: `❌ Community fund project not found. Please contact an administrator to fix this configuration.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      if (!project.walletAddress) {
        await interaction.editReply({ 
          content: `❌ Community fund project has no wallet address configured. Please contact an administrator to fix this configuration.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get community fund QR code from community_fund_qr table (use project name, not fund name)
      const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
      const qrCodeUrl = communityFundQRData?.[projectName] || null;
      
      // Extract supported tokens from project
      let supportedTokens = [];
      if (project.supportedTokens) {
        if (Array.isArray(project.supportedTokens)) {
          supportedTokens = project.supportedTokens;
        } else if (typeof project.supportedTokens === 'string') {
          supportedTokens = project.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
        }
      }
      
      // Build supported tokens display
      const supportedTokensDisplay = supportedTokens.length > 0 
        ? supportedTokens.join(', ') 
        : 'None configured';
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Community Fund Deposit Address')
        .setDescription(`Send tokens to the community fund to participate in games and activities!`)
        .addFields([
          { name: '⚠️ Important: Register First!', value: '**You must register your wallet BEFORE sending tokens!**\n\nIf you send tokens without registering your wallet first, the bot cannot track your deposits and you may lose your funds.\n\n**Click the "Register My Wallet" button below to register your wallet address.**', inline: false },
          { name: 'Fund Name', value: `**${communityFundProject || 'Community Fund'}**`, inline: true },
          { name: 'Wallet Address', value: `\`${project.walletAddress}\``, inline: false },
          { name: 'Supported ESDT Tokens', value: supportedTokensDisplay, inline: false },
          { name: '📦 NFT Support', value: '**NFTs can also be added to your Virtual Account!**\n\nSimply send NFTs to the community fund wallet address above, and they will be automatically added to your virtual account balance. Use `/check-balance-nft` to view your NFT collection.', inline: false },
          { name: 'How to Deposit', value: '1. **First:** Click "Register My Wallet" button below\n2. Enter your wallet address in the form\n3. Copy the wallet address above\n4. Send your **ESDT tokens or NFTs** to this address\n5. Your virtual account will be automatically updated\n6. Use `/check-balance-esdt` to verify ESDT deposits\n7. Use `/check-balance-nft` to verify NFT deposits', inline: false }
        ])
        .setColor('#FF9900')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Add QR code as thumbnail if available (from community_fund_qr table)
      if (qrCodeUrl) {
        embed.setThumbnail(qrCodeUrl);
      }
      
      // Add button to register wallet for easier onboarding
      const registerButton = new ButtonBuilder()
        .setCustomId('register-wallet')
        .setLabel('Register My Wallet')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝');
      
      const buttonRow = new ActionRowBuilder()
        .addComponents(registerButton);
      
      await interaction.editReply({ embeds: [embed], components: [buttonRow] });
      
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

      const projects = await getProjects(guildId);
      
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

      // Check if this project is set as community fund
      const communityFundProject = await getCommunityFundProject(guildId);
      let isCommunityFund = false;
      if (communityFundProject === projectName) {
        isCommunityFund = true;
        
        // Check for virtual account balances before deleting community fund
        const accountsWithBalances = await virtualAccounts.getAllVirtualAccountsWithBalances(guildId);
        
        if (accountsWithBalances.length > 0) {
          // Calculate total balances
          let totalRefunds = 0;
          const balanceSummary = {};
          for (const account of accountsWithBalances) {
            for (const [token, balance] of Object.entries(account.balances)) {
              totalRefunds++;
              if (!balanceSummary[token]) {
                balanceSummary[token] = new BigNumber(0);
              }
              balanceSummary[token] = balanceSummary[token].plus(new BigNumber(balance));
            }
          }

          // Check Community Fund balances (totalRefunds transfers needed)
          const balanceCheck = await checkCommunityFundBalances(guildId, totalRefunds);
          if (!balanceCheck.sufficient) {
            const errorEmbed = await createBalanceErrorEmbed(guildId, balanceCheck, '/delete-project');
            await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
            return;
          }

          const balanceSummaryText = Object.entries(balanceSummary)
            .map(([token, amount]) => `${amount.toString()} ${token}`)
            .join(', ');

          await interaction.editReply({ 
            content: `🔄 **Initiating Mass Refund...**\n\nThis project is set as the Community Fund and there are **${accountsWithBalances.length}** accounts with balances.\nTotal refunds to process: **${totalRefunds}**\nTotal amounts: ${balanceSummaryText}\n\nProcessing refunds one by one. This may take several minutes...`, 
            flags: [MessageFlags.Ephemeral] 
          });

          // Process mass refund
          let lastProgressUpdate = Date.now();
          const refundResult = await processMassRefund(guildId, projectName, async (progress) => {
            if (Date.now() - lastProgressUpdate > 5000) {
              lastProgressUpdate = Date.now();
              try {
                await interaction.editReply({ 
                  content: `🔄 **Mass Refund in Progress...**\n\n${progress.message}\n\nProcessed: ${progress.current || 0}/${progress.total || 0}\n\nPlease wait...`, 
                  flags: [MessageFlags.Ephemeral] 
                });
              } catch (updateError) {
                // Ignore update errors during processing
              }
            }
          });

          // Verify all balances are zero
          const remainingAccounts = await virtualAccounts.getAllVirtualAccountsWithBalances(guildId);
          
          if (remainingAccounts.length > 0) {
            await interaction.editReply({ 
              content: `❌ **Mass Refund Incomplete!**\n\n**${refundResult.successfulRefunds}** refunds succeeded, **${refundResult.failedRefunds}** failed.\n\nThere are still **${remainingAccounts.length}** accounts with balances.\n\n**Project deletion cancelled for safety.**\n\nPlease resolve failed refunds and try again.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          await interaction.editReply({ 
            content: `✅ **Mass Refund Complete!**\n\nSuccessfully refunded **${refundResult.successfulRefunds}** transactions.\nAll virtual account balances are now zero.\n\nProceeding with project deletion...`, 
            flags: [MessageFlags.Ephemeral] 
          });
        }
        
        // Clear community fund reference before deleting project
        await dbServerData.updateGuildSettings(guildId, {
          communityFundProject: null
        });
        console.log(`[DELETE-PROJECT] Cleared community fund reference for deleted project ${projectName}`);
      }

      // Delete the project from database
      await dbServerData.deleteProject(guildId, projectName);
      
      // Clean up wallet timestamp if this was a Community Fund project
      if (isCommunityFund && walletAddress) {
        await blockchainListener.removeWalletTimestamp(walletAddress, projectName);
        console.log(`[DELETE-PROJECT] Removed timestamp for deleted Community Fund wallet: ${walletAddress}`);
      }

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
      
      // Add warning if community fund was cleared
      if (isCommunityFund) {
        embed.addFields({
          name: '⚠️ Community Fund Cleared',
          value: 'This project was set as the Community Fund. The Community Fund reference has been cleared. Blockchain listener will stop monitoring this wallet.',
          inline: false
        });
      }

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
  } else if (commandName === 'delete-all-server-data') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const confirm = interaction.options.getString('confirm');

      if (confirm !== 'DELETE ALL DATA') {
        await interaction.editReply({ 
          content: `❌ **Deletion Cancelled**\n\nTo delete ALL server data, you must type "DELETE ALL DATA" in the confirm field.\n\n⚠️ **WARNING:** This will permanently delete:\n- All projects\n- All user wallets\n- All virtual accounts and balances\n- All transaction history\n- All RPS games\n- All football matches and bets\n- All leaderboard data\n- All auction data\n- All house balances\n- All server settings\n\nThis action is **IRREVERSIBLE**!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const guildId = interaction.guildId;

      // Check for virtual account balances
      const accountsWithBalances = await virtualAccounts.getAllVirtualAccountsWithBalances(guildId);
      
      if (accountsWithBalances.length > 0) {
        // Get community fund project for mass refund
        const communityFundProject = await getCommunityFundProject(guildId);
        
        if (!communityFundProject) {
          await interaction.editReply({ 
            content: `❌ **Cannot proceed with deletion!**\n\nThere are **${accountsWithBalances.length}** virtual accounts with balances, but no Community Fund is configured.\n\nPlease set a Community Fund project using \`/set-community-fund\` to enable mass refund before deletion.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }

        const projects = await getProjects(guildId);
        const projectName = getCommunityFundProjectName();
        if (!projects[projectName]) {
          await interaction.editReply({ 
            content: `❌ **Cannot proceed with deletion!**\n\nThe Community Fund project no longer exists.\n\nPlease set a valid Community Fund project using \`/set-community-fund\` to enable mass refund before deletion.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }

        // Calculate total balances
        let totalRefunds = 0;
        const balanceSummary = {};
        for (const account of accountsWithBalances) {
          for (const [token, balance] of Object.entries(account.balances)) {
            totalRefunds++;
            if (!balanceSummary[token]) {
              balanceSummary[token] = new BigNumber(0);
            }
            balanceSummary[token] = balanceSummary[token].plus(new BigNumber(balance));
          }
        }

        // Check Community Fund balances (totalRefunds transfers needed)
        const balanceCheck = await checkCommunityFundBalances(guildId, totalRefunds);
        if (!balanceCheck.sufficient) {
          const errorEmbed = await createBalanceErrorEmbed(guildId, balanceCheck, '/delete-all-server-data');
          await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
          return;
        }

        // Show mass refund initiation
        const balanceSummaryText = Object.entries(balanceSummary)
          .map(([token, amount]) => `${amount.toString()} ${token}`)
          .join(', ');

        await interaction.editReply({ 
          content: `🔄 **Initiating Mass Refund...**\n\nFound **${accountsWithBalances.length}** accounts with balances.\nTotal refunds to process: **${totalRefunds}**\nTotal amounts: ${balanceSummaryText}\n\nProcessing refunds one by one. This may take several minutes...`, 
          flags: [MessageFlags.Ephemeral] 
        });

        // Process mass refund with progress updates (use project name for lookup)
        let lastProgressUpdate = Date.now();
        const refundResult = await processMassRefund(guildId, projectName, async (progress) => {
          // Update progress every 5 seconds
          if (Date.now() - lastProgressUpdate > 5000) {
            lastProgressUpdate = Date.now();
            try {
              await interaction.editReply({ 
                content: `🔄 **Mass Refund in Progress...**\n\n${progress.message}\n\nProcessed: ${progress.current || 0}/${progress.total || 0}\n\nPlease wait...`, 
                flags: [MessageFlags.Ephemeral] 
              });
            } catch (updateError) {
              // Ignore update errors during processing
            }
          }
        });

        // Verify all balances are zero
        const remainingAccounts = await virtualAccounts.getAllVirtualAccountsWithBalances(guildId);
        
        if (remainingAccounts.length > 0) {
          await interaction.editReply({ 
            content: `❌ **Mass Refund Incomplete!**\n\n**${refundResult.successfulRefunds}** refunds succeeded, **${refundResult.failedRefunds}** failed.\n\nThere are still **${remainingAccounts.length}** accounts with balances.\n\n**Deletion cancelled for safety.**\n\nPlease resolve failed refunds and try again.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }

        // All balances cleared, proceed with deletion
        await interaction.editReply({ 
          content: `✅ **Mass Refund Complete!**\n\nSuccessfully refunded **${refundResult.successfulRefunds}** transactions.\nAll virtual account balances are now zero.\n\nProceeding with server data deletion...`, 
          flags: [MessageFlags.Ephemeral] 
        });
      } else {
        // No balances, proceed directly to deletion
        await interaction.editReply({ 
          content: `✅ **No virtual account balances found.**\n\nProceeding with server data deletion...`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }

      // Get Community Fund wallet address before deletion (for timestamp cleanup)
      const communityFundProject = await getCommunityFundProject(guildId);
      let communityFundWalletAddress = null;
      if (communityFundProject) {
        const project = await dbServerData.getProject(guildId, 'Community Fund');
        if (project && project.walletAddress) {
          communityFundWalletAddress = project.walletAddress;
        }
      }
      
      // Delete all server data
      const deleteResult = await dbServerData.deleteAllServerData(guildId);
      
      // Clean up wallet timestamp for Community Fund wallet (if it existed)
      if (communityFundWalletAddress) {
        await blockchainListener.removeWalletTimestamp(communityFundWalletAddress, 'Community Fund');
        console.log(`[DELETE-ALL] Removed timestamp for Community Fund wallet: ${communityFundWalletAddress}`);
      }
      
      // Also run cleanup as a safety net to catch any other orphaned timestamps
      await blockchainListener.cleanupOrphanedTimestamps();
      console.log(`[DELETE-ALL] Cleaned up orphaned timestamps for guild ${guildId}`);

      if (deleteResult.success) {
        const embed = new EmbedBuilder()
          .setTitle('🗑️ All Server Data Deleted')
          .setDescription(`**Hard Reset Complete**\n\nAll server data has been permanently deleted.`)
          .addFields([
            { name: 'Deleted By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '✅ Complete', inline: true },
            { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
          ])
          .setColor('#FF0000')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

        await interaction.editReply({ 
          content: `✅ **Server data deletion complete!**`, 
          embeds: [embed],
          flags: [MessageFlags.Ephemeral] 
        });

        console.log(`All server data deleted for guild ${guildId} by ${interaction.user.tag}`);
      } else {
        const failedTables = Object.entries(deleteResult.results)
          .filter(([_, result]) => !result.success)
          .map(([table, result]) => `${table}: ${result.error || 'Unknown error'}`)
          .join('\n');

        await interaction.editReply({ 
          content: `⚠️ **Deletion Partially Complete**\n\nSome tables failed to delete:\n\`\`\`${failedTables}\`\`\`\n\nPlease check logs and retry if needed.`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('Error deleting all server data:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
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
      const serverConfig = await dbServerData.getGuildSettings(guildId) || {};
      const projects = await getProjects(guildId);
      const fundProject = serverConfig.communityFundProject; // This is the fund name for display
      const projectName = getCommunityFundProjectName(); // This is the actual project name for lookup
      const fundProjectData = projects[projectName] || null;
      
      // Build debug embed
      const debugEmbed = new EmbedBuilder()
        .setTitle('🔍 Server Configuration Debug')
        .setDescription(`Debug information for server: ${interaction.guild.name}`)
        .addFields([
          { name: 'Server ID', value: guildId, inline: true },
          { name: 'Community Fund Project', value: fundProject || '❌ Not set', inline: true },
          { name: 'Total Projects', value: Object.keys(projects).length.toString(), inline: true },
          { name: 'Total Users', value: Object.keys(await getUserWallets(guildId) || {}).length.toString(), inline: true }
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
      
      const userTag = interaction.options.getString('user-tag');
      const guildId = interaction.guildId;
      
      // Find user by tag
      let targetUserId = null;
      let memberInfo = null;
      let userWallet = null;
      
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
          memberInfo = {
            tag: targetMember.user.tag,
            username: targetMember.user.username,
            nickname: targetMember.nickname,
            joinedAt: targetMember.joinedAt,
            isInGuild: true
          };
          
          // Get user wallets for this server
          const userWallets = await getUserWallets(guildId);
          userWallet = userWallets[targetUserId];
        }
      } catch (fetchError) {
        console.error('Error fetching guild members:', fetchError.message);
      }
      
      if (!targetUserId) {
        await interaction.editReply({ 
          content: `User "${userTag}" not found in this server.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get user wallets for this server
      const userWallets = await getUserWallets(guildId);
      const userWalletEntries = Object.entries(userWallets);
      const userIndex = userWalletEntries.findIndex(([id, wallet]) => id === targetUserId);
      const isInAutocompleteRange = userIndex !== -1 && userIndex < 100;
      
      // Get ESDT balances
      let esdtBalances = {};
      let esdtBalancesDisplay = 'None';
      try {
        esdtBalances = await virtualAccounts.getAllUserBalances(guildId, targetUserId);
        
        if (Object.keys(esdtBalances).length > 0) {
          // Get token metadata to map identifiers to tickers
          const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
          const identifierToTicker = {};
          for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
            if (metadata.ticker) {
              identifierToTicker[identifier] = metadata.ticker;
            }
          }
          
          // Format balances
          const BigNumber = require('bignumber.js');
          const balanceEntries = Object.entries(esdtBalances)
            .map(([tokenIdentifier, balance]) => {
              const ticker = identifierToTicker[tokenIdentifier] || tokenIdentifier.split('-')[0];
              const balanceBN = new BigNumber(balance);
              const formattedBalance = balanceBN.isZero() ? '0' : balanceBN.toFixed();
              return `${ticker}: ${formattedBalance}`;
            })
            .filter(b => !b.endsWith(': 0'));
          
          esdtBalancesDisplay = balanceEntries.length > 0 
            ? balanceEntries.join('\n') 
            : 'None';
        }
      } catch (error) {
        console.error('Error fetching ESDT balances:', error);
        esdtBalancesDisplay = 'Error fetching balances';
      }
      
      // Get NFT balances grouped by collection
      let nftBalancesDisplay = 'None';
      try {
        const nftBalances = await virtualAccountsNFT.getUserNFTBalances(guildId, targetUserId);
        
        if (nftBalances && nftBalances.length > 0) {
          // Group by collection
          const collectionsMap = {};
          for (const nft of nftBalances) {
            const collection = nft.collection;
            if (!collectionsMap[collection]) {
              collectionsMap[collection] = 0;
            }
            collectionsMap[collection]++;
          }
          
          // Format as "Collection: Count"
          const collectionEntries = Object.entries(collectionsMap)
            .map(([collection, count]) => `${collection}: ${count}`)
            .sort();
          
          nftBalancesDisplay = collectionEntries.length > 0 
            ? collectionEntries.join('\n') 
            : 'None';
        }
      } catch (error) {
        console.error('Error fetching NFT balances:', error);
        nftBalancesDisplay = 'Error fetching balances';
      }
      
      // Build debug embed
      const debugEmbed = new EmbedBuilder()
        .setTitle('🔍 User Debug Information')
        .setDescription(`Debug information for user: **${memberInfo?.tag || userTag}**`)
        .addFields([
          { name: 'User ID', value: `\`${targetUserId}\``, inline: false },
          { name: 'Wallet Registered', value: userWallet ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Wallet Address', value: userWallet ? `\`${userWallet}\`` : 'Not registered', inline: false },
          { name: 'In Guild', value: memberInfo ? '✅ Yes' : '❌ No', inline: true },
          { name: 'User Tag', value: memberInfo?.tag || 'Unknown', inline: true },
          { name: 'Nickname', value: memberInfo?.nickname || 'None', inline: true },
          { name: 'Joined Server', value: memberInfo?.joinedAt ? `<t:${Math.floor(memberInfo.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true },
          { name: 'Total Registered Users', value: `${userWalletEntries.length}`, inline: true },
          { name: 'User Index in List', value: userIndex !== -1 ? `${userIndex + 1}` : 'Not found', inline: true },
          { name: 'In Autocomplete Range', value: isInAutocompleteRange ? '✅ Yes (first 100)' : '❌ No (beyond first 100)', inline: true },
          { name: '💰 ESDT Balances', value: esdtBalancesDisplay.length > 1024 ? esdtBalancesDisplay.substring(0, 1021) + '...' : esdtBalancesDisplay, inline: false },
          { name: '🖼️ NFT Balances', value: nftBalancesDisplay.length > 1024 ? nftBalancesDisplay.substring(0, 1021) + '...' : nftBalancesDisplay, inline: false }
        ])
        .setColor(isInAutocompleteRange ? '#00FF00' : '#FF0000')
        .setTimestamp()
        .setFooter({ text: 'Debug Command', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      await interaction.editReply({ embeds: [debugEmbed] });
      
      // Log debug info
      console.log(`[DEBUG] User ${targetUserId} (${userTag}) debug info:`, {
        walletRegistered: !!userWallet,
        walletAddress: userWallet,
        inGuild: !!memberInfo,
        userTag: memberInfo?.tag,
        totalUsers: userWalletEntries.length,
        userIndex: userIndex,
        inAutocompleteRange: isInAutocompleteRange,
        esdtBalancesCount: Object.keys(esdtBalances).length
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
      const fundProject = await getCommunityFundProject(guildId);
      if (!fundProject) {
        const availableProjects = Object.keys(await getProjects(guildId));
        await interaction.editReply({ 
          content: `❌ **No Community Tip Fund configured!**\n\nThis server needs a Community Tip Fund to create football fixtures.\n\n**To fix this:**\n1. Ask an admin to run \`/set-community-fund\`\n2. Select a project that supports the tokens you want to use for betting\n\n**Current projects:** ${availableProjects.length > 0 ? availableProjects.join(', ') : 'None'}\n\n**Example:** \`/set-community-fund project-name:YourProjectName\``, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (!projects[projectName]) {
        await interaction.editReply({ content: `The Community Tip Fund project no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Validate token is supported by community fund
      const fundSupportedTokens = projects[projectName].supportedTokens || [];
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
        await dbServerData.updateGuildSettings(guildId, {
          lastCompetition: competition
        });

        // Initialize football data for this guild

        let createdMatches = 0;
        let skippedMatches = 0;
        let newMatches = 0;
        const matchEmbeds = [];

        for (const fixture of fixtures.matches) {
          const matchId = fixture.id.toString();
          const kickoffTime = new Date(fixture.utcDate);
          
          // Check if match already exists in database
          const existingMatch = await dbFootball.getMatch(matchId);
          
          // Check if this match already has an embed for this guild
          let hasEmbedForGuild = false;
          if (existingMatch) {
            const guildMatches = await dbFootball.getMatchesByGuild(guildId);
            const matchInGuild = guildMatches[matchId];
            hasEmbedForGuild = matchInGuild && matchInGuild.embeds && matchInGuild.embeds[guildId] && matchInGuild.embeds[guildId].messageId;
          }
          
          if (hasEmbedForGuild) {
            // Match already exists and has embed for this guild - skip to avoid duplication
            console.log(`[FOOTBALL] Match ${matchId} already exists with embed for guild ${guildId}, skipping`);
            skippedMatches++;
            continue;
          }
          
          // Prepare match data
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
            requiredAmountWei: requiredAmountWei,
            status: 'SCHEDULED',
            ftScore: { home: 0, away: 0 },
            guildIds: existingMatch ? (existingMatch.guildIds || []).concat(existingMatch.guildIds && existingMatch.guildIds.includes(guildId) ? [] : [guildId]) : [guildId],
            embeds: existingMatch && existingMatch.embeds ? existingMatch.embeds : {}
          };
          
          if (existingMatch) {
            // Match exists but no embed for this guild - add this guild to the existing match
            console.log(`[FOOTBALL] Match ${matchId} already exists, adding guild ${guildId} to existing match`);
            
            // Ensure the new guild is in embeds (even if empty) so updateMatch processes it
            if (!matchData.embeds[guildId]) {
              matchData.embeds[guildId] = {};
            }
            
            // Update match in database (only shared data, guild config is handled separately)
            await dbFootball.updateMatch(matchId, {
              guildIds: matchData.guildIds,
              embeds: matchData.embeds,
              // Include token and stake for the new guild being added
              token: matchData.token,
              requiredAmountWei: matchData.requiredAmountWei
            });
            console.log(`[FOOTBALL] Updated existing match ${matchId} for guild ${guildId}`);
          } else {
            // New match - create fresh match data
            await dbFootball.createMatch(matchData);
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
          const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
          const communityFundQR = communityFundQRData?.[fundProject];
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
            const currentMatch = await dbFootball.getMatch(matchId);
            if (currentMatch) {
              const updatedEmbeds = currentMatch.embeds || {};
              updatedEmbeds[guildId] = {
                messageId: matchMessage.id,
                threadId: thread.id
              };
              // Only update embeds - don't pass token/stake (guild already exists, will preserve existing config)
              await dbFootball.updateMatch(matchId, {
                embeds: updatedEmbeds,
                guildIds: currentMatch.guildIds || [guildId]
                // Don't pass token/requiredAmountWei - guild already exists, will preserve existing config
              });
            }
            
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
        // Removed - using database

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
  } else if (commandName === 'get-competition') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      const lastCompetition = await getLastCompetition(guildId);
      
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
        .setThumbnail('https://i.ibb.co/60PgqNc5/checklist-logo.png')
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();

      // Define command categories
      const categories = {
        '👛 Virtual Accounts (ESDT)': [
          '`/check-balance-esdt` - View your virtual account balance',
          '`/balance-history` - View your transaction history',
          '`/tip-virtual-esdt` - Tip another user with virtual balance',
          '`/virtual-house-topup` - Transfer from Virtual Account to House Balance',
          '`/withdraw-esdt` - Withdraw funds to your wallet'
        ],
        '🖼️ Virtual Accounts (NFT)': [
          '`/check-balance-nft` - View your NFT virtual account balance',
          '`/balance-history-nft` - View your NFT transaction history',
          '`/show-my-nft` - View detailed information about an NFT (image, attributes, metadata)',
          '`/tip-virtual-nft` - Tip another user an NFT from your virtual account',
          '`/sell-nft` - List an NFT for sale on the marketplace',
          '`/withdraw-nft` - Withdraw an NFT to your registered wallet'
        ],
        '⚽ Football Betting': [
          '`/create-fixtures` 🔴 Admin - Create football matches for betting',
          '`/leaderboard` - View betting leaderboard',
          '`/leaderboard-filtered` - View leaderboard for date range',
          '`/my-football-stats` - View your betting statistics & PNL'
        ],
        '🎮 Rock Paper Scissors': [
          '`/challenge-rps` - Challenge someone to RPS',
          '`/list-rps-challenges` - List active challenges'
        ],
        '🎰 Lottery & Auctions': [
          '`/create-lottery` 🔴 Admin - Create a new lottery game',
          '`/create-auction` 🔴 Admin - Create an NFT auction'
        ],
        '💼 Wallet & Project Management': [
          '`/set-wallet` - Register your MultiversX wallet',
          '`/register-project` 🔴 Admin - Register a new project',
          '`/update-project` 🔴 Admin - Update project settings',
          '`/list-projects` 🔴 Admin - View all projects',
          '`/delete-project` 🔴 Admin - Delete a project',
          '`/set-community-fund` 🔴 Admin - Set community fund project'
        ],
        '💰 Token & NFT Transfers': [
          '`/send-esdt` 🔴 Admin - Send tokens to a user',
          '`/send-nft` 🔴 Admin - Send NFT to a user',
          '`/house-tip` 🔴 Admin - Tip from house balance',
          '`/list-wallets` - List registered wallets (verify your registration)',
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

      // Add documentation link
      embed.addFields({
        name: '📖 Documentation',
        value: 'For detailed guides and more information, visit our [GitBook Documentation](https://hodltokenclub.gitbook.io/esdt-tipping-bot/)',
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

      // Get leaderboard from database
      const guildLeaderboard = await dbLeaderboard.getLeaderboard(guildId) || {};
      
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
            const storedDecimals = await getStoredTokenDecimals(interaction.guildId, tokenTicker);
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
          const storedDecimals = await getStoredTokenDecimals(interaction.guildId, 'REWARD-cf6eac');
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
  } else if (commandName === 'my-football-stats') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });

      // Get user stats from database
      const userData = await dbLeaderboard.getUserStats(guildId, interaction.user.id);

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
      const userBets = await dbFootball.getBetsByUser(guildId, interaction.user.id);
      const userBetsArray = Object.values(userBets || {});
      const userMatchIds = [...new Set(userBetsArray.map(bet => bet.matchId))];
      
      // Count finished matches - check multiple indicators:
      // 1. Matches with status FINISHED
      let finishedMatchesByStatus = 0;
      let matchesNotFound = 0;
      for (const matchId of userMatchIds) {
        const match = await dbFootball.getMatch(matchId);
        if (!match) {
          matchesNotFound++;
          console.log(`[MY-STATS] Match ${matchId} not found in database`);
          continue;
        }
        if (match.status === 'FINISHED') {
          finishedMatchesByStatus++;
        }
      }
      
      if (matchesNotFound > 0) {
        console.log(`[MY-STATS] Warning: ${matchesNotFound} match(es) not found in database out of ${userMatchIds.length} total matches`);
      }
      
      // 2. Count unique match IDs where at least one bet from that match has a prize
      // (This indicates the match finished and prizes were distributed, even if match was cleaned up)
      const matchesWithPrizes = new Set();
      userBetsArray.forEach(bet => {
        // Note: prize tracking would need to be added to database schema if needed
        // For now, we'll rely on match status
      });
      
      // 3. For matches with prizes, also check if other users' bets from same match have prizes
      // This helps identify finished matches even if this user lost
      const allBetsForMatches = [];
      for (const matchId of userMatchIds) {
        const matchBets = await dbFootball.getBetsByMatch(guildId, matchId);
        allBetsForMatches.push(...Object.values(matchBets || {}));
      }
      userMatchIds.forEach(matchId => {
        const matchBets = allBetsForMatches.filter(bet => bet.matchId === matchId);
        // If any bet from this match has a prize, the match finished
        if (matchBets.some(bet => bet.prizeSent === true || bet.prizeAmount !== undefined)) {
          matchesWithPrizes.add(matchId);
        }
      });
      
      const finishedMatchesByPrizes = matchesWithPrizes.size;
      
      // Prioritize status-based count (most reliable)
      // Only use prize-based count as fallback for matches that don't exist in database anymore
      // This prevents counting unfinished matches that might have prizes set incorrectly
      let finishedMatches = finishedMatchesByStatus;
      
      // If status count is less than prize count, it might mean some matches were cleaned up
      // But we should verify: only count prizes for matches that don't exist in database
      if (finishedMatchesByPrizes > finishedMatchesByStatus) {
        // Check if the extra matches from prize count are actually missing from database
        const matchesWithPrizesButNoStatus = [];
        for (const matchId of matchesWithPrizes) {
          const match = await dbFootball.getMatch(matchId);
          if (!match) {
            // Match doesn't exist in database, but has prizes - likely cleaned up finished match
            matchesWithPrizesButNoStatus.push(matchId);
          }
        }
        
        // Only add matches that don't exist in database (cleaned up finished matches)
        if (matchesWithPrizesButNoStatus.length > 0) {
          console.log(`[MY-STATS] Found ${matchesWithPrizesButNoStatus.length} finished match(es) with prizes but missing from database (likely cleaned up)`);
          finishedMatches = finishedMatchesByStatus + matchesWithPrizesButNoStatus.length;
        } else {
          // All matches exist in database, so status count is authoritative
          console.log(`[MY-STATS] Prize count (${finishedMatchesByPrizes}) > status count (${finishedMatchesByStatus}), but all matches exist in DB - using status count`);
          finishedMatches = finishedMatchesByStatus;
        }
      }
      
      // Ensure finished matches is at least the number of wins (sanity check)
      // This handles edge cases where match status might not be updated but prizes were distributed
      if (finishedMatches < (userData.wins || 0)) {
        console.log(`[MY-STATS] Warning: finishedMatches (${finishedMatches}) < wins (${userData.wins}), using wins as minimum`);
        finishedMatches = userData.wins || 0;
      }
      
      // Calculate win rate: wins / finished matches * 100
      const winRate = finishedMatches > 0 
        ? ((userData.wins || 0) / finishedMatches * 100).toFixed(1)
        : '0.0';
      
      // Debug logging
      console.log(`[MY-STATS] User ${interaction.user.id} stats:`, {
        totalMatches: userMatchIds.length,
        finishedMatchesByStatus,
        finishedMatchesByPrizes,
        finishedMatches,
        wins: userData.wins || 0,
        winRate
      });
      
      // Points and Wins
      // Clarify the display: show "X wins out of Y finished matches" instead of ambiguous "X/Y finished"
      const finishedMatchesText = finishedMatches > 0 
        ? ` (${userData.wins || 0} wins out of ${finishedMatches} finished matches)`
        : ' (no finished matches yet)';
      
      embed.addFields({
        name: '📈 Performance',
        value: `**Points:** ${userData.points || 0}\n**Wins:** ${userData.wins || 0}\n**Win Rate:** ${winRate}%${finishedMatchesText}`,
        inline: true
      });

      // Calculate total bets and PNL
      const totalBetsWei = new BigNumber(userData.totalBetsWei || '0');
      const totalEarningsWei = new BigNumber(userData.totalEarningsWei || '0');
      const pnlWei = totalEarningsWei.minus(totalBetsWei);

      // Get all tokens with metadata
      // Note: tokenEarnings and tokenBets are stored by tokenIdentifier (e.g., "REWARD-cf6eac")
      const allTokenIdentifiers = new Set();
      if (userData.tokenEarnings) {
        Object.keys(userData.tokenEarnings).forEach(token => allTokenIdentifiers.add(token));
      }
      if (userData.tokenBets) {
        Object.keys(userData.tokenBets).forEach(token => allTokenIdentifiers.add(token));
      }

      // Get token metadata to map identifiers to tickers
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      
      // Fetch token prices for USD calculations
      const tokenPrices = {};
      const uniqueTokenIds = Array.from(allTokenIdentifiers).filter(id => {
        // Only fetch prices for valid identifiers (format: TICKER-6hexchars)
        const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
        return esdtIdentifierRegex.test(id);
      });
      
      // Fetch prices in parallel
      const pricePromises = uniqueTokenIds.map(async (tokenIdentifier) => {
        try {
          const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            return { tokenIdentifier, price: priceData.price || 0 };
          }
        } catch (error) {
          console.error(`[MY-STATS] Error fetching price for ${tokenIdentifier}:`, error.message);
        }
        return { tokenIdentifier, price: 0 };
      });
      
      const priceResults = await Promise.all(pricePromises);
      priceResults.forEach(({ tokenIdentifier, price }) => {
        tokenPrices[tokenIdentifier] = price;
      });

      // Calculate total USD spent and won
      let totalBetsUsd = new BigNumber(0);
      let totalEarningsUsd = new BigNumber(0);

      // Display token-specific stats
      const tokenStats = [];
      for (const tokenIdentifier of allTokenIdentifiers) {
        // Check if it's a full identifier or just ticker (backward compatibility)
        const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
        const isFullIdentifier = esdtIdentifierRegex.test(tokenIdentifier);
        
        // Get token metadata - try identifier first, then ticker
        let tokenMeta = tokenMetadata[tokenIdentifier];
        let tokenTicker = tokenMeta?.ticker || (isFullIdentifier ? tokenIdentifier.split('-')[0] : tokenIdentifier);
        let decimals = tokenMeta?.decimals || 8;
        
        // If identifier not found, try to find by ticker
        if (!tokenMeta && isFullIdentifier) {
          const tickerOnly = tokenIdentifier.split('-')[0];
          for (const [id, meta] of Object.entries(tokenMetadata)) {
            if (meta.ticker === tickerOnly) {
              tokenMeta = meta;
              decimals = meta.decimals;
              break;
            }
          }
        }
        
        // Get decimals - try stored decimals function as fallback
        if (decimals === 8 && !tokenMeta) {
          const storedDecimals = await getStoredTokenDecimals(guildId, tokenIdentifier);
          if (storedDecimals !== null) {
            decimals = storedDecimals;
          }
        }

        const tokenBets = new BigNumber(userData.tokenBets?.[tokenIdentifier] || '0');
        const tokenEarnings = new BigNumber(userData.tokenEarnings?.[tokenIdentifier] || '0');
        const tokenPNL = tokenEarnings.minus(tokenBets);

        const betsHuman = new BigNumber(tokenBets).dividedBy(new BigNumber(10).pow(decimals)).toFixed(2);
        const earningsHuman = new BigNumber(tokenEarnings).dividedBy(new BigNumber(10).pow(decimals)).toFixed(2);
        const pnlHuman = new BigNumber(tokenPNL).dividedBy(new BigNumber(10).pow(decimals)).toFixed(2);
        const pnlSign = tokenPNL.isGreaterThan(0) ? '+' : '';
        const pnlEmoji = tokenPNL.isGreaterThanOrEqualTo(0) ? '🟢' : '🔴';
        
        // Calculate USD values
        const tokenPrice = tokenPrices[tokenIdentifier] || 0;
        const betsUsd = new BigNumber(betsHuman).multipliedBy(tokenPrice).toFixed(2);
        const earningsUsd = new BigNumber(earningsHuman).multipliedBy(tokenPrice).toFixed(2);
        const pnlUsd = new BigNumber(pnlHuman).multipliedBy(tokenPrice).toFixed(2);
        
        // Add to totals
        totalBetsUsd = totalBetsUsd.plus(new BigNumber(betsUsd));
        totalEarningsUsd = totalEarningsUsd.plus(new BigNumber(earningsUsd));
        
        // Format USD display (only show if price > 0)
        const betsUsdDisplay = parseFloat(tokenPrice) > 0 ? ` (≈ $${betsUsd})` : '';
        const earningsUsdDisplay = parseFloat(tokenPrice) > 0 ? ` (≈ $${earningsUsd})` : '';
        const pnlUsdDisplay = parseFloat(tokenPrice) > 0 ? ` (≈ $${pnlSign}${pnlUsd})` : '';

        tokenStats.push({
          token: tokenTicker,
          bets: betsHuman,
          earnings: earningsHuman,
          pnl: pnlHuman,
          pnlSign: pnlSign,
          pnlEmoji: pnlEmoji,
          betsUsdDisplay: betsUsdDisplay,
          earningsUsdDisplay: earningsUsdDisplay,
          pnlUsdDisplay: pnlUsdDisplay
        });
      }

      if (tokenStats.length > 0) {
        let tokenStatsText = '';
        for (const stat of tokenStats) {
          tokenStatsText += `**${stat.token}:**\n`;
          tokenStatsText += `  Bet: ${stat.bets}${stat.betsUsdDisplay}\n`;
          tokenStatsText += `  Won: ${stat.earnings}${stat.earningsUsdDisplay}\n`;
          tokenStatsText += `  PNL: ${stat.pnlEmoji} ${stat.pnlSign}${stat.pnl}${stat.pnlUsdDisplay}\n\n`;
        }

        embed.addFields({
          name: '💰 Profit & Loss (PNL)',
          value: tokenStatsText || 'No data',
          inline: false
        });
        
        // Add total USD summary if we have any prices
        if (totalBetsUsd.isGreaterThan(0) || totalEarningsUsd.isGreaterThan(0)) {
          const totalPnlUsd = totalEarningsUsd.minus(totalBetsUsd);
          const pnlSign = totalPnlUsd.isGreaterThanOrEqualTo(0) ? '+' : '';
          const pnlEmoji = totalPnlUsd.isGreaterThanOrEqualTo(0) ? '🟢' : '🔴';
          embed.addFields({
            name: '💵 Total USD Summary',
            value: `**Total Bet:** $${totalBetsUsd.toFixed(2)}\n**Total Won:** $${totalEarningsUsd.toFixed(2)}\n**Total PNL:** ${pnlEmoji} ${pnlSign}$${Math.abs(totalPnlUsd.toNumber()).toFixed(2)}`,
            inline: false
          });
        }
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

      const houseBalanceData = await getAllHouseBalances(guildId);

      // Debug: Log the raw data structure for troubleshooting
      console.log(`[HOUSE-BALANCE] Raw house balance data for guild ${guildId}:`, JSON.stringify(houseBalanceData, null, 2));

      const embed = new EmbedBuilder()
        .setTitle('🏛️ House Balance Overview')
        .setDescription('Separate tracking for Betting, Auction, and Lottery house balances')
        .setColor('#8B5CF6')
        .setTimestamp();

      // Aggregate all tokens from all balance records
      // houseBalanceData structure: {token_identifier: {bettingEarnings: {...}, bettingSpending: {...}, ...}}
      const aggregatedBalances = {
        bettingEarnings: {},
        bettingSpending: {},
        bettingPNL: {},
        auctionEarnings: {},
        auctionSpending: {},
        auctionPNL: {},
        lotteryEarnings: {},
        lotterySpending: {},
        lotteryPNL: {}
      };
      
      const allTokens = new Set();
      
      // Aggregate balances from all token records
      for (const [tokenIdentifier, tokenData] of Object.entries(houseBalanceData || {})) {
        allTokens.add(tokenIdentifier);
        
        // Debug: Log lottery earnings structure
        if (tokenData.lotteryEarnings && Object.keys(tokenData.lotteryEarnings).length > 0) {
          console.log(`[HOUSE-BALANCE] Found lottery earnings for tokenIdentifier ${tokenIdentifier}:`, JSON.stringify(tokenData.lotteryEarnings));
        }
        
        // Merge betting earnings (JSONB structure: {"token": "amount"})
        if (tokenData.bettingEarnings) {
          for (const [token, amount] of Object.entries(tokenData.bettingEarnings)) {
            allTokens.add(token); // Add token from JSONB to the set
            aggregatedBalances.bettingEarnings[token] = amount;
          }
        }
        
        // Merge betting spending
        if (tokenData.bettingSpending) {
          for (const [token, amount] of Object.entries(tokenData.bettingSpending)) {
            allTokens.add(token); // Add token from JSONB to the set
            aggregatedBalances.bettingSpending[token] = amount;
          }
        }
        
        // Merge auction earnings
        if (tokenData.auctionEarnings) {
          for (const [token, amount] of Object.entries(tokenData.auctionEarnings)) {
            allTokens.add(token); // Add token from JSONB to the set
            aggregatedBalances.auctionEarnings[token] = amount;
          }
        }
        
        // Merge auction spending
        if (tokenData.auctionSpending) {
          for (const [token, amount] of Object.entries(tokenData.auctionSpending)) {
            allTokens.add(token); // Add token from JSONB to the set
            aggregatedBalances.auctionSpending[token] = amount;
          }
        }
        
        // Merge lottery earnings (sum if multiple entries exist)
        if (tokenData.lotteryEarnings && typeof tokenData.lotteryEarnings === 'object' && Object.keys(tokenData.lotteryEarnings).length > 0) {
          for (const [token, amount] of Object.entries(tokenData.lotteryEarnings)) {
            allTokens.add(token); // Add token from JSONB to the set
            if (!aggregatedBalances.lotteryEarnings[token]) {
              aggregatedBalances.lotteryEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
            aggregatedBalances.lotteryEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery spending (sum if multiple entries exist)
        if (tokenData.lotterySpending && typeof tokenData.lotterySpending === 'object' && Object.keys(tokenData.lotterySpending).length > 0) {
          for (const [token, amount] of Object.entries(tokenData.lotterySpending)) {
            allTokens.add(token); // Add token from JSONB to the set
            if (!aggregatedBalances.lotterySpending[token]) {
              aggregatedBalances.lotterySpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
            aggregatedBalances.lotterySpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
      }
      
      // Debug: Log aggregated lottery balances
      console.log(`[HOUSE-BALANCE] Aggregated lottery earnings:`, JSON.stringify(aggregatedBalances.lotteryEarnings));
      console.log(`[HOUSE-BALANCE] All tokens:`, Array.from(allTokens));

      // Display token-specific balances for both sources
      // Group tokens by ticker to avoid double-counting (identifier vs ticker)
      const processedTokens = new Set();
      
      if (allTokens.size > 0) {
        for (const tokenKey of allTokens) {
          // Extract ticker from identifier if needed
          const tokenTickerOnly = tokenKey.includes('-') ? tokenKey.split('-')[0] : tokenKey;
          
          // Skip if we've already processed a token with this ticker
          // Prefer identifier over ticker-only
          if (processedTokens.has(tokenTickerOnly)) {
            // If current is ticker-only and we already processed an identifier, skip
            if (!tokenKey.includes('-')) continue;
            // If current is identifier and we processed ticker-only, remove ticker-only from processed
            // (we'll process the identifier instead)
          }
          
          processedTokens.add(tokenTickerOnly);
          
          // Use identifier if available, otherwise use ticker
          const tokenTicker = tokenKey.includes('-') ? tokenKey : tokenTickerOnly;
          const storedDecimals = await getStoredTokenDecimals(guildId, tokenTicker);
          if (storedDecimals === null) continue;
          
          // Betting balance
          const bettingEarnings = new BigNumber(aggregatedBalances.bettingEarnings[tokenTicker] || aggregatedBalances.bettingEarnings[tokenTickerOnly] || '0');
          const bettingSpending = new BigNumber(aggregatedBalances.bettingSpending[tokenTicker] || aggregatedBalances.bettingSpending[tokenTickerOnly] || '0');
          const bettingBalance = bettingEarnings.minus(bettingSpending);
          
          // Auction balance
          const auctionEarnings = new BigNumber(aggregatedBalances.auctionEarnings[tokenTicker] || aggregatedBalances.auctionEarnings[tokenTickerOnly] || '0');
          const auctionSpending = new BigNumber(aggregatedBalances.auctionSpending[tokenTicker] || aggregatedBalances.auctionSpending[tokenTickerOnly] || '0');
          const auctionBalance = auctionEarnings.minus(auctionSpending);
          
          // Lottery balance - check both identifier and ticker (for backward compatibility with old data)
          // Sum them if both exist (they represent the same token, just stored differently)
          const lotteryEarningsId = aggregatedBalances.lotteryEarnings[tokenTicker] || '0';
          const lotteryEarningsTicker = tokenTicker !== tokenTickerOnly ? (aggregatedBalances.lotteryEarnings[tokenTickerOnly] || '0') : '0';
          const lotteryEarnings = new BigNumber(lotteryEarningsId).plus(new BigNumber(lotteryEarningsTicker));
          
          const lotterySpendingId = aggregatedBalances.lotterySpending[tokenTicker] || '0';
          const lotterySpendingTicker = tokenTicker !== tokenTickerOnly ? (aggregatedBalances.lotterySpending[tokenTickerOnly] || '0') : '0';
          const lotterySpending = new BigNumber(lotterySpendingId).plus(new BigNumber(lotterySpendingTicker));
          const lotteryBalance = lotteryEarnings.minus(lotterySpending);
          
          // Convert to human-readable
          const bettingEarningsHuman = new BigNumber(bettingEarnings).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const bettingSpendingHuman = new BigNumber(bettingSpending).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const bettingBalanceHuman = new BigNumber(bettingBalance).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          
          const auctionEarningsHuman = new BigNumber(auctionEarnings).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const auctionSpendingHuman = new BigNumber(auctionSpending).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const auctionBalanceHuman = new BigNumber(auctionBalance).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          
          const lotteryEarningsHuman = new BigNumber(lotteryEarnings).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const lotterySpendingHuman = new BigNumber(lotterySpending).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          const lotteryBalanceHuman = new BigNumber(lotteryBalance).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          
          // Status emojis
          let bettingEmoji = '🟢';
          if (bettingBalance.isLessThan(0)) bettingEmoji = '🔴';
          else if (bettingBalance.isEqualTo(0)) bettingEmoji = '⚪';
          
          let auctionEmoji = '🟢';
          if (auctionBalance.isLessThan(0)) auctionEmoji = '🔴';
          else if (auctionBalance.isEqualTo(0)) auctionEmoji = '⚪';
          
          let lotteryEmoji = '🟢';
          if (lotteryBalance.isLessThan(0)) lotteryEmoji = '🔴';
          else if (lotteryBalance.isEqualTo(0)) lotteryEmoji = '⚪';
          
          // Total balance
          const totalBalance = bettingBalance.plus(auctionBalance).plus(lotteryBalance);
          const totalBalanceHuman = new BigNumber(totalBalance).dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
          
          embed.addFields({
            name: `💰 ${tokenTicker}`,
            value: `**⚽ Betting:** ${bettingBalanceHuman} (Earned: ${bettingEarningsHuman} | Spent: ${bettingSpendingHuman})\n**🎨 Auction:** ${auctionBalanceHuman} (Earned: ${auctionEarningsHuman} | Spent: ${auctionSpendingHuman})\n**🎲 Lottery:** ${lotteryBalanceHuman} (Earned: ${lotteryEarningsHuman} | Spent: ${lotterySpendingHuman})\n**📊 Total:** ${totalBalanceHuman}`,
            inline: false
          });
        }
      } else {
        embed.addFields({
          name: 'No Balance',
          value: 'No house balance has been accumulated yet.',
          inline: false
        });
      }

      embed.addFields({
        name: 'ℹ️ How it Works',
        value: '**Balance = Earnings - Spending**\n\n**⚽ Betting House:**\n• Earnings: From matches with no winners\n• Spending: When house pays prizes from betting balance\n\n**🎨 Auction House:**\n• Earnings: From successful NFT auction sales\n• Spending: When house pays prizes from auction balance\n\n**🎲 Lottery House:**\n• Earnings: From lottery commission on prize pools\n• Spending: When house pays prizes from lottery balance',
        inline: false
      });

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
      const houseType = interaction.options.getString('house-type') || 'betting'; // Default to betting for backward compatibility
      const tokenTicker = interaction.options.getString('token');
      const amount = interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || 'House prize';
      const guildId = interaction.guildId;

      if (amount <= 0) {
        await interaction.editReply({ content: 'Amount must be greater than 0.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check house balance based on source
      const houseBalanceData = await getAllHouseBalances(guildId);
      
      // Aggregate balances from all token records
      const aggregatedBalances = {
        bettingEarnings: {},
        bettingSpending: {},
        auctionEarnings: {},
        auctionSpending: {},
        lotteryEarnings: {},
        lotterySpending: {}
      };
      
      for (const [tokenIdentifier, tokenData] of Object.entries(houseBalanceData || {})) {
        // Merge betting earnings
        if (tokenData.bettingEarnings) {
          for (const [token, amount] of Object.entries(tokenData.bettingEarnings)) {
            if (!aggregatedBalances.bettingEarnings[token]) {
              aggregatedBalances.bettingEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingEarnings[token] || '0');
            aggregatedBalances.bettingEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge betting spending
        if (tokenData.bettingSpending) {
          for (const [token, amount] of Object.entries(tokenData.bettingSpending)) {
            if (!aggregatedBalances.bettingSpending[token]) {
              aggregatedBalances.bettingSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingSpending[token] || '0');
            aggregatedBalances.bettingSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction earnings
        if (tokenData.auctionEarnings) {
          for (const [token, amount] of Object.entries(tokenData.auctionEarnings)) {
            if (!aggregatedBalances.auctionEarnings[token]) {
              aggregatedBalances.auctionEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionEarnings[token] || '0');
            aggregatedBalances.auctionEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction spending
        if (tokenData.auctionSpending) {
          for (const [token, amount] of Object.entries(tokenData.auctionSpending)) {
            if (!aggregatedBalances.auctionSpending[token]) {
              aggregatedBalances.auctionSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionSpending[token] || '0');
            aggregatedBalances.auctionSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery earnings
        if (tokenData.lotteryEarnings) {
          for (const [token, amount] of Object.entries(tokenData.lotteryEarnings)) {
            if (!aggregatedBalances.lotteryEarnings[token]) {
              aggregatedBalances.lotteryEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
            aggregatedBalances.lotteryEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery spending
        if (tokenData.lotterySpending) {
          for (const [token, amount] of Object.entries(tokenData.lotterySpending)) {
            if (!aggregatedBalances.lotterySpending[token]) {
              aggregatedBalances.lotterySpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
            aggregatedBalances.lotterySpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
      }
      
      await interaction.editReply({ content: '💸 Transferring tokens from house balance...', flags: [MessageFlags.Ephemeral] });

      // Resolve token identifier from ticker/identifier FIRST (needed for balance lookup and decimals)
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      if (!tokenIdentifier) {
        await interaction.editReply({ content: `❌ Could not resolve token identifier for ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Extract ticker from identifier if needed (for backward compatibility with old data stored by ticker)
      const tokenTickerOnly = tokenTicker.includes('-') ? tokenTicker.split('-')[0] : tokenTicker;
      
      // Get balance based on source - check both identifier and ticker (for backward compatibility)
      let houseBalance;
      let sourceName;
      if (houseType === 'auction') {
        sourceName = 'Auction House Balance';
        const auctionEarningsId = aggregatedBalances.auctionEarnings[tokenIdentifier] || '0';
        const auctionEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.auctionEarnings[tokenTickerOnly] || '0') : '0';
        const auctionEarnings = new BigNumber(auctionEarningsId).plus(new BigNumber(auctionEarningsTicker));
        
        const auctionSpendingId = aggregatedBalances.auctionSpending[tokenIdentifier] || '0';
        const auctionSpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.auctionSpending[tokenTickerOnly] || '0') : '0';
        const auctionSpending = new BigNumber(auctionSpendingId).plus(new BigNumber(auctionSpendingTicker));
        
        houseBalance = auctionEarnings.minus(auctionSpending);
        if (houseBalance.isLessThanOrEqualTo(0)) {
          await interaction.editReply({ content: '❌ Auction house has no balance for this token yet. No auctions have completed successfully.', flags: [MessageFlags.Ephemeral] });
          return;
        }
      } else if (houseType === 'lottery') {
        sourceName = 'Lottery House Balance';
        // Check both identifier and ticker (for backward compatibility with old data stored by ticker)
        const lotteryEarningsId = aggregatedBalances.lotteryEarnings[tokenIdentifier] || '0';
        const lotteryEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.lotteryEarnings[tokenTickerOnly] || '0') : '0';
        const lotteryEarnings = new BigNumber(lotteryEarningsId).plus(new BigNumber(lotteryEarningsTicker));
        
        const lotterySpendingId = aggregatedBalances.lotterySpending[tokenIdentifier] || '0';
        const lotterySpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.lotterySpending[tokenTickerOnly] || '0') : '0';
        const lotterySpending = new BigNumber(lotterySpendingId).plus(new BigNumber(lotterySpendingTicker));
        
        houseBalance = lotteryEarnings.minus(lotterySpending);
        if (houseBalance.isLessThanOrEqualTo(0)) {
          await interaction.editReply({ content: '❌ Lottery house has no balance for this token yet. No lotteries have collected commission.', flags: [MessageFlags.Ephemeral] });
          return;
        }
      } else {
        sourceName = 'Betting House Balance';
        const bettingEarningsId = aggregatedBalances.bettingEarnings[tokenIdentifier] || '0';
        const bettingEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.bettingEarnings[tokenTickerOnly] || '0') : '0';
        const bettingEarnings = new BigNumber(bettingEarningsId).plus(new BigNumber(bettingEarningsTicker));
        
        const bettingSpendingId = aggregatedBalances.bettingSpending[tokenIdentifier] || '0';
        const bettingSpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.bettingSpending[tokenTickerOnly] || '0') : '0';
        const bettingSpending = new BigNumber(bettingSpendingId).plus(new BigNumber(bettingSpendingTicker));
        
        houseBalance = bettingEarnings.minus(bettingSpending);
        if (houseBalance.isLessThanOrEqualTo(0)) {
          await interaction.editReply({ content: '❌ Betting house has no balance for this token yet. No matches have had zero winners.', flags: [MessageFlags.Ephemeral] });
          return;
        }
      }

      // Get decimals using token identifier (metadata is stored by identifier, not ticker)
      const storedDecimals = await getStoredTokenDecimals(guildId, tokenIdentifier);
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
      
      // Track house spending FIRST (before virtual transfer) - using identifier
      await trackHouseSpending(guildId, amountWei, tokenIdentifier, memo, houseType);
      
      // Add to recipient's virtual account (virtual transfer, no on-chain transaction)
      const addResult = await virtualAccounts.addFundsToAccount(
        guildId,
        targetUser.id,
        tokenIdentifier,
        amount.toString(),
        null, // No transaction hash for virtual transfers
        'house_tip',
        targetUser.tag
      );

      console.log(`[HOUSE-TIP] addFundsToAccount result:`, { success: addResult.success, error: addResult.error, newBalance: addResult.newBalance });

      if (addResult.success) {
        try {
          const successEmbed = new EmbedBuilder()
            .setTitle('💰 House Tip Completed')
            .setDescription(`Sent **${amount} ${tokenTicker}** to ${targetUser.tag} from ${sourceName}`)
            .addFields([
              { name: 'Recipient', value: `<@${targetUser.id}>`, inline: true },
              { name: 'Amount', value: `${amount} ${tokenTicker}`, inline: true },
              { name: 'Source', value: houseType === 'auction' ? '🎨 Auction House' : houseType === 'lottery' ? '🎲 Lottery House' : '⚽ Betting House', inline: true },
              { name: 'New Balance', value: `${addResult.newBalance} ${tokenTicker}`, inline: true },
              { name: 'Memo', value: memo, inline: false },
              { name: 'Sent By', value: `<@${interaction.user.id}>`, inline: true }
            ])
            .setColor('#8B5CF6')
            .setTimestamp()
            .setFooter({ text: 'Virtual Account Transfer', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

          await interaction.editReply({ 
            content: `✅ **Success!** House tip sent to ${targetUser.tag}`, 
            embeds: [successEmbed],
            flags: [MessageFlags.Ephemeral] 
          });
        } catch (embedError) {
          console.error('[HOUSE-TIP] Error creating/sending success embed:', embedError.message);
          // Fallback to simple success message
          await interaction.editReply({ 
            content: `✅ **Success!** Sent ${amount} ${tokenTicker} to ${targetUser.tag} from ${sourceName}. New balance: ${addResult.newBalance} ${tokenTicker}`, 
            flags: [MessageFlags.Ephemeral] 
          });
        }

        // Send public notification
        try {
          const channel = interaction.channel;
          const botMember = interaction.guild.members.cache.get(client.user.id);
          const hasSendMessages = botMember?.permissionsIn(channel).has(PermissionsBitField.Flags.SendMessages);
          const hasEmbedLinks = botMember?.permissionsIn(channel).has(PermissionsBitField.Flags.EmbedLinks);
          
          if (hasSendMessages && hasEmbedLinks) {
            const publicEmbed = new EmbedBuilder()
              .setTitle('💰 House Tip')
              .setDescription(`<@${interaction.user.id}> sent **${amount} ${tokenTicker}** to <@${targetUser.id}> from ${sourceName}`)
              .addFields([
                { name: 'Recipient', value: `<@${targetUser.id}>`, inline: true },
                { name: 'Amount', value: `${amount} ${tokenTicker}`, inline: true },
                { name: 'Source', value: houseType === 'auction' ? '🎨 Auction House' : houseType === 'lottery' ? '🎲 Lottery House' : '⚽ Betting House', inline: true },
                { name: 'Memo', value: memo, inline: false }
              ])
              .setColor('#8B5CF6')
              .setTimestamp()
              .setFooter({ text: 'Virtual Account Transfer', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

            await channel.send({ 
              content: `🪙 **House Tip Notification** 🪙`,
              embeds: [publicEmbed]
            });
          } else {
            console.warn('[HOUSE-TIP] Bot lacks permissions to send public notification in channel:', channel.id);
          }
        } catch (notifError) {
          console.error('[HOUSE-TIP] Error sending public notification:', notifError.message);
        }
      } else {
        // Refund house balance if virtual transfer failed (reverse the spending)
        // Use tokenIdentifier (not tokenTicker) for house balance operations
        const tokenBalance = await getHouseBalance(guildId, tokenIdentifier);
        if (tokenBalance) {
          if (houseType === 'auction') {
            const currentSpending = new BigNumber(tokenBalance.auctionSpending?.[tokenIdentifier] || '0');
            tokenBalance.auctionSpending[tokenIdentifier] = currentSpending.minus(amountWei).toString();
            tokenBalance.auctionPNL[tokenIdentifier] = new BigNumber(tokenBalance.auctionPNL[tokenIdentifier] || '0').plus(amountWei).toString();
          } else if (houseType === 'lottery') {
            const currentSpending = new BigNumber(tokenBalance.lotterySpending?.[tokenIdentifier] || '0');
            tokenBalance.lotterySpending[tokenIdentifier] = currentSpending.minus(amountWei).toString();
            tokenBalance.lotteryPNL[tokenIdentifier] = new BigNumber(tokenBalance.lotteryPNL[tokenIdentifier] || '0').plus(amountWei).toString();
          } else {
            const currentSpending = new BigNumber(tokenBalance.bettingSpending?.[tokenIdentifier] || '0');
            tokenBalance.bettingSpending[tokenIdentifier] = currentSpending.minus(amountWei).toString();
            tokenBalance.bettingPNL[tokenIdentifier] = new BigNumber(tokenBalance.bettingPNL[tokenIdentifier] || '0').plus(amountWei).toString();
          }
          await dbServerData.updateHouseBalance(guildId, tokenIdentifier, tokenBalance);
        }
        
        await interaction.editReply({ 
          content: `❌ Transfer failed: ${addResult.error || 'Unknown error'}`, 
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
  } else if (commandName === 'house-withdraw') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const source = interaction.options.getString('source') || 'betting';
      const projectName = interaction.options.getString('project-name');
      const tokenTicker = interaction.options.getString('token');
      const amount = interaction.options.getString('amount') || interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || 'House withdrawal';
      const guildId = interaction.guildId;

      // Get Community Fund project (source wallet)
      const communityFundProjectName = getCommunityFundProjectName(); // Always "Community Fund"
      const projects = await getProjects(guildId);
      const communityFundProject = projects[communityFundProjectName];
      
      if (!communityFundProject) {
        await interaction.editReply({ content: '❌ Community Fund project not found. Please set up a Community Fund first.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (!communityFundProject.walletAddress || !communityFundProject.walletPem) {
        await interaction.editReply({ content: '❌ Community Fund wallet is not configured properly.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Get destination project (target wallet)
      const destinationProject = projects[projectName];
      
      if (!destinationProject) {
        await interaction.editReply({ content: `❌ Project "${projectName}" not found.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if trying to withdraw to Community Fund (should not be)
      if (projectName === communityFundProjectName) {
        await interaction.editReply({ content: '❌ Cannot withdraw to Community Fund project. Please select a different project.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (!destinationProject.walletAddress) {
        await interaction.editReply({ content: `❌ Project "${projectName}" has no wallet address configured.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check Community Fund balances (1 transfer for house-withdraw)
      const balanceCheck = await checkCommunityFundBalances(guildId, 1);
      if (!balanceCheck.sufficient) {
        const errorEmbed = await createBalanceErrorEmbed(guildId, balanceCheck, '/house-withdraw');
        await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check if destination project supports this token
      const supportedTokens = Array.isArray(destinationProject.supportedTokens) 
        ? destinationProject.supportedTokens 
        : (destinationProject.supportedTokens || '').split(',').map(t => t.trim());
      
      if (!supportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ content: `❌ Project "${projectName}" does not support token "${tokenTicker}".`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Check house balance based on source
      const houseBalanceData = await getAllHouseBalances(guildId);
      
      // Aggregate balances similar to how house-balance command does it
      const aggregatedBalances = {
        bettingEarnings: {},
        bettingSpending: {},
        auctionEarnings: {},
        auctionSpending: {},
        lotteryEarnings: {},
        lotterySpending: {}
      };
      
      // Aggregate balances from all token records
      for (const [tokenIdentifier, tokenData] of Object.entries(houseBalanceData || {})) {
        // Merge betting earnings
        if (tokenData.bettingEarnings) {
          for (const [token, amount] of Object.entries(tokenData.bettingEarnings)) {
            if (!aggregatedBalances.bettingEarnings[token]) {
              aggregatedBalances.bettingEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingEarnings[token] || '0');
            aggregatedBalances.bettingEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge betting spending
        if (tokenData.bettingSpending) {
          for (const [token, amount] of Object.entries(tokenData.bettingSpending)) {
            if (!aggregatedBalances.bettingSpending[token]) {
              aggregatedBalances.bettingSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingSpending[token] || '0');
            aggregatedBalances.bettingSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction earnings
        if (tokenData.auctionEarnings) {
          for (const [token, amount] of Object.entries(tokenData.auctionEarnings)) {
            if (!aggregatedBalances.auctionEarnings[token]) {
              aggregatedBalances.auctionEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionEarnings[token] || '0');
            aggregatedBalances.auctionEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction spending
        if (tokenData.auctionSpending) {
          for (const [token, amount] of Object.entries(tokenData.auctionSpending)) {
            if (!aggregatedBalances.auctionSpending[token]) {
              aggregatedBalances.auctionSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionSpending[token] || '0');
            aggregatedBalances.auctionSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery earnings
        if (tokenData.lotteryEarnings) {
          for (const [token, amount] of Object.entries(tokenData.lotteryEarnings)) {
            if (!aggregatedBalances.lotteryEarnings[token]) {
              aggregatedBalances.lotteryEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
            aggregatedBalances.lotteryEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery spending
        if (tokenData.lotterySpending) {
          for (const [token, amount] of Object.entries(tokenData.lotterySpending)) {
            if (!aggregatedBalances.lotterySpending[token]) {
              aggregatedBalances.lotterySpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
            aggregatedBalances.lotterySpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
      }
      
      // Resolve token identifier from ticker/identifier FIRST (needed for balance lookup and decimals)
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      if (!tokenIdentifier) {
        await interaction.editReply({ content: `❌ Could not resolve token identifier for ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Extract ticker from identifier if needed (for backward compatibility with old data stored by ticker)
      const tokenTickerOnly = tokenTicker.includes('-') ? tokenTicker.split('-')[0] : tokenTicker;
      
      // Get balance based on source - check both identifier and ticker (for backward compatibility)
      let houseBalance;
      let sourceName;
      if (source === 'auction') {
        sourceName = 'Auction House Balance';
        const auctionEarningsId = aggregatedBalances.auctionEarnings[tokenIdentifier] || '0';
        const auctionEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.auctionEarnings[tokenTickerOnly] || '0') : '0';
        const auctionEarnings = new BigNumber(auctionEarningsId).plus(new BigNumber(auctionEarningsTicker));
        
        const auctionSpendingId = aggregatedBalances.auctionSpending[tokenIdentifier] || '0';
        const auctionSpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.auctionSpending[tokenTickerOnly] || '0') : '0';
        const auctionSpending = new BigNumber(auctionSpendingId).plus(new BigNumber(auctionSpendingTicker));
        
        houseBalance = auctionEarnings.minus(auctionSpending);
        
        if (houseBalance.isLessThanOrEqualTo(0)) {
          await interaction.editReply({ content: '❌ Auction house has no balance for this token yet. No auctions have completed successfully.', flags: [MessageFlags.Ephemeral] });
          return;
        }
      } else if (source === 'lottery') {
        sourceName = 'Lottery House Balance';
        // Check both identifier and ticker (for backward compatibility with old data stored by ticker)
        const lotteryEarningsId = aggregatedBalances.lotteryEarnings[tokenIdentifier] || '0';
        const lotteryEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.lotteryEarnings[tokenTickerOnly] || '0') : '0';
        const lotteryEarnings = new BigNumber(lotteryEarningsId).plus(new BigNumber(lotteryEarningsTicker));
        
        const lotterySpendingId = aggregatedBalances.lotterySpending[tokenIdentifier] || '0';
        const lotterySpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.lotterySpending[tokenTickerOnly] || '0') : '0';
        const lotterySpending = new BigNumber(lotterySpendingId).plus(new BigNumber(lotterySpendingTicker));
        
        houseBalance = lotteryEarnings.minus(lotterySpending);
        
        if (houseBalance.isLessThanOrEqualTo(0)) {
          await interaction.editReply({ content: '❌ Lottery house has no balance for this token yet. No lotteries have collected commission.', flags: [MessageFlags.Ephemeral] });
          return;
        }
      } else {
        sourceName = 'Betting House Balance';
        const bettingEarningsId = aggregatedBalances.bettingEarnings[tokenIdentifier] || '0';
        const bettingEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.bettingEarnings[tokenTickerOnly] || '0') : '0';
        const bettingEarnings = new BigNumber(bettingEarningsId).plus(new BigNumber(bettingEarningsTicker));
        
        const bettingSpendingId = aggregatedBalances.bettingSpending[tokenIdentifier] || '0';
        const bettingSpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.bettingSpending[tokenTickerOnly] || '0') : '0';
        const bettingSpending = new BigNumber(bettingSpendingId).plus(new BigNumber(bettingSpendingTicker));
        
        houseBalance = bettingEarnings.minus(bettingSpending);
        
        if (houseBalance.isLessThanOrEqualTo(0)) {
          await interaction.editReply({ content: '❌ Betting house has no balance for this token yet. No matches have had zero winners.', flags: [MessageFlags.Ephemeral] });
          return;
        }
      }
      
      const storedDecimals = await getStoredTokenDecimals(guildId, tokenIdentifier);
      if (storedDecimals === null) {
        await interaction.editReply({ content: `❌ Token metadata missing for ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Handle MAX amount option
      let amountToWithdraw;
      if (typeof amount === 'string' && amount.toUpperCase() === 'MAX') {
        // Calculate maximum withdrawable amount (full balance)
        const maxAmount = houseBalance.dividedBy(new BigNumber(10).pow(storedDecimals));
        amountToWithdraw = parseFloat(maxAmount.toString());
      } else if (typeof amount === 'number') {
        amountToWithdraw = amount;
      } else if (typeof amount === 'string') {
        // Try to parse as number
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          await interaction.editReply({ content: '❌ Invalid amount. Please enter a positive number or "MAX".', flags: [MessageFlags.Ephemeral] });
          return;
        }
        amountToWithdraw = parsedAmount;
      } else {
        await interaction.editReply({ content: '❌ Invalid amount. Please enter a number or "MAX".', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (amountToWithdraw <= 0) {
        await interaction.editReply({ content: '❌ Amount must be greater than 0.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const amountWei = toBlockchainAmount(amountToWithdraw, storedDecimals);
      
      // Check if house has enough balance
      if (houseBalance.isLessThan(amountWei)) {
        const currentBalance = houseBalance.dividedBy(new BigNumber(10).pow(storedDecimals)).toString();
        await interaction.editReply({ 
          content: `❌ **Insufficient house balance!**\n\nCurrent house balance: **${currentBalance}** ${tokenTicker}\nRequired: **${amountToWithdraw}** ${tokenTicker}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      await interaction.editReply({ content: '💸 Processing withdrawal from Community Fund to project wallet...', flags: [MessageFlags.Ephemeral] });

      // Transfer on-chain from Community Fund wallet to destination project wallet
      const transferResult = await transferESDTFromCommunityFund(
        destinationProject.walletAddress,
        tokenTicker,
        amountToWithdraw,
        communityFundProjectName,
        guildId
      );

      if (transferResult.success) {
        // Resolve token identifier from ticker/identifier
        const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
        
        // Track house spending with source - using identifier
        await trackHouseSpending(guildId, amountWei, tokenIdentifier, memo, source);

        const successEmbed = new EmbedBuilder()
          .setTitle('💰 House Withdrawal Completed')
          .setDescription(`Withdrew **${amountToWithdraw} ${tokenTicker}** from ${sourceName} to project "${projectName}"`)
          .addFields([
            { name: 'Destination Project', value: projectName, inline: true },
            { name: 'Amount', value: `${amountToWithdraw} ${tokenTicker}`, inline: true },
            { name: 'Source', value: source === 'auction' ? '🎨 Auction House' : source === 'lottery' ? '🎲 Lottery House' : '⚽ Betting House', inline: true },
            { name: 'From (Community Fund)', value: `\`${communityFundProject.walletAddress}\``, inline: false },
            { name: 'To (Project Wallet)', value: `\`${destinationProject.walletAddress}\``, inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Transaction', value: `[\`${transferResult.txHash}\`](https://explorer.multiversx.com/transactions/${transferResult.txHash})`, inline: false },
            { name: 'Sent By', value: `<@${interaction.user.id}>`, inline: true }
          ])
          .setColor('#8B5CF6')
          .setTimestamp()
          .setFooter({ text: 'On-Chain Transfer', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

        await interaction.editReply({ 
          content: `✅ **Success!** Withdrawal completed`, 
          embeds: [successEmbed],
          flags: [MessageFlags.Ephemeral] 
        });
      } else {
        await interaction.editReply({ 
          content: `❌ Withdrawal failed: ${transferResult.errorMessage || 'Unknown error'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error('[HOUSE-WITHDRAW] Error in house-withdraw command:', error.message);
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
      function parseDate(dateStr, isEndDate = false) {
        let year, month, day;
        
        // Try EU format first (DD-MM-YYYY) - more specific pattern
        const euPattern = /^(\d{2})-(\d{2})-(\d{4})$/;
        const euMatch = dateStr.match(euPattern);
        if (euMatch) {
          [, day, month, year] = euMatch;
          // Validate month and day ranges
          const monthNum = parseInt(month, 10);
          const dayNum = parseInt(day, 10);
          if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
            const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
            if (!isNaN(date.getTime()) && date.getFullYear() == year && date.getMonth() + 1 == monthNum && date.getDate() == dayNum) {
              return date.getTime();
            }
          }
        }
        
        // Try US format (YYYY-MM-DD)
        const usPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
        const usMatch = dateStr.match(usPattern);
        if (usMatch) {
          [, year, month, day] = usMatch;
          const monthNum = parseInt(month, 10);
          const dayNum = parseInt(day, 10);
          if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
            const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
            if (!isNaN(date.getTime()) && date.getFullYear() == year && date.getMonth() + 1 == monthNum && date.getDate() == dayNum) {
              return date.getTime();
            }
          }
        }
        
        // Fallback: try direct Date parsing (may work for some formats)
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          // Verify it's a valid date by checking the input matches
          return date.getTime();
        }
        
        return null;
      }
      
      const startTime = parseDate(startDate, false);
      let endTime = parseDate(endDate, true);
      
      // For end date, set to end of day (23:59:59.999) to include the full day
      if (endTime !== null) {
        const endDateObj = new Date(endTime);
        endDateObj.setUTCHours(23, 59, 59, 999);
        endTime = endDateObj.getTime();
      }
      
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
      // Get all bets for this guild in the date range
      const allBets = [];
      const guildMatchesObj = await dbFootball.getMatchesByGuild(guildId);
      const guildMatches = guildMatchesObj || {};
      
      // Get all bets for this guild
      for (const match of Object.values(guildMatches)) {
        const matchBets = await dbFootball.getBetsByMatch(guildId, match.matchId);
        allBets.push(...Object.values(matchBets || {}));
      }
      const guildBets = {};
      allBets.forEach(bet => {
        guildBets[bet.betId] = bet;
      });
      
      // Filter bets by date range and competition
      const filteredBets = Object.values(guildBets).filter(bet => {
        // Check date range
        if (!bet.createdAtISO) {
          console.log(`[LEADERBOARD-FILTERED] Bet ${bet.betId} missing createdAtISO, skipping`);
          return false;
        }
        
        const betTime = new Date(bet.createdAtISO).getTime();
        if (isNaN(betTime)) {
          console.log(`[LEADERBOARD-FILTERED] Invalid date for bet ${bet.betId}: ${bet.createdAtISO}`);
          return false;
        }
        
        const inRange = betTime >= startTime && betTime <= endTime;
        if (!inRange) return false;
        
        // Filter by competition if specified
        if (competition) {
          const match = guildMatches[bet.matchId];
          if (!match) {
            console.log(`[LEADERBOARD-FILTERED] Match ${bet.matchId} not found for bet ${bet.betId}`);
            return false;
          }
          
          // Case-insensitive competition comparison
          const matchCompCode = (match.compCode || '').toUpperCase().trim();
          const filterCompCode = competition.toUpperCase().trim();
          
          if (matchCompCode !== filterCompCode) {
            return false;
          }
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
        if (!match) {
          console.log(`[LEADERBOARD-FILTERED] Match ${bet.matchId} not found for bet ${bet.betId}, skipping`);
          continue;
        }
        
        const userId = bet.userId;
        if (!userId) {
          console.log(`[LEADERBOARD-FILTERED] Bet ${bet.betId} missing userId, skipping`);
          continue;
        }
        
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
        if (betAmountWei.isZero() || !betAmountWei.isFinite()) {
          console.log(`[LEADERBOARD-FILTERED] Invalid bet amount for bet ${bet.betId}: ${bet.amountWei}`);
          continue;
        }
        
        const tokenTicker = match.token?.ticker;
        if (!tokenTicker) {
          console.log(`[LEADERBOARD-FILTERED] Match ${bet.matchId} missing token ticker, skipping bet ${bet.betId}`);
          continue;
        }
        
        if (!userStats[userId].tokenStats[tokenTicker]) {
          userStats[userId].tokenStats[tokenTicker] = {
            bets: 0,
            earnings: 0
          };
        }
        
        userStats[userId].totalBets += betAmountWei.toNumber();
        userStats[userId].matches += 1;
        userStats[userId].tokenStats[tokenTicker].bets += betAmountWei.toNumber();
        
        // Check if bet won (prizeSent can be true/false, prizeAmount should exist if prize was sent)
        if (bet.prizeSent === true && bet.prizeAmount) {
          try {
            // prizeAmount is stored as human-readable string (e.g., "100.5")
            // Convert to wei for calculations
            const storedDecimals = match.token?.decimals || await getStoredTokenDecimals(guildId, tokenTicker);
            if (storedDecimals === null) {
              console.log(`[LEADERBOARD-FILTERED] Cannot convert prize for bet ${bet.betId}: missing decimals for ${tokenTicker}`);
              continue;
            }
            
            const prizeAmountWei = toBlockchainAmount(bet.prizeAmount, storedDecimals);
            const prizeBN = new BigNumber(prizeAmountWei);
            
            if (prizeBN.isGreaterThan(0) && prizeBN.isFinite()) {
              userStats[userId].totalEarnings += prizeBN.toNumber();
              userStats[userId].tokenStats[tokenTicker].earnings += prizeBN.toNumber();
              userStats[userId].wins += 1;
              userStats[userId].points += 3;
            }
          } catch (prizeError) {
            console.error(`[LEADERBOARD-FILTERED] Error processing prize for bet ${bet.betId}:`, prizeError.message);
          }
        }
      }
      
      // Convert to array and sort
      const sortedUsers = Object.values(userStats).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.totalEarnings - a.totalEarnings;
      }).slice(0, 20); // Top 20
      
      // Get competition name for display
      let competitionDisplay = '';
      if (competition) {
        const matchWithComp = Object.values(guildMatches).find(m => 
          m.compCode && m.compCode.toUpperCase() === competition.toUpperCase()
        );
        competitionDisplay = matchWithComp ? ` in ${matchWithComp.compName}` : ` in ${competition}`;
      }
      
      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('🏆 Filtered Leaderboard')
        .setDescription(`**Top ${sortedUsers.length} players** from ${startDate} to ${endDate}${competitionDisplay}`)
        .setColor('#FFD700')
        .setTimestamp();
      
      for (let i = 0; i < sortedUsers.length; i++) {
        const user = sortedUsers[i];
        const userMember = await interaction.guild.members.fetch(user.userId).catch(() => null);
        const username = userMember ? userMember.user.username : `User ${user.userId}`;
        
        // Calculate PNL (in human format for display)
        const pnlTokens = [];
        for (const [tokenTicker, stats] of Object.entries(user.tokenStats)) {
          const storedDecimals = await getStoredTokenDecimals(guildId, tokenTicker);
          if (storedDecimals !== null) {
            // stats.bets and stats.earnings are already in wei (as numbers)
            const tokenBetsBN = new BigNumber(stats.bets || 0);
            const tokenEarningsBN = new BigNumber(stats.earnings || 0);
            const tokenPNLBN = tokenEarningsBN.minus(tokenBetsBN);
            
            const tokenBetsHuman = tokenBetsBN.dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const tokenEarningsHuman = tokenEarningsBN.dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            const tokenPNLHuman = tokenPNLBN.dividedBy(new BigNumber(10).pow(storedDecimals)).toFixed(2);
            
            const pnlEmoji = tokenPNLBN.isGreaterThanOrEqualTo(0) ? '🟢' : '🔴';
            const pnlSign = tokenPNLBN.isGreaterThanOrEqualTo(0) ? '+' : '';
            pnlTokens.push(`${pnlEmoji} ${pnlSign}${tokenPNLHuman} ${tokenTicker}`);
          } else {
            console.log(`[LEADERBOARD-FILTERED] Missing decimals for token ${tokenTicker}, skipping PNL calculation`);
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
      const projects = await getProjects(guildId);
      for (const project of Object.values(projects)) {
        if (project.supportedTokens) {
          project.supportedTokens.forEach(token => allTokens.add(token));
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
  } else if (commandName === 'check-balance-esdt') {
    try {
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      console.log(`[CHECK-BALANCE DEBUG] Guild ID: ${guildId}, User ID: ${userId}`);
      
      // Update username for this user
      await virtualAccounts.updateUserUsername(guildId, userId, interaction.user.tag);
      
      // Get user's virtual account balances
      const balances = await virtualAccounts.getAllUserBalances(guildId, userId);
      
      console.log(`[CHECK-BALANCE DEBUG] Retrieved balances:`, balances);
      
      if (Object.keys(balances).length === 0) {
        // Get Community Fund wallet address
        let communityFundAddress = null;
        try {
          const projects = await getProjects(guildId);
          const communityFundProjectName = getCommunityFundProjectName();
          const communityFundProject = projects[communityFundProjectName];
          
          if (communityFundProject && communityFundProject.walletAddress) {
            communityFundAddress = communityFundProject.walletAddress;
          }
        } catch (error) {
          console.error(`[CHECK-BALANCE-ESDT] Error getting Community Fund address:`, error.message);
        }
        
        const embed = new EmbedBuilder()
          .setTitle('💰 Virtual Account Balance')
          .setDescription('You have no tokens in your virtual account yet.')
          .addFields([
            { name: '💡 How to get started', value: 'Make a transfer to the Community Fund wallet address below to top up your virtual account!', inline: false }
          ])
          .setColor('#FF9900')
          .setThumbnail('https://i.ibb.co/bTmZbDK/Crypto-Wallet-Logo.png')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        // Add Community Fund address if available
        if (communityFundAddress) {
          embed.addFields([
            { name: '💰 Community Fund Deposit Address', value: `\`${communityFundAddress}\``, inline: false }
          ]);
        } else {
          embed.addFields([
            { name: '⚠️ Note', value: 'Community Fund address not configured. Please contact an administrator.', inline: false }
          ]);
        }
        
        // Add debug info
        embed.addFields([
          { name: '🔍 Debug Info', value: `Guild ID: ${guildId}\nUser ID: ${userId}`, inline: false }
        ]);
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      
      // Get token metadata to map tickers to identifiers
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      
      // Create a map of ticker -> identifier and identifier -> ticker
      const tickerToIdentifier = {};
      const identifierToTicker = {};
      for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
        tickerToIdentifier[metadata.ticker] = identifier;
        identifierToTicker[identifier] = metadata.ticker;
      }
      
      // Merge duplicate balances (ticker + identifier for same token)
      const mergedBalances = {};
      const processedIdentifiers = new Set();
      
      for (const [tokenKey, balance] of Object.entries(balances)) {
        // Sanitize balance
        let balanceValue = balance;
        if (balance === null || balance === undefined || balance === 'null' || balance === 'undefined' || balance === 'NaN') {
          balanceValue = '0';
        } else {
          const balanceBN = new BigNumber(balance);
          if (balanceBN.isNaN()) {
            balanceValue = '0';
          } else {
            balanceValue = balance.toString();
          }
        }
        
        // Determine the canonical identifier for this token
        let canonicalIdentifier = tokenKey;
        
        if (tokenKey.includes('-')) {
          // Already an identifier
          canonicalIdentifier = tokenKey;
        } else {
          // It's a ticker, try to find the identifier
          canonicalIdentifier = tickerToIdentifier[tokenKey] || tokenKey;
        }
        
        // If we've already processed this identifier, merge the balances
        if (mergedBalances[canonicalIdentifier]) {
          const existingBalance = new BigNumber(mergedBalances[canonicalIdentifier]);
          const newBalance = existingBalance.plus(new BigNumber(balanceValue));
          mergedBalances[canonicalIdentifier] = newBalance.toString();
        } else {
          mergedBalances[canonicalIdentifier] = balanceValue;
        }
        
        processedIdentifiers.add(canonicalIdentifier);
      }
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Virtual Account Balance')
        .setDescription(`Balance for ${interaction.user.tag}`)
        .setColor('#00FF00')
        .setThumbnail('https://i.ibb.co/bTmZbDK/Crypto-Wallet-Logo.png')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Sort merged balances by token identifier for consistent display
      const sortedBalances = Object.entries(mergedBalances).sort((a, b) => {
        return a[0].localeCompare(b[0]);
      });
      
      // Fetch token prices and calculate USD values
      const tokenPrices = {};
      let totalUsdValue = new BigNumber(0);
      
      // Fetch prices for all tokens in parallel
      const pricePromises = sortedBalances.map(async ([tokenIdentifier, balance]) => {
        if (new BigNumber(balance).isZero()) {
          return { tokenIdentifier, price: 0 };
        }
        
        try {
          const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            return { tokenIdentifier, price: priceData.price || 0 };
          }
        } catch (error) {
          console.error(`[CHECK-BALANCE] Error fetching price for ${tokenIdentifier}:`, error.message);
        }
        return { tokenIdentifier, price: 0 };
      });
      
      const priceResults = await Promise.all(pricePromises);
      priceResults.forEach(({ tokenIdentifier, price }) => {
        tokenPrices[tokenIdentifier] = price;
      });
      
      // Add balance fields with USD values
      for (const [tokenIdentifier, balance] of sortedBalances) {
        // Skip zero balances
        if (new BigNumber(balance).isZero()) {
          continue;
        }
        
        const tokenPrice = tokenPrices[tokenIdentifier] || 0;
        const balanceBN = new BigNumber(balance);
        const usdValue = balanceBN.multipliedBy(tokenPrice);
        totalUsdValue = totalUsdValue.plus(usdValue);
        
        const usdDisplay = tokenPrice > 0 
          ? `\n**USD Value:** $${usdValue.toFixed(2)}`
          : '';
        
        embed.addFields({
          name: `${tokenIdentifier}`,
          value: `**${balance}** tokens${usdDisplay}`,
          inline: true
        });
      }
      
      // Add total USD value if we have any prices
      if (totalUsdValue.isGreaterThan(0)) {
        embed.addFields({
          name: '💵 Total Portfolio Value',
          value: `**$${totalUsdValue.toFixed(2)} USD**`,
          inline: false
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
      console.error('Error in check-balance-esdt command:', error.message);
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
      const transactions = await virtualAccounts.getUserTransactionHistory(guildId, userId, limit);
      
      if (!transactions || transactions.length === 0) {
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
  } else if (commandName === 'check-balance-nft') {
    try {
      const collection = interaction.options.getString('collection');
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Get user's NFT balances
      const nftBalances = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, collection || null);
      
      if (!nftBalances || nftBalances.length === 0) {
        // Get Community Fund wallet address
        let communityFundAddress = null;
        try {
          const projects = await getProjects(guildId);
          const communityFundProjectName = getCommunityFundProjectName();
          const communityFundProject = projects[communityFundProjectName];
          
          if (communityFundProject && communityFundProject.walletAddress) {
            communityFundAddress = communityFundProject.walletAddress;
          }
        } catch (error) {
          console.error(`[CHECK-BALANCE-NFT] Error getting Community Fund address:`, error.message);
        }
        
        const embed = new EmbedBuilder()
          .setTitle('🖼️ NFT Virtual Account Balance')
          .setDescription(collection 
            ? `You have no NFTs in collection "${collection}" yet.`
            : 'You have no NFTs in your virtual account yet.')
          .addFields([
            { name: '💡 How to get started', value: 'Send NFTs to the Community Fund wallet address below to add them to your virtual account!', inline: false }
          ])
          .setColor('#FF9900')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        // Add Community Fund address if available
        if (communityFundAddress) {
          embed.addFields([
            { name: '💰 Community Fund Deposit Address', value: `\`${communityFundAddress}\``, inline: false }
          ]);
        } else {
          embed.addFields([
            { name: '⚠️ Note', value: 'Community Fund address not configured. Please contact an administrator.', inline: false }
          ]);
        }
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      
      // Group NFTs by collection
      const collectionsMap = {};
      for (const nft of nftBalances) {
        const coll = nft.collection;
        if (!collectionsMap[coll]) {
          collectionsMap[coll] = [];
        }
        collectionsMap[coll].push(nft);
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🖼️ NFT Virtual Account Balance')
        .setDescription(`NFTs owned by ${interaction.user.tag}`)
        .setColor('#00FF00')
        .setThumbnail('https://i.ibb.co/FkZdFMPz/NFT-Wallet-Logo.png')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Add fields for each collection
      const collections = Object.keys(collectionsMap).sort();
      let fieldCount = 0;
      let totalNFTs = 0;
      let totalSFTs = 0;
      
      for (const coll of collections) {
        if (fieldCount >= 25) break; // Discord embed limit
        
        const nfts = collectionsMap[coll];
        const nftDisplayList = nfts.map(nft => {
          const amount = nft.amount || 1;
          const tokenType = nft.token_type || (amount > 1 ? 'SFT' : 'NFT');
          const nftName = nft.nft_name || `${coll}#${nft.nonce}`;
          if (tokenType === 'SFT') {
            totalSFTs += amount;
            return `${nftName} (${amount}x SFT)`;
          } else {
            totalNFTs += 1;
            return nftName;
          }
        }).slice(0, 10);
        const remainingCount = nfts.length > 10 ? `\n... and ${nfts.length - 10} more` : '';
        
        let fieldValue = `**Count:** ${nfts.length}\n**NFTs/SFTs:**\n${nftDisplayList.join('\n')}${remainingCount}`;
        
        embed.addFields({
          name: `📦 ${coll}`,
          value: fieldValue,
          inline: false
        });
        
        fieldCount++;
      }
      
      // Add total count
      const totalItems = nftBalances.length;
      const summaryText = totalSFTs > 0 
        ? `**Total Items:** ${totalItems}\n**NFTs:** ${totalNFTs}\n**SFTs:** ${totalSFTs} (total quantity)\n**Collections:** ${collections.length}`
        : `**Total NFTs:** ${totalItems}\n**Collections:** ${collections.length}`;
      
      embed.addFields({
        name: '📊 Summary',
        value: summaryText,
        inline: false
      });
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in check-balance-nft command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'balance-history-nft') {
    try {
      const collection = interaction.options.getString('collection');
      const limit = Math.min(interaction.options.getInteger('limit') || 10, 50);
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Get user's NFT transaction history
      const transactions = await virtualAccountsNFT.getNFTTransactionHistory(guildId, userId, collection || null, limit);
      
      if (!transactions || transactions.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('📊 NFT Transaction History')
          .setDescription(collection 
            ? `No NFT transactions found for collection "${collection}".`
            : 'No NFT transactions found for your account.')
          .setColor('#FF9900')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📊 NFT Transaction History')
        .setDescription(`Last ${transactions.length} NFT transactions for ${interaction.user.tag}`)
        .setColor('#0099FF')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      for (const tx of transactions) {
        const emoji = tx.type === 'deposit' ? '💰' : 
                     tx.type === 'transfer_in' || tx.type === 'purchase' ? '✅' :
                     tx.type === 'transfer_out' || tx.type === 'sale' ? '📤' :
                     tx.type === 'offer' ? '💼' : '🔄';
        
        const timestamp = `<t:${Math.floor(tx.timestamp / 1000)}:R>`;
        const nftDisplay = tx.nftName || `${tx.collection}#${tx.nonce}`;
        
        let value = `**NFT:** ${nftDisplay}\n**Collection:** ${tx.collection}\n**Type:** ${tx.type}`;
        
        if (tx.priceAmount && tx.priceTokenIdentifier) {
          value += `\n**Price:** ${tx.priceAmount} ${tx.priceTokenIdentifier}`;
        }
        
        if (tx.fromUserId || tx.toUserId) {
          const otherParty = tx.fromUserId ? `from <@${tx.fromUserId}>` : `to <@${tx.toUserId}>`;
          value += `\n**${tx.fromUserId ? 'From' : 'To'}:** ${otherParty}`;
        }
        
        value += `\n**Time:** ${timestamp}`;
        
        embed.addFields({
          name: `${emoji} ${tx.description || tx.type}`,
          value: value,
          inline: false
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in balance-history-nft command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'show-my-nft') {
    try {
      const collection = interaction.options.getString('collection');
      const nftName = interaction.options.getString('nft-name');
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? [] : [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Get user's NFTs in the collection
      const userNFTs = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, collection);
      
      if (!userNFTs || userNFTs.length === 0) {
        await interaction.editReply({ 
          content: `❌ **NFT not found!**\n\nYou don't own any NFTs in collection "${collection}" in your virtual account.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Find the specific NFT by name
      const nft = userNFTs.find(n => 
        (n.nft_name && n.nft_name.toLowerCase() === nftName.toLowerCase()) ||
        `${collection}#${n.nonce}` === nftName ||
        (n.nft_name && `${collection}#${n.nonce}`.toLowerCase() === nftName.toLowerCase())
      );
      
      if (!nft) {
        await interaction.editReply({ 
          content: `❌ **NFT not found!**\n\nNFT "${nftName}" not found in your collection "${collection}".`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Fetch full NFT details from MultiversX API
      let nftDetails = null;
      let nftImageUrl = nft.nft_image_url;
      let attributes = [];
      let metadata = nft.metadata || {};
      
      // Helper function to convert IPFS URL to HTTP gateway URL
      const convertIPFSToGateway = (ipfsUrl) => {
        if (!ipfsUrl) return ipfsUrl;
        if (ipfsUrl.startsWith('ipfs://')) {
          const ipfsHash = ipfsUrl.replace('ipfs://', '');
          return `https://ipfs.io/ipfs/${ipfsHash}`;
        }
        return ipfsUrl;
      };
      
      // Convert stored image URL if it's IPFS
      if (nftImageUrl && nftImageUrl.startsWith('ipfs://')) {
        nftImageUrl = convertIPFSToGateway(nftImageUrl);
      }
      
      try {
        await interaction.editReply({ content: '🔄 Fetching NFT details from MultiversX...', flags: [MessageFlags.Ephemeral] });
        
        const nftUrl = `https://api.multiversx.com/nfts/${nft.identifier}`;
        const nftResponse = await fetch(nftUrl);
        
        if (nftResponse.ok) {
          nftDetails = await nftResponse.json();
          
          // Decode URIs array to get IPFS URLs (standard MultiversX format)
          let ipfsImageUrl = null;
          let ipfsJsonUrl = null;
          if (nftDetails.uris && Array.isArray(nftDetails.uris) && nftDetails.uris.length > 0) {
            for (const uri of nftDetails.uris) {
              try {
                const decodedUri = Buffer.from(uri, 'base64').toString('utf-8');
                console.log(`[SHOW-NFT] Decoded URI: ${decodedUri}`);
                
                if (decodedUri.includes('.png') || decodedUri.includes('.jpg') || decodedUri.includes('.jpeg') || decodedUri.includes('.gif') || decodedUri.includes('.webp')) {
                  ipfsImageUrl = decodedUri;
                } else if (decodedUri.includes('.json')) {
                  ipfsJsonUrl = decodedUri;
                }
              } catch (uriError) {
                console.log(`[SHOW-NFT] Could not decode URI: ${uriError.message}`);
              }
            }
          }
          
          // Update image URL if available from API - check multiple sources
          if (nftDetails.url && !nftDetails.url.includes('default.png')) {
            nftImageUrl = convertIPFSToGateway(nftDetails.url);
          } else if (ipfsImageUrl) {
            nftImageUrl = convertIPFSToGateway(ipfsImageUrl);
            console.log(`[SHOW-NFT] Using image from decoded URIs: ${nftImageUrl}`);
          } else if (nftDetails.media && nftDetails.media.length > 0) {
            const mediaUrl = nftDetails.media[0].url || nftDetails.media[0].thumbnailUrl;
            if (mediaUrl && !mediaUrl.includes('default.png')) {
              nftImageUrl = convertIPFSToGateway(mediaUrl);
            }
          }
          
          // Also check for image in metadata
          if (!nftImageUrl && nftDetails.metadata) {
            try {
              if (typeof nftDetails.metadata === 'string') {
                const decoded = Buffer.from(nftDetails.metadata, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.image) {
                  nftImageUrl = convertIPFSToGateway(parsed.image);
                }
              } else if (typeof nftDetails.metadata === 'object' && nftDetails.metadata.image) {
                nftImageUrl = convertIPFSToGateway(nftDetails.metadata.image);
              }
            } catch (metaError) {
              // Ignore metadata parsing errors for image
            }
          }
          
          // Decode attributes field to extract metadata URI (MultiversX standard format)
          if (nftDetails.attributes && typeof nftDetails.attributes === 'string') {
            try {
              const decodedAttributes = Buffer.from(nftDetails.attributes, 'base64').toString('utf-8');
              console.log(`[SHOW-NFT] Decoded attributes field: ${decodedAttributes}`);
              
              // Parse format: "tags:...;metadata:..."
              const metadataMatch = decodedAttributes.match(/metadata:([^\s;]+)/);
              if (metadataMatch && metadataMatch[1]) {
                let metadataPath = metadataMatch[1];
                // If it's just a path, construct full IPFS URL
                if (!metadataPath.startsWith('http') && !metadataPath.startsWith('ipfs://')) {
                  // Extract IPFS hash from other URIs or use the path directly
                  if (ipfsJsonUrl) {
                    // Use the decoded JSON URI we already found
                    console.log(`[SHOW-NFT] Using JSON URI from uris array: ${ipfsJsonUrl}`);
                  } else {
                    // Try to construct from hash if available
                    if (nftDetails.hash) {
                      try {
                        const hashDecoded = Buffer.from(nftDetails.hash, 'base64').toString('utf-8');
                        metadataPath = `ipfs://${hashDecoded}/${metadataPath}`;
                        console.log(`[SHOW-NFT] Constructed metadata path: ${metadataPath}`);
                      } catch (hashError) {
                        console.log(`[SHOW-NFT] Could not decode hash: ${hashError.message}`);
                      }
                    }
                  }
                } else {
                  metadataPath = metadataMatch[1];
                }
                
                // Use the JSON URL from uris if we have it, otherwise use the constructed path
                const jsonUrlToFetch = ipfsJsonUrl || (metadataPath.startsWith('ipfs://') ? metadataPath : `ipfs://${metadataPath}`);
                console.log(`[SHOW-NFT] Will fetch metadata from: ${jsonUrlToFetch}`);
                
                // Helper function to fetch JSON and extract attributes
                const fetchJsonMetadata = async (url) => {
                  if (url.startsWith('ipfs://')) {
                    const ipfsHash = url.replace('ipfs://', '');
                    const ipfsGateways = [
                      `https://ipfs.io/ipfs/${ipfsHash}`,
                      `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
                      `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
                      `https://dweb.link/ipfs/${ipfsHash}`
                    ];
                    
                    // Try each gateway until one works
                    for (const gateway of ipfsGateways) {
                      let timeoutId = null;
                      try {
                        console.log(`[SHOW-NFT] Attempting to fetch JSON metadata from ${gateway}`);
                        const controller = new AbortController();
                        timeoutId = setTimeout(() => controller.abort(), 5000);
                        const ipfsResponse = await fetch(gateway, { 
                          signal: controller.signal
                        });
                        if (timeoutId) clearTimeout(timeoutId);
                        
                        if (ipfsResponse.ok) {
                          const ipfsData = await ipfsResponse.json();
                          console.log(`[SHOW-NFT] Successfully fetched JSON metadata from ${gateway}`);
                          
                          // Extract attributes from IPFS JSON metadata
                          if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                            attributes = ipfsData.attributes;
                            console.log(`[SHOW-NFT] Found ${attributes.length} attributes from IPFS JSON metadata`);
                            
                            // Also update image URL if found in IPFS JSON metadata
                            if (ipfsData.image && !nftImageUrl) {
                              nftImageUrl = convertIPFSToGateway(ipfsData.image);
                              console.log(`[SHOW-NFT] Updated image URL from IPFS JSON metadata: ${nftImageUrl}`);
                            }
                            return true; // Success
                          } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                            attributes = ipfsData.traits;
                            console.log(`[SHOW-NFT] Found ${attributes.length} traits from IPFS JSON metadata`);
                            
                            // Also update image URL if found in IPFS JSON metadata
                            if (ipfsData.image && !nftImageUrl) {
                              nftImageUrl = convertIPFSToGateway(ipfsData.image);
                              console.log(`[SHOW-NFT] Updated image URL from IPFS JSON metadata: ${nftImageUrl}`);
                            }
                            return true; // Success
                          }
                        }
                      } catch (ipfsError) {
                        if (timeoutId) clearTimeout(timeoutId);
                        console.log(`[SHOW-NFT] Failed to fetch JSON from ${gateway}:`, ipfsError.message);
                        continue;
                      }
                    }
                  } else if (url.startsWith('http')) {
                    // Direct HTTP URL
                    try {
                      console.log(`[SHOW-NFT] Fetching JSON metadata from direct URL: ${url}`);
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 5000);
                      const jsonResponse = await fetch(url, { 
                        signal: controller.signal
                      });
                      clearTimeout(timeoutId);
                      
                      if (jsonResponse.ok) {
                        const jsonData = await jsonResponse.json();
                        if (jsonData.attributes && Array.isArray(jsonData.attributes)) {
                          attributes = jsonData.attributes;
                          console.log(`[SHOW-NFT] Found ${attributes.length} attributes from direct JSON URL`);
                          
                          // Also update image URL if found
                          if (jsonData.image && !nftImageUrl) {
                            nftImageUrl = convertIPFSToGateway(jsonData.image);
                            console.log(`[SHOW-NFT] Updated image URL from JSON metadata: ${nftImageUrl}`);
                          }
                          return true; // Success
                        } else if (jsonData.traits && Array.isArray(jsonData.traits)) {
                          attributes = jsonData.traits;
                          console.log(`[SHOW-NFT] Found ${attributes.length} traits from direct JSON URL`);
                          
                          // Also update image URL if found
                          if (jsonData.image && !nftImageUrl) {
                            nftImageUrl = convertIPFSToGateway(jsonData.image);
                            console.log(`[SHOW-NFT] Updated image URL from JSON metadata: ${nftImageUrl}`);
                          }
                          return true; // Success
                        }
                      }
                    } catch (jsonError) {
                      console.log(`[SHOW-NFT] Failed to fetch from direct URL: ${jsonError.message}`);
                    }
                  }
                  return false; // Failed
                };
                
                // Try fetching from the JSON URL
                await fetchJsonMetadata(jsonUrlToFetch);
              }
            } catch (attrError) {
              console.log(`[SHOW-NFT] Could not decode attributes field: ${attrError.message}`);
            }
          }
          
          // If we still don't have attributes and we have a JSON URL from uris, try fetching it directly
          if (attributes.length === 0 && ipfsJsonUrl) {
            console.log(`[SHOW-NFT] Attempting to fetch attributes from uris JSON URL: ${ipfsJsonUrl}`);
            const fetchJsonMetadata = async (url) => {
              if (url.startsWith('ipfs://')) {
                const ipfsHash = url.replace('ipfs://', '');
                const ipfsGateways = [
                  `https://ipfs.io/ipfs/${ipfsHash}`,
                  `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
                  `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
                  `https://dweb.link/ipfs/${ipfsHash}`
                ];
                
                for (const gateway of ipfsGateways) {
                  let timeoutId = null;
                  try {
                    console.log(`[SHOW-NFT] Attempting to fetch JSON metadata from ${gateway}`);
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 5000);
                    const ipfsResponse = await fetch(gateway, { 
                      signal: controller.signal
                    });
                    if (timeoutId) clearTimeout(timeoutId);
                    
                    if (ipfsResponse.ok) {
                      const ipfsData = await ipfsResponse.json();
                      if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                        attributes = ipfsData.attributes;
                        console.log(`[SHOW-NFT] Found ${attributes.length} attributes from uris JSON URL`);
                        if (ipfsData.image && !nftImageUrl) {
                          nftImageUrl = convertIPFSToGateway(ipfsData.image);
                        }
                        return true;
                      } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                        attributes = ipfsData.traits;
                        console.log(`[SHOW-NFT] Found ${attributes.length} traits from uris JSON URL`);
                        if (ipfsData.image && !nftImageUrl) {
                          nftImageUrl = convertIPFSToGateway(ipfsData.image);
                        }
                        return true;
                      }
                    }
                  } catch (ipfsError) {
                    if (timeoutId) clearTimeout(timeoutId);
                    continue;
                  }
                }
              } else if (url.startsWith('http')) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000);
                  const jsonResponse = await fetch(url, { 
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);
                  
                  if (jsonResponse.ok) {
                    const jsonData = await jsonResponse.json();
                    if (jsonData.attributes && Array.isArray(jsonData.attributes)) {
                      attributes = jsonData.attributes;
                      console.log(`[SHOW-NFT] Found ${attributes.length} attributes from uris JSON URL`);
                      if (jsonData.image && !nftImageUrl) {
                        nftImageUrl = convertIPFSToGateway(jsonData.image);
                      }
                      return true;
                    } else if (jsonData.traits && Array.isArray(jsonData.traits)) {
                      attributes = jsonData.traits;
                      console.log(`[SHOW-NFT] Found ${attributes.length} traits from uris JSON URL`);
                      if (jsonData.image && !nftImageUrl) {
                        nftImageUrl = convertIPFSToGateway(jsonData.image);
                      }
                      return true;
                    }
                  }
                } catch (jsonError) {
                  console.log(`[SHOW-NFT] Failed to fetch from uris JSON URL: ${jsonError.message}`);
                }
              }
              return false;
            };
            await fetchJsonMetadata(ipfsJsonUrl);
          }
          
          // Extract attributes - check multiple possible locations
          if (nftDetails.attributes && Array.isArray(nftDetails.attributes) && nftDetails.attributes.length > 0) {
            attributes = nftDetails.attributes;
            console.log(`[SHOW-NFT] Found ${attributes.length} attributes from nftDetails.attributes for ${nft.identifier}`);
          } else if (nftDetails.metadata) {
            // Check if metadata is an object with attributes
            if (typeof nftDetails.metadata === 'object' && !Array.isArray(nftDetails.metadata)) {
              if (nftDetails.metadata.attributes && Array.isArray(nftDetails.metadata.attributes)) {
                attributes = nftDetails.metadata.attributes;
                console.log(`[SHOW-NFT] Found ${attributes.length} attributes from metadata.attributes for ${nft.identifier}`);
              }
            } else if (typeof nftDetails.metadata === 'string') {
              // Try to decode base64 metadata if present
              try {
                const decoded = Buffer.from(nftDetails.metadata, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                
                // Check if it contains an IPFS URL for metadata
                if (parsed.metadataUri || parsed.metadata_url || parsed.uri) {
                  const ipfsUrl = parsed.metadataUri || parsed.metadata_url || parsed.uri;
                  console.log(`[SHOW-NFT] Found IPFS metadata URL in decoded metadata: ${ipfsUrl}`);
                  
                  // Try to fetch from IPFS
                  if (ipfsUrl.startsWith('ipfs://')) {
                    const ipfsHash = ipfsUrl.replace('ipfs://', '');
                    const ipfsGateways = [
                      `https://ipfs.io/ipfs/${ipfsHash}`,
                      `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
                      `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
                      `https://dweb.link/ipfs/${ipfsHash}`
                    ];
                    
                    // Try each gateway until one works
                    for (const gateway of ipfsGateways) {
                      let timeoutId = null;
                      try {
                        console.log(`[SHOW-NFT] Attempting to fetch metadata from ${gateway}`);
                        const controller = new AbortController();
                        timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                        const ipfsResponse = await fetch(gateway, { 
                          signal: controller.signal
                        });
                        if (timeoutId) clearTimeout(timeoutId);
                        
                        if (ipfsResponse.ok) {
                          const ipfsData = await ipfsResponse.json();
                          console.log(`[SHOW-NFT] Successfully fetched IPFS metadata from ${gateway}`);
                          
                          // Extract attributes from IPFS metadata
                          if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                            attributes = ipfsData.attributes;
                            console.log(`[SHOW-NFT] Found ${attributes.length} attributes from IPFS metadata`);
                            break;
                          } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                            // Some NFTs use "traits" instead of "attributes"
                            attributes = ipfsData.traits;
                            console.log(`[SHOW-NFT] Found ${attributes.length} traits from IPFS metadata`);
                            break;
                          }
                          
                          // Also update image URL if found in IPFS metadata (prefer IPFS metadata image)
                          if (ipfsData.image) {
                            nftImageUrl = convertIPFSToGateway(ipfsData.image);
                            console.log(`[SHOW-NFT] Updated image URL from IPFS metadata: ${nftImageUrl}`);
                          }
                        }
                      } catch (ipfsError) {
                        if (timeoutId) clearTimeout(timeoutId);
                        console.log(`[SHOW-NFT] Failed to fetch from ${gateway}:`, ipfsError.message);
                        continue; // Try next gateway
                      }
                    }
                  }
                }
                
                // Also check if attributes are directly in the decoded JSON
                if (attributes.length === 0 && parsed.attributes && Array.isArray(parsed.attributes)) {
                  attributes = parsed.attributes;
                  console.log(`[SHOW-NFT] Found ${attributes.length} attributes from decoded base64 metadata for ${nft.identifier}`);
                } else if (attributes.length === 0 && parsed.traits && Array.isArray(parsed.traits)) {
                  attributes = parsed.traits;
                  console.log(`[SHOW-NFT] Found ${attributes.length} traits from decoded base64 metadata for ${nft.identifier}`);
                }
              } catch (decodeError) {
                console.log(`[SHOW-NFT] Could not decode base64 metadata for ${nft.identifier}:`, decodeError.message);
              }
            }
          }
          
          // Fallback to stored metadata
          if (attributes.length === 0 && metadata.attributes && Array.isArray(metadata.attributes) && metadata.attributes.length > 0) {
            attributes = metadata.attributes;
            console.log(`[SHOW-NFT] Found ${attributes.length} attributes from stored metadata for ${nft.identifier}`);
          }
          
          // Log for debugging if no attributes found
          if (attributes.length === 0) {
            console.log(`[SHOW-NFT] No attributes found for ${nft.identifier}. API response keys:`, Object.keys(nftDetails));
            if (nftDetails.metadata) {
              console.log(`[SHOW-NFT] Metadata type:`, typeof nftDetails.metadata, 'Is array:', Array.isArray(nftDetails.metadata));
              if (typeof nftDetails.metadata === 'object') {
                console.log(`[SHOW-NFT] Metadata keys:`, Object.keys(nftDetails.metadata));
              }
            }
          }
          
          // Merge metadata
          metadata = {
            ...metadata,
            collection: nftDetails.collection || collection,
            ticker: nftDetails.ticker || null,
            owner: nftDetails.owner || null,
            supply: nftDetails.supply || null,
            decimals: nftDetails.decimals || null
          };
        }
      } catch (fetchError) {
        console.error(`[SHOW-NFT] Error fetching NFT details for ${nft.identifier}:`, fetchError.message);
        // Continue with stored metadata if API fetch fails
        if (metadata.attributes && Array.isArray(metadata.attributes)) {
          attributes = metadata.attributes;
        }
      }
      
      // Create beautiful embed
      const nftDisplayName = nft.nft_name || `${collection}#${nft.nonce}`;
      const amount = nft.amount || 1;
      // Use token_type from database for reliable detection (bulletproof)
      const tokenType = nft.token_type || (amount > 1 ? 'SFT' : 'NFT');
      const amountText = amount > 1 ? ` (${amount}x)` : '';
      const explorerUrl = `https://explorer.multiversx.com/nfts/${nft.identifier}/transactions`;
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${nftDisplayName}${amountText}`)
        .setDescription(`**Type:** ${tokenType}\n**Collection:** ${collection}\n**Identifier:** [${nft.identifier}](${explorerUrl})\n**Nonce:** ${nft.nonce}`)
        .setColor(0x00FF00)
        .setTimestamp()
        .setFooter({ text: `Owned by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });
      
      // Set image/thumbnail
      if (nftImageUrl) {
        embed.setImage(nftImageUrl);
      } else {
        embed.setThumbnail('https://i.ibb.co/FkZdFMPz/NFT-Wallet-Logo.png');
      }
      
      // Add supply if available
      if (metadata.supply) {
        embed.addFields({
          name: '📊 Supply',
          value: metadata.supply.toString(),
          inline: true
        });
      }
      
      // Add section separator before attributes
      if (attributes && attributes.length > 0) {
        embed.addFields({
          name: '━━━━━━━━━━━━━━━━━━━━',
          value: '**Attributes & Traits**',
          inline: false
        });
      }
      
      // Add attributes section
      if (attributes && attributes.length > 0) {
        // Group attributes by trait type for better display
        const attributesByType = {};
        for (const attr of attributes) {
          // Handle different attribute formats
          let traitType = 'Other';
          let value = '';
          
          if (typeof attr === 'string') {
            // If attribute is a string, try to parse it
            try {
              const parsed = JSON.parse(attr);
              traitType = parsed.trait_type || parsed.name || parsed.key || 'Other';
              value = parsed.value || parsed.val || attr;
            } catch {
              traitType = 'Other';
              value = attr;
            }
          } else if (typeof attr === 'object') {
            traitType = attr.trait_type || attr.name || attr.key || attr.type || 'Other';
            value = attr.value || attr.val || attr.toString();
          } else {
            value = String(attr);
          }
          
          if (!attributesByType[traitType]) {
            attributesByType[traitType] = [];
          }
          attributesByType[traitType].push({ value, rarity: attr.rarity || attr.rarityPercent || null });
        }
        
        // Add attributes as fields (Discord limit: 25 fields, 1024 chars per field)
        let attributeFieldsAdded = 0;
        for (const [traitType, attrs] of Object.entries(attributesByType)) {
          if (attributeFieldsAdded >= 20) break; // Leave room for other fields
          
          const attrValues = attrs.map(attr => {
            const displayValue = attr.value || 'N/A';
            const rarity = attr.rarity ? ` (${attr.rarity}%)` : '';
            return `• **${displayValue}**${rarity}`;
          }).join('\n');
          
          // Truncate if too long
          const fieldValue = attrValues.length > 1024 
            ? attrValues.substring(0, 1021) + '...'
            : attrValues;
          
          embed.addFields({
            name: traitType,
            value: fieldValue || 'N/A',
            inline: true
          });
          
          attributeFieldsAdded++;
        }
        
        // If we have more attributes, add a summary
        if (attributes.length > attributeFieldsAdded * 3) {
          embed.addFields({
            name: '📋 Attributes Summary',
            value: `**Total Attributes:** ${attributes.length}\n**Trait Types:** ${Object.keys(attributesByType).length}`,
            inline: false
          });
        }
      } else {
        embed.addFields({
          name: '━━━━━━━━━━━━━━━━━━━━',
          value: '**Attributes & Traits**\nNo attributes available for this NFT',
          inline: false
        });
      }
      
      // Add ownership section separator
      embed.addFields({
        name: '━━━━━━━━━━━━━━━━━━━━',
        value: '**Ownership Information**',
        inline: false
      });
      
      // Add ownership info
      embed.addFields({
        name: 'Status',
        value: `**In Virtual Account**\n**Owner:** ${interaction.user.tag}\n**Added:** <t:${Math.floor(new Date(nft.created_at).getTime() / 1000)}:R>`,
        inline: false
      });
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in show-my-nft command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'sell-nft') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const collection = interaction.options.getString('collection');
      const nftName = interaction.options.getString('nft-name');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description') || '';
      const priceTokenTicker = interaction.options.getString('price-token');
      const priceAmount = interaction.options.getString('price-amount');
      const listingType = interaction.options.getString('listing-type') || 'fixed_price';
      const expiresInHours = interaction.options.getNumber('expires-in');
      const amountOption = interaction.options.getNumber('amount');
      const amount = amountOption && amountOption > 0 ? amountOption : 1;
      
      // Validate amount
      if (amount <= 0 || !Number.isInteger(amount)) {
        await interaction.editReply({ 
          content: `❌ **Invalid amount!**\n\nAmount must be a positive integer.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Validate user owns the NFT/SFT
      const userNFTs = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, collection);
      
      if (!userNFTs || userNFTs.length === 0) {
        await interaction.editReply({ 
          content: `❌ You don't own any NFTs in collection "${collection}".`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Find the specific NFT by name
      const nft = userNFTs.find(n => 
        (n.nft_name && n.nft_name.toLowerCase() === nftName.toLowerCase()) ||
        `${collection}#${n.nonce}` === nftName
      );
      
      if (!nft) {
        await interaction.editReply({ 
          content: `❌ NFT "${nftName}" not found in your collection "${collection}".`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Verify NFT/SFT still exists in user's balance and check sufficient amount
      const verifyNFT = await virtualAccountsNFT.getUserNFTBalance(guildId, userId, collection, nft.nonce);
      if (!verifyNFT) {
        await interaction.editReply({ 
          content: `❌ NFT "${nftName}" is no longer in your balance. It may have been transferred.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // CRITICAL: Calculate available balance (total - active auctions - active listings)
      const totalBalance = verifyNFT.amount || 1;
      
      // Get active auctions for this NFT (collection + nonce) by this user
      const dbAuctions = require('./db/auctions');
      const activeAuctions = await dbAuctions.getUserActiveAuctions(guildId, userId, collection, nft.nonce);
      const lockedInAuctions = activeAuctions.reduce((sum, auction) => sum + (auction.amount || 1), 0);
      
      // Get active listings for this NFT (collection + nonce) by this user
      const activeListings = await virtualAccountsNFT.getUserListings(guildId, userId, 'ACTIVE');
      const listingsForThisNFT = activeListings.filter(listing => 
        listing.collection === collection && listing.nonce === nft.nonce
      );
      const lockedInListings = listingsForThisNFT.reduce((sum, listing) => sum + (listing.amount || 1), 0);
      
      // Calculate available balance
      const availableBalance = totalBalance - lockedInAuctions - lockedInListings;
      
      // Check if user has sufficient available balance
      if (amount > availableBalance) {
        const balanceTokenType = verifyNFT.token_type || 'NFT';
        const lockedTotal = lockedInAuctions + lockedInListings;
        
        let errorMessage = `❌ **Insufficient available balance!**\n\n`;
        errorMessage += `**Total Balance:** ${totalBalance} ${balanceTokenType}(s)\n`;
        if (lockedInAuctions > 0) {
          errorMessage += `**Locked in Auctions:** ${lockedInAuctions} ${balanceTokenType}(s)\n`;
        }
        if (lockedInListings > 0) {
          errorMessage += `**Locked in Listings:** ${lockedInListings} ${balanceTokenType}(s)\n`;
        }
        errorMessage += `**Available:** ${availableBalance} ${balanceTokenType}(s)\n`;
        errorMessage += `**Trying to list:** ${amount} ${balanceTokenType}(s)`;
        
        await interaction.editReply({ 
          content: errorMessage, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check if this NFT is already listed for sale (informational, but we allow multiple listings if balance allows)
      // Note: We still check this to prevent duplicate listings, but the balance check above is the main validation
      if (listingsForThisNFT.length > 0) {
        await interaction.editReply({ 
          content: `❌ **NFT already listed!**\n\nThis NFT "${nftName}" (${collection}#${nft.nonce}) is already listed for sale.\n\nYou can only list each NFT once. Please cancel the existing listing first if you want to create a new one.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get Community Fund project for token validation
      const fundProject = await getCommunityFundProject(guildId);
      if (!fundProject) {
        await interaction.editReply({ 
          content: `❌ No Community Fund configured. Please ask an admin to set it up.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      const fundProjectData = projects[projectName];
      
      if (!fundProjectData) {
        await interaction.editReply({ 
          content: `❌ Community Fund project not found.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Validate token is supported by Community Fund
      // Get supported tokens from database (should be full identifiers)
      const supportedTokensRaw = fundProjectData.supportedTokens || [];
      const supportedTokens = Array.isArray(supportedTokensRaw)
        ? supportedTokensRaw
        : (supportedTokensRaw || '').split(',').map(t => t.trim()).filter(t => t.length > 0);
      
      // Compare identifiers directly (case-insensitive)
      const priceTokenIdentifier = priceTokenTicker.trim();
      const isSupported = supportedTokens.some(token => 
        token.toLowerCase() === priceTokenIdentifier.toLowerCase()
      );
      
      if (!isSupported) {
        // Display original supported tokens for error message
        const displayTokens = supportedTokens.join(', ');
        await interaction.editReply({ 
          content: `❌ Token "${priceTokenIdentifier}" is not supported by Community Fund. Supported: ${displayTokens}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Use the identifier directly (already validated)
      const tokenIdentifier = priceTokenIdentifier;
      
      // Get ticker for display purposes
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      let displayTicker = tokenIdentifier;
      for (const [id, metadata] of Object.entries(tokenMetadata)) {
        if (id.toLowerCase() === tokenIdentifier.toLowerCase()) {
          displayTicker = metadata.ticker || tokenIdentifier.split('-')[0];
          break;
        }
      }
      // Fallback: extract ticker from identifier if metadata not found
      if (displayTicker === tokenIdentifier && tokenIdentifier.includes('-')) {
        displayTicker = tokenIdentifier.split('-')[0];
      }
      
      // Validate price amount
      try {
        const priceBN = new BigNumber(priceAmount);
        if (priceBN.isLessThanOrEqualTo(0) || !priceBN.isFinite()) {
          throw new Error('Invalid price amount');
        }
      } catch (amountError) {
        await interaction.editReply({ 
          content: `❌ Invalid price amount: ${priceAmount}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Generate listing ID
      const listingId = `nft_listing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Calculate expiration
      let expiresAt = null;
      if (expiresInHours && expiresInHours > 0) {
        expiresAt = Date.now() + (expiresInHours * 60 * 60 * 1000);
      }
      
      // Fetch token price for USD valuation
      let priceUsd = 0;
      try {
        const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          const tokenPriceUsd = priceData.price || 0;
          priceUsd = new BigNumber(priceAmount).multipliedBy(tokenPriceUsd).toNumber();
        }
      } catch (error) {
        console.error('[NFT-MARKETPLACE] Error fetching token price:', error.message);
      }
      
      // Format price with USD value
      const priceDisplay = priceUsd > 0 
        ? `${priceAmount} ${displayTicker} (≈ $${priceUsd.toFixed(2)})`
        : `${priceAmount} ${displayTicker}`;
      
      // CRITICAL: Use actual token_type from balance, don't infer from amount
      // 1 SFT is still SFT, not NFT! Must use explicit token_type from database
      const nftTokenType = verifyNFT.token_type || 'NFT';
      const amountText = amount > 1 ? ` (${amount}x)` : '';
      const nftDisplayName = nft.nft_name || `${collection}#${nft.nonce}`;
      
      // Create listing embed
      const listingEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n**${nftTokenType}:** ${nftDisplayName}${amountText}\n**Collection:** ${collection}\n**Nonce:** ${nft.nonce}`)
        .addFields([
          { name: '💰 Price', value: priceDisplay, inline: true },
          { name: '📋 Listing Type', value: listingType === 'fixed_price' ? 'Fixed Price' : 'Accept Offers', inline: true },
          { name: '👤 Seller', value: `<@${userId}>`, inline: true },
          { name: '📊 Status', value: '🟢 Active', inline: true }
        ])
        .setColor(0x00FF00)
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      if (expiresAt) {
        listingEmbed.addFields([
          { name: '⏰ Expires', value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true }
        ]);
      }
      
      // Fetch NFT details from API for better image URL resolution
      let nftImageUrl = nft.nft_image_url;
      try {
        const nftApiUrl = `https://api.multiversx.com/nfts/${nft.identifier}`;
        const nftResponse = await fetch(nftApiUrl);
        if (nftResponse.ok) {
          const nftDetails = await nftResponse.json();
          nftImageUrl = await extractNFTImageUrl(nftDetails, nft.nft_image_url);
        }
      } catch (error) {
        console.error('[NFT-MARKETPLACE] Error fetching NFT details for listing:', error.message);
        // Use stored image URL as fallback
        nftImageUrl = nft.nft_image_url;
      }
      
      if (nftImageUrl) {
        listingEmbed.setThumbnail(nftImageUrl);
      }
      
      // Create buttons
      const buttons = [];
      
      // Always show Buy button - for fixed_price it's "Buy Now", for accept_offers it's "Buy at Listed Price"
      const buyButton = new ButtonBuilder()
        .setCustomId(`nft-buy:${listingId}`)
        .setLabel(listingType === 'fixed_price' ? 'Buy Now' : 'Buy at Listed Price')
        .setStyle(ButtonStyle.Success);
      buttons.push(buyButton);
      
      // Only show offer button for accept_offers listings
      if (listingType === 'accept_offers') {
        const offerButton = new ButtonBuilder()
          .setCustomId(`nft-offer:${listingId}`)
          .setLabel('Make Offer')
          .setStyle(ButtonStyle.Primary);
        buttons.push(offerButton);
      }
      
      const cancelButton = new ButtonBuilder()
        .setCustomId(`nft-listing-cancel:${listingId}`)
        .setLabel('Cancel Listing')
        .setStyle(ButtonStyle.Danger);
      buttons.push(cancelButton);
      
      const buttonRow = new ActionRowBuilder().addComponents(buttons);
      
      // Check if channel is a forum channel
      const channel = interaction.channel;
      if (!channel) {
        throw new Error('Channel not found. Please try again.');
      }
      
      const isForumChannel = channel.type === ChannelType.GuildForum;
      
      let listingMessage = null;
      let thread = null;
      let threadId = null;
      
      if (isForumChannel) {
        // For forum channels, create a forum post (which is a thread)
        try {
          thread = await channel.threads.create({
            name: `Listing: ${nft.nft_name || `${collection}#${nft.nonce}`}`,
            message: {
              embeds: [listingEmbed],
              components: [buttonRow]
            },
            autoArchiveDuration: 60
          });
          threadId = thread.id;
          // In forum channels, the first message is the thread's starter message
          try {
            listingMessage = await thread.fetchStarterMessage();
            if (!listingMessage) {
              // Fallback: get the first message from the thread
              const messages = await thread.messages.fetch({ limit: 1 });
              listingMessage = messages.first();
            }
          } catch (msgError) {
            console.error(`[NFT-LISTING] Error fetching starter message:`, msgError.message);
            // Try to get first message as fallback
            try {
              const messages = await thread.messages.fetch({ limit: 1 });
              listingMessage = messages.first();
            } catch (fallbackError) {
              console.error(`[NFT-LISTING] Error fetching fallback message:`, fallbackError.message);
            }
          }
        } catch (forumError) {
          console.error(`[NFT-LISTING] Error creating forum post:`, forumError);
          // Provide more user-friendly error message
          if (forumError.message && forumError.message.includes('Unknown interaction')) {
            throw new Error('Failed to create forum post. The interaction may have expired. Please try the command again.');
          } else if (forumError.code === 50013) {
            throw new Error('Missing permissions to create forum posts. Please check bot permissions.');
          } else {
            throw new Error(`Failed to create forum post: ${forumError.message || 'Unknown error'}`);
          }
        }
      } else {
        // For regular channels, post message and create thread
        listingMessage = await channel.send({ 
          embeds: [listingEmbed], 
          components: [buttonRow] 
        });
        
        // Create thread
        try {
          thread = await listingMessage.startThread({
            name: `Listing: ${nft.nft_name || `${collection}#${nft.nonce}`}`,
            autoArchiveDuration: 60
          });
          threadId = thread.id;
        } catch (threadError) {
          console.error(`[NFT-LISTING] Error creating thread:`, threadError.message);
        }
      }
      
      // Ensure we have a listing message
      if (!listingMessage) {
        throw new Error('Failed to create listing message. Please try again.');
      }
      
      // CRITICAL: Use actual token_type from balance, don't infer from amount
      // 1 SFT is still SFT, not NFT! Must use explicit token_type from database
      const listingTokenType = verifyNFT.token_type || 'NFT';
      await virtualAccountsNFT.createListing(guildId, listingId, {
        sellerId: userId,
        sellerTag: interaction.user.tag,
        collection: collection,
        identifier: nft.identifier,
        nonce: nft.nonce,
        amount: amount,
        tokenType: listingTokenType,
        nftName: nft.nft_name,
        nftImageUrl: nft.nft_image_url,
        title: title,
        description: description,
        priceTokenIdentifier: tokenIdentifier,
        priceAmount: priceAmount,
        listingType: listingType,
        status: 'ACTIVE',
        messageId: listingMessage.id,
        threadId: threadId,
        channelId: channel.id,
        createdAt: Date.now(),
        expiresAt: expiresAt
      });
      
      // Post initial message in thread
      if (thread) {
        await thread.send(`📢 **Listing created!**\n\nThis ${listingTokenType} is now available for purchase. Use the buttons above to buy or make an offer.`);
      }
      
      await interaction.editReply({ 
        content: `✅ **Listing created successfully!**\n\nYour ${listingTokenType} "${nftDisplayName}${amountText}" is now listed for ${priceAmount} ${displayTicker}.`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
    } catch (error) {
      console.error('Error in sell-nft command:', error.message);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        } else if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (replyError) {
        // Interaction already acknowledged/replied, just log the error
        console.error('Could not send error message to user (interaction already handled):', replyError.message);
      }
    }
  } else if (commandName === 'withdraw-nft') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const collection = interaction.options.getString('collection');
      const nftName = interaction.options.getString('nft-name');
      const amountOption = interaction.options.getNumber('amount');
      const amount = amountOption && amountOption > 0 ? amountOption : 1;
      
      // Validate amount
      if (amount <= 0 || !Number.isInteger(amount)) {
        await interaction.editReply({ 
          content: `❌ **Invalid amount!**\n\nAmount must be a positive integer.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get user's registered wallet
      const userWallet = await getUserWallet(userId, guildId);
      if (!userWallet) {
        await interaction.editReply({ 
          content: `❌ **No wallet registered!**\n\nPlease register your wallet using \`/set-wallet\` before withdrawing NFTs.`, 
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
      
      // Validate user owns the NFT/SFT
      const userNFTs = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, collection);
      
      if (!userNFTs || userNFTs.length === 0) {
        await interaction.editReply({ 
          content: `❌ You don't own any NFTs in collection "${collection}".`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Find the specific NFT by name
      const nft = userNFTs.find(n => 
        (n.nft_name && n.nft_name.toLowerCase() === nftName.toLowerCase()) ||
        `${collection}#${n.nonce}` === nftName
      );
      
      if (!nft) {
        await interaction.editReply({ 
          content: `❌ NFT "${nftName}" not found in your collection "${collection}".`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check user has sufficient amount
      const currentAmount = nft.amount || 1;
      if (amount > currentAmount) {
        // Use token_type from database for reliable detection
        const tokenType = nft.token_type || (currentAmount > 1 ? 'SFT' : 'NFT');
        await interaction.editReply({ 
          content: `❌ **Insufficient balance!**\n\nYou have ${currentAmount} ${tokenType}(s), trying to withdraw ${amount}.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get Community Fund project
      const communityFundProjectName = getCommunityFundProjectName();
      const projects = await getProjects(guildId);
      const communityFundProject = projects[communityFundProjectName];
      
      if (!communityFundProject) {
        await interaction.editReply({ 
          content: `❌ Community Fund project not configured. Please contact an administrator.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check Community Fund balances (1 transfer for NFT/SFT withdraw)
      const balanceCheck = await checkCommunityFundBalances(guildId, 1);
      if (!balanceCheck.sufficient) {
        const errorEmbed = await createBalanceErrorEmbed(guildId, balanceCheck, '/withdraw-nft');
        await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const nftDisplayName = nft.nft_name || `${collection}#${nft.nonce}`;
      // Use token_type from database for reliable detection (bulletproof)
      const tokenType = nft.token_type || (amount > 1 ? 'SFT' : 'NFT');
      const amountText = amount > 1 ? ` (${amount}x)` : '';
      
      await interaction.editReply({ 
        content: `🔄 **Processing withdrawal...**\n\n**${tokenType}:** ${nftDisplayName}${amountText}\n**Collection:** ${collection}\n**Nonce:** ${nft.nonce}\n**Recipient:** \`${userWallet}\``, 
        flags: [MessageFlags.Ephemeral] 
      });
      
      console.log(`[WITHDRAW-NFT] User ${interaction.user.tag} (${userId}) withdrawing ${tokenType} ${nftDisplayName}${amountText} (${collection}#${nft.nonce}) to ${userWallet}`);
      
      // Transfer NFT/SFT from Community Fund to user wallet (use token_type from database)
      const transferResult = await transferNFTFromCommunityFund(
        userWallet,
        collection,
        nft.nonce,
        communityFundProjectName,
        guildId,
        amount,
        tokenType
      );
      
      if (transferResult.success) {
        // Remove NFT/SFT from virtual account (handles partial removal)
        await virtualAccountsNFT.removeNFTFromAccount(guildId, userId, collection, nft.nonce, amount);
        
        // Create transaction record
        const amountTextDesc = amount > 1 ? ` (${amount}x)` : '';
        // Get token_type from balance (most reliable source)
        const balanceTokenType = nft.token_type || tokenType;
        await virtualAccountsNFT.addNFTTransaction(guildId, userId, {
          id: `withdraw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'withdraw',
          collection: collection,
          identifier: collection,
          nonce: nft.nonce,
          nft_name: nftDisplayName,
          amount: amount, // Store amount for SFTs
          token_type: balanceTokenType, // Use actual token_type from balance, not inferred from amount
          price_token_identifier: null,
          price_amount: null,
          timestamp: Date.now(),
          description: `Withdrew ${balanceTokenType} ${nftDisplayName}${amountTextDesc} to wallet ${userWallet}`,
          tx_hash: transferResult.txHash
        });
        
        const explorerUrl = transferResult.txHash
          ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
          : null;
        
        const txHashFieldValue = transferResult.txHash
          ? `[View on Explorer](${explorerUrl})`
          : 'Transaction hash not available';
        
        const successEmbed = new EmbedBuilder()
          .setTitle(`✅ ${tokenType} Withdrawal Successful!`)
          .setDescription(`Your ${tokenType} has been successfully withdrawn to your registered wallet.`)
          .addFields([
            { name: tokenType, value: `${nftDisplayName}${amountText}`, inline: true },
            { name: 'Collection', value: collection, inline: true },
            { name: 'Nonce', value: String(nft.nonce), inline: true },
            { name: 'Recipient Wallet', value: `\`${userWallet}\``, inline: false },
            { name: 'Transaction Hash', value: txHashFieldValue, inline: false }
          ])
          .setColor(0x00FF00)
          .setThumbnail(nft.nft_image_url || 'https://i.ibb.co/FkZdFMPz/NFT-Wallet-Logo.png')
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed], flags: [MessageFlags.Ephemeral] });
        
        console.log(`[WITHDRAW-NFT] Successfully withdrew ${tokenType} ${nftDisplayName}${amountText} (${collection}#${nft.nonce}) for user ${interaction.user.tag} (${userId})`);
      } else {
        await interaction.editReply({ 
          content: `❌ **Withdrawal failed!**\n\n**Error:** ${transferResult.errorMessage || 'Unknown error'}\n\nPlease try again or contact an administrator if the issue persists.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        console.error(`[WITHDRAW-NFT] Failed to withdraw ${tokenType} for user ${interaction.user.tag} (${userId}): ${transferResult.errorMessage}`);
      }
      
    } catch (error) {
      console.error('Error in withdraw-nft command:', error.message);
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
      
      const status = await blockchainListener.getListenerStatus();
      
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
      const summary = await virtualAccounts.getServerVirtualAccountsSummary(guildId);
      
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
  } else if (commandName === 'check-community-fund-balance') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      // Check if user is admin
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: '❌ **Admin Only!** This command is restricted to server administrators.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const guildId = interaction.guildId;
      const numberOfTransfers = interaction.options.getInteger('transfers') || 1;
      
      // Check Community Fund balances
      const balanceCheck = await checkCommunityFundBalances(guildId, numberOfTransfers);
      
      const embed = new EmbedBuilder()
        .setTitle(balanceCheck.sufficient ? '✅ Community Fund Balances Sufficient' : '❌ Community Fund Balances Insufficient')
        .setDescription(`Balance check for **${numberOfTransfers}** transfer(s)`)
        .setColor(balanceCheck.sufficient ? 0x00FF00 : 0xFF0000)
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Format REWARD balances to 2 decimal places
      const formatReward = (value) => {
        const num = parseFloat(value || '0');
        return isNaN(num) ? '0.00' : num.toFixed(2);
      };
      
      // Calculate totals and differences
      const onChainReward = parseFloat(balanceCheck.rewardBalanceOnChain || '0');
      const virtualAccountReward = parseFloat(balanceCheck.rewardBalanceVirtualAccount || '0');
      const houseBalanceReward = parseFloat(balanceCheck.rewardBalanceHouseBalance || '0');
      const totalInVirtualAccounts = virtualAccountReward + houseBalanceReward;
      const difference = onChainReward - totalInVirtualAccounts;
      const usageFeeReward = parseFloat(balanceCheck.requiredReward || '0');
      const neededToWithdraw = Math.max(0, -difference) + Math.ceil(usageFeeReward * 100) / 100; // Round up usage fee
      
      // Calculate REWARD status
      const egldStatus = new BigNumber(balanceCheck.egldBalance).isGreaterThanOrEqualTo(new BigNumber(balanceCheck.requiredEgld)) ? '✅ Sufficient' : '❌ Insufficient';
      const availableReward = parseFloat(balanceCheck.rewardBalanceAvailable || '0');
      const requiredReward = parseFloat(balanceCheck.requiredReward || '0');
      const rewardStatus = new BigNumber(availableReward).isGreaterThanOrEqualTo(new BigNumber(requiredReward)) ? '✅ Sufficient' : '❌ Insufficient';
      
      // Add simplified balance information
      embed.addFields([
        { name: '💰 EGLD Balance', value: `${balanceCheck.egldBalance} EGLD`, inline: true },
        { name: '📊 Required EGLD', value: `${balanceCheck.requiredEgld} EGLD`, inline: true },
        { name: '✅ EGLD Status', value: egldStatus, inline: true },
        { name: '💼 REWARD Available', value: `${formatReward(balanceCheck.rewardBalanceAvailable)} REWARD`, inline: true },
        { name: '💵 Required REWARD', value: `${formatReward(Math.ceil(requiredReward * 100) / 100)} REWARD`, inline: true },
        { name: '✅ REWARD Status', value: rewardStatus, inline: true },
        { name: '💼 Total in Wallet (On-Chain)', value: `${formatReward(balanceCheck.rewardBalanceOnChain)} REWARD`, inline: false },
        { name: '📦 Total in Virtual Accounts', value: `${formatReward(totalInVirtualAccounts)} REWARD\n• Virtual Accounts: ${formatReward(virtualAccountReward)}\n• House Balance: ${formatReward(houseBalanceReward)}`, inline: false },
        { name: '📊 Difference', value: `${formatReward(difference)} REWARD`, inline: true },
        { name: '💵 1 Transfer Usage Fee', value: `${formatReward(Math.ceil(usageFeeReward * 100) / 100)} REWARD`, inline: true },
        { name: '⚠️ Needed to Perform Withdraw', value: `${formatReward(neededToWithdraw)} REWARD`, inline: true }
      ]);
      
      // Add informational note about transferring REWARD if insufficient
      if (!balanceCheck.sufficient && balanceCheck.walletAddress && neededToWithdraw > 0) {
        embed.addFields({
          name: 'ℹ️ How to Add REWARD',
          value: `A REWARD transfer of **${formatReward(neededToWithdraw)} REWARD** to the Community Fund wallet address is required:\n\`${balanceCheck.walletAddress}\`\n\n⚠️ **Important:** Transfer must be made from a wallet that is **NOT** registered with this bot.\n\n💡 Ask admins to supply the required tokens to enable withdrawals.`,
          inline: false
        });
      }
      
      // Add wallet address for reference (when sufficient or if not shown above)
      if (balanceCheck.walletAddress && (balanceCheck.sufficient || neededToWithdraw === 0)) {
        embed.addFields({
          name: '📍 Community Fund Wallet Address',
          value: `\`${balanceCheck.walletAddress}\``,
          inline: false
        });
      }
      
      // Add other errors (non-REWARD related, like EGLD issues)
      const otherErrors = balanceCheck.errors?.filter(e => !e.includes('REWARD')) || [];
      if (otherErrors.length > 0) {
        embed.addFields({
          name: '⚠️ Other Issues',
          value: otherErrors.map(e => `• ${e}`).join('\n'),
          inline: false
        });
      }
      
      // Get QR code URL if available
      try {
        const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
        const communityFundProjectName = getCommunityFundProjectName();
        const qrCodeUrl = communityFundQRData?.[communityFundProjectName];
        
        if (qrCodeUrl) {
          embed.setThumbnail(qrCodeUrl);
        }
      } catch (error) {
        console.error('[BALANCE-CHECK] Error getting QR code:', error.message);
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in check-community-fund-balance command:', error.message);
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
      const result = await virtualAccounts.updateAllUsernamesInGuild(guildId, userMap);
      
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
  } else if (commandName === 'virtual-house-topup') {
    try {
      await interaction.deferReply();
      
      const tokenTicker = interaction.options.getString('token');
      const amount = interaction.options.getString('amount');
      const houseType = interaction.options.getString('house-type');
      const memo = interaction.options.getString('memo') || 'House top-up';
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const userTag = interaction.user.tag;
      
      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        await interaction.editReply({ content: '❌ Invalid amount. Please provide a positive number.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Validate house type
      const validHouseTypes = ['betting', 'auction', 'lottery'];
      if (!validHouseTypes.includes(houseType)) {
        await interaction.editReply({ 
          content: `❌ Invalid house type: "${houseType}". Must be one of: ${validHouseTypes.join(', ')}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Force reload virtual accounts data
      virtualAccounts.forceReloadData();
      
      // Update username
      await virtualAccounts.updateUserUsername(guildId, userId, userTag);
      
      // Resolve token identifier from ticker/identifier
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      
      // Validate identifier format
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (!esdtIdentifierRegex.test(tokenIdentifier)) {
        await interaction.editReply({ 
          content: `❌ **Invalid token identifier!**\n\nCould not resolve full token identifier for "${tokenTicker}". Please ensure token metadata is registered using /update-token-metadata.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get token metadata for display
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      const tokenData = tokenMetadata[tokenIdentifier];
      if (!tokenData) {
        await interaction.editReply({ 
          content: `❌ Token "${tokenTicker}" not found in metadata. Please register it first.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      const tokenTickerDisplay = tokenData.ticker;
      const decimals = tokenData.decimals || 8;
      
      // Check if user has sufficient balance (using identifier - migration handled automatically)
      const currentBalance = await virtualAccounts.getUserBalance(guildId, userId, tokenIdentifier);
      
      if (new BigNumber(currentBalance).isLessThan(amountNum)) {
        await interaction.editReply({ 
          content: `❌ **Insufficient balance!**\n\nYou have: **${currentBalance}** ${tokenTickerDisplay}\nRequired: **${amountNum}** ${tokenTickerDisplay}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Deduct from user's virtual account
      const deductResult = await virtualAccounts.deductFundsFromAccount(
        guildId,
        userId,
        tokenIdentifier,
        amountNum.toString(),
        `House top-up to ${houseType}`,
        'house_topup'
      );
      
      if (!deductResult.success) {
        await interaction.editReply({ 
          content: `❌ **Failed to deduct funds!**\n\nError: ${deductResult.error}`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Convert amount to Wei for house balance tracking
      const amountWei = toBlockchainAmount(amountNum, decimals);
      
      // Add to house balance (allocate to specified house type)
      const topupResult = await trackHouseTopup(
        guildId,
        amountWei,
        tokenIdentifier,
        houseType,
        userId,
        userTag,
        memo
      );
      
      if (!topupResult.success) {
        // Refund if house update fails
        await virtualAccounts.addFundsToAccount(
          guildId,
          userId,
          tokenIdentifier,
          amountNum.toString(),
          null,
          'refund',
          userTag
        );
        await interaction.editReply({ 
          content: `❌ **Failed to update house balance!**\n\nError: ${topupResult.error}\n\nFunds have been refunded to your Virtual Account.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Success response
      const houseTypeName = houseType === 'betting' ? '⚽ Betting House' : houseType === 'auction' ? '🎨 Auction House' : '🎲 Lottery House';
      const newHouseBalance = topupResult.newBalances[houseType];
      const newHouseBalanceHuman = new BigNumber(newHouseBalance).dividedBy(new BigNumber(10).pow(decimals)).toString();
      
      const successEmbed = new EmbedBuilder()
        .setTitle('✅ House Top-Up Successful')
        .setDescription(`Successfully transferred funds from your Virtual Account to House Balance.`)
        .setColor('#00FF00')
        .addFields([
          { name: 'Token', value: tokenTickerDisplay, inline: true },
          { name: 'Amount', value: `${amountNum} ${tokenTickerDisplay}`, inline: true },
          { name: 'House Type', value: houseTypeName, inline: true },
          { name: 'Your New Balance', value: `${deductResult.newBalance} ${tokenTickerDisplay}`, inline: true },
          { name: `New ${houseTypeName} Balance`, value: `${newHouseBalanceHuman} ${tokenTickerDisplay}`, inline: true },
          { name: 'Memo', value: memo || 'N/A', inline: false }
        ])
        .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      await interaction.editReply({ embeds: [successEmbed] });
      
      console.log(`[HOUSE-TOPUP] User ${userTag} (${userId}) topped up ${amountNum} ${tokenTickerDisplay} to ${houseTypeName} in guild ${guildId}`);
      
    } catch (error) {
      console.error('Error in virtual-house-topup command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'withdraw-esdt') {
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
      await virtualAccounts.updateUserUsername(guildId, userId, interaction.user.tag);
      
      // Resolve token identifier from ticker/identifier BEFORE checking balance
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      
      // Validate identifier format
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (!esdtIdentifierRegex.test(tokenIdentifier)) {
        await interaction.editReply({ 
          content: `❌ **Invalid token identifier!**\n\nCould not resolve full token identifier for "${tokenTicker}". Please ensure token metadata is registered using /update-token-metadata.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check if user has any balance for the selected token (use identifier, not ticker)
      let currentBalance = await virtualAccounts.getUserBalance(guildId, userId, tokenIdentifier);
      
      // If balance is 0 with identifier, try ticker as fallback (for backward compatibility)
      if (new BigNumber(currentBalance).isZero() && tokenIdentifier !== tokenTicker) {
        currentBalance = await virtualAccounts.getUserBalance(guildId, userId, tokenTicker);
      }
      
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
      
      // Get user's wallet address (await the async function)
      const userWallets = await getUserWallets(guildId);
      const userWallet = userWallets?.[userId];
      
      if (!userWallet) {
        await interaction.editReply({ 
          content: `❌ **No wallet registered!**\n\nPlease register your wallet address using \`/set-wallet\` or click the "Register My Wallet" button in \`/list-wallets\` before withdrawing funds.`, 
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
      const fundProject = await getCommunityFundProject(guildId);
      if (!fundProject) {
        await interaction.editReply({ 
          content: `❌ **No Community Fund configured!**\n\nPlease ask an admin to set up a Community Fund using \`/set-community-fund\`.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check Community Fund balances (1 transfer for withdraw)
      const balanceCheck = await checkCommunityFundBalances(guildId, 1);
      if (!balanceCheck.sufficient) {
        const errorEmbed = await createBalanceErrorEmbed(guildId, balanceCheck, '/withdraw');
        await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (!projects[projectName]) {
        await interaction.editReply({ 
          content: `❌ **Community Fund not found!**\n\nThe Community Fund project no longer exists. Please ask an admin to reconfigure it.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      await interaction.editReply({ 
        content: `🔄 **Processing withdrawal...**\n\nWithdrawing **${withdrawAmount}** ${tokenTicker} to your wallet...\nMemo: ${memo}`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
      // Use internal project name "Community Fund" for the transfer function
      const communityFundProjectName = getCommunityFundProjectName();
      
      console.log(`User ${interaction.user.tag} (${userId}) is withdrawing ${withdrawAmount} ${tokenTicker} to wallet ${userWallet} using Community Fund (${fundProject})`);
      
      // tokenIdentifier was already resolved above
      // Perform the blockchain transfer (use internal project name, not display name)
      const transferResult = await transferESDTFromCommunityFund(userWallet, tokenIdentifier, withdrawAmount, communityFundProjectName, guildId);
      
      if (transferResult.success) {
        // Deduct funds from virtual account
        // Ensure withdrawAmount is a string (deductFundsFromAccount expects string or number)
        const withdrawAmountStr = typeof withdrawAmount === 'object' && withdrawAmount.toString 
          ? withdrawAmount.toString() 
          : String(withdrawAmount);
        
        console.log(`[WITHDRAW] Deducting ${withdrawAmountStr} ${tokenIdentifier} from virtual account for user ${userId}`);
        const deductResult = await virtualAccounts.deductFundsFromAccount(guildId, userId, tokenIdentifier, withdrawAmountStr, 'withdrawal', memo);
        
        console.log(`[WITHDRAW] Deduction result:`, deductResult);
        
        if (deductResult.success) {
          const explorerUrl = transferResult.txHash
            ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
            : null;
          const txHashFieldValue = transferResult.txHash
            ? `[${transferResult.txHash}](${explorerUrl})`
            : 'Not available';
          
          // Get Community Fund project logo for withdrawal notification
          const communityFundProjectName = getCommunityFundProjectName();
          const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
          
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
            .setThumbnail(projectLogoUrl)
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
  } else if (commandName === 'tip-virtual-esdt') {
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
      await virtualAccounts.updateUserUsername(guildId, fromUserId, interaction.user.tag);
      if (targetUserId) {
        await virtualAccounts.updateUserUsername(guildId, targetUserId, targetUser ? targetUser.tag : userTag);
      }
      
      // Resolve token identifier from ticker/identifier
      const tokenIdentifier = await resolveTokenIdentifier(guildId, tokenTicker);
      
      // Validate identifier format
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (!esdtIdentifierRegex.test(tokenIdentifier)) {
        await interaction.editReply({ 
          content: `❌ **Invalid token identifier!**\n\nCould not resolve full token identifier for "${tokenTicker}". Please ensure token metadata is registered using /update-token-metadata.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check if user has sufficient balance (using identifier - migration handled automatically)
      const currentBalance = await virtualAccounts.getUserBalance(guildId, fromUserId, tokenIdentifier);
      console.log(`[TIP-VIRTUAL DEBUG] Guild ID: ${guildId}, User ID: ${fromUserId}, Token: ${tokenIdentifier}, Balance: ${currentBalance}, Required: ${amountNum}`);
      
      if (new BigNumber(currentBalance).isLessThan(amountNum)) {
        await interaction.editReply({ 
          content: `❌ **Insufficient balance!**\n\nYou have: **${currentBalance}** ${tokenTicker}\nRequired: **${amountNum}** ${tokenTicker}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Transfer funds between users (using identifier)
      const transferResult = await virtualAccounts.transferFundsBetweenUsers(
        guildId, 
        fromUserId, 
        targetUserId, 
        tokenIdentifier, 
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
            // Get Community Fund project logo for tip notification
            const communityFundProjectName = getCommunityFundProjectName();
            const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
            
            const recipientEmbed = new EmbedBuilder()
              .setTitle('💸 You Received a Virtual Tip!')
              .setDescription(`You received **${amountNum} ${tokenTicker}** from ${interaction.user.tag}`)
              .addFields([
                { name: '💰 Amount', value: `${amountNum} ${tokenTicker}`, inline: true },
                { name: '📝 Memo', value: memo, inline: true },
                { name: '💳 Your New Balance', value: `${transferResult.toUserNewBalance} ${tokenTicker}`, inline: true }
              ])
              .setColor('#00FF00')
              .setThumbnail(projectLogoUrl)
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
      console.error('Error in tip-virtual-esdt command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'tip-virtual-nft') {
    try {
      await interaction.deferReply();
      
      const userTag = interaction.options.getString('user-tag');
      const collection = interaction.options.getString('collection');
      const nftName = interaction.options.getString('nft-name');
      const memo = interaction.options.getString('memo') || 'No memo provided';
      const amountOption = interaction.options.getNumber('amount');
      const amount = amountOption && amountOption > 0 ? amountOption : 1;
      
      // Validate amount
      if (amount <= 0 || !Number.isInteger(amount)) {
        await interaction.editReply({ content: '❌ Invalid amount. Amount must be a positive integer.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const guildId = interaction.guildId;
      const fromUserId = interaction.user.id;
      
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
      
      // Parse NFT identifier from nft-name (could be name or collection#nonce format)
      let nonce = null;
      
      // Check if it's in format "collection#nonce"
      if (nftName.includes('#')) {
        const parts = nftName.split('#');
        if (parts.length === 2 && parts[0] === collection) {
          nonce = parseInt(parts[1]);
          if (isNaN(nonce)) {
            await interaction.editReply({ content: '❌ Invalid NFT identifier format. Expected: "Collection#Nonce" or NFT name.', flags: [MessageFlags.Ephemeral] });
            return;
          }
        }
      }
      
      // If nonce not found, try to find NFT by name
      if (nonce === null) {
        const userNFTs = await virtualAccountsNFT.getUserNFTBalances(guildId, fromUserId, collection);
        const matchingNFT = userNFTs.find(nft => {
          const nftDisplayName = nft.nft_name || `${collection}#${nft.nonce}`;
          return nftDisplayName.toLowerCase() === nftName.toLowerCase() || 
                 `${collection}#${nft.nonce}`.toLowerCase() === nftName.toLowerCase();
        });
        
        if (!matchingNFT) {
          await interaction.editReply({ 
            content: `❌ **NFT not found!**\n\nCould not find "${nftName}" in collection "${collection}" in your account.\n\nUse \`/check-balance-nft\` to view your NFTs.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
        
        nonce = matchingNFT.nonce;
      }
      
      // Verify user owns the NFT/SFT and has sufficient amount
      const nftBalance = await virtualAccountsNFT.getUserNFTBalance(guildId, fromUserId, collection, nonce);
      if (!nftBalance) {
        await interaction.editReply({ 
          content: `❌ **You don't own this NFT!**\n\nNFT ${collection}#${nonce} not found in your account.\n\nUse \`/check-balance-nft\` to view your NFTs.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Check sufficient balance for SFTs
      const currentAmount = nftBalance.amount || 1;
      if (amount > currentAmount) {
        // Use token_type from database for reliable detection
        const tokenType = nftBalance.token_type || (currentAmount > 1 ? 'SFT' : 'NFT');
        await interaction.editReply({ 
          content: `❌ **Insufficient balance!**\n\nYou have ${currentAmount} ${tokenType}(s), trying to tip ${amount}.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Transfer NFT/SFT between users
      const transferResult = await virtualAccountsNFT.transferNFTBetweenUsers(
        guildId,
        fromUserId,
        targetUserId,
        collection,
        nonce,
        null, // No price data for tips
        amount
      );
      
      if (transferResult.success) {
        const nftDisplayName = nftBalance.nft_name || `${collection}#${nonce}`;
        // Use token_type from database for reliable detection (bulletproof)
        const tokenType = nftBalance.token_type || (amount > 1 ? 'SFT' : 'NFT');
        const amountText = amount > 1 ? ` (${amount}x)` : '';
        const communityFundProjectName = getCommunityFundProjectName();
        const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
        
        const embed = new EmbedBuilder()
          .setTitle(`🖼️ ${tokenType} Tip Sent!`)
          .setDescription(`Successfully tipped **${nftDisplayName}${amountText}** (${collection}#${nonce}) to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: `🖼️ ${tokenType}`, value: `${nftDisplayName}${amountText}`, inline: true },
            { name: '📦 Collection', value: collection, inline: true },
            { name: '🔢 Nonce', value: String(nonce), inline: true },
            { name: '📝 Memo', value: memo, inline: false }
          ])
          .setColor('#00FF00')
          .setThumbnail(nftBalance.nft_image_url || projectLogoUrl)
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        await interaction.editReply({ embeds: [embed] });
        
        // Send DM to recipient
        try {
          if (targetUser) {
            const recipientEmbed = new EmbedBuilder()
              .setTitle(`🖼️ You Received a ${tokenType} Tip!`)
              .setDescription(`You received **${nftDisplayName}${amountText}** (${collection}#${nonce}) from ${interaction.user.tag}`)
              .addFields([
                { name: `🖼️ ${tokenType}`, value: `${nftDisplayName}${amountText}`, inline: true },
                { name: '📦 Collection', value: collection, inline: true },
                { name: '🔢 Nonce', value: String(nonce), inline: true },
                { name: '📝 Memo', value: memo, inline: false }
              ])
              .setColor('#00FF00')
              .setThumbnail(nftBalance.nft_image_url || projectLogoUrl)
              .setTimestamp()
              .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
            
            await targetUser.send({ embeds: [recipientEmbed] });
          }
        } catch (dmError) {
          console.error(`Could not send DM to ${userTag}:`, dmError.message);
        }
        
      } else {
        await interaction.editReply({ 
          content: `❌ **${tokenType} tip failed!** ${transferResult.error || 'Unknown error'}`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
      
    } catch (error) {
      console.error('Error in tip-virtual-nft command:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  }

  // LOTTERY COMMANDS
  if (commandName === 'create-lottery') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can create lotteries.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const guildId = interaction.guildId;
      const winningNumbersCount = interaction.options.getInteger('winning_numbers_count');
      const totalPoolNumbers = interaction.options.getInteger('total_pool_numbers');
      const tokenTicker = interaction.options.getString('token');
      const drawingFrequency = interaction.options.getString('drawing_frequency');
      const houseCommission = interaction.options.getNumber('house_commission') || 0;
      const ticketPrice = interaction.options.getNumber('ticket_price');
      
      // Validate inputs
      if (winningNumbersCount < 1 || winningNumbersCount > 10) {
        await interaction.editReply({ content: 'Winning numbers count must be between 1 and 10.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (totalPoolNumbers < 5 || totalPoolNumbers > 100) {
        await interaction.editReply({ content: 'Total pool numbers must be between 5 and 100.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (winningNumbersCount > totalPoolNumbers) {
        await interaction.editReply({ content: 'Winning numbers count cannot exceed total pool numbers.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (houseCommission < 0 || houseCommission > 50) {
        await interaction.editReply({ content: 'House commission must be between 0 and 50.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (ticketPrice <= 0) {
        await interaction.editReply({ content: 'Ticket price must be greater than 0.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Get token metadata
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      let tokenIdentifier = null;
      let tokenDecimals = 8;
      
      // Check if input is already a full ESDT identifier (format: TICKER-6hexchars)
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      const isFullIdentifier = esdtIdentifierRegex.test(tokenTicker);
      
      if (isFullIdentifier) {
        // Input is a full identifier, check if we have metadata for it
        if (tokenMetadata[tokenTicker]) {
          tokenIdentifier = tokenTicker;
          tokenDecimals = tokenMetadata[tokenTicker].decimals;
        } else {
          // Try to fetch metadata automatically
          await interaction.editReply({ content: '🔄 Fetching token metadata...', flags: [MessageFlags.Ephemeral] });
          const success = await updateTokenMetadata(guildId, tokenTicker);
          if (success) {
            const updatedMetadata = await dbServerData.getTokenMetadata(guildId);
            if (updatedMetadata[tokenTicker]) {
              tokenIdentifier = tokenTicker;
              tokenDecimals = updatedMetadata[tokenTicker].decimals;
            } else {
              await interaction.editReply({ content: `❌ Failed to fetch metadata for token ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
              return;
            }
          } else {
            await interaction.editReply({ content: `❌ Failed to fetch metadata for token ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
            return;
          }
        }
      } else {
        // Input is a ticker, try to find matching identifier
        for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
          if (metadata.ticker === tokenTicker) {
            tokenIdentifier = identifier;
            tokenDecimals = metadata.decimals;
            break;
          }
        }
        
        // If not found in metadata, try to get identifier from projects or API
        if (!tokenIdentifier) {
          await interaction.editReply({ content: '🔄 Looking up token identifier...', flags: [MessageFlags.Ephemeral] });
          const foundIdentifier = await getTokenIdentifier(tokenTicker);
          if (foundIdentifier) {
            // Check if we have metadata for this identifier
            if (tokenMetadata[foundIdentifier]) {
              tokenIdentifier = foundIdentifier;
              tokenDecimals = tokenMetadata[foundIdentifier].decimals;
            } else {
              // Fetch metadata automatically
              await interaction.editReply({ content: '🔄 Fetching token metadata...', flags: [MessageFlags.Ephemeral] });
              const success = await updateTokenMetadata(guildId, foundIdentifier);
              if (success) {
                const updatedMetadata = await dbServerData.getTokenMetadata(guildId);
                if (updatedMetadata[foundIdentifier]) {
                  tokenIdentifier = foundIdentifier;
                  tokenDecimals = updatedMetadata[foundIdentifier].decimals;
                } else {
                  await interaction.editReply({ content: `❌ Failed to fetch metadata for token ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
                  return;
                }
              } else {
                await interaction.editReply({ content: `❌ Failed to fetch metadata for token ${tokenTicker}. Please run /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
                return;
              }
            }
          } else {
            await interaction.editReply({ content: `❌ Token ${tokenTicker} not found. Please register token metadata first using /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
            return;
          }
        }
      }
      
      if (!tokenIdentifier) {
        await interaction.editReply({ content: `❌ Token ${tokenTicker} not found. Please register token metadata first using /update-token-metadata.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // CRITICAL: Validate that tokenIdentifier is a full identifier format (not just ticker)
      // This prevents conflicts when multiple tokens share the same ticker
      const identifierFormatRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (!identifierFormatRegex.test(tokenIdentifier)) {
        await interaction.editReply({ 
          content: `❌ **Invalid token identifier format!**\n\nThe token identifier must be in full format (e.g., "REWARD-cf6eac"), not just the ticker ("REWARD").\n\nThis is required to prevent conflicts when multiple tokens share the same ticker.\n\nPlease use the full token identifier or run /update-token-metadata first.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // Get the actual ticker from metadata (in case user provided full identifier)
      const finalMetadata = await dbServerData.getTokenMetadata(guildId);
      const actualTicker = finalMetadata[tokenIdentifier]?.ticker || tokenTicker.split('-')[0] || tokenTicker;
      
      // Convert ticket price to wei
      const ticketPriceWei = new BigNumber(ticketPrice).multipliedBy(new BigNumber(10).pow(tokenDecimals)).toString();
      
      // Generate unique lottery ID (needed for memo in House Lottery balance tracking)
      const lotteryId = `lottery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Check if user wants to use House Lottery balance for initial prize pool
      const useHouseLotteryBalance = interaction.options.getBoolean('use_house_lottery_balance') || false;
      const initialPrizePoolHuman = interaction.options.getNumber('initial_prize_pool');
      let initialPrizePoolWei = '0';
      let initialPrizePoolUsd = 0;
      
      if (useHouseLotteryBalance) {
        try {
          // Get all house balances
          const houseBalanceData = await getAllHouseBalances(guildId);
          const tokenTickerOnly = tokenIdentifier.includes('-') ? tokenIdentifier.split('-')[0] : tokenIdentifier;
          
          // Aggregate lottery earnings and spending
          const aggregatedBalances = {
            lotteryEarnings: {},
            lotterySpending: {}
          };
          
          for (const [tokenId, tokenData] of Object.entries(houseBalanceData || {})) {
            // Merge lottery earnings
            if (tokenData.lotteryEarnings) {
              for (const [token, amount] of Object.entries(tokenData.lotteryEarnings)) {
                if (!aggregatedBalances.lotteryEarnings[token]) {
                  aggregatedBalances.lotteryEarnings[token] = '0';
                }
                const current = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
                aggregatedBalances.lotteryEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
              }
            }
            
            // Merge lottery spending
            if (tokenData.lotterySpending) {
              for (const [token, amount] of Object.entries(tokenData.lotterySpending)) {
                if (!aggregatedBalances.lotterySpending[token]) {
                  aggregatedBalances.lotterySpending[token] = '0';
                }
                const current = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
                aggregatedBalances.lotterySpending[token] = current.plus(new BigNumber(amount || '0')).toString();
              }
            }
          }
          
          // Calculate available House Lottery balance (check both identifier and ticker for backward compatibility)
          const lotteryEarningsId = aggregatedBalances.lotteryEarnings[tokenIdentifier] || '0';
          const lotteryEarningsTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.lotteryEarnings[tokenTickerOnly] || '0') : '0';
          const lotteryEarnings = new BigNumber(lotteryEarningsId).plus(new BigNumber(lotteryEarningsTicker));
          
          const lotterySpendingId = aggregatedBalances.lotterySpending[tokenIdentifier] || '0';
          const lotterySpendingTicker = tokenIdentifier !== tokenTickerOnly ? (aggregatedBalances.lotterySpending[tokenTickerOnly] || '0') : '0';
          const lotterySpending = new BigNumber(lotterySpendingId).plus(new BigNumber(lotterySpendingTicker));
          
          const availableBalanceWei = lotteryEarnings.minus(lotterySpending);
          
          if (availableBalanceWei.isLessThanOrEqualTo(0)) {
            await interaction.editReply({ 
              content: `❌ **Insufficient House Lottery balance!**\n\nHouse Lottery has no balance for ${actualTicker} yet. No lotteries have collected commission.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }
          
          // Determine the amount to use
          let amountToUseWei;
          if (initialPrizePoolHuman !== null && initialPrizePoolHuman !== undefined) {
            // User specified an amount
            amountToUseWei = new BigNumber(initialPrizePoolHuman).multipliedBy(new BigNumber(10).pow(tokenDecimals));
            
            if (amountToUseWei.isGreaterThan(availableBalanceWei)) {
              const availableHuman = availableBalanceWei.dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
              await interaction.editReply({ 
                content: `❌ **Insufficient House Lottery balance!**\n\nRequested: **${initialPrizePoolHuman}** ${actualTicker}\nAvailable: **${availableHuman}** ${actualTicker}`, 
                flags: [MessageFlags.Ephemeral] 
              });
              return;
            }
          } else {
            // Use full available balance
            amountToUseWei = availableBalanceWei;
          }
          
          // Track spending from House Lottery balance
          const spendingResult = await trackHouseSpending(
            guildId, 
            amountToUseWei.toString(), 
            tokenIdentifier, 
            `Initial prize pool for lottery ${lotteryId.substring(0, 16)}...`, 
            'lottery'
          );
          
          if (!spendingResult || !spendingResult.success) {
            await interaction.editReply({ 
              content: `❌ **Failed to track House Lottery spending!**\n\nError: ${spendingResult?.error || 'Unknown error'}`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }
          
          // Set initial prize pool
          initialPrizePoolWei = amountToUseWei.toString();
          
          // Fetch token price for USD calculation
          try {
            const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
            if (priceResponse.ok) {
              const priceData = await priceResponse.json();
              const tokenPriceUsd = priceData.price || 0;
              const initialPrizePoolHumanAmount = amountToUseWei.dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
              initialPrizePoolUsd = new BigNumber(initialPrizePoolHumanAmount).multipliedBy(tokenPriceUsd).toNumber();
            }
          } catch (error) {
            console.error('[LOTTERY] Error fetching token price for initial prize pool:', error.message);
          }
          
        } catch (error) {
          console.error('[LOTTERY] Error processing House Lottery balance funding:', error);
          await interaction.editReply({ 
            content: `❌ **Error processing House Lottery balance!**\n\n${error.message}`, 
            flags: [MessageFlags.Ephemeral] 
          });
          return;
        }
      }
      
      // Calculate times
      const startTime = Date.now();
      const frequencyMs = lotteryHelpers.parseFrequency(drawingFrequency);
      const endTime = startTime + frequencyMs;
      const nextDrawTime = endTime;
      
      // Fetch token price from MultiversX API (if not already calculated for initial prize pool)
      let tokenPriceUsd = 0;
      if (useHouseLotteryBalance && initialPrizePoolWei !== '0' && initialPrizePoolUsd > 0) {
        // We already have the USD value, calculate token price from it
        const initialPrizePoolHumanAmount = new BigNumber(initialPrizePoolWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
        tokenPriceUsd = initialPrizePoolUsd / parseFloat(initialPrizePoolHumanAmount);
      } else {
        // Fetch token price from API
        try {
          const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            tokenPriceUsd = priceData.price || 0;
            // If we have initial prize pool but no USD value yet, calculate it
            if (useHouseLotteryBalance && initialPrizePoolWei !== '0' && initialPrizePoolUsd === 0) {
              const initialPrizePoolHumanAmount = new BigNumber(initialPrizePoolWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
              initialPrizePoolUsd = new BigNumber(initialPrizePoolHumanAmount).multipliedBy(tokenPriceUsd).toNumber();
            }
          }
        } catch (error) {
          console.error('[LOTTERY] Error fetching token price:', error.message);
        }
      }
      
      // Create lottery in database
      await dbLottery.createLottery(guildId, lotteryId, {
        winningNumbersCount,
        totalPoolNumbers,
        tokenIdentifier,
        tokenTicker: actualTicker,
        drawingFrequency,
        houseCommissionPercent: houseCommission,
        ticketPriceWei,
        prizePoolWei: initialPrizePoolWei,
        prizePoolUsd: initialPrizePoolUsd,
        startTime,
        endTime,
        nextDrawTime,
        status: 'LIVE',
        hasWinners: false,
        totalTickets: 0,
        uniqueParticipants: 0,
        isRollover: false,
        rolloverCount: 0
      });
      
      // Format prize pool display
      const prizePoolHuman = new BigNumber(initialPrizePoolWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
      const prizePoolDisplay = initialPrizePoolWei !== '0' 
        ? `${prizePoolHuman} ${actualTicker} (≈ $${initialPrizePoolUsd.toFixed(2)})` 
        : `0 ${actualTicker} (≈ $0.00)`;
      
      // Calculate ticket price USD value
      const ticketPriceUsdValue = tokenPriceUsd > 0 ? new BigNumber(ticketPrice).multipliedBy(tokenPriceUsd).toFixed(2) : '0.00';
      const ticketPriceDisplay = `${ticketPrice} ${actualTicker} (≈ $${ticketPriceUsdValue})`;
      
      // Create embed
      const lotteryEmbed = new EmbedBuilder()
        .setTitle('🎰 Lottery')
        .setDescription(`**Lottery ID:** \`${lotteryId}\`\n\nPick ${winningNumbersCount} numbers from 1 to ${totalPoolNumbers}`)
        .addFields([
          { name: '🎫 Ticket Price', value: ticketPriceDisplay, inline: true },
          { name: '💰 Prize Pool', value: prizePoolDisplay, inline: true },
          { name: '🏦 House Commission', value: `${houseCommission}%`, inline: true },
          { name: '⏰ End Time', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
          { name: '🎫 Tickets Sold', value: '0', inline: true },
          { name: '👥 Participants', value: '0', inline: true }
        ])
        .setColor(0x00FF00)
        .setThumbnail('https://i.ibb.co/20MLJZNH/lottery-logo.png')
        .setTimestamp(new Date(endTime))
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
      
      // Create buttons
      const buyTicketButton = new ButtonBuilder()
        .setCustomId(`lottery-buy-ticket:${lotteryId}`)
        .setLabel('Buy Ticket')
        .setStyle(ButtonStyle.Primary);
      
      const luckyDipButton = new ButtonBuilder()
        .setCustomId(`lottery-lucky-dip:${lotteryId}`)
        .setLabel('Lucky Dip')
        .setStyle(ButtonStyle.Success);
      
      const myActiveTicketsButton = new ButtonBuilder()
        .setCustomId(`lottery-my-active:${lotteryId}`)
        .setLabel('My Active Tickets')
        .setStyle(ButtonStyle.Secondary);
      
      const myResultsButton = new ButtonBuilder()
        .setCustomId(`lottery-my-results:${lotteryId}`)
        .setLabel('My Results')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true); // Disabled until lottery ends
      
      const buttonRow = new ActionRowBuilder()
        .addComponents(buyTicketButton, luckyDipButton, myActiveTicketsButton, myResultsButton);
      
      // Post embed
      const lotteryMessage = await interaction.channel.send({
        embeds: [lotteryEmbed],
        components: [buttonRow]
      });
      
      // Create thread (optional)
      let thread = null;
      let threadId = null;
      try {
        thread = await lotteryMessage.startThread({
          name: `Lottery ${lotteryId.substring(0, 8)}`,
          autoArchiveDuration: 1440
        });
        threadId = thread.id;
      } catch (threadError) {
        console.error('[LOTTERY] Error creating thread:', threadError.message);
      }
      
      // Update lottery with message/channel/thread IDs
      await dbLottery.updateLottery(guildId, lotteryId, {
        channelId: interaction.channel.id,
        messageId: lotteryMessage.id,
        threadId: threadId
      });
      
      await interaction.editReply({
        content: `✅ Lottery created successfully! Lottery ID: \`${lotteryId}\``,
        flags: [MessageFlags.Ephemeral]
      });
      
    } catch (error) {
      console.error('[LOTTERY] Error creating lottery:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error creating lottery: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error creating lottery: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'my-active-lottery-tickets') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      let tokenTicker = interaction.options.getString('token');
      const page = interaction.options.getInteger('page') || 1;
      
      // Extract ticker from full identifier if needed (e.g., "USDC-c76f1f" -> "USDC")
      if (tokenTicker && tokenTicker.includes('-')) {
        tokenTicker = tokenTicker.split('-')[0];
      }
      
      const limit = 20;
      const offset = (page - 1) * limit;
      
      const tickets = await dbLottery.getTicketsByUser(guildId, userId, tokenTicker, 'LIVE', limit, offset);
      const totalCount = await dbLottery.getTicketsCountByUser(guildId, userId, tokenTicker, 'LIVE');
      const totalPages = Math.ceil(totalCount / limit);
      
      if (tickets.length === 0) {
        await interaction.editReply({
          content: `You have no active lottery tickets${tokenTicker ? ` for ${tokenTicker}` : ''}.`,
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
      
      // Get token metadata to get decimals for price calculation
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      
      const embed = new EmbedBuilder()
        .setTitle('🎫 My Active Lottery Tickets')
        .setDescription(`Showing page ${page} of ${totalPages} (${totalCount} total tickets)`)
        .setColor(0x00FF00)
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      
      tickets.forEach((ticket, index) => {
        const numbersDisplay = lotteryHelpers.formatNumbersForDisplay(ticket.numbers);
        
        // Get token decimals from metadata
        let tokenDecimals = 8; // Default fallback
        if (tokenMetadata[ticket.tokenIdentifier]) {
          tokenDecimals = tokenMetadata[ticket.tokenIdentifier].decimals;
        }
        
        const ticketPriceHuman = new BigNumber(ticket.ticketPriceWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
        
        embed.addFields({
          name: `Ticket ${offset + index + 1}`,
          value: `**Lottery:** \`${ticket.lotteryId.substring(0, 16)}...\`\n**Numbers:** ${numbersDisplay}\n**Token:** ${ticket.tokenTicker}\n**Price:** ${ticketPriceHuman} ${ticket.tokenTicker}`,
          inline: false
        });
      });
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('[LOTTERY] Error getting active tickets:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'my-expired-tickets') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const tokenTicker = interaction.options.getString('token');
      const page = interaction.options.getInteger('page') || 1;
      
      const limit = 20;
      const offset = (page - 1) * limit;
      
      // Get expired tickets (including winners, as they're also expired lotteries)
      // Note: We need to get all tickets and filter by status since getTicketsByUser only accepts one status
      const allTickets = await dbLottery.getTicketsByUser(guildId, userId, tokenTicker, null, 1000, 0); // Get more tickets to filter
      const expiredTickets = allTickets.filter(t => t.status === 'EXPIRED' || t.status === 'WINNER');
      
      // Apply pagination manually
      const totalCount = expiredTickets.length;
      const tickets = expiredTickets.slice(offset, offset + limit);
      const totalPages = Math.ceil(totalCount / limit);
      
      if (tickets.length === 0) {
        await interaction.editReply({
          content: `You have no expired lottery tickets${tokenTicker ? ` for ${tokenTicker}` : ''}.`,
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
      
      // Get lottery data for each ticket to show winning numbers
      const ticketsWithResults = [];
      for (const ticket of tickets) {
        const lottery = await dbLottery.getLottery(guildId, ticket.lotteryId);
        if (lottery && lottery.winningNumbers) {
          const match = lotteryHelpers.checkTicketMatch(ticket.numbers, lottery.winningNumbers);
          ticketsWithResults.push({
            ...ticket,
            lottery,
            match
          });
        } else {
          ticketsWithResults.push({
            ...ticket,
            lottery: null,
            match: { isWinner: false, matchedCount: 0 }
          });
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📋 My Expired Lottery Tickets')
        .setDescription(`Showing page ${page} of ${totalPages} (${totalCount} total tickets)`)
        .setColor(0xFF0000)
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      
      ticketsWithResults.forEach((ticket, index) => {
        const numbersDisplay = lotteryHelpers.formatNumbersForDisplay(ticket.numbers);
        let resultText = '';
        
        if (ticket.lottery && ticket.lottery.winningNumbers) {
          const winningNumbersDisplay = lotteryHelpers.formatNumbersForDisplay(ticket.lottery.winningNumbers);
          if (ticket.match.isWinner) {
            resultText = `✅ **WINNER!** Matched: ${ticket.match.matchedCount}/${ticket.lottery.winningNumbersCount}\n**Winning Numbers:** ${winningNumbersDisplay}`;
          } else {
            resultText = `❌ No match. Matched: ${ticket.match.matchedCount}/${ticket.lottery.winningNumbersCount}\n**Winning Numbers:** ${winningNumbersDisplay}`;
          }
        } else {
          resultText = 'No draw results available';
        }
        
        embed.addFields({
          name: `Ticket ${offset + index + 1}${ticket.isWinner ? ' 🏆' : ''}`,
          value: `**Lottery:** \`${ticket.lotteryId.substring(0, 16)}...\`\n**Your Numbers:** ${numbersDisplay}\n${resultText}`,
          inline: false
        });
      });
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('[LOTTERY] Error getting expired tickets:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (commandName === 'my-lottery-stats') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      const stats = await dbLottery.getUserLotteryStats(guildId, userId);
      
      // Get token decimals for display
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      const decimalsMap = {};
      for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
        decimalsMap[metadata.ticker] = metadata.decimals;
      }
      
      // Format amounts
      const formatAmount = (amountWei, tokenTicker) => {
        const decimals = decimalsMap[tokenTicker] || 8;
        return new BigNumber(amountWei).dividedBy(new BigNumber(10).pow(decimals)).toString();
      };
      
      // Get breakdown by token - get all tickets
      const allTickets = await dbLottery.getTicketsByUser(guildId, userId, null, null, 10000, 0);
      
      // Get all winners for this user (across all lotteries)
      const allWinners = await dbLottery.getWinnersByLottery(guildId, null);
      const userWinners = allWinners.filter(w => w.userId === userId);
      
      // Group by token identifier (not ticker) to ensure proper separation of tokens with same ticker
      const tokenBreakdown = {};
      
      (allTickets || []).forEach(ticket => {
        // Use tokenIdentifier as the key for grouping
        const tokenKey = ticket.tokenIdentifier || ticket.tokenTicker; // Fallback to ticker for old data
        if (!tokenBreakdown[tokenKey]) {
          tokenBreakdown[tokenKey] = {
            tokenIdentifier: ticket.tokenIdentifier,
            tokenTicker: ticket.tokenTicker,
            tickets: 0,
            spent: new BigNumber('0'),
            won: new BigNumber('0'),
            wins: 0
          };
        }
        tokenBreakdown[tokenKey].tickets++;
        tokenBreakdown[tokenKey].spent = tokenBreakdown[tokenKey].spent.plus(new BigNumber(ticket.ticketPriceWei || '0'));
        if (ticket.isWinner) {
          tokenBreakdown[tokenKey].wins++;
        }
      });
      
      // Add prize amounts from winners - group by identifier
      (userWinners || []).forEach(winner => {
        // Use tokenIdentifier as the key for grouping
        const tokenKey = winner.tokenIdentifier || winner.tokenTicker; // Fallback to ticker for old data
        if (!tokenBreakdown[tokenKey]) {
          tokenBreakdown[tokenKey] = {
            tokenIdentifier: winner.tokenIdentifier,
            tokenTicker: winner.tokenTicker,
            tickets: 0,
            spent: new BigNumber('0'),
            won: new BigNumber('0'),
            wins: 0
          };
        }
        tokenBreakdown[tokenKey].won = tokenBreakdown[tokenKey].won.plus(new BigNumber(winner.prizeAmountWei || '0'));
      });
      
      // Fetch token prices for USD calculations
      const tokenPrices = {};
      const uniqueTokenIds = [...new Set(Object.values(tokenBreakdown).map(b => b.tokenIdentifier).filter(Boolean))];
      
      // Fetch prices in parallel
      const pricePromises = uniqueTokenIds.map(async (tokenIdentifier) => {
        try {
          const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            return { tokenIdentifier, price: priceData.price || 0 };
          }
        } catch (error) {
          console.error(`[LOTTERY-STATS] Error fetching price for ${tokenIdentifier}:`, error.message);
        }
        return { tokenIdentifier, price: 0 };
      });
      
      const priceResults = await Promise.all(pricePromises);
      priceResults.forEach(({ tokenIdentifier, price }) => {
        tokenPrices[tokenIdentifier] = price;
      });
      
      // Calculate total USD spent and won
      let totalSpentUsd = new BigNumber(0);
      let totalWonUsd = new BigNumber(0);
      
      const embed = new EmbedBuilder()
        .setTitle('📊 My Lottery Statistics')
        .setDescription(`Statistics across all lottery types`)
        .addFields([
          { name: '🎫 Total Tickets', value: stats.totalTickets.toString(), inline: true },
          { name: '🏆 Wins', value: stats.wins.toString(), inline: true },
          { name: '📈 Win Rate', value: `${stats.winRate}%`, inline: true }
        ])
        .setColor(0x4d55dc)
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      
      // Add token breakdown - use tokenIdentifier as key, but display ticker
      for (const [tokenKey, breakdown] of Object.entries(tokenBreakdown)) {
        // Get ticker from breakdown object (or extract from identifier)
        const displayTicker = breakdown.tokenTicker || (breakdown.tokenIdentifier ? breakdown.tokenIdentifier.split('-')[0] : tokenKey);
        // Get decimals for this token identifier
        const tokenId = breakdown.tokenIdentifier || tokenKey;
        const tokenMeta = tokenMetadata[tokenId];
        const decimals = tokenMeta?.decimals || 8;
        
        const spentFormatted = new BigNumber(breakdown.spent.toString()).dividedBy(new BigNumber(10).pow(decimals)).toString();
        const wonFormatted = new BigNumber(breakdown.won.toString()).dividedBy(new BigNumber(10).pow(decimals)).toString();
        
        // Calculate USD values
        const tokenPrice = tokenPrices[tokenId] || 0;
        const spentUsd = new BigNumber(spentFormatted).multipliedBy(tokenPrice).toFixed(2);
        const wonUsd = new BigNumber(wonFormatted).multipliedBy(tokenPrice).toFixed(2);
        
        // Add to totals
        totalSpentUsd = totalSpentUsd.plus(new BigNumber(spentUsd));
        totalWonUsd = totalWonUsd.plus(new BigNumber(wonUsd));
        
        // Format USD display (only show if price > 0)
        const spentUsdDisplay = parseFloat(tokenPrice) > 0 ? ` (≈ $${spentUsd})` : '';
        const wonUsdDisplay = parseFloat(tokenPrice) > 0 ? ` (≈ $${wonUsd})` : '';
        
        embed.addFields({
          name: `${displayTicker}`,
          value: `**Tickets:** ${breakdown.tickets}\n**Spent:** ${spentFormatted} ${displayTicker}${spentUsdDisplay}\n**Won:** ${wonFormatted} ${displayTicker}${wonUsdDisplay}\n**Wins:** ${breakdown.wins}`,
          inline: true
        });
      }
      
      // Add total USD summary if we have any prices
      if (totalSpentUsd.isGreaterThan(0) || totalWonUsd.isGreaterThan(0)) {
        const netUsd = totalWonUsd.minus(totalSpentUsd);
        const netDisplay = netUsd.isGreaterThanOrEqualTo(0) ? `+$${netUsd.toFixed(2)}` : `-$${Math.abs(netUsd.toNumber()).toFixed(2)}`;
        embed.addFields({
          name: '💰 Total USD Summary',
          value: `**Total Spent:** $${totalSpentUsd.toFixed(2)}\n**Total Won:** $${totalWonUsd.toFixed(2)}\n**Net:** ${netDisplay}`,
          inline: false
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('[LOTTERY] Error getting lottery stats:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  }
});

// Combined autocomplete handler for send-esdt command
client.on('interactionCreate', async (interaction) => {
  // Log ALL interactions first to see if we're even receiving them
  if (interaction.isAutocomplete()) {
    console.log('[AUTOCOMPLETE] ===== AUTocomplete INTERACTION RECEIVED =====');
    console.log('[AUTOCOMPLETE] Command:', interaction.commandName);
    console.log('[AUTOCOMPLETE] Guild ID:', interaction.guildId);
    try {
      const focusedOption = interaction.options.getFocused(true);
      console.log('[AUTOCOMPLETE] Focused option:', focusedOption?.name);
    } catch (err) {
      console.error('[AUTOCOMPLETE] Error getting focused option:', err.message);
    }
  }
  
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
      const projects = await getProjects(guildId);
      
      // Exclude community fund project from /send-esdt options
      // Use internal project name "Community Fund" for comparison
      const communityFundProjectName = getCommunityFundProjectName();
      const availableProjects = Object.keys(projects).filter(projectName => 
        projectName !== communityFundProjectName
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
      const userWallets = await getUserWallets(guildId);
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
      const projects = await getProjects(guildId);
      
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

  // PROJECT NAME AUTOCOMPLETE FOR SEND-NFT
  if (interaction.commandName === 'send-nft' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = await getProjects(guildId);
      const communityFundProject = await getCommunityFundProject(guildId);
      
      // Exclude community fund project from /send-nft options
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

  // COLLECTION AUTOCOMPLETE FOR SEND-NFT
  if (interaction.commandName === 'send-nft' && interaction.options.getFocused(true).name === 'collection') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = await getProjects(guildId);
      const selectedProject = interaction.options.getString('project-name');
      
      if (!selectedProject || !projects[selectedProject]) {
        console.log('[AUTOCOMPLETE] send-nft collection: No project selected or project not found');
        await safeRespond(interaction, []);
        return;
      }
      
      const project = projects[selectedProject];
      const walletAddress = project.walletAddress;
      
      if (!walletAddress) {
        console.log('[AUTOCOMPLETE] send-nft collection: No wallet address for project');
        await safeRespond(interaction, []);
        return;
      }
      
      // Fetch all NFTs/SFTs from MultiversX API with pagination - this endpoint excludes MetaESDT automatically
      console.log('[AUTOCOMPLETE] send-nft collection: Fetching from wallet', walletAddress);
      const allItems = await fetchAllNFTs(walletAddress, 3000); // 3 second timeout for autocomplete
      
      if (!Array.isArray(allItems) || allItems.length === 0) {
        console.log('[AUTOCOMPLETE] send-nft collection: No NFTs/SFTs found');
        await safeRespond(interaction, []);
        return;
      }
      
      console.log(`[AUTOCOMPLETE] send-nft collection: Found ${allItems.length} items from API`);
      
      // Extract unique collections that have actual NFTs (NonFungibleESDT) with media
      const collectionsMap = new Map();
      
      allItems.forEach(item => {
        // Only include collections that have NFTs (not SFTs) and have media URLs
        if (item.type === 'NonFungibleESDT' && 
            item.collection && 
            item.media && 
            item.media.length > 0 && 
            item.media[0].url) {
          
          if (!collectionsMap.has(item.collection)) {
            // Extract collection name from first NFT in collection or use ticker
            const collectionName = item.name?.split('#')[0]?.trim() || 
                                  item.collection.split('-')[0] || 
                                  item.collection;
            const ticker = item.ticker || item.collection.split('-')[0] || '';
            
            collectionsMap.set(item.collection, {
              identifier: item.collection,
              name: collectionName,
              ticker: ticker
            });
          }
        }
      });
      
      const collections = Array.from(collectionsMap.values());
      console.log(`[AUTOCOMPLETE] send-nft collection: Extracted ${collections.length} unique NFT collections (excluded SFTs and items without media)`);
      
      // Map collections to choices, using identifier as value (full collection identifier)
      const choices = collections.map(collection => ({
        name: `${collection.name}${collection.ticker ? ` (${collection.ticker})` : ''}`,
        value: collection.identifier // Always use full identifier
      })).filter(choice => choice.value);
      
      // Filter by user input
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
        choice.value.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      console.log(`[AUTOCOMPLETE] send-nft collection: Returning ${filtered.length} filtered choices`);
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[AUTOCOMPLETE] send-nft collection: Error fetching collections:', error.message, error.stack);
      }
      await safeRespond(interaction, []);
    }
    return;
  }

  // NFT NAME AUTOCOMPLETE FOR SEND-NFT
  if (interaction.commandName === 'send-nft' && interaction.options.getFocused(true).name === 'nft-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = await getProjects(guildId);
      const selectedProject = interaction.options.getString('project-name');
      const selectedCollection = interaction.options.getString('collection');
      
      if (!selectedProject || !projects[selectedProject] || !selectedCollection) {
        console.log('[AUTOCOMPLETE] send-nft nft-name: Missing project or collection');
        await safeRespond(interaction, []);
        return;
      }
      
      const project = projects[selectedProject];
      const walletAddress = project.walletAddress;
      
      if (!walletAddress) {
        console.log('[AUTOCOMPLETE] send-nft nft-name: No wallet address');
        await safeRespond(interaction, []);
        return;
      }
      
      // Fetch all NFTs/SFTs from MultiversX API with pagination - this endpoint excludes MetaESDT automatically
      console.log('[AUTOCOMPLETE] send-nft nft-name: Fetching from wallet', walletAddress);
      console.log('[AUTOCOMPLETE] send-nft nft-name: Filtering for collection:', selectedCollection);
      
      const allItems = await fetchAllNFTs(walletAddress, 3000); // 3 second timeout for autocomplete
      
      if (!Array.isArray(allItems) || allItems.length === 0) {
        console.log('[AUTOCOMPLETE] send-nft nft-name: No NFTs found or invalid format');
        await safeRespond(interaction, []);
        return;
      }
      
      console.log(`[AUTOCOMPLETE] send-nft nft-name: Found ${allItems.length} items from API`);
      
      // Filter to only include actual NFTs (NonFungibleESDT) from the selected collection
      // Also ensure they have media URLs
      const actualNFTs = allItems.filter(item => {
        // Only include NonFungibleESDT type (exclude SemiFungibleESDT)
        const isNFT = item.type === 'NonFungibleESDT';
        
        // Must have media URL
        const hasMedia = item.media && item.media.length > 0 && item.media[0].url;
        
        // Match collection exactly (case-insensitive)
        const matchesCollection = item.collection && 
          (item.collection.toLowerCase() === selectedCollection.toLowerCase() ||
           item.collection === selectedCollection);
        
        return isNFT && hasMedia && matchesCollection;
      });
      
      console.log(`[AUTOCOMPLETE] send-nft nft-name: Filtered to ${actualNFTs.length} NFTs from collection "${selectedCollection}" (excluded ${allItems.length - actualNFTs.length} SFTs/other collections/items without media)`);
      
      // Map NFTs to choices, using name as both display and value
      const choices = actualNFTs.map(nft => ({
        name: nft.name || nft.identifier || 'Unnamed NFT',
        value: nft.name || nft.identifier // Use name as value
      })).filter(choice => choice.value); // Filter out invalid entries
      
      // Filter by user input
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      console.log(`[AUTOCOMPLETE] send-nft nft-name: Returning ${filtered.length} filtered choices`);
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[AUTOCOMPLETE] send-nft nft-name: Error fetching NFTs:', error.message, error.stack);
      }
      await safeRespond(interaction, []);
    }
    return;
  }

  // PROJECT NAME AUTOCOMPLETE FOR CREATE-AUCTION
  if (interaction.commandName === 'create-auction' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = await getProjects(guildId);
      const communityFundProjectName = getCommunityFundProjectName(); // Always "Community Fund"
      
      // Exclude community fund project from /create-auction options
      // Filter by internal project name "Community Fund" to ensure it's always excluded
      const availableProjects = Object.keys(projects).filter(projectName => 
        projectName !== communityFundProjectName
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

  // Helper function to fetch all NFTs with pagination
  async function fetchAllNFTs(walletAddress, timeout = 5000) {
    const allItems = [];
    let from = 0;
    const size = 100; // Fetch 100 items per page
    let hasMore = true;
    
    while (hasMore) {
      const nftsUrl = `https://api.multiversx.com/accounts/${walletAddress}/nfts?from=${from}&size=${size}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(nftsUrl, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          console.error(`[AUTOCOMPLETE] API error ${response.status} ${response.statusText} at offset ${from}`);
          break;
        }
        
        const responseData = await response.json();
        
        // Handle paginated response (check for data property) or direct array
        let items = Array.isArray(responseData) ? responseData : (responseData.data || []);
        
        if (!Array.isArray(items) || items.length === 0) {
          hasMore = false;
          break;
        }
        
        allItems.push(...items);
        
        // Check if there are more items to fetch
        // If we got fewer items than requested, we've reached the end
        if (items.length < size) {
          hasMore = false;
        } else {
          from += size;
        }
        
        // Safety limit: don't fetch more than 1000 items total (10 pages)
        if (allItems.length >= 1000) {
          console.log(`[AUTOCOMPLETE] Reached safety limit of 1000 items, stopping pagination`);
          hasMore = false;
        }
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          console.log(`[AUTOCOMPLETE] Request timeout at offset ${from}`);
          break;
        }
        console.error(`[AUTOCOMPLETE] Error fetching NFTs at offset ${from}:`, error.message);
        break;
      }
    }
    
    console.log(`[AUTOCOMPLETE] Fetched ${allItems.length} total items with pagination`);
    return allItems;
  }

  // COLLECTION AUTOCOMPLETE FOR CREATE-AUCTION
  if (interaction.commandName === 'create-auction' && interaction.options.getFocused(true).name === 'collection') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const source = interaction.options.getString('source');
      
      console.log('[AUTOCOMPLETE] create-auction collection: Source value:', source);
      
      // Validate source is set
      if (!source) {
        console.log('[AUTOCOMPLETE] create-auction collection: No source selected');
        await safeRespond(interaction, []);
        return;
      }
      
      // If source is Virtual Account, fetch from user's virtual account NFT balances
      if (source === 'virtual_account') {
        try {
          const userId = interaction.user.id;
          console.log('[AUTOCOMPLETE] create-auction collection: Fetching from Virtual Account for user:', userId);
          
          // Get user's collections
          const collections = await virtualAccountsNFT.getUserCollections(guildId, userId);
          console.log('[AUTOCOMPLETE] create-auction collection: Found collections from VA:', collections);
          console.log('[AUTOCOMPLETE] create-auction collection: Collections type:', typeof collections, 'Is array:', Array.isArray(collections));
          
          if (!collections || !Array.isArray(collections) || collections.length === 0) {
            console.log('[AUTOCOMPLETE] create-auction collection: No collections found for user');
            await safeRespond(interaction, []);
            return;
          }
          
          // Filter by focused value
          const filtered = collections.filter(collection =>
            collection && collection.toLowerCase().includes(focusedValue.toLowerCase())
          );
          
          const choices = filtered.slice(0, 25).map(collection => ({ 
            name: collection, 
            value: collection 
          }));
          
          console.log('[AUTOCOMPLETE] create-auction collection: Returning', choices.length, 'filtered choices');
          await safeRespond(interaction, choices);
          return;
        } catch (vaError) {
          console.error('[AUTOCOMPLETE] create-auction collection: Error fetching from Virtual Account:', vaError.message, vaError.stack);
          await safeRespond(interaction, []);
          return;
        }
      }
      
      // If source is Project Wallet, fetch from project's wallet via API
      if (source === 'project_wallet') {
        try {
          const projects = await getProjects(guildId);
          const selectedProject = interaction.options.getString('project-name');
          
          // If a specific project is selected, fetch from that project only
          if (selectedProject && projects[selectedProject]) {
            const project = projects[selectedProject];
            const walletAddress = project.walletAddress;
            
            if (!walletAddress) {
              console.log('[AUTOCOMPLETE] create-auction collection: No wallet address for project:', selectedProject);
              await safeRespond(interaction, []);
              return;
            }
            
            // Fetch all NFTs/SFTs from MultiversX API with pagination - this endpoint excludes MetaESDT automatically
            console.log('[AUTOCOMPLETE] create-auction collection: Fetching from wallet', walletAddress);
            const allItems = await fetchAllNFTs(walletAddress, 5000);
            
            if (!Array.isArray(allItems) || allItems.length === 0) {
              console.log('[AUTOCOMPLETE] create-auction collection: No NFTs/SFTs found');
              await safeRespond(interaction, []);
              return;
            }
            
            console.log(`[AUTOCOMPLETE] create-auction collection: Found ${allItems.length} items from API`);
            
            // Extract unique collections that have actual NFTs (NonFungibleESDT) with media
            const collectionsMap = new Map();
            
            allItems.forEach(item => {
              // Only include collections that have NFTs (not SFTs) and have media URLs
              if (item.type === 'NonFungibleESDT' && 
                  item.collection && 
                  item.media && 
                  item.media.length > 0 && 
                  item.media[0].url) {
                
                if (!collectionsMap.has(item.collection)) {
                  // Extract collection name from first NFT in collection or use ticker
                  const collectionName = item.name?.split('#')[0]?.trim() || 
                                        item.collection.split('-')[0] || 
                                        item.collection;
                  const ticker = item.ticker || item.collection.split('-')[0] || '';
                  
                  collectionsMap.set(item.collection, {
                    identifier: item.collection,
                    name: collectionName,
                    ticker: ticker
                  });
                }
              }
            });
            
            const collections = Array.from(collectionsMap.values());
            console.log(`[AUTOCOMPLETE] create-auction collection: Extracted ${collections.length} unique NFT collections (excluded SFTs and items without media)`);
            
            const choices = collections.map(collection => ({
              name: `${collection.name}${collection.ticker ? ` (${collection.ticker})` : ''}`,
              value: collection.identifier // Always use full identifier
            })).filter(choice => choice.value);
            
            const filtered = choices.filter(choice =>
              choice.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
              choice.value.toLowerCase().includes(focusedValue.toLowerCase())
            );
            
            console.log(`[AUTOCOMPLETE] create-auction collection: Returning ${filtered.length} filtered choices`);
            await safeRespond(interaction, filtered.slice(0, 25));
            return;
          }
          
          // If no project is selected, aggregate collections from all projects
          console.log('[AUTOCOMPLETE] create-auction collection: No project selected, aggregating from all projects');
          const communityFundProjectName = getCommunityFundProjectName();
          const allCollectionsMap = new Map();
          
          // Fetch collections from all projects (excluding Community Fund)
          const projectNames = Object.keys(projects).filter(name => name !== communityFundProjectName);
          
          if (projectNames.length === 0) {
            console.log('[AUTOCOMPLETE] create-auction collection: No projects available');
            await safeRespond(interaction, []);
            return;
          }
          
          // Fetch from all projects in parallel (with timeout)
          const fetchPromises = projectNames.map(async (projectName) => {
            const project = projects[projectName];
            if (!project || !project.walletAddress) {
              return [];
            }
            
            try {
              // Fetch all NFTs with pagination
              const allItems = await fetchAllNFTs(project.walletAddress, 3000); // Shorter timeout for parallel requests
              return allItems || [];
            } catch (error) {
              if (error.name !== 'AbortError') {
                console.error(`[AUTOCOMPLETE] create-auction collection: Error fetching from ${projectName}:`, error.message);
              }
              return [];
            }
          });
          
          const allResults = await Promise.all(fetchPromises);
          const allItems = allResults.flat();
          
          console.log(`[AUTOCOMPLETE] create-auction collection: Found ${allItems.length} total items from ${projectNames.length} projects`);
          
          // Extract unique collections from all projects
          allItems.forEach(item => {
            // Only include collections that have NFTs (not SFTs) and have media URLs
            if (item.type === 'NonFungibleESDT' && 
                item.collection && 
                item.media && 
                item.media.length > 0 && 
                item.media[0].url) {
              
              if (!allCollectionsMap.has(item.collection)) {
                // Extract collection name from first NFT in collection or use ticker
                const collectionName = item.name?.split('#')[0]?.trim() || 
                                      item.collection.split('-')[0] || 
                                      item.collection;
                const ticker = item.ticker || item.collection.split('-')[0] || '';
                
                allCollectionsMap.set(item.collection, {
                  identifier: item.collection,
                  name: collectionName,
                  ticker: ticker
                });
              }
            }
          });
          
          const collections = Array.from(allCollectionsMap.values());
          console.log(`[AUTOCOMPLETE] create-auction collection: Extracted ${collections.length} unique NFT collections from all projects`);
          
          const choices = collections.map(collection => ({
            name: `${collection.name}${collection.ticker ? ` (${collection.ticker})` : ''}`,
            value: collection.identifier
          })).filter(choice => choice.value);
          
          const filtered = choices.filter(choice =>
            choice.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
            choice.value.toLowerCase().includes(focusedValue.toLowerCase())
          );
          
          console.log(`[AUTOCOMPLETE] create-auction collection: Returning ${filtered.length} filtered choices from all projects`);
          await safeRespond(interaction, filtered.slice(0, 25));
          return;
        } catch (projectError) {
          if (projectError.name !== 'AbortError') {
            console.error('[AUTOCOMPLETE] create-auction collection: Error fetching from Project Wallet:', projectError.message, projectError.stack);
          }
          await safeRespond(interaction, []);
          return;
        }
      }
      
      // Unknown source value
      console.log('[AUTOCOMPLETE] create-auction collection: Unknown source value:', source);
      await safeRespond(interaction, []);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[AUTOCOMPLETE] create-auction collection: Error fetching collections:', error.message, error.stack);
      }
      await safeRespond(interaction, []);
    }
    return;
  }

  // NFT NAME AUTOCOMPLETE FOR CREATE-AUCTION
  if (interaction.commandName === 'create-auction' && interaction.options.getFocused(true).name === 'nft-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const source = interaction.options.getString('source');
      const selectedCollection = interaction.options.getString('collection');
      
      if (!selectedCollection) {
        console.log('[AUTOCOMPLETE] create-auction nft-name: Missing collection');
        await safeRespond(interaction, []);
        return;
      }
      
      // If source is Virtual Account, fetch from user's virtual account NFT balances
      if (source === 'virtual_account') {
        const userId = interaction.user.id;
        console.log('[AUTOCOMPLETE] create-auction nft-name: Fetching from Virtual Account for user:', userId, 'collection:', selectedCollection);
        
        // Get user's NFTs in selected collection
        const nfts = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, selectedCollection);
        console.log('[AUTOCOMPLETE] create-auction nft-name: Found NFTs from VA:', nfts.length);
        
        // Filter by focused value (match by name or identifier)
        const filtered = nfts.filter(nft => {
          const name = nft.nft_name || `${selectedCollection}#${nft.nonce}`;
          const identifier = `${selectedCollection}#${nft.nonce}`;
          return name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                 identifier.toLowerCase().includes(focusedValue.toLowerCase());
        });
        
        await safeRespond(interaction,
          filtered.slice(0, 25).map(nft => ({
            name: `${nft.nft_name || `${selectedCollection}#${nft.nonce}`} (${selectedCollection}#${nft.nonce})`,
            value: nft.nft_name || `${selectedCollection}#${nft.nonce}`
          }))
        );
        return;
      }
      
      // Otherwise, use project wallet logic
      const projects = await getProjects(guildId);
      const selectedProject = interaction.options.getString('project-name');
      
      // If a specific project is selected, fetch from that project only
      if (selectedProject && projects[selectedProject]) {
        const project = projects[selectedProject];
        const walletAddress = project.walletAddress;
        
        if (!walletAddress) {
          console.log('[AUTOCOMPLETE] create-auction nft-name: No wallet address');
          await safeRespond(interaction, []);
          return;
        }
        
        // Fetch all NFTs/SFTs from MultiversX API with pagination - this endpoint excludes MetaESDT automatically
        console.log('[AUTOCOMPLETE] create-auction nft-name: Fetching from wallet', walletAddress);
        console.log('[AUTOCOMPLETE] create-auction nft-name: Filtering for collection:', selectedCollection);
        
        const allItems = await fetchAllNFTs(walletAddress, 3000);
        
        if (!Array.isArray(allItems) || allItems.length === 0) {
          console.log('[AUTOCOMPLETE] create-auction nft-name: No NFTs found or invalid format');
          await safeRespond(interaction, []);
          return;
        }
        
        console.log(`[AUTOCOMPLETE] create-auction nft-name: Found ${allItems.length} items from API`);
        
        // Filter to only include actual NFTs (NonFungibleESDT) from the selected collection
        // Also ensure they have media URLs (required for auctions)
        const actualNFTs = allItems.filter(item => {
          // Only include NonFungibleESDT type (exclude SemiFungibleESDT)
          const isNFT = item.type === 'NonFungibleESDT';
          
          // Must have media URL (required for auction display)
          const hasMedia = item.media && item.media.length > 0 && item.media[0].url;
          
          // Match collection exactly (case-insensitive)
          const matchesCollection = item.collection && 
            (item.collection.toLowerCase() === selectedCollection.toLowerCase() ||
             item.collection === selectedCollection);
          
          return isNFT && hasMedia && matchesCollection;
        });
        
        console.log(`[AUTOCOMPLETE] create-auction nft-name: Filtered to ${actualNFTs.length} NFTs from collection "${selectedCollection}" (excluded ${allItems.length - actualNFTs.length} SFTs/other collections/items without media)`);
        
        const choices = actualNFTs.map(nft => ({
          name: nft.name || nft.identifier || 'Unnamed NFT',
          value: nft.name || nft.identifier
        })).filter(choice => choice.value); // Filter out invalid entries
        
        const filtered = choices.filter(choice =>
          choice.name.toLowerCase().includes(focusedValue.toLowerCase())
        );
        
        console.log(`[AUTOCOMPLETE] create-auction nft-name: Returning ${filtered.length} filtered choices`);
        await safeRespond(interaction, filtered.slice(0, 25));
        return;
      }
      
      // If no project is selected, aggregate NFTs from all projects that have the selected collection
      console.log('[AUTOCOMPLETE] create-auction nft-name: No project selected, aggregating from all projects');
      const communityFundProjectName = getCommunityFundProjectName();
      
      // Fetch NFTs from all projects (excluding Community Fund)
      const projectNames = Object.keys(projects).filter(name => name !== communityFundProjectName);
      
      if (projectNames.length === 0) {
        console.log('[AUTOCOMPLETE] create-auction nft-name: No projects available');
        await safeRespond(interaction, []);
        return;
      }
      
      // Fetch from all projects in parallel (with timeout)
      const fetchPromises = projectNames.map(async (projectName) => {
        const project = projects[projectName];
        if (!project || !project.walletAddress) {
          return [];
        }
        
        try {
          // Fetch all NFTs with pagination
          const allItems = await fetchAllNFTs(project.walletAddress, 3000); // Shorter timeout for parallel requests
          return allItems || [];
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.error(`[AUTOCOMPLETE] create-auction nft-name: Error fetching from ${projectName}:`, error.message);
          }
          return [];
        }
      });
      
      const allResults = await Promise.all(fetchPromises);
      const allItems = allResults.flat();
      
      console.log(`[AUTOCOMPLETE] create-auction nft-name: Found ${allItems.length} total items from ${projectNames.length} projects`);
      
      // Filter to only include actual NFTs (NonFungibleESDT) from the selected collection
      // Also ensure they have media URLs (required for auctions)
      const actualNFTs = allItems.filter(item => {
        // Only include NonFungibleESDT type (exclude SemiFungibleESDT)
        const isNFT = item.type === 'NonFungibleESDT';
        
        // Must have media URL (required for auction display)
        const hasMedia = item.media && item.media.length > 0 && item.media[0].url;
        
        // Match collection exactly (case-insensitive)
        const matchesCollection = item.collection && 
          (item.collection.toLowerCase() === selectedCollection.toLowerCase() ||
           item.collection === selectedCollection);
        
        return isNFT && hasMedia && matchesCollection;
      });
      
      console.log(`[AUTOCOMPLETE] create-auction nft-name: Filtered to ${actualNFTs.length} NFTs from collection "${selectedCollection}" across all projects`);
      
      const choices = actualNFTs.map(nft => ({
        name: nft.name || nft.identifier || 'Unnamed NFT',
        value: nft.name || nft.identifier
      })).filter(choice => choice.value); // Filter out invalid entries
      
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      console.log(`[AUTOCOMPLETE] create-auction nft-name: Returning ${filtered.length} filtered choices from all projects`);
      await safeRespond(interaction, filtered.slice(0, 25));
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[AUTOCOMPLETE] create-auction nft-name: Error fetching NFTs:', error.message, error.stack);
      }
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR CREATE-AUCTION
  try {
    const focusedOption = interaction.options.getFocused(true);
    if (interaction.commandName === 'create-auction' && focusedOption && focusedOption.name === 'token-ticker') {
      console.log('[AUTOCOMPLETE] create-auction token-ticker handler reached!');
      try {
        const focusedValue = interaction.options.getFocused();
        const guildId = interaction.guildId;
        const source = interaction.options.getString('source');
        
        console.log('[AUTOCOMPLETE] create-auction token-ticker autocomplete triggered');
        console.log('[AUTOCOMPLETE] Guild ID:', guildId);
        console.log('[AUTOCOMPLETE] Focused value:', focusedValue);
        console.log('[AUTOCOMPLETE] Source:', source);
        
        let supportedTokens = [];
        
        // If source is Virtual Account, use Community Fund supported tokens
        if (source === 'virtual_account') {
          console.log('[AUTOCOMPLETE] create-auction token-ticker: Using Community Fund tokens for Virtual Account source');
          const fundProject = await getCommunityFundProject(guildId);
          const projects = await getProjects(guildId);
          const projectName = getCommunityFundProjectName();
          
          if (fundProject && projects[projectName]) {
            const communityFundProject = projects[projectName];
            // Handle both string (comma-separated) and array formats
            if (communityFundProject.supportedTokens) {
              if (Array.isArray(communityFundProject.supportedTokens)) {
                supportedTokens = communityFundProject.supportedTokens;
              } else if (typeof communityFundProject.supportedTokens === 'string') {
                supportedTokens = communityFundProject.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
              }
            }
            console.log('[AUTOCOMPLETE] Community Fund supported tokens:', supportedTokens);
          } else {
            console.log('[AUTOCOMPLETE] Community Fund project not found');
          }
        } else {
          // Otherwise, use project wallet logic
          const projects = await getProjects(guildId);
          console.log('[AUTOCOMPLETE] Available projects:', Object.keys(projects));
          
          const selectedProject = interaction.options.getString('project-name');
          console.log('[AUTOCOMPLETE] Selected project:', selectedProject);
          
          // If a specific project is selected, use its supported tokens
          if (selectedProject && projects[selectedProject]) {
            const project = projects[selectedProject];
            console.log('[AUTOCOMPLETE] Project data:', {
              name: selectedProject,
              hasSupportedTokens: !!project.supportedTokens,
              supportedTokensType: typeof project.supportedTokens,
              supportedTokensValue: project.supportedTokens
            });
            
            // Handle both string (comma-separated) and array formats
            if (project.supportedTokens) {
              if (Array.isArray(project.supportedTokens)) {
                supportedTokens = project.supportedTokens;
              } else if (typeof project.supportedTokens === 'string') {
                supportedTokens = project.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
              }
            }
          } else {
            // If no project is selected, aggregate supported tokens from all projects (excluding Community Fund)
            console.log('[AUTOCOMPLETE] No project selected, aggregating tokens from all projects');
            const communityFundProjectName = getCommunityFundProjectName();
            const allTokensSet = new Set();
            
            Object.keys(projects).forEach(projectName => {
              if (projectName === communityFundProjectName) {
                return; // Skip Community Fund
              }
              
              const project = projects[projectName];
              if (project && project.supportedTokens) {
                let projectTokens = [];
                if (Array.isArray(project.supportedTokens)) {
                  projectTokens = project.supportedTokens;
                } else if (typeof project.supportedTokens === 'string') {
                  projectTokens = project.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
                }
                
                projectTokens.forEach(token => {
                  if (token) {
                    allTokensSet.add(token);
                  }
                });
              }
            });
            
            supportedTokens = Array.from(allTokensSet);
            console.log('[AUTOCOMPLETE] Aggregated tokens from all projects:', supportedTokens);
          }
        }
        
        console.log('[AUTOCOMPLETE] Supported tokens after processing:', supportedTokens);
        
        if (supportedTokens.length === 0) {
          console.log('[AUTOCOMPLETE] No supported tokens found');
          await safeRespond(interaction, []);
          return;
        }
        
        const choices = supportedTokens
          .filter(token => token.toLowerCase().includes(focusedValue.toLowerCase()))
          .map(token => ({
            name: token,
            value: token
          }))
          .slice(0, 25);
        
        console.log('[AUTOCOMPLETE] Filtered choices:', choices);
        console.log('[AUTOCOMPLETE] Sending', choices.length, 'token choices');
        
        await safeRespond(interaction, choices);
        console.log('[AUTOCOMPLETE] Token autocomplete response sent successfully');
      } catch (error) {
        console.error('[AUTOCOMPLETE] Error in create-auction token autocomplete:', error.message);
        console.error('[AUTOCOMPLETE] Full error:', error);
        console.error('[AUTOCOMPLETE] Stack trace:', error.stack);
        await safeRespond(interaction, []);
      }
      return;
    }
  } catch (error) {
    // Catch any error from getFocused(true) itself
    if (interaction.commandName === 'create-auction') {
      console.error('[AUTOCOMPLETE] Error getting focused option for create-auction:', error.message);
      console.error('[AUTOCOMPLETE] Full error:', error);
    }
  }

  // USER AUTOCOMPLETE FOR SEND-NFT
  if (interaction.commandName === 'send-nft' && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      
      let choices = [];
      const userWallets = await getUserWallets(guildId);
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

  // PROJECT NAME AUTOCOMPLETE FOR UPDATE-PROJECT
  if (interaction.commandName === 'update-project' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = await getProjects(guildId);
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
      const projects = await getProjects(guildId);
      const availableProjects = Object.keys(projects);
      
      const options = [];
      
      // Add regular projects
      const filtered = availableProjects.filter(projectName =>
        projectName.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      options.push(...filtered.slice(0, 24).map(projectName => ({ name: projectName, value: projectName })));
      
      await safeRespond(interaction, options);
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
      const projects = await getProjects(guildId);
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

  // PROJECT AUTOCOMPLETE FOR HOUSE-WITHDRAW
  if (interaction.commandName === 'house-withdraw' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = await getProjects(guildId);
      const communityFundProject = await getCommunityFundProject(guildId);
      
      // Filter out Community Fund project (always named "Community Fund") and get projects that have wallet configured
      const communityFundProjectName = getCommunityFundProjectName(); // Always "Community Fund"
      const availableProjects = Object.entries(projects)
        .filter(([name, project]) => 
          name !== communityFundProjectName && // Exclude Community Fund by actual project name
          project.walletAddress && 
          project.walletPem
        )
        .map(([name]) => name)
        .filter(name =>
          name.toLowerCase().includes(focusedValue.toLowerCase())
        )
        .map(name => ({
          name: name,
          value: name
        }));
      
      await safeRespond(interaction, availableProjects.slice(0, 25));
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in house-withdraw project-name autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR HOUSE-WITHDRAW
  if (interaction.commandName === 'house-withdraw' && interaction.options.getFocused(true).name === 'token') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const source = interaction.options.getString('source') || 'betting';
      const projectName = interaction.options.getString('project-name');
      
      const houseBalanceData = await getAllHouseBalances(guildId);
      const projects = await getProjects(guildId);
      const project = projectName ? projects[projectName] : null;
      
      // Get tokens that house has balance for AND project supports
      // houseBalanceData structure: {token_identifier: {bettingEarnings: {token: amount}, bettingSpending: {token: amount}, ...}}
      // Aggregate balances similar to how house-balance command does it
      const aggregatedBalances = {
        bettingEarnings: {},
        bettingSpending: {},
        auctionEarnings: {},
        auctionSpending: {},
        lotteryEarnings: {},
        lotterySpending: {}
      };
      
      // Aggregate balances from all token records (similar to house-balance command)
      for (const [tokenIdentifier, tokenData] of Object.entries(houseBalanceData || {})) {
        // Merge betting earnings
        if (tokenData.bettingEarnings) {
          for (const [token, amount] of Object.entries(tokenData.bettingEarnings)) {
            if (!aggregatedBalances.bettingEarnings[token]) {
              aggregatedBalances.bettingEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingEarnings[token] || '0');
            aggregatedBalances.bettingEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge betting spending
        if (tokenData.bettingSpending) {
          for (const [token, amount] of Object.entries(tokenData.bettingSpending)) {
            if (!aggregatedBalances.bettingSpending[token]) {
              aggregatedBalances.bettingSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingSpending[token] || '0');
            aggregatedBalances.bettingSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction earnings
        if (tokenData.auctionEarnings) {
          for (const [token, amount] of Object.entries(tokenData.auctionEarnings)) {
            if (!aggregatedBalances.auctionEarnings[token]) {
              aggregatedBalances.auctionEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionEarnings[token] || '0');
            aggregatedBalances.auctionEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction spending
        if (tokenData.auctionSpending) {
          for (const [token, amount] of Object.entries(tokenData.auctionSpending)) {
            if (!aggregatedBalances.auctionSpending[token]) {
              aggregatedBalances.auctionSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionSpending[token] || '0');
            aggregatedBalances.auctionSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery earnings
        if (tokenData.lotteryEarnings) {
          for (const [token, amount] of Object.entries(tokenData.lotteryEarnings)) {
            if (!aggregatedBalances.lotteryEarnings[token]) {
              aggregatedBalances.lotteryEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
            aggregatedBalances.lotteryEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery spending
        if (tokenData.lotterySpending) {
          for (const [token, amount] of Object.entries(tokenData.lotterySpending)) {
            if (!aggregatedBalances.lotterySpending[token]) {
              aggregatedBalances.lotterySpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
            aggregatedBalances.lotterySpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
      }
      
      // Get all unique tokens from aggregated balances
      const allTokens = new Set([
        ...Object.keys(aggregatedBalances.bettingEarnings),
        ...Object.keys(aggregatedBalances.bettingSpending),
        ...Object.keys(aggregatedBalances.auctionEarnings),
        ...Object.keys(aggregatedBalances.auctionSpending),
        ...Object.keys(aggregatedBalances.lotteryEarnings),
        ...Object.keys(aggregatedBalances.lotterySpending)
      ]);
      
      // Filter tokens that have balance > 0 for the selected source
      let availableTokens = [];
      for (const token of allTokens) {
        let balance = new BigNumber(0);
        
        if (source === 'auction') {
          // Calculate auction PNL: earnings - spending
          const auctionEarnings = new BigNumber(aggregatedBalances.auctionEarnings[token] || '0');
          const auctionSpending = new BigNumber(aggregatedBalances.auctionSpending[token] || '0');
          balance = auctionEarnings.minus(auctionSpending);
        } else if (source === 'lottery') {
          // Calculate lottery PNL: earnings - spending
          const lotteryEarnings = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
          const lotterySpending = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
          balance = lotteryEarnings.minus(lotterySpending);
        } else {
          // Calculate betting PNL: earnings - spending
          const bettingEarnings = new BigNumber(aggregatedBalances.bettingEarnings[token] || '0');
          const bettingSpending = new BigNumber(aggregatedBalances.bettingSpending[token] || '0');
          balance = bettingEarnings.minus(bettingSpending);
        }
        
        // Only include tokens with balance > 0
        if (!balance.isGreaterThan(0)) continue;
        
        // If project is selected, check if it supports this token
        if (project) {
          const supportedTokens = Array.isArray(project.supportedTokens) 
            ? project.supportedTokens 
            : (project.supportedTokens || '').split(',').map(t => t.trim());
          if (!supportedTokens.includes(token)) continue;
        }
        
        availableTokens.push(token);
      }
      
      const filtered = availableTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in house-withdraw token autocomplete:', error);
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
      const userWallets = await getUserWallets(guildId);
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

  // USER AUTOCOMPLETE FOR DEBUG-USER
  if (interaction.commandName === 'debug-user' && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      
      let choices = [];
      const userWallets = await getUserWallets(guildId);
      // Increase limit to 100 users to ensure more users are available for autocomplete
      const userWalletEntries = Object.entries(userWallets).slice(0, 100);
      if (userWalletEntries.length > 0) {
        console.log(`[AUTOCOMPLETE] Processing ${userWalletEntries.length} users for debug-user user-tag autocomplete`);
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
      const fundProject = await getCommunityFundProject(guildId);
      let supportedTokens = [];
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (fundProject && projects[projectName]) {
        supportedTokens = projects[projectName].supportedTokens || [];
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
      const source = interaction.options.getString('source') || 'betting';
      
      // Get tokens that house has balance for based on source
      const houseBalanceData = await getAllHouseBalances(guildId);
      
      // Aggregate balances from all token records
      const aggregatedBalances = {
        bettingEarnings: {},
        bettingSpending: {},
        auctionEarnings: {},
        auctionSpending: {},
        lotteryEarnings: {},
        lotterySpending: {}
      };
      
      for (const [tokenIdentifier, tokenData] of Object.entries(houseBalanceData || {})) {
        // Merge betting earnings
        if (tokenData.bettingEarnings) {
          for (const [token, amount] of Object.entries(tokenData.bettingEarnings)) {
            if (!aggregatedBalances.bettingEarnings[token]) {
              aggregatedBalances.bettingEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingEarnings[token] || '0');
            aggregatedBalances.bettingEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge betting spending
        if (tokenData.bettingSpending) {
          for (const [token, amount] of Object.entries(tokenData.bettingSpending)) {
            if (!aggregatedBalances.bettingSpending[token]) {
              aggregatedBalances.bettingSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.bettingSpending[token] || '0');
            aggregatedBalances.bettingSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction earnings
        if (tokenData.auctionEarnings) {
          for (const [token, amount] of Object.entries(tokenData.auctionEarnings)) {
            if (!aggregatedBalances.auctionEarnings[token]) {
              aggregatedBalances.auctionEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionEarnings[token] || '0');
            aggregatedBalances.auctionEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge auction spending
        if (tokenData.auctionSpending) {
          for (const [token, amount] of Object.entries(tokenData.auctionSpending)) {
            if (!aggregatedBalances.auctionSpending[token]) {
              aggregatedBalances.auctionSpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.auctionSpending[token] || '0');
            aggregatedBalances.auctionSpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery earnings
        if (tokenData.lotteryEarnings) {
          for (const [token, amount] of Object.entries(tokenData.lotteryEarnings)) {
            if (!aggregatedBalances.lotteryEarnings[token]) {
              aggregatedBalances.lotteryEarnings[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
            aggregatedBalances.lotteryEarnings[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
        
        // Merge lottery spending
        if (tokenData.lotterySpending) {
          for (const [token, amount] of Object.entries(tokenData.lotterySpending)) {
            if (!aggregatedBalances.lotterySpending[token]) {
              aggregatedBalances.lotterySpending[token] = '0';
            }
            const current = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
            aggregatedBalances.lotterySpending[token] = current.plus(new BigNumber(amount || '0')).toString();
          }
        }
      }
      
      // Get all unique tokens from aggregated balances
      const allTokens = new Set([
        ...Object.keys(aggregatedBalances.bettingEarnings),
        ...Object.keys(aggregatedBalances.bettingSpending),
        ...Object.keys(aggregatedBalances.auctionEarnings),
        ...Object.keys(aggregatedBalances.auctionSpending),
        ...Object.keys(aggregatedBalances.lotteryEarnings),
        ...Object.keys(aggregatedBalances.lotterySpending)
      ]);
      
      // Filter tokens that have balance > 0 for the selected source
      let availableTokens = [];
      for (const token of allTokens) {
        let balance = new BigNumber(0);
        
        if (houseType === 'auction') {
          // Calculate auction PNL: earnings - spending
          const auctionEarnings = new BigNumber(aggregatedBalances.auctionEarnings[token] || '0');
          const auctionSpending = new BigNumber(aggregatedBalances.auctionSpending[token] || '0');
          balance = auctionEarnings.minus(auctionSpending);
        } else if (houseType === 'lottery') {
          // Calculate lottery PNL: earnings - spending
          const lotteryEarnings = new BigNumber(aggregatedBalances.lotteryEarnings[token] || '0');
          const lotterySpending = new BigNumber(aggregatedBalances.lotterySpending[token] || '0');
          balance = lotteryEarnings.minus(lotterySpending);
        } else {
          // Calculate betting PNL: earnings - spending
          const bettingEarnings = new BigNumber(aggregatedBalances.bettingEarnings[token] || '0');
          const bettingSpending = new BigNumber(aggregatedBalances.bettingSpending[token] || '0');
          balance = bettingEarnings.minus(bettingSpending);
        }
        
        // Only include tokens with balance > 0
        if (!balance.isGreaterThan(0)) continue;
        
        availableTokens.push(token);
      }
      
      const filtered = availableTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in house-tip token autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR CHALLENGE-RPS
  if (interaction.commandName === 'challenge-rps' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const fundProject = await getCommunityFundProject(guildId);
      let supportedTokens = [];
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (fundProject && projects[projectName]) {
        supportedTokens = projects[projectName].supportedTokens || [];
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

  // TOKEN AUTOCOMPLETE FOR LOTTERY COMMANDS
  if ((interaction.commandName === 'create-lottery' || 
       interaction.commandName === 'my-active-lottery-tickets' || 
       interaction.commandName === 'my-expired-tickets') && 
      interaction.options.getFocused(true).name === 'token') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      
      // Get supported tokens from Community Fund project
      const fundProject = await getCommunityFundProject(guildId);
      let supportedTokens = [];
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (fundProject && projects[projectName]) {
        supportedTokens = projects[projectName].supportedTokens || [];
      }
      
      // If no tokens found, try to get tokens from any available project
      if (supportedTokens.length === 0) {
        for (const [projectName, project] of Object.entries(projects)) {
          if (project.supportedTokens && project.supportedTokens.length > 0) {
            supportedTokens = project.supportedTokens;
            break;
          }
        }
      }
      
      const filtered = supportedTokens
        .filter(token => token.toLowerCase().includes(focusedValue.toLowerCase()))
        .map(token => ({ name: token, value: token }))
        .slice(0, 25);
      
      await safeRespond(interaction, filtered);
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in lottery token autocomplete:', error.message);
      await safeRespond(interaction, []);
    }
    return;
  }

  // USER AUTOCOMPLETE FOR TIP-VIRTUAL
  if ((interaction.commandName === 'tip-virtual-esdt' || interaction.commandName === 'tip-virtual-nft') && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      
      let choices = [];
      const userWallets = await getUserWallets(guildId);
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

  // TOKEN AUTOCOMPLETE FOR TIP-VIRTUAL-ESDT
  if (interaction.commandName === 'tip-virtual-esdt' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const fundProject = await getCommunityFundProject(guildId);
      let supportedTokens = [];
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      if (fundProject && projects[projectName]) {
        supportedTokens = projects[projectName].supportedTokens || [];
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

  // TOKEN AUTOCOMPLETE FOR WITHDRAW-ESDT (based on user's actual holdings)
  if (interaction.commandName === 'withdraw-esdt' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Force reload virtual accounts data
      virtualAccounts.forceReloadData();
      
      // Get user's actual token holdings (await the async function)
      const userBalances = await virtualAccounts.getAllUserBalances(guildId, userId);
      
      // Filter tokens with balance > 0
      const userTokens = Object.keys(userBalances || {}).filter(token => {
        const balance = userBalances[token];
        if (!balance) return false;
        try {
          return new BigNumber(balance).isGreaterThan(0);
        } catch (error) {
          console.error(`[AUTOCOMPLETE] Error parsing balance for token ${token}:`, error);
          return false;
        }
      });
      
      const filtered = userTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      // Format token names for display
      const options = filtered.slice(0, 25).map(token => {
        const balance = userBalances[token];
        const displayName = token.includes('-') ? token.split('-')[0] : token;
        return { 
          name: `${displayName} (${token}) - Balance: ${balance}`, 
          value: token 
        };
      });
      
      await safeRespond(interaction, options);
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in withdraw token autocomplete:', error);
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
      const userWallets = await getUserWallets(guildId);
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
        const fundProject = await getCommunityFundProject(guildId);
        const projects = await getProjects(guildId);
        const projectName = getCommunityFundProjectName();
        
        console.log('[AUTOCOMPLETE] Fund project:', fundProject);
        console.log('[AUTOCOMPLETE] Available projects:', Object.keys(projects));
        
        let supportedTokens = [];
        if (fundProject && projects[projectName]) {
          supportedTokens = projects[projectName].supportedTokens || [];
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

  // COLLECTION AUTOCOMPLETE FOR CHECK-BALANCE-NFT, BALANCE-HISTORY-NFT, SELL-NFT, WITHDRAW-NFT, AND SHOW-MY-NFT
  if ((interaction.commandName === 'check-balance-nft' || 
       interaction.commandName === 'balance-history-nft' || 
       interaction.commandName === 'sell-nft' ||
       interaction.commandName === 'withdraw-nft' ||
       interaction.commandName === 'tip-virtual-nft' ||
       interaction.commandName === 'show-my-nft') && 
      interaction.options.getFocused(true).name === 'collection') {
    try {
      console.log('[AUTOCOMPLETE] Collection autocomplete for command:', interaction.commandName);
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      console.log('[AUTOCOMPLETE] Getting collections for user:', userId, 'guild:', guildId);
      // Get user's collections
      const collections = await virtualAccountsNFT.getUserCollections(guildId, userId);
      console.log('[AUTOCOMPLETE] Found collections:', collections);
      
      // Filter by focused value
      const filtered = collections.filter(collection =>
        collection.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      console.log('[AUTOCOMPLETE] Filtered collections:', filtered);
      await safeRespond(interaction,
        filtered.slice(0, 25).map(collection => ({ name: collection, value: collection }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in collection autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // NFT NAME AUTOCOMPLETE FOR SELL-NFT
  if (interaction.commandName === 'sell-nft' && interaction.options.getFocused(true).name === 'nft-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const selectedCollection = interaction.options.getString('collection');
      
      if (!selectedCollection) {
        await safeRespond(interaction, []);
        return;
      }
      
      // Get user's NFTs in selected collection
      const nfts = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, selectedCollection);
      
      // Get user's active listings to filter out already-listed NFTs
      let activeListings = [];
      try {
        activeListings = await virtualAccountsNFT.getUserListings(guildId, userId, 'ACTIVE');
      } catch (error) {
        console.error('[AUTOCOMPLETE] Error fetching active listings:', error);
        // Continue without filtering if there's an error
      }
      
      // Create a set of (collection, nonce) pairs from active listings for quick lookup
      const listedNFTs = new Set();
      for (const listing of activeListings) {
        listedNFTs.add(`${listing.collection}:${listing.nonce}`);
      }
      
      // Filter out NFTs that are already listed and match the focused value
      const filtered = nfts.filter(nft => {
        // Check if this NFT is already listed
        const nftKey = `${nft.collection}:${nft.nonce}`;
        if (listedNFTs.has(nftKey)) {
          return false; // Skip NFTs that are already listed
        }
        
        // Filter by focused value (match by name or identifier)
        const name = nft.nft_name || `${selectedCollection}#${nft.nonce}`;
        const identifier = `${selectedCollection}#${nft.nonce}`;
        return name.toLowerCase().includes(focusedValue.toLowerCase()) ||
               identifier.toLowerCase().includes(focusedValue.toLowerCase());
      });
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(nft => ({
          name: `${nft.nft_name || `${selectedCollection}#${nft.nonce}`} (${selectedCollection}#${nft.nonce})`,
          value: nft.nft_name || `${selectedCollection}#${nft.nonce}`
        }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in nft-name autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // COLLECTION AUTOCOMPLETE FOR TIP-VIRTUAL-NFT
  if (interaction.commandName === 'tip-virtual-nft' && interaction.options.getFocused(true).name === 'collection') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // Get user's collections
      const collections = await virtualAccountsNFT.getUserCollections(guildId, userId);
      
      // Filter by focused value
      const filtered = collections.filter(collection =>
        collection.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(collection => ({ name: collection, value: collection }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in tip-virtual-nft collection autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // NFT NAME AUTOCOMPLETE FOR SHOW-MY-NFT
  if (interaction.commandName === 'show-my-nft' && interaction.options.getFocused(true).name === 'nft-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const selectedCollection = interaction.options.getString('collection');
      
      if (!selectedCollection) {
        await safeRespond(interaction, []);
        return;
      }
      
      // Get user's NFTs in selected collection
      const nfts = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, selectedCollection);
      
      // Filter by focused value (match by name or identifier)
      const filtered = nfts.filter(nft => {
        const name = nft.nft_name || `${selectedCollection}#${nft.nonce}`;
        const identifier = `${selectedCollection}#${nft.nonce}`;
        return name.toLowerCase().includes(focusedValue.toLowerCase()) ||
               identifier.toLowerCase().includes(focusedValue.toLowerCase());
      });
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(nft => ({
          name: `${nft.nft_name || `${selectedCollection}#${nft.nonce}`} (${selectedCollection}#${nft.nonce})`,
          value: nft.nft_name || `${selectedCollection}#${nft.nonce}`
        }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in show-my-nft nft-name autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // NFT NAME AUTOCOMPLETE FOR TIP-VIRTUAL-NFT
  if (interaction.commandName === 'tip-virtual-nft' && interaction.options.getFocused(true).name === 'nft-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const selectedCollection = interaction.options.getString('collection');
      
      if (!selectedCollection) {
        await safeRespond(interaction, []);
        return;
      }
      
      // Get user's NFTs in selected collection
      const nfts = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, selectedCollection);
      
      // Filter by focused value (match by name or identifier)
      const filtered = nfts.filter(nft => {
        const name = nft.nft_name || `${selectedCollection}#${nft.nonce}`;
        const identifier = `${selectedCollection}#${nft.nonce}`;
        return name.toLowerCase().includes(focusedValue.toLowerCase()) ||
               identifier.toLowerCase().includes(focusedValue.toLowerCase());
      });
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(nft => ({
          name: `${nft.nft_name || `${selectedCollection}#${nft.nonce}`} (${selectedCollection}#${nft.nonce})`,
          value: nft.nft_name || `${selectedCollection}#${nft.nonce}`
        }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in tip-virtual-nft nft-name autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // NFT NAME AUTOCOMPLETE FOR WITHDRAW-NFT
  if (interaction.commandName === 'withdraw-nft' && interaction.options.getFocused(true).name === 'nft-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const selectedCollection = interaction.options.getString('collection');
      
      if (!selectedCollection) {
        await safeRespond(interaction, []);
        return;
      }
      
      // Get user's NFTs in selected collection
      const nfts = await virtualAccountsNFT.getUserNFTBalances(guildId, userId, selectedCollection);
      
      // Filter by focused value (match by name or identifier)
      const filtered = nfts.filter(nft => {
        const name = nft.nft_name || `${selectedCollection}#${nft.nonce}`;
        const identifier = `${selectedCollection}#${nft.nonce}`;
        return name.toLowerCase().includes(focusedValue.toLowerCase()) ||
               identifier.toLowerCase().includes(focusedValue.toLowerCase());
      });
      
      await safeRespond(interaction,
        filtered.slice(0, 25).map(nft => ({
          name: `${nft.nft_name || `${selectedCollection}#${nft.nonce}`} (${selectedCollection}#${nft.nonce})`,
          value: nft.nft_name || `${selectedCollection}#${nft.nonce}`
        }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in withdraw-nft nft-name autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // PRICE TOKEN AUTOCOMPLETE FOR SELL-NFT
  if (interaction.commandName === 'sell-nft' && interaction.options.getFocused(true).name === 'price-token') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      
      // Get Community Fund project and its supported tokens
      const fundProject = await getCommunityFundProject(guildId);
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      
      let supportedTokens = [];
      if (fundProject && projects[projectName]) {
        const tokensRaw = projects[projectName].supportedTokens || [];
        supportedTokens = Array.isArray(tokensRaw)
          ? tokensRaw
          : (tokensRaw || '').split(',').map(t => t.trim()).filter(t => t.length > 0);
      }
      
      if (supportedTokens.length === 0) {
        await safeRespond(interaction, []);
        return;
      }
      
      // Get token metadata for display names
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      
      // Filter tokens that match focused value and return full identifiers
      const filtered = supportedTokens
        .filter(identifier => {
          const lowerIdentifier = identifier.toLowerCase();
          const lowerFocused = focusedValue.toLowerCase();
          // Match if identifier contains focused value
          if (lowerIdentifier.includes(lowerFocused)) {
            return true;
          }
          // Also check ticker from metadata
          const metadata = tokenMetadata[identifier];
          if (metadata && metadata.ticker && metadata.ticker.toLowerCase().includes(lowerFocused)) {
            return true;
          }
          return false;
        })
        .map(identifier => {
          // Find display name from metadata (ticker or identifier)
          const metadata = tokenMetadata[identifier];
          const displayName = metadata && metadata.ticker 
            ? `${metadata.ticker} (${identifier})` 
            : identifier;
          return { identifier, displayName };
        })
        .slice(0, 25);
      
      await safeRespond(interaction,
        filtered.map(({ identifier, displayName }) => ({ 
          name: displayName, 
          value: identifier 
        }))
      );
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in price-token autocomplete:', error);
      await safeRespond(interaction, []);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE FOR VIRTUAL-HOUSE-TOPUP
  if (interaction.commandName === 'virtual-house-topup') {
    const focusedOption = interaction.options.getFocused(true);
    if (!focusedOption || focusedOption.name !== 'token') return;
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      
      console.log('[AUTOCOMPLETE] virtual-house-topup token autocomplete for guild:', guildId);
      console.log('[AUTOCOMPLETE] Focused value:', focusedValue);
      
      // Get Community Fund project and its supported tokens
      const fundProject = await getCommunityFundProject(guildId);
      const projects = await getProjects(guildId);
      const projectName = getCommunityFundProjectName();
      
      let supportedTokens = [];
      if (fundProject && projects[projectName]) {
        supportedTokens = projects[projectName].supportedTokens || [];
        console.log('[AUTOCOMPLETE] Supported tokens from Community Fund project:', supportedTokens);
      } else {
        console.log('[AUTOCOMPLETE] No Community Fund project found');
        await safeRespond(interaction, []);
        return;
      }
      
      if (supportedTokens.length === 0) {
        console.log('[AUTOCOMPLETE] No supported tokens found for Community Fund project');
        await safeRespond(interaction, []);
        return;
      }
      
      // Get token metadata for display
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      
      // Filter tokens that are in Community Fund supported tokens list and match focused value
      const choices = supportedTokens
        .filter(tokenIdentifier => {
          // Check if token matches focused value (case-insensitive)
          const matches = tokenIdentifier.toLowerCase().includes(focusedValue.toLowerCase());
          if (!matches) return false;
          
          // Get token metadata for display name
          const metadata = tokenMetadata[tokenIdentifier];
          return metadata !== undefined; // Only include tokens with metadata
        })
        .map(tokenIdentifier => {
          const metadata = tokenMetadata[tokenIdentifier];
          const displayName = metadata?.ticker || tokenIdentifier.split('-')[0];
          return {
            name: `${displayName} (${tokenIdentifier})`,
            value: tokenIdentifier
          };
        })
        .slice(0, 25);
      
      console.log('[AUTOCOMPLETE] Sending', choices.length, 'token choices for virtual-house-topup');
      await safeRespond(interaction, choices);
    } catch (error) {
      console.error('[AUTOCOMPLETE] Error in virtual-house-topup token autocomplete:', error.message);
      await safeRespond(interaction, []);
    }
    return;
  }
});

// Button interaction handler for football betting and wallet registration
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId } = interaction;
  const guildId = interaction.guildId;

  console.log(`[BUTTON] Button clicked: ${customId} in guild ${guildId}`);

  // Handle wallet registration button
  if (customId === 'register-wallet') {
    try {
      // Create modal for wallet registration
      const modal = new ModalBuilder()
        .setCustomId('wallet-registration-modal')
        .setTitle('Register Your Wallet');

      const walletInput = new TextInputBuilder()
        .setCustomId('wallet-address-input')
        .setLabel('MultiversX Wallet Address')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('erd1...')
        .setRequired(true)
        .setMaxLength(62)
        .setMinLength(62);

      const firstActionRow = new ActionRowBuilder().addComponents(walletInput);
      modal.addComponents(firstActionRow);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('Error showing wallet registration modal:', error);
      await interaction.reply({ 
        content: `❌ Error opening registration form: ${error.message}`, 
        flags: [MessageFlags.Ephemeral] 
      });
    }
    return;
  }

  if (customId.startsWith('bet:')) {
    try {
      const matchId = customId.split(':')[1];
      const match = await dbFootball.getMatch(matchId);
      
      if (!match || !match.guildIds || !match.guildIds.includes(guildId)) {
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
      const challenges = await getRPSChallenges(guildId);
      console.log('[RPS MODAL] Available challenges:', Object.keys(challenges));
      console.log('[RPS MODAL] Challenges object type:', typeof challenges);
      console.log('[RPS MODAL] Challenges is array:', Array.isArray(challenges));
      console.log('[RPS MODAL] Challenges is object:', challenges && typeof challenges === 'object');
      // Data is loaded from database on-demand
      
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
      const challenges = await getRPSChallenges(guildId);
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
      
      // Update game in database with the new move
      await dbRpsGames.updateGame(guildId, challengeId, { rounds: challenge.rounds });
      
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
          
          // Update game in database with draw result and new round
          await dbRpsGames.updateGame(guildId, challengeId, { 
            rounds: challenge.rounds,
            currentRound: challenge.currentRound
          });
          
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
          
          // Update game in database with completion status and winner info
          await dbRpsGames.updateGame(guildId, challengeId, {
            status: 'completed',
            rounds: challenge.rounds,
            winner: challenge.winner,
            winnerId: challenge.winnerId,
            winnerTag: challenge.winnerTag,
            loserId: challenge.loserId,
            loserTag: challenge.loserTag,
            completedAt: challenge.completedAt
          });
          
          // Get balances BEFORE adding prize to ensure we have correct loser balance
          virtualAccounts.forceReloadData();
          const loserBalance = await virtualAccounts.getUserBalance(guildId, loserId, challenge.token);
          const winnerBalanceBeforePrize = await virtualAccounts.getUserBalance(guildId, winnerId, challenge.token);
          
          console.log(`[RPS DEBUG] Before prize (second handler) - Winner: ${winnerId}, Loser: ${loserId}, Token: ${challenge.token}`);
          console.log(`[RPS DEBUG] Winner balance before prize: ${winnerBalanceBeforePrize}, Loser balance: ${loserBalance}`);
          
          // Prize transfer to virtual account
          const totalPrizeHuman = Number(challenge.humanAmount) * 2;
          let prizeResult = null;
          
          if (challenge.humanAmount && challenge.token) {
            try {
              prizeResult = await virtualAccounts.addFundsToAccount(
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
          const winnerBalance = await virtualAccounts.getUserBalance(guildId, winnerId, challenge.token);
          
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
              // Get Community Fund project logo for RPS winner notification
              const communityFundProjectName = getCommunityFundProjectName();
              const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
              
              const winnerDMEmbed = new EmbedBuilder()
                .setTitle('🎉 You Won Rock, Paper, Scissors!')
                .setDescription(`Congratulations! You won the RPS game and received **${totalPrizeHuman} ${challenge.token}** in your virtual account.`)
                .addFields([
                  { name: 'Challenge ID', value: `\`${challengeId}\``, inline: true },
                  { name: 'Prize Won', value: `${totalPrizeHuman} ${challenge.token}`, inline: true },
                  { name: 'Your New Balance', value: `${winnerBalance} ${challenge.token}`, inline: true }
                ])
                .setColor('#00FF00')
                .setThumbnail(projectLogoUrl)
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
  } else if (customId.startsWith('lottery-buy-ticket:')) {
    // Buy Ticket button - opens modal
    try {
      const lotteryId = customId.split(':')[1];
      const lottery = await dbLottery.getLottery(guildId, lotteryId);
      
      if (!lottery) {
        await interaction.reply({ content: '❌ Lottery not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (lottery.status !== 'LIVE') {
        await interaction.reply({ content: '❌ This lottery is no longer accepting tickets.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (Date.now() >= lottery.endTime) {
        await interaction.reply({ content: '❌ This lottery has ended.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Create modal for number input
      const modal = new ModalBuilder()
        .setCustomId(`lottery-ticket-modal:${lotteryId}`)
        .setTitle(`Buy Ticket - Pick ${lottery.winningNumbersCount} Numbers`);
      
      // Create input fields for each number
      const inputs = [];
      for (let i = 1; i <= lottery.winningNumbersCount; i++) {
        const numberInput = new TextInputBuilder()
          .setCustomId(`number_${i}`)
          .setLabel(`Number ${i} (1-${lottery.totalPoolNumbers})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`Enter number between 1 and ${lottery.totalPoolNumbers}`)
          .setRequired(true)
          .setMaxLength(3)
          .setMinLength(1);
        
        inputs.push(new ActionRowBuilder().addComponents(numberInput));
      }
      
      modal.addComponents(...inputs);
      await interaction.showModal(modal);
      
    } catch (error) {
      console.error('[LOTTERY] Error showing buy ticket modal:', error.message);
      await interaction.reply({ content: '❌ An error occurred. Please try again.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (customId.startsWith('lottery-lucky-dip:')) {
    // Lucky Dip button - generates random numbers and purchases ticket
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const lotteryId = customId.split(':')[1];
      const lottery = await dbLottery.getLottery(guildId, lotteryId);
      
      if (!lottery) {
        await interaction.editReply({ content: '❌ Lottery not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (lottery.status !== 'LIVE') {
        await interaction.editReply({ content: '❌ This lottery is no longer accepting tickets.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (Date.now() >= lottery.endTime) {
        await interaction.editReply({ content: '❌ This lottery has ended.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Generate random numbers
      const randomNumbers = lotteryHelpers.generateRandomNumbers(lottery.winningNumbersCount, lottery.totalPoolNumbers);
      
      // Process ticket purchase
      await processTicketPurchase(guildId, lotteryId, interaction.user.id, interaction.user.tag, randomNumbers, lottery);
      
      const numbersDisplay = lotteryHelpers.formatNumbersForDisplay(randomNumbers);
      try {
        await interaction.editReply({
          content: `✅ **Lucky Dip Ticket Purchased!**\n\n**Your Numbers:** ${numbersDisplay}\n**Lottery:** \`${lotteryId.substring(0, 16)}...\``,
          flags: [MessageFlags.Ephemeral]
        });
      } catch (replyError) {
        // If reply fails due to connection error, log it but don't fail the purchase
        const isConnectionError = replyError.message.includes('other side closed') || 
                                  replyError.message.includes('ECONNRESET') ||
                                  replyError.message.includes('WebSocket') ||
                                  replyError.code === 'ECONNRESET';
        if (isConnectionError) {
          console.error('[LOTTERY] Connection error when sending success message (ticket was purchased):', replyError.message);
          // Try to send a follow-up message if possible
          try {
            await interaction.followUp({ 
              content: `✅ **Ticket Purchased Successfully!**\n\n**Your Numbers:** ${numbersDisplay}\n**Lottery:** \`${lotteryId.substring(0, 16)}...\``, 
              flags: [MessageFlags.Ephemeral] 
            });
          } catch (followUpError) {
            console.error('[LOTTERY] Failed to send follow-up message:', followUpError.message);
          }
        } else {
          throw replyError; // Re-throw if it's not a connection error
        }
      }
      
    } catch (error) {
      console.error('[LOTTERY] Error processing lucky dip:', error.message);
      console.error('[LOTTERY] Error stack:', error.stack);
      
      // Handle connection errors gracefully
      const isConnectionError = error.message.includes('other side closed') || 
                                error.message.includes('ECONNRESET') ||
                                error.message.includes('WebSocket') ||
                                error.code === 'ECONNRESET';
      
      try {
        if (interaction.deferred) {
          if (isConnectionError) {
            await interaction.editReply({ 
              content: `⚠️ **Connection Error**\n\nThe purchase may have succeeded, but Discord connection was interrupted. Please check your tickets with \`/lottery my-tickets\` to confirm.`, 
              flags: [MessageFlags.Ephemeral] 
            });
          } else {
            await interaction.editReply({ content: `❌ Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        } else {
          if (isConnectionError) {
            await interaction.reply({ 
              content: `⚠️ **Connection Error**\n\nThe purchase may have succeeded, but Discord connection was interrupted. Please check your tickets with \`/lottery my-tickets\` to confirm.`, 
              flags: [MessageFlags.Ephemeral] 
            });
          } else {
            await interaction.reply({ content: `❌ Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        }
      } catch (replyError) {
        // If even the error reply fails, log it but don't crash
        console.error('[LOTTERY] Failed to send error message to user:', replyError.message);
      }
    }
  } else if (customId.startsWith('lottery-my-active:')) {
    // My Active Tickets button
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const lotteryId = customId.split(':')[1];
      const userId = interaction.user.id;
      
      // Get all tickets for this specific lottery and filter by user (no limit)
      const allTickets = await dbLottery.getTicketsByLottery(guildId, lotteryId);
      const lotteryTickets = Object.values(allTickets)
        .filter(t => t.userId === userId && t.status === 'LIVE')
        .sort((a, b) => b.createdAt - a.createdAt); // Sort by newest first
      
      if (lotteryTickets.length === 0) {
        await interaction.editReply({
          content: `You have no active tickets for this lottery.`,
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
      
      // Discord embed limit is 25 fields, so limit to 24 tickets
      const maxTicketsToShow = 24;
      const ticketsToShow = lotteryTickets.slice(0, maxTicketsToShow);
      const totalTickets = lotteryTickets.length;
      
      const embed = new EmbedBuilder()
        .setTitle('🎫 My Active Tickets')
        .setDescription(totalTickets > maxTicketsToShow 
          ? `You have ${totalTickets} active ticket(s) for this lottery\n\nShowing ${maxTicketsToShow} of ${totalTickets} tickets`
          : `You have ${totalTickets} active ticket(s) for this lottery`)
        .setColor(0x00FF00)
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      
      ticketsToShow.forEach((ticket, index) => {
        const numbersDisplay = lotteryHelpers.formatNumbersForDisplay(ticket.numbers);
        embed.addFields({
          name: `Ticket ${index + 1}`,
          value: `**Numbers:** ${numbersDisplay}`,
          inline: true
        });
      });
      
      if (totalTickets > maxTicketsToShow) {
        embed.addFields({
          name: 'ℹ️ Note',
          value: `You have ${totalTickets} total tickets. Only the first ${maxTicketsToShow} are shown.`,
          inline: false
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('[LOTTERY] Error getting active tickets:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (customId.startsWith('lottery-my-results:')) {
    // My Results button - shows expired tickets with matches
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const lotteryId = customId.split(':')[1];
      const userId = interaction.user.id;
      
      const lottery = await dbLottery.getLottery(guildId, lotteryId);
      if (!lottery || !lottery.winningNumbers) {
        await interaction.editReply({
          content: `No results available for this lottery yet.`,
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
      
      // Get all tickets for this specific lottery and user (no limit)
      // Include both EXPIRED and WINNER tickets
      const allTickets = await dbLottery.getTicketsByLottery(guildId, lotteryId);
      const lotteryTickets = Object.values(allTickets)
        .filter(t => t.userId === userId && (t.status === 'EXPIRED' || t.status === 'WINNER'))
        .sort((a, b) => b.createdAt - a.createdAt); // Sort by newest first
      
      if (lotteryTickets.length === 0) {
        await interaction.editReply({
          content: `You have no tickets for this lottery.`,
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📋 My Results')
        .setDescription(`Results for lottery \`${lotteryId.substring(0, 16)}...\``)
        .setColor(0xFF0000)
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
        .setTimestamp();
      
      const winningNumbersDisplay = lotteryHelpers.formatNumbersForDisplay(lottery.winningNumbers);
      embed.addFields({
        name: '🎯 Winning Numbers',
        value: winningNumbersDisplay,
        inline: false
      });
      
      // Discord embed limit is 25 fields, so limit to 24 (1 for winning numbers + 23 tickets)
      const maxTicketsToShow = 23;
      const ticketsToShow = lotteryTickets.slice(0, maxTicketsToShow);
      const totalTickets = lotteryTickets.length;
      
      if (totalTickets > maxTicketsToShow) {
        embed.setDescription(`Results for lottery \`${lotteryId.substring(0, 16)}...\`\n\nShowing ${maxTicketsToShow} of ${totalTickets} tickets`);
      }
      
      ticketsToShow.forEach((ticket, index) => {
        const numbersDisplay = lotteryHelpers.formatNumbersForDisplay(ticket.numbers);
        
        // Use stored matchedNumbers from database, but recalculate if needed for accuracy
        let match = { matchedCount: ticket.matchedNumbers || 0, isWinner: ticket.isWinner || false };
        
        // Recalculate match to ensure accuracy (especially for tickets with wrong stored values)
        const recalculatedMatch = lotteryHelpers.checkTicketMatch(ticket.numbers, lottery.winningNumbers);
        
        // Use recalculated values if they differ (for fixing old data)
        if (recalculatedMatch.matchedCount !== match.matchedCount) {
          match = recalculatedMatch;
        }
        
        let resultText = '';
        if (match.isWinner || ticket.status === 'WINNER') {
          resultText = `✅ **WINNER!** Matched: ${match.matchedCount}/${lottery.winningNumbersCount}`;
        } else {
          resultText = `❌ No match. Matched: ${match.matchedCount}/${lottery.winningNumbersCount}`;
        }
        
        embed.addFields({
          name: `Ticket ${index + 1}${(match.isWinner || ticket.status === 'WINNER') ? ' 🏆' : ''}`,
          value: `**Your Numbers:** ${numbersDisplay}\n${resultText}`,
          inline: false
        });
      });
      
      if (totalTickets > maxTicketsToShow) {
        embed.addFields({
          name: 'ℹ️ Note',
          value: `You have ${totalTickets} total tickets for this lottery. Only the first ${maxTicketsToShow} are shown.`,
          inline: false
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('[LOTTERY] Error getting results:', error.message);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (customId.startsWith('bid:')) {
        // Place Bid button - opens modal
        try {
          console.log(`[AUCTIONS] Place Bid button clicked: ${customId}`);
          const auctionId = customId.split(':')[1];
          console.log(`[AUCTIONS] Auction ID: ${auctionId}`);
          console.log(`[AUCTIONS] Guild ID: ${guildId}`);
          // Data is loaded from database on-demand
          
          const auctions = await getAuctions(guildId);
          console.log(`[AUCTIONS] Available auctions:`, Object.keys(auctions));
          console.log(`[AUCTIONS] Full auctions object:`, auctions);
          const auction = auctions[auctionId];
      
      if (!auction) {
        console.log(`[AUCTIONS] Auction not found: ${auctionId}`);
        await interaction.reply({ content: '❌ Auction not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      console.log(`[AUCTIONS] Auction found: ${auction.title}`);

      // Check if auction is expired
      if (isAuctionExpired(auction)) {
        await processAuctionClosure(guildId, auctionId);
        await interaction.reply({ content: '❌ This auction has ended.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Prevent auction owner from bidding on their own auction
      const isOwner = interaction.user.id === auction.creatorId || interaction.user.id === auction.sellerId;
      if (isOwner) {
        await interaction.reply({ 
          content: '❌ **You cannot bid on your own auction!**\n\nAs the auction creator, you are not allowed to place bids on your own auction.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Create bidding modal
      const modal = new ModalBuilder()
        .setCustomId(`bid-modal:${auctionId}`)
        .setTitle(`Place Bid - ${auction.title.substring(0, 30)}`);

      const currentBidDisplay = auction.highestBidderTag 
        ? `${auction.currentBid} ${auction.tokenTicker} by ${auction.highestBidderTag}`
        : `${auction.currentBid} ${auction.tokenTicker} (Starting bid)`;

      const bidAmountInput = new TextInputBuilder()
        .setCustomId('bid-amount')
        .setLabel(`Bid Amount (${auction.tokenTicker})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Minimum: ${new BigNumber(auction.currentBid).plus(auction.minBidIncrease).toString()}`)
        .setRequired(true)
        .setMaxLength(50);

      const infoInput = new TextInputBuilder()
        .setCustomId('info')
        .setLabel(`Current Highest Bid`)
        .setStyle(TextInputStyle.Short)
        .setValue(currentBidDisplay)
        .setRequired(false)
        .setMaxLength(100);

      const firstActionRow = new ActionRowBuilder().addComponents(bidAmountInput);
      const secondActionRow = new ActionRowBuilder().addComponents(infoInput);
      modal.addComponents(firstActionRow, secondActionRow);
      
      await interaction.showModal(modal);
    } catch (error) {
      console.error('[AUCTIONS] Error showing bid modal:', error.message);
      console.error('[AUCTIONS] Full error:', error);
      await interaction.reply({ content: '❌ An error occurred while opening the bid form. Please try again.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (customId.startsWith('quick-bid:')) {
    // Quick Bid button - places minimum increase bid
    try {
      console.log(`[AUCTIONS] Quick Bid button clicked: ${customId}`);
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const auctionId = customId.split(':')[1];
      console.log(`[AUCTIONS] Auction ID: ${auctionId}`);
      console.log(`[AUCTIONS] Guild ID: ${guildId}`);
      // Data is loaded from database on-demand
      
      const auctions = await getAuctions(guildId);
      console.log(`[AUCTIONS] Available auctions:`, Object.keys(auctions));
      console.log(`[AUCTIONS] Full auctions object:`, auctions);
      const auction = auctions[auctionId];
      
      if (!auction) {
        console.log(`[AUCTIONS] Auction not found: ${auctionId}`);
        await interaction.editReply({ content: '❌ Auction not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      console.log(`[AUCTIONS] Auction found: ${auction.title}`);

      // Check if auction is expired
      if (isAuctionExpired(auction)) {
        await processAuctionClosure(guildId, auctionId);
        await interaction.editReply({ content: '❌ This auction has ended.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Prevent auction owner from bidding on their own auction
      const isOwner = interaction.user.id === auction.creatorId || interaction.user.id === auction.sellerId;
      if (isOwner) {
        await interaction.editReply({ 
          content: '❌ **You cannot bid on your own auction!**\n\nAs the auction creator, you are not allowed to place bids on your own auction.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Calculate quick bid amount (current bid + minimum increase)
      const quickBidAmount = new BigNumber(auction.currentBid).plus(auction.minBidIncrease).toString();

      // Resolve token identifier (use stored identifier if available, otherwise resolve from ticker)
      const tokenIdentifier = auction.tokenIdentifier || await resolveTokenIdentifier(guildId, auction.tokenTicker);
      if (!tokenIdentifier) {
        await interaction.editReply({ 
          content: `❌ **Error:** Could not resolve token identifier for auction. Please contact an administrator.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      // Check user balance (using identifier)
      const userBalance = await virtualAccounts.getUserBalance(guildId, interaction.user.id, tokenIdentifier);
      const balanceBN = new BigNumber(userBalance);
      const bidAmountBN = new BigNumber(quickBidAmount);

      if (balanceBN.isLessThan(bidAmountBN)) {
        // Get community fund QR code URL
        const communityFundProject = await getCommunityFundProject(guildId);
        const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
        const qrCodeUrl = communityFundQRData?.[communityFundProject] || null;
        
        let errorMessage = `❌ **Insufficient balance!**\n\n`;
        errorMessage += `You need **${quickBidAmount} ${auction.tokenTicker}** but you only have **${userBalance} ${auction.tokenTicker}**.\n\n`;
        errorMessage += `Please top up your virtual account by sending tokens to the Community Fund wallet.`;
        
        if (qrCodeUrl) {
          const errorEmbed = new EmbedBuilder()
            .setTitle('Insufficient Balance')
            .setDescription(errorMessage)
            .setImage(qrCodeUrl)
            .setColor(0xFF0000)
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
          
          await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
        } else {
          await interaction.editReply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
        }
        return;
      }

      // Record bid (no deduction yet)
      if (!auction.bids) {
        auction.bids = [];
      }
      auction.bids.push({
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        amount: quickBidAmount,
        timestamp: Date.now()
      });

      // Update auction with new highest bidder and save to database
      auction.currentBid = quickBidAmount;
      auction.highestBidderId = interaction.user.id;
      auction.highestBidderTag = interaction.user.tag;
      
      // Save auction updates to database
      await dbAuctions.updateAuction(guildId, auctionId, {
        currentBid: quickBidAmount,
        highestBidderId: interaction.user.id,
        highestBidderTag: interaction.user.tag
      });

      // Save bid to auction_bids table for historical record
      try {
        // Get decimals - use stored value or default to 8 if not found
        const storedDecimals = await getStoredTokenDecimals(guildId, auction.tokenTicker);
        const decimals = storedDecimals !== null ? storedDecimals : 8; // Default to 8 decimals if not found
        const bidAmountWei = toBlockchainAmount(quickBidAmount, decimals);
        await dbAuctions.createBid(guildId, auctionId, {
          bidderId: interaction.user.id,
          bidderTag: interaction.user.tag,
          bidAmountWei: bidAmountWei
        });
        console.log(`[AUCTIONS] Bid saved to database: ${quickBidAmount} ${auction.tokenTicker} by ${interaction.user.tag}`);
      } catch (bidError) {
        console.error('[AUCTIONS] Error saving bid to database:', bidError.message);
        // Don't fail the bid if database save fails
      }

      // Update embed
      await updateAuctionEmbed(guildId, auctionId);

      // Post notification in thread
      try {
        const channel = await client.channels.fetch(auction.channelId);
        if (channel) {
          const thread = await channel.threads.cache.get(auction.threadId) || await channel.threads.fetch(auction.threadId);
          if (thread) {
            await thread.send(`💰 **New bid!** ${interaction.user.tag} placed a bid of **${quickBidAmount} ${auction.tokenTicker}**`);
          }
        }
      } catch (threadError) {
        console.error(`[AUCTIONS] Error posting to thread:`, threadError.message);
      }

      await interaction.editReply({ 
        content: `✅ Bid placed successfully! Your bid: **${quickBidAmount} ${auction.tokenTicker}**\n\n💡 **Note:** Your virtual account will only be charged when the auction ends if you are the highest bidder.`, 
        flags: [MessageFlags.Ephemeral] 
      });

      console.log(`[AUCTIONS] Quick bid placed: ${quickBidAmount} ${auction.tokenTicker} by ${interaction.user.tag} on auction ${auctionId}`);
    } catch (error) {
      console.error('[AUCTIONS] Error processing quick bid:', error.message);
      console.error('[AUCTIONS] Full error:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error placing bid: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error placing bid: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (customId.startsWith('nft-buy:')) {
    // NFT Buy button
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const listingId = customId.split(':')[1];
      const listing = await virtualAccountsNFT.getListing(guildId, listingId);
      
      if (!listing) {
        await interaction.editReply({ content: '❌ Listing not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (listing.status !== 'ACTIVE') {
        await interaction.editReply({ content: '❌ This listing is no longer active.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if listing expired
      if (listing.expiresAt && Date.now() > listing.expiresAt) {
        await virtualAccountsNFT.updateListing(guildId, listingId, { status: 'EXPIRED' });
        await interaction.editReply({ content: '❌ This listing has expired.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if user is trying to buy their own NFT
      if (listing.sellerId === interaction.user.id) {
        await interaction.editReply({ content: '❌ You cannot buy your own listing.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Verify seller still owns NFT/SFT and has sufficient amount
      const sellerNFT = await virtualAccountsNFT.getUserNFTBalance(guildId, listing.sellerId, listing.collection, listing.nonce);
      if (!sellerNFT) {
        await virtualAccountsNFT.updateListing(guildId, listingId, { status: 'CANCELLED' });
        await interaction.editReply({ content: '❌ Seller no longer owns this NFT. Listing has been cancelled.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const listingAmount = listing.amount || 1;
      const sellerAmount = sellerNFT.amount || 1;
      if (listingAmount > sellerAmount) {
        // CRITICAL: Use actual token_type from listing, don't infer from amount
        const tokenType = listing.tokenType || 'NFT';
        await virtualAccountsNFT.updateListing(guildId, listingId, { status: 'CANCELLED' });
        await interaction.editReply({ content: `❌ Seller no longer has sufficient ${tokenType} balance. Listing has been cancelled.`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check buyer has sufficient balance
      const buyerBalance = await virtualAccounts.getUserBalance(guildId, interaction.user.id, listing.priceTokenIdentifier);
      const priceBN = new BigNumber(listing.priceAmount);
      const balanceBN = new BigNumber(buyerBalance);
      
      if (balanceBN.isLessThan(priceBN)) {
        await interaction.editReply({ 
          content: `❌ Insufficient balance. You need ${listing.priceAmount} ${listing.priceTokenIdentifier.split('-')[0]} but you have ${buyerBalance}.`, 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }
      
      // CRITICAL: Use actual token_type from listing, don't infer from amount
      // 1 SFT is still SFT, not NFT! Must use explicit token_type from listing
      const tokenType = listing.tokenType || 'NFT';
      const amountText = listingAmount > 1 ? ` (${listingAmount}x)` : '';
      
      // Deduct ESDT from buyer
      const deductResult = await virtualAccounts.deductFundsFromAccount(
        guildId,
        interaction.user.id,
        listing.priceTokenIdentifier,
        listing.priceAmount,
        `${tokenType} purchase: ${listing.nftName || `${listing.collection}#${listing.nonce}`}${amountText}`,
        'marketplace_purchase'
      );
      
      if (!deductResult.success) {
        await interaction.editReply({ content: `❌ Failed to deduct funds: ${deductResult.error}`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Add ESDT to seller
      await virtualAccounts.addFundsToAccount(
        guildId,
        listing.sellerId,
        listing.priceTokenIdentifier,
        listing.priceAmount,
        null,
        'marketplace_sale',
        null
      );
      
      // Transfer NFT/SFT with amount
      await virtualAccountsNFT.transferNFTBetweenUsers(
        guildId,
        listing.sellerId,
        interaction.user.id,
        listing.collection,
        listing.nonce,
        {
          tokenIdentifier: listing.priceTokenIdentifier,
          amount: listing.priceAmount
        },
        listingAmount
      );
      
      // Update listing status
      await virtualAccountsNFT.updateListing(guildId, listingId, { 
        status: 'SOLD',
        soldAt: Date.now(),
        buyerId: interaction.user.id
      });
      
      // Update listing embed
      await updateNFTListingEmbed(guildId, listingId);
      
      // Send notifications (use token_type from listing for reliable detection)
      const nftDisplayName = listing.nftName || `${listing.collection}#${listing.nonce}`;
      // CRITICAL: Use actual token_type from listing, don't infer from amount
      const listingTokenType = listing.tokenType || 'NFT';
      try {
        const seller = await client.users.fetch(listing.sellerId);
        await seller.send(`✅ **Your ${listingTokenType} has been sold!**\n\n**${listingTokenType}:** ${nftDisplayName}${amountText}\n**Buyer:** ${interaction.user.tag}\n**Price:** ${listing.priceAmount} ${listing.priceTokenIdentifier.split('-')[0]}`);
      } catch (dmError) {
        console.error('[NFT-MARKETPLACE] Could not send DM to seller:', dmError.message);
      }
      
      await interaction.editReply({ 
        content: `✅ **Purchase successful!**\n\nYou have purchased **${nftDisplayName}${amountText}** for ${listing.priceAmount} ${listing.priceTokenIdentifier.split('-')[0]}.`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error processing buy:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
      }
    }
  } else if (customId.startsWith('nft-offer:')) {
    // NFT Make Offer button - opens modal
    try {
      const listingId = customId.split(':')[1];
      
      if (!listingId) {
        await interaction.reply({ content: '❌ Invalid listing ID.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const listing = await virtualAccountsNFT.getListing(guildId, listingId);
      
      if (!listing) {
        await interaction.reply({ content: '❌ Listing not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (listing.status !== 'ACTIVE') {
        await interaction.reply({ content: '❌ This listing is no longer active.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if listing expired
      if (listing.expiresAt && Date.now() > listing.expiresAt) {
        await virtualAccountsNFT.updateListing(guildId, listingId, { status: 'EXPIRED' });
        await interaction.reply({ content: '❌ This listing has expired.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if user is trying to offer on their own NFT
      if (listing.sellerId === interaction.user.id) {
        await interaction.reply({ content: '❌ You cannot make an offer on your own listing.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if listing type allows offers
      if (listing.listingType !== 'accept_offers') {
        await interaction.reply({ content: '❌ This listing does not accept offers. Please use the "Buy Now" button instead.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Get token ticker for display
      const tokenTicker = listing.priceTokenIdentifier.split('-')[0];
      
      // Create offer modal
      const modal = new ModalBuilder()
        .setCustomId(`nft-offer-modal:${listingId}`)
        .setTitle(`Make Offer - ${listing.title.substring(0, 30)}`);
      
      const offerAmountInput = new TextInputBuilder()
        .setCustomId('offer-amount')
        .setLabel(`Offer Amount (${tokenTicker})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Enter your offer amount`)
        .setRequired(true)
        .setMaxLength(50);
      
      const firstActionRow = new ActionRowBuilder().addComponents(offerAmountInput);
      modal.addComponents(firstActionRow);
      
      await interaction.showModal(modal);
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error showing offer modal:', error);
      console.error('[NFT-MARKETPLACE] Error stack:', error.stack);
      
      // Try to reply if not already replied
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred. Please try again.', flags: [MessageFlags.Ephemeral] });
        } else {
          await interaction.reply({ content: '❌ An error occurred. Please try again.', flags: [MessageFlags.Ephemeral] });
        }
      } catch (replyError) {
        console.error('[NFT-MARKETPLACE] Error sending error message:', replyError);
      }
    }
  } else if (customId.startsWith('nft-listing-cancel:')) {
    // Cancel listing button
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const listingId = customId.split(':')[1];
      const listing = await virtualAccountsNFT.getListing(guildId, listingId);
      
      if (!listing) {
        await interaction.editReply({ content: '❌ Listing not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Verify user is the seller
      if (listing.sellerId !== interaction.user.id) {
        await interaction.editReply({ content: '❌ Only the seller can cancel this listing.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (listing.status !== 'ACTIVE') {
        await interaction.editReply({ content: '❌ This listing is already cancelled or sold.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Update listing status
      await virtualAccountsNFT.updateListing(guildId, listingId, { status: 'CANCELLED' });
      
      // Update embed
      await updateNFTListingEmbed(guildId, listingId);
      
      await interaction.editReply({ content: '✅ Listing cancelled successfully.', flags: [MessageFlags.Ephemeral] });
      
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error cancelling listing:', error);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        } else if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (replyError) {
        console.error('[NFT-MARKETPLACE] Could not send error message (interaction already handled):', replyError.message);
      }
    }
  } else if (customId.startsWith('nft-offer-accept:')) {
    // Accept offer button
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const offerId = customId.split(':')[1];
      // Get offer - if in DM (guildId is null), get by offerId only, otherwise use guildId
      let offer = null;
      if (guildId) {
        offer = await virtualAccountsNFT.getOffer(guildId, offerId);
      } else {
        offer = await virtualAccountsNFT.getOfferById(offerId);
      }
      
      if (!offer) {
        await interaction.editReply({ content: '❌ Offer not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Use offer's guildId for subsequent operations
      const offerGuildId = offer.guildId || guildId;
      if (!offerGuildId) {
        await interaction.editReply({ content: '❌ Could not determine server. Please use this button in the server where the listing was created.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const offerListing = await virtualAccountsNFT.getListing(offerGuildId, offer.listingId);
      
      if (!offerListing) {
        await interaction.editReply({ content: '❌ Listing not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Verify user is the seller
      if (offerListing.sellerId !== interaction.user.id) {
        await interaction.editReply({ content: '❌ Only the seller can accept offers.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (offer.status !== 'PENDING') {
        await interaction.editReply({ content: '❌ This offer is no longer pending.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check if offer expired
      if (offer.expiresAt && Date.now() > offer.expiresAt) {
        await virtualAccountsNFT.updateOffer(offerGuildId, offerId, { status: 'EXPIRED' });
        await interaction.editReply({ content: '❌ This offer has expired.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Verify seller still owns NFT
      const sellerNFT = await virtualAccountsNFT.getUserNFTBalance(offerGuildId, offerListing.sellerId, offerListing.collection, offerListing.nonce);
      if (!sellerNFT) {
        await virtualAccountsNFT.updateListing(offerGuildId, offerListing.listingId, { status: 'CANCELLED' });
        await interaction.editReply({ content: '❌ You no longer own this NFT. Listing has been cancelled.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Check offerer still has sufficient balance
      const offererBalance = await virtualAccounts.getUserBalance(offerGuildId, offer.offererId, offer.priceTokenIdentifier);
      const offerAmountBN = new BigNumber(offer.priceAmount);
      const balanceBN = new BigNumber(offererBalance);
      
      if (balanceBN.isLessThan(offerAmountBN)) {
        await virtualAccountsNFT.updateOffer(offerGuildId, offerId, { status: 'REJECTED' });
        await interaction.editReply({ content: '❌ Offerer no longer has sufficient balance. Offer rejected.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Deduct ESDT from offerer
      const deductResult = await virtualAccounts.deductFundsFromAccount(
        offerGuildId,
        offer.offererId,
        offer.priceTokenIdentifier,
        offer.priceAmount,
        `NFT purchase (offer accepted): ${offerListing.nftName || `${offerListing.collection}#${offerListing.nonce}`}`,
        'marketplace_purchase'
      );
      
      if (!deductResult.success) {
        await interaction.editReply({ content: `❌ Failed to deduct funds: ${deductResult.error}`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Add ESDT to seller
      await virtualAccounts.addFundsToAccount(
        offerGuildId,
        offerListing.sellerId,
        offer.priceTokenIdentifier,
        offer.priceAmount,
        null,
        'marketplace_sale',
        null
      );
      
      // Transfer NFT
      // Get listing amount (for SFTs, this is the number of tokens being sold)
      const listingAmount = offerListing.amount || 1;
      
      await virtualAccountsNFT.transferNFTBetweenUsers(
        offerGuildId,
        offerListing.sellerId,
        offer.offererId,
        offerListing.collection,
        offerListing.nonce,
        {
          tokenIdentifier: offer.priceTokenIdentifier,
          amount: offer.priceAmount
        },
        listingAmount // CRITICAL: Pass the listing amount (number of SFTs/NFTs being transferred)
      );
      
      // Update offer status
      await virtualAccountsNFT.updateOffer(offerGuildId, offerId, { 
        status: 'ACCEPTED',
        acceptedAt: Date.now()
      });
      
      // Reject/expire all other offers on this listing
      const allOffers = await virtualAccountsNFT.getOffersForListing(offerGuildId, offerListing.listingId);
      for (const otherOffer of allOffers) {
        if (otherOffer.offerId !== offerId && otherOffer.status === 'PENDING') {
          await virtualAccountsNFT.updateOffer(offerGuildId, otherOffer.offerId, { status: 'REJECTED' });
        }
      }
      
      // Update listing status
      await virtualAccountsNFT.updateListing(offerGuildId, offerListing.listingId, { 
        status: 'SOLD',
        soldAt: Date.now(),
        buyerId: offer.offererId
      });
      
      // Update embeds
      await updateNFTListingEmbed(offerGuildId, offerListing.listingId);
      
      // Send notifications
      try {
        const offerer = await client.users.fetch(offer.offererId);
        await offerer.send(`✅ **Your offer was accepted!**\n\n**NFT:** ${offerListing.nftName || `${offerListing.collection}#${offerListing.nonce}`}\n**Seller:** ${interaction.user.tag}\n**Price:** ${offer.priceAmount} ${offer.priceTokenIdentifier.split('-')[0]}`);
      } catch (dmError) {
        console.error('[NFT-MARKETPLACE] Could not send DM to offerer:', dmError.message);
      }
      
      await interaction.editReply({ 
        content: `✅ **Offer accepted!**\n\nNFT has been transferred to <@${offer.offererId}> for ${offer.priceAmount} ${offer.priceTokenIdentifier.split('-')[0]}.`, 
        flags: [MessageFlags.Ephemeral] 
      });
      
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error accepting offer:', error);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        } else if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (replyError) {
        console.error('[NFT-MARKETPLACE] Could not send error message (interaction already handled):', replyError.message);
      }
    }
  } else if (customId.startsWith('nft-offer-reject:')) {
    // Reject offer button
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const offerId = customId.split(':')[1];
      // Get offer - if in DM (guildId is null), get by offerId only, otherwise use guildId
      let offer = null;
      if (guildId) {
        offer = await virtualAccountsNFT.getOffer(guildId, offerId);
      } else {
        offer = await virtualAccountsNFT.getOfferById(offerId);
      }
      
      if (!offer) {
        await interaction.editReply({ content: '❌ Offer not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Use offer's guildId for subsequent operations
      const offerGuildId = offer.guildId || guildId;
      if (!offerGuildId) {
        await interaction.editReply({ content: '❌ Could not determine server. Please use this button in the server where the listing was created.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      const offerListing = await virtualAccountsNFT.getListing(offerGuildId, offer.listingId);
      
      if (!offerListing) {
        await interaction.editReply({ content: '❌ Listing not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Verify user is the seller
      if (offerListing.sellerId !== interaction.user.id) {
        await interaction.editReply({ content: '❌ Only the seller can reject offers.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (offer.status !== 'PENDING') {
        await interaction.editReply({ content: '❌ This offer is no longer pending.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Update offer status
      await virtualAccountsNFT.updateOffer(offerGuildId, offerId, { status: 'REJECTED' });
      
      // Send DM notification to offerer (buyer)
      try {
        const offerer = await client.users.fetch(offer.offererId);
        const tokenTicker = offer.priceTokenIdentifier.split('-')[0];
        const nftDisplayName = offerListing.nftName || `${offerListing.collection}#${offerListing.nonce}`;
        await offerer.send(`❌ **Your offer was rejected**\n\n**NFT:** ${nftDisplayName}\n**Collection:** ${offerListing.collection}\n**Your Offer:** ${offer.priceAmount} ${tokenTicker}\n**Seller:** ${interaction.user.tag}`);
      } catch (dmError) {
        console.error('[NFT-MARKETPLACE] Could not send DM to offerer:', dmError.message);
      }
      
      // Update listing embed to reflect the rejected offer
      await updateNFTListingEmbed(offerGuildId, offerListing.listingId);
      
      await interaction.editReply({ content: '✅ Offer rejected.', flags: [MessageFlags.Ephemeral] });
      
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error rejecting offer:', error);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        } else if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (replyError) {
        console.error('[NFT-MARKETPLACE] Could not send error message (interaction already handled):', replyError.message);
      }
    }
  }
});

// Modal submission handler for football betting and wallet registration
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  const { customId } = interaction;
  const guildId = interaction.guildId;

  // Handle wallet registration modal
  if (customId === 'wallet-registration-modal') {
    try {
      const walletAddress = interaction.fields.getTextInputValue('wallet-address-input').trim();
      
      // Validate wallet address format
      if (!walletAddress.startsWith('erd1') || walletAddress.length !== 62) {
        await interaction.reply({ 
          content: '❌ **Invalid wallet address!**\n\nMust be a valid MultiversX address:\n• Starts with `erd1`\n• Exactly 62 characters\n\nPlease try again.', 
          flags: [MessageFlags.Ephemeral] 
        });
        return;
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      try {
        // Register wallet in database
        await dbServerData.setUserWallet(guildId, interaction.user.id, walletAddress);
        
        // Initialize virtual account (this will create it if it doesn't exist)
        const dbVirtualAccounts = require('./db/virtual-accounts');
        await dbVirtualAccounts.getUserAccount(guildId, interaction.user.id, interaction.user.username);
        
        console.log(`[WALLET-REGISTRATION] Wallet registered via button for user ${interaction.user.tag} (${interaction.user.id}) in guild ${guildId}: ${walletAddress}`);
        
        // Process any pending transactions (NFTs/tokens sent before registration)
        try {
          const blockchainListener = require('./blockchain-listener');
          const pendingResult = await blockchainListener.processPendingTransactionsForWallet(
            guildId,
            interaction.user.id,
            walletAddress
          );
          
          if (pendingResult.processed > 0) {
            console.log(`[WALLET-REGISTRATION] Processed ${pendingResult.processed} pending transaction(s) for user ${interaction.user.id}`);
          }
        } catch (pendingError) {
          console.error(`[WALLET-REGISTRATION] Error processing pending transactions:`, pendingError.message);
          // Don't fail wallet registration if pending processing fails
        }
        
        // Get Community Fund wallet address and QR code
        let communityFundAddress = null;
        let qrCodeUrl = null;
        let supportedTokens = [];
        try {
          const projects = await getProjects(guildId);
          const communityFundProjectName = getCommunityFundProjectName();
          const communityFundProject = projects[communityFundProjectName];
          
          if (communityFundProject && communityFundProject.walletAddress) {
            communityFundAddress = communityFundProject.walletAddress;
            
            // Get QR code if available
            const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
            qrCodeUrl = communityFundQRData?.[communityFundProjectName] || null;
            
            // Extract supported tokens
            if (communityFundProject.supportedTokens) {
              if (Array.isArray(communityFundProject.supportedTokens)) {
                supportedTokens = communityFundProject.supportedTokens;
              } else if (typeof communityFundProject.supportedTokens === 'string') {
                supportedTokens = communityFundProject.supportedTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
              }
            }
          }
        } catch (error) {
          console.error(`[WALLET-REGISTRATION] Error getting Community Fund info:`, error.message);
          // Continue without Community Fund info if there's an error
        }
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Wallet Registered Successfully!')
          .setDescription('Your wallet address has been registered and your virtual account has been set up.')
          .addFields([
            { name: 'Wallet Address', value: `\`${walletAddress}\``, inline: false }
          ])
          .setColor('#00FF00')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        
        // Add Community Fund address field if available
        if (communityFundAddress) {
          embed.addFields([
            { name: '💰 Community Fund Deposit Address', value: `\`${communityFundAddress}\``, inline: false }
          ]);
        }
        
        // Add supported tokens if available
        if (supportedTokens.length > 0) {
          embed.addFields([
            { name: 'Supported ESDT Tokens', value: supportedTokens.join(', '), inline: false }
          ]);
        }
        
        // Add NFT support information
        embed.addFields([
          { name: '📦 NFT Support', value: '**NFTs can also be added to your Virtual Account!**\n\nSimply send NFTs to the community fund wallet address above, and they will be automatically added to your virtual account balance. Use `/check-balance-nft` to view your NFT collection.', inline: false }
        ]);
        
        // Add QR code as thumbnail if available
        if (qrCodeUrl) {
          embed.setThumbnail(qrCodeUrl);
        }
        
        // Add Next Steps field
        const nextStepsValue = communityFundAddress 
          ? `1. Send **ESDT tokens or NFTs** to the Community Fund address above\n2. Your virtual account will be automatically updated\n3. Use \`/check-balance-esdt\` to view ESDT balances\n4. Use \`/check-balance-nft\` to view NFT collection`
          : `1. Send **ESDT tokens or NFTs** to the Community Fund address\n2. Your virtual account will be automatically updated\n3. Use \`/check-balance-esdt\` to view ESDT balances\n4. Use \`/check-balance-nft\` to view NFT collection`;
        
        embed.addFields([
          { name: 'Next Steps', value: nextStepsValue, inline: false }
        ]);
        
        await interaction.editReply({ embeds: [embed] });
      } catch (writeError) {
        console.error(`[WALLET-REGISTRATION] Failed to save user wallet for guild ${guildId}:`, writeError.message);
        await interaction.editReply({ 
          content: `❌ **Error registering wallet:**\n\n${writeError.message}\n\nPlease try again or use \`/set-wallet\` command.`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    } catch (error) {
      console.error(`[WALLET-REGISTRATION] Error processing wallet registration for ${interaction.user.tag} in guild ${guildId}:`, error.message);
      
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: `❌ **Error registering wallet:**\n\n${error.message}\n\nPlease try again or use \`/set-wallet\` command.`, 
          flags: [MessageFlags.Ephemeral] 
        });
      } else {
        await interaction.reply({ 
          content: `❌ **Error registering wallet:**\n\n${error.message}\n\nPlease try again or use \`/set-wallet\` command.`, 
          flags: [MessageFlags.Ephemeral] 
        });
      }
    }
    return;
  }

  if (customId.startsWith('lottery-ticket-modal:')) {
    // Lottery ticket purchase modal
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      
      const lotteryId = customId.split(':')[1];
      const lottery = await dbLottery.getLottery(guildId, lotteryId);
      
      if (!lottery) {
        await interaction.editReply({ content: '❌ Lottery not found.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (lottery.status !== 'LIVE') {
        await interaction.editReply({ content: '❌ This lottery is no longer accepting tickets.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      if (Date.now() >= lottery.endTime) {
        await interaction.editReply({ content: '❌ This lottery has ended.', flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Extract numbers from modal inputs
      const numbers = [];
      for (let i = 1; i <= lottery.winningNumbersCount; i++) {
        const numberValue = interaction.fields.getTextInputValue(`number_${i}`);
        const num = parseInt(numberValue, 10);
        if (isNaN(num)) {
          await interaction.editReply({ content: `❌ Invalid number in field ${i}. Please enter a valid number.`, flags: [MessageFlags.Ephemeral] });
          return;
        }
        numbers.push(num);
      }
      
      // Validate numbers
      const validation = lotteryHelpers.validateTicketNumbers(numbers, lottery.winningNumbersCount, lottery.totalPoolNumbers);
      if (!validation.valid) {
        await interaction.editReply({ content: `❌ ${validation.error}`, flags: [MessageFlags.Ephemeral] });
        return;
      }
      
      // Process ticket purchase
      await processTicketPurchase(guildId, lotteryId, interaction.user.id, interaction.user.tag, numbers, lottery);
      
      const numbersDisplay = lotteryHelpers.formatNumbersForDisplay(numbers);
      try {
        await interaction.editReply({
          content: `✅ **Ticket Purchased!**\n\n**Your Numbers:** ${numbersDisplay}\n**Lottery:** \`${lotteryId.substring(0, 16)}...\``,
          flags: [MessageFlags.Ephemeral]
        });
      } catch (replyError) {
        // If reply fails due to connection error, log it but don't fail the purchase
        const isConnectionError = replyError.message.includes('other side closed') || 
                                  replyError.message.includes('ECONNRESET') ||
                                  replyError.message.includes('WebSocket') ||
                                  replyError.code === 'ECONNRESET';
        if (isConnectionError) {
          console.error('[LOTTERY] Connection error when sending success message (ticket was purchased):', replyError.message);
          // Try to send a follow-up message if possible
          try {
            await interaction.followUp({ 
              content: `✅ **Ticket Purchased Successfully!**\n\n**Your Numbers:** ${numbersDisplay}\n**Lottery:** \`${lotteryId.substring(0, 16)}...\``, 
              flags: [MessageFlags.Ephemeral] 
            });
          } catch (followUpError) {
            console.error('[LOTTERY] Failed to send follow-up message:', followUpError.message);
          }
        } else {
          throw replyError; // Re-throw if it's not a connection error
        }
      }
      
    } catch (error) {
      console.error('[LOTTERY] Error processing ticket purchase:', error.message);
      console.error('[LOTTERY] Error stack:', error.stack);
      
      // Handle connection errors gracefully
      const isConnectionError = error.message.includes('other side closed') || 
                                error.message.includes('ECONNRESET') ||
                                error.message.includes('WebSocket') ||
                                error.code === 'ECONNRESET';
      
      try {
        if (interaction.deferred) {
          if (isConnectionError) {
            await interaction.editReply({ 
              content: `⚠️ **Connection Error**\n\nThe purchase may have succeeded, but Discord connection was interrupted. Please check your tickets with \`/lottery my-tickets\` to confirm.`, 
              flags: [MessageFlags.Ephemeral] 
            });
          } else {
            await interaction.editReply({ content: `❌ Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        } else {
          if (isConnectionError) {
            await interaction.reply({ 
              content: `⚠️ **Connection Error**\n\nThe purchase may have succeeded, but Discord connection was interrupted. Please check your tickets with \`/lottery my-tickets\` to confirm.`, 
              flags: [MessageFlags.Ephemeral] 
            });
          } else {
            await interaction.reply({ content: `❌ Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        }
      } catch (replyError) {
        // If even the error reply fails, log it but don't crash
        console.error('[LOTTERY] Failed to send error message to user:', replyError.message);
      }
    }
  } else if (customId.startsWith('betting-modal:')) {
        try {
          const matchId = customId.split(':')[1];
          const outcome = interaction.fields.getTextInputValue('outcome').toUpperCase();

          // Validate outcome
          if (!['H', 'A', 'D'].includes(outcome)) {
            await interaction.reply({ content: '❌ Invalid outcome. Please use H (Home), A (Away), or D (Draw).', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if match still exists and is accepting bets
          const match = await dbFootball.getMatch(matchId);
          if (!match || !match.guildIds || !match.guildIds.includes(guildId)) {
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

          // Get guild-specific token configuration
          const token = getMatchTokenForGuild(match, guildId);
          if (!token) {
            await interaction.reply({ 
              content: '❌ **Error:** No token configuration found for this match in this guild.', 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Check if user has sufficient virtual balance (using identifier)
          const requiredAmountWei = getMatchStakeForGuild(match, guildId);
          const requiredAmount = new BigNumber(requiredAmountWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
          const currentBalance = await virtualAccounts.getUserBalance(guildId, interaction.user.id, token.identifier);
          
          if (new BigNumber(currentBalance).isLessThan(requiredAmount)) {
            await interaction.reply({ 
              content: `❌ **Insufficient virtual balance!**\n\nYou have: **${currentBalance}** ${token.ticker}\nRequired: **${requiredAmount}** ${token.ticker}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }
          
          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          await interaction.editReply({ content: '💸 Processing your virtual bet...', flags: [MessageFlags.Ephemeral] });
          
          // Deduct funds from virtual account (using identifier)
          const deductionResult = await virtualAccounts.deductFundsFromAccount(
            guildId, 
            interaction.user.id, 
            token.identifier, 
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
            token: token,
            amountWei: betAmountWei,
            txHash: null, // No blockchain transaction needed
            createdAtISO: new Date().toISOString(),
            status: 'ACCEPTED',
            virtualBet: true // Mark as virtual bet
          };

          // Save bet to database
          await dbFootball.createBet({
            betId: betId,
            guildId: guildId,
            matchId: matchId,
            userId: interaction.user.id,
            outcome: outcome,
            tokenData: token,
            amountWei: betAmountWei,
            txHash: 'VIRTUAL_BET',
            createdAtISO: new Date().toISOString(),
            status: 'ACCEPTED'
          });

          // Track bet amount for PNL calculation
          await trackBetAmount(guildId, interaction.user.id, betAmountWei, token.identifier, token.ticker);

          // No transaction hash needed for virtual bets

          // Update the main match embed with new pot size
          try {
            console.log(`[FOOTBALL] Updating pot size for match ${matchId} in guild ${guildId}`);
            const channel = interaction.channel;
            const matchMessage = await channel.messages.fetch(match.embeds[guildId].messageId);
            if (matchMessage && matchMessage.embeds && matchMessage.embeds.length > 0) {
              // Calculate current pot size using utility function
              const potSize = await calculateMatchPotSize(guildId, matchId);
              console.log(`[FOOTBALL] Calculated pot size: ${potSize.totalPotHuman} ${token.ticker}`);
              
              // Update the embed - handle both fetched message embeds and EmbedBuilder
              let updatedEmbed;
              if (matchMessage.embeds[0].data) {
                // This is already an EmbedBuilder
                updatedEmbed = matchMessage.embeds[0];
              } else {
                // This is a fetched message embed, convert to EmbedBuilder
                updatedEmbed = EmbedBuilder.from(matchMessage.embeds[0]);
              }
              
              // Check if fields exist and update both pot size and stake fields
              if (updatedEmbed.data && updatedEmbed.data.fields && Array.isArray(updatedEmbed.data.fields)) {
                const potSizeField = updatedEmbed.data.fields.find(field => field.name === '🏆 Pot Size');
                const stakeField = updatedEmbed.data.fields.find(field => field.name === '💰 Stake');
                
                let needsUpdate = false;
                
                if (potSizeField) {
                  potSizeField.value = `${potSize.totalPotHuman} ${token.ticker}`;
                  needsUpdate = true;
                }
                
                // Also update stake field to ensure it shows the correct guild-specific stake
                if (stakeField) {
                  const stakeAmountWei = getMatchStakeForGuild(match, guildId);
                  const stakeAmountHuman = new BigNumber(stakeAmountWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
                  stakeField.value = `${stakeAmountHuman} ${token.ticker}`;
                  needsUpdate = true;
                }
                
                if (needsUpdate) {
                  await matchMessage.edit({ embeds: [updatedEmbed] });
                  console.log(`[FOOTBALL] Updated match embed pot size to ${potSize.totalPotHuman} ${token.ticker} and stake for match ${matchId}`);
                } else {
                  console.log(`[FOOTBALL] Pot size or stake field not found in embed for match ${matchId}. Available fields:`, updatedEmbed.data.fields.map(f => f.name));
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
                    { name: 'Amount', value: `${requiredAmount} ${token.ticker}`, inline: true },
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

          const betMessage = `✅ Virtual bet accepted successfully! Match: ${match.home} vs ${match.away}, Outcome: ${outcome === 'H' ? 'Home Win' : outcome === 'A' ? 'Away Win' : 'Draw'}, Amount: ${requiredAmount} ${token.ticker}`;
          
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
          const challenges = await getRPSChallenges(guildId);
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
          const fundProject = await getCommunityFundProject(guildId);
          if (!fundProject) {
            await interaction.reply({ content: 'No Community Tip Fund is set for this server. Please ask an admin to run /set-community-fund.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          const projects = await getProjects(guildId);
          const projectName = getCommunityFundProjectName();
          if (!projects[projectName]) {
            await interaction.reply({ content: `The Community Tip Fund project no longer exists. Please ask an admin to set it again.`, flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Get community fund wallet address
          const communityFundWallet = projects[projectName]?.walletAddress;
          if (!communityFundWallet) {
            await interaction.reply({ content: 'Community Fund wallet address not found. Please ask an admin to update the project.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          await interaction.editReply({ content: '💸 Processing your virtual entry...', flags: [MessageFlags.Ephemeral] });

          // Use humanAmount (display value) or amount (stored value) - prefer humanAmount for consistency
          const amountToDeduct = challenge.humanAmount || challenge.amount;
          if (!amountToDeduct) {
            await interaction.editReply({ 
              content: `❌ **Invalid challenge amount!** The challenge amount could not be determined.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Deduct balance from challenged person's virtual account
          const deductionResult = await virtualAccounts.deductFundsFromAccount(
            guildId, 
            interaction.user.id, 
            challenge.token, 
            amountToDeduct.toString(), 
            `RPS Challenge: ${challenge.memo}`
          );

          if (!deductionResult.success) {
            await interaction.editReply({ 
              content: `❌ **Insufficient virtual balance!**\n\nYou have: **${deductionResult.currentBalance || '0'}** ${challenge.token}\nRequired: **${amountToDeduct}** ${challenge.token}\n\nTop up your account by making a transfer to any Community Fund wallet!`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Update challenge status in database
          await dbRpsGames.updateGame(guildId, challengeId, {
            status: 'active',
            joinedAt: Date.now(),
            joinerTransactionHash: null, // No blockchain transaction needed
            joinerMemo: memo
          });

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
      } else if (customId.startsWith('nft-offer-modal:')) {
        // NFT Offer modal submission
        try {
          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          
          const listingId = customId.split(':')[1];
          const listing = await virtualAccountsNFT.getListing(guildId, listingId);
          
          if (!listing) {
            await interaction.editReply({ content: '❌ Listing not found.', flags: [MessageFlags.Ephemeral] });
            return;
          }
          
          if (listing.status !== 'ACTIVE') {
            await interaction.editReply({ content: '❌ This listing is no longer active.', flags: [MessageFlags.Ephemeral] });
            return;
          }
          
          // Check if listing type allows offers
          if (listing.listingType !== 'accept_offers') {
            await interaction.editReply({ content: '❌ This listing does not accept offers. Please use the "Buy Now" button instead.', flags: [MessageFlags.Ephemeral] });
            return;
          }
          
          const offerAmountInput = interaction.fields.getTextInputValue('offer-amount');
          
          // Validate offer amount
          let offerAmountBN;
          try {
            offerAmountBN = new BigNumber(offerAmountInput);
            if (offerAmountBN.isLessThanOrEqualTo(0) || !offerAmountBN.isFinite()) {
              throw new Error('Invalid offer amount');
            }
          } catch (amountError) {
            await interaction.editReply({ 
              content: `❌ Invalid offer amount. Please enter a valid number.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }
          
          // Check buyer has sufficient balance
          const buyerBalance = await virtualAccounts.getUserBalance(guildId, interaction.user.id, listing.priceTokenIdentifier);
          const balanceBN = new BigNumber(buyerBalance);
          
          if (balanceBN.isLessThan(offerAmountBN)) {
            await interaction.editReply({ 
              content: `❌ Insufficient balance. You need ${offerAmountBN.toString()} ${listing.priceTokenIdentifier.split('-')[0]} but you have ${buyerBalance}.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }
          
          // Create offer
          const offerId = `nft_offer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days default
          
          await virtualAccountsNFT.createOffer(guildId, offerId, {
            listingId: listingId,
            offererId: interaction.user.id,
            offererTag: interaction.user.tag,
            priceTokenIdentifier: listing.priceTokenIdentifier,
            priceAmount: offerAmountBN.toString(),
            status: 'PENDING',
            createdAt: Date.now(),
            expiresAt: expiresAt
          });
          
          // Create transaction record for offerer
          const listingAmount = listing.amount || 1; // Get listing amount for SFTs
          // Get token_type from listing (most reliable source)
          const listingTokenType = listing.tokenType || (listingAmount > 1 ? 'SFT' : 'NFT');
          await virtualAccountsNFT.addNFTTransaction(guildId, interaction.user.id, {
            id: `nft_offer_${offerId}`,
            type: 'offer',
            collection: listing.collection,
            identifier: listing.identifier,
            nonce: listing.nonce,
            nft_name: listing.nftName,
            amount: listingAmount, // Store amount for SFTs
            token_type: listingTokenType, // Use actual token_type from listing, not inferred from amount
            price_token_identifier: listing.priceTokenIdentifier,
            price_amount: offerAmountBN.toString(),
            timestamp: Date.now(),
            description: `Made offer on ${listing.nftName || `${listing.collection}#${listing.nonce}`}`
          });
          
          // Send DM notification to seller
          try {
            const seller = await client.users.fetch(listing.sellerId);
            if (seller) {
              const communityFundProjectName = getCommunityFundProjectName();
              const projectLogoUrl = await getProjectLogoUrl(guildId, communityFundProjectName);
              
              const tokenTicker = listing.priceTokenIdentifier.split('-')[0];
              const nftDisplayName = listing.nftName || `${listing.collection}#${listing.nonce}`;
              
              const dmEmbed = new EmbedBuilder()
                .setTitle('💼 New Offer Received')
                .setDescription(`You have received a new offer on your NFT listing!`)
                .addFields([
                  { name: 'NFT', value: nftDisplayName, inline: true },
                  { name: 'Collection', value: listing.collection, inline: true },
                  { name: 'Nonce', value: String(listing.nonce), inline: true },
                  { name: 'Offerer', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
                  { name: 'Offer Amount', value: `${offerAmountBN.toString()} ${tokenTicker}`, inline: true },
                  { name: 'Status', value: 'Pending', inline: true },
                  { name: 'Listing', value: listing.title || 'Untitled Listing', inline: false }
                ])
                .setColor(0x0099FF)
                .setThumbnail(projectLogoUrl)
                .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
                .setTimestamp();
              
              // Add Accept/Reject buttons to DM
              const acceptButton = new ButtonBuilder()
                .setCustomId(`nft-offer-accept:${offerId}`)
                .setLabel('Accept Offer')
                .setStyle(ButtonStyle.Success);
              
              const rejectButton = new ButtonBuilder()
                .setCustomId(`nft-offer-reject:${offerId}`)
                .setLabel('Reject Offer')
                .setStyle(ButtonStyle.Danger);
              
              const dmButtonRow = new ActionRowBuilder().addComponents(acceptButton, rejectButton);
              
              await seller.send({ embeds: [dmEmbed], components: [dmButtonRow] });
              console.log(`[NFT-MARKETPLACE] Sent DM notification to seller ${listing.sellerId} about new offer`);
            }
          } catch (dmError) {
            console.error('[NFT-MARKETPLACE] Could not send DM to seller:', dmError.message);
          }
          
          // Notify seller in thread (works for both regular threads and forum posts)
          try {
            const channel = await client.channels.fetch(listing.channelId);
            if (channel && listing.threadId) {
              // Try to get thread from channel's thread cache or fetch it
              let thread = null;
              
              // Check if channel is a forum channel - threads are stored differently
              if (channel.type === ChannelType.GuildForum) {
                // For forum channels, threads are the posts themselves
                thread = await channel.threads.fetch(listing.threadId);
              } else {
                // For regular channels, get thread from channel.threads
                thread = channel.threads.cache.get(listing.threadId) || await channel.threads.fetch(listing.threadId);
              }
              
              if (thread) {
                const offerEmbed = new EmbedBuilder()
                  .setTitle('💼 New Offer Received')
                  .setDescription(`**Offerer:** <@${interaction.user.id}>\n**Amount:** ${offerAmountBN.toString()} ${listing.priceTokenIdentifier.split('-')[0]}\n**Status:** Pending`)
                  .setColor(0x0099FF)
                  .setTimestamp()
                  .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
                
                const acceptButton = new ButtonBuilder()
                  .setCustomId(`nft-offer-accept:${offerId}`)
                  .setLabel('Accept Offer')
                  .setStyle(ButtonStyle.Success);
                
                const rejectButton = new ButtonBuilder()
                  .setCustomId(`nft-offer-reject:${offerId}`)
                  .setLabel('Reject Offer')
                  .setStyle(ButtonStyle.Danger);
                
                const buttonRow = new ActionRowBuilder().addComponents(acceptButton, rejectButton);
                
                await thread.send({ embeds: [offerEmbed], components: [buttonRow] });
              }
            }
          } catch (threadError) {
            console.error('[NFT-MARKETPLACE] Error posting offer to thread:', threadError.message);
            // Don't fail the offer creation if thread posting fails - DM notification already sent with buttons
          }
          
          // Update listing embed to show offer count
          await updateNFTListingEmbed(guildId, listingId);
          
          await interaction.editReply({ 
            content: `✅ **Offer submitted!**\n\nYour offer of **${offerAmountBN.toString()} ${listing.priceTokenIdentifier.split('-')[0]}** has been sent to the seller.`, 
            flags: [MessageFlags.Ephemeral] 
          });
          
        } catch (error) {
          console.error('[NFT-MARKETPLACE] Error processing offer:', error);
          if (interaction.deferred) {
            await interaction.editReply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          } else {
            await interaction.reply({ content: `Error: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        }
      } else if (customId.startsWith('bid-modal:')) {
        // Bid modal submission
        try {
          console.log(`[AUCTIONS] Bid modal submitted: ${customId}`);
          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          
          const auctionId = customId.split(':')[1];
          console.log(`[AUCTIONS] Auction ID: ${auctionId}`);
          const auctions = await getAuctions(guildId);
          console.log(`[AUCTIONS] Available auctions:`, Object.keys(auctions));
          const auction = auctions[auctionId];
          
          if (!auction) {
            console.log(`[AUCTIONS] Auction not found: ${auctionId}`);
            await interaction.editReply({ content: '❌ Auction not found.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if auction is expired
          if (isAuctionExpired(auction)) {
            await processAuctionClosure(guildId, auctionId);
            await interaction.editReply({ content: '❌ This auction has ended.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Prevent auction owner from bidding on their own auction
          const isOwner = interaction.user.id === auction.creatorId || interaction.user.id === auction.sellerId;
          if (isOwner) {
            await interaction.editReply({ 
              content: '❌ **You cannot bid on your own auction!**\n\nAs the auction creator, you are not allowed to place bids on your own auction.', 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          const bidAmountInput = interaction.fields.getTextInputValue('bid-amount');
          
          // Validate bid amount
          let bidAmountBN;
          try {
            bidAmountBN = new BigNumber(bidAmountInput);
            if (bidAmountBN.isLessThanOrEqualTo(0) || !bidAmountBN.isFinite()) {
              throw new Error('Invalid bid amount');
            }
          } catch (amountError) {
            await interaction.editReply({ 
              content: `❌ Invalid bid amount. Please enter a valid number.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Check minimum bid requirement
          const minBidAmount = new BigNumber(auction.currentBid).plus(auction.minBidIncrease);
          if (bidAmountBN.isLessThan(minBidAmount)) {
            await interaction.editReply({ 
              content: `❌ Bid amount must be at least **${minBidAmount.toString()} ${auction.tokenTicker}** (current bid: ${auction.currentBid} + minimum increase: ${auction.minBidIncrease})`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Resolve token identifier (use stored identifier if available, otherwise resolve from ticker)
          const tokenIdentifier = auction.tokenIdentifier || await resolveTokenIdentifier(guildId, auction.tokenTicker);
          if (!tokenIdentifier) {
            await interaction.editReply({ 
              content: `❌ **Error:** Could not resolve token identifier for auction. Please contact an administrator.`, 
              flags: [MessageFlags.Ephemeral] 
            });
            return;
          }

          // Check user balance (using identifier)
          const userBalance = await virtualAccounts.getUserBalance(guildId, interaction.user.id, tokenIdentifier);
          const balanceBN = new BigNumber(userBalance);

          if (balanceBN.isLessThan(bidAmountBN)) {
            // Get community fund QR code URL
            const communityFundProject = await getCommunityFundProject(guildId);
            const communityFundQRData = await dbServerData.getCommunityFundQR(guildId);
        const qrCodeUrl = communityFundQRData?.[communityFundProject] || null;
            
            let errorMessage = `❌ **Insufficient balance!**\n\n`;
            errorMessage += `You need **${bidAmountBN.toString()} ${auction.tokenTicker}** but you only have **${userBalance} ${auction.tokenTicker}**.\n\n`;
            errorMessage += `Please top up your virtual account by sending tokens to the Community Fund wallet.`;
            
            if (qrCodeUrl) {
              const errorEmbed = new EmbedBuilder()
                .setTitle('Insufficient Balance')
                .setDescription(errorMessage)
                .setImage(qrCodeUrl)
                .setColor(0xFF0000)
                .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
              
              await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
            } else {
              await interaction.editReply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
            }
            return;
          }

          // Record bid (no deduction yet)
          if (!auction.bids) {
            auction.bids = [];
          }
          auction.bids.push({
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            amount: bidAmountBN.toString(),
            timestamp: Date.now()
          });

          // Update auction with new highest bidder and save to database
          auction.currentBid = bidAmountBN.toString();
          auction.highestBidderId = interaction.user.id;
          auction.highestBidderTag = interaction.user.tag;
          
          // Save auction updates to database
          await dbAuctions.updateAuction(guildId, auctionId, {
            currentBid: bidAmountBN.toString(),
            highestBidderId: interaction.user.id,
            highestBidderTag: interaction.user.tag
          });

          // Save bid to auction_bids table for historical record
          try {
            // Get decimals - use stored value or default to 8 if not found
            const storedDecimals = await getStoredTokenDecimals(guildId, auction.tokenTicker);
            const decimals = storedDecimals !== null ? storedDecimals : 8; // Default to 8 decimals if not found
            const bidAmountWei = toBlockchainAmount(bidAmountBN.toString(), decimals);
            await dbAuctions.createBid(guildId, auctionId, {
              bidderId: interaction.user.id,
              bidderTag: interaction.user.tag,
              bidAmountWei: bidAmountWei
            });
            console.log(`[AUCTIONS] Bid saved to database: ${bidAmountBN.toString()} ${auction.tokenTicker} by ${interaction.user.tag}`);
          } catch (bidError) {
            console.error('[AUCTIONS] Error saving bid to database:', bidError.message);
            // Don't fail the bid if database save fails
          }

          // Update embed
          await updateAuctionEmbed(guildId, auctionId);

          // Post notification in thread
          try {
            const channel = await client.channels.fetch(auction.channelId);
            if (channel) {
              const thread = await channel.threads.cache.get(auction.threadId) || await channel.threads.fetch(auction.threadId);
              if (thread) {
                await thread.send(`💰 **New bid!** ${interaction.user.tag} placed a bid of **${bidAmountBN.toString()} ${auction.tokenTicker}**`);
              }
            }
          } catch (threadError) {
            console.error(`[AUCTIONS] Error posting to thread:`, threadError.message);
          }

          await interaction.editReply({ 
            content: `✅ Bid placed successfully! Your bid: **${bidAmountBN.toString()} ${auction.tokenTicker}**\n\n💡 **Note:** Your virtual account will only be charged when the auction ends if you are the highest bidder.`, 
            flags: [MessageFlags.Ephemeral] 
          });

          console.log(`[AUCTIONS] Bid placed: ${bidAmountBN.toString()} ${auction.tokenTicker} by ${interaction.user.tag} on auction ${auctionId}`);
        } catch (error) {
          console.error('[AUCTIONS] Error processing bid modal:', error.message);
          console.error('[AUCTIONS] Full error:', error);
          if (interaction.deferred) {
            await interaction.editReply({ content: `Error placing bid: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          } else {
            await interaction.reply({ content: `Error placing bid: ${error.message}`, flags: [MessageFlags.Ephemeral] });
          }
        }
      }
});

// LOTTERY HELPER FUNCTIONS

// Process ticket purchase
async function processTicketPurchase(guildId, lotteryId, userId, userTag, numbers, lottery) {
  try {
    // Get token decimals using identifier
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    let tokenDecimals = 8;
    if (tokenMetadata[lottery.tokenIdentifier]) {
      tokenDecimals = tokenMetadata[lottery.tokenIdentifier].decimals;
    }
    
    // Convert ticket price to human amount
    const ticketPriceHuman = new BigNumber(lottery.ticketPriceWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
    
    // Check user's virtual account balance
    // Try using token identifier first (balances are stored by identifier like "REWARD-cf6eac")
    // If not found, fall back to ticker
    let currentBalance = await virtualAccounts.getUserBalance(guildId, userId, lottery.tokenIdentifier);
    console.log(`[LOTTERY] Balance check for ${lottery.tokenIdentifier}: ${currentBalance}`);
    
    if (new BigNumber(currentBalance).isZero() || new BigNumber(currentBalance).isLessThan(ticketPriceHuman)) {
      // Try with ticker as fallback
      const balanceByTicker = await virtualAccounts.getUserBalance(guildId, userId, lottery.tokenTicker);
      console.log(`[LOTTERY] Balance check for ${lottery.tokenTicker}: ${balanceByTicker}`);
      if (new BigNumber(balanceByTicker).isGreaterThan(new BigNumber(currentBalance))) {
        currentBalance = balanceByTicker;
      }
    }
    
    if (new BigNumber(currentBalance).isLessThan(ticketPriceHuman)) {
      throw new Error(`Insufficient balance! You have ${currentBalance} ${lottery.tokenTicker}, but need ${ticketPriceHuman} ${lottery.tokenTicker}`);
    }
    
    // Deduct funds from virtual account (using identifier - migration handled automatically)
    const deductionResult = await virtualAccounts.deductFundsFromAccount(
      guildId,
      userId,
      lottery.tokenIdentifier,
      ticketPriceHuman,
      `Lottery ticket: ${lotteryId.substring(0, 16)}...`
    );
    
    if (!deductionResult.success) {
      throw new Error(deductionResult.error || 'Failed to deduct funds');
    }
    
    // Sort numbers for storage
    const sortedNumbers = [...numbers].sort((a, b) => a - b);
    
    // Create ticket
    const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await dbLottery.createTicket(guildId, ticketId, {
      lotteryId,
      userId,
      userTag,
      numbers: sortedNumbers,
      tokenIdentifier: lottery.tokenIdentifier,
      tokenTicker: lottery.tokenTicker,
      ticketPriceWei: lottery.ticketPriceWei,
      status: 'LIVE',
      createdAt: Date.now()
    });
    
    // Update lottery stats
    const tickets = await dbLottery.getTicketsByLottery(guildId, lotteryId);
    const ticketCount = Object.keys(tickets).length;
    const uniqueUsers = new Set(Object.values(tickets).map(t => t.userId));
    const uniqueParticipants = uniqueUsers.size;
    
    // Calculate new prize pool
    const newPrizePoolWei = new BigNumber(lottery.prizePoolWei).plus(new BigNumber(lottery.ticketPriceWei)).toString();
    
    await dbLottery.updateLottery(guildId, lotteryId, {
      totalTickets: ticketCount,
      uniqueParticipants: uniqueParticipants,
      prizePoolWei: newPrizePoolWei
    });
    
    // Update embed
    await updateLotteryEmbed(guildId, lotteryId);
    
    // Post notification in thread
    try {
      if (lottery.threadId) {
        const channel = await client.channels.fetch(lottery.channelId);
        if (channel) {
          const thread = await channel.threads.cache.get(lottery.threadId) || await channel.threads.fetch(lottery.threadId);
          if (thread) {
            await thread.send(`🎫 **Ticket purchased!** ${userTag} bought a ticket for this lottery.`);
          }
        }
      }
    } catch (threadError) {
      console.error('[LOTTERY] Error posting to thread:', threadError.message);
      // Don't fail ticket purchase if thread post fails
    }
    
    console.log(`[LOTTERY] Ticket purchased: ${ticketId} for lottery ${lotteryId} by user ${userTag}`);
    
  } catch (error) {
    console.error('[LOTTERY] Error processing ticket purchase:', error.message);
    throw error;
  }
}

// Update lottery embed
async function updateLotteryEmbed(guildId, lotteryId) {
  try {
    const lottery = await dbLottery.getLottery(guildId, lotteryId);
    if (!lottery || !lottery.messageId || !lottery.channelId) {
      return;
    }
    
    const channel = await client.channels.fetch(lottery.channelId);
    if (!channel) return;
    
    const message = await channel.messages.fetch(lottery.messageId);
    if (!message) return;
    
    // Get token decimals first
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    let tokenDecimals = 8;
    for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
      if (identifier === lottery.tokenIdentifier) {
        tokenDecimals = metadata.decimals;
        break;
      }
    }
    
    // Fetch token price from MultiversX API
    let tokenPriceUsd = 0;
    try {
      const priceResponse = await fetch(`https://api.multiversx.com/tokens/${lottery.tokenIdentifier}?denominated=true`);
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        tokenPriceUsd = priceData.price || 0;
      }
    } catch (error) {
      console.error('[LOTTERY] Error fetching token price:', error.message);
      // Try to calculate from existing USD value if available
      if (lottery.prizePoolUsd > 0 && parseFloat(lottery.prizePoolWei) > 0) {
        const prizePoolHuman = new BigNumber(lottery.prizePoolWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
        if (parseFloat(prizePoolHuman) > 0) {
          tokenPriceUsd = parseFloat(lottery.prizePoolUsd) / parseFloat(prizePoolHuman);
        }
      }
    }
    
    const prizePoolHuman = new BigNumber(lottery.prizePoolWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
    const ticketPriceHuman = new BigNumber(lottery.ticketPriceWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
    const prizePoolUsdValue = tokenPriceUsd > 0 ? new BigNumber(prizePoolHuman).multipliedBy(tokenPriceUsd).toFixed(2) : '0.00';
    const ticketPriceUsdValue = tokenPriceUsd > 0 ? new BigNumber(ticketPriceHuman).multipliedBy(tokenPriceUsd).toFixed(2) : '0.00';
    
    // Update prize pool USD in database
    await dbLottery.updateLottery(guildId, lotteryId, {
      prizePoolUsd: parseFloat(prizePoolUsdValue)
    });
    
    const isExpired = Date.now() >= lottery.endTime || lottery.status === 'EXPIRED';
    const color = isExpired ? 0xFF0000 : 0x00FF00;
    const statusText = isExpired ? '🔴 Ended' : '🟢 Live';
    const endTimeText = isExpired ? 'Ended' : `<t:${Math.floor(lottery.endTime / 1000)}:R>`;
    
    const lotteryEmbed = new EmbedBuilder()
      .setTitle(lottery.isRollover ? '🎰 Lottery (Rollover)' : '🎰 Lottery')
      .setDescription(`${lottery.isRollover ? `**Rollover #${lottery.rolloverCount}** - No winners in previous draw!\n\n` : ''}**Lottery ID:** \`${lotteryId}\`\n\nPick ${lottery.winningNumbersCount} numbers from 1 to ${lottery.totalPoolNumbers}`)
      .addFields([
        { name: '🎫 Ticket Price', value: `${ticketPriceHuman} ${lottery.tokenTicker} (≈ $${ticketPriceUsdValue})`, inline: true },
        { name: '💰 Prize Pool', value: `${prizePoolHuman} ${lottery.tokenTicker} (≈ $${prizePoolUsdValue})`, inline: true },
        { name: '🏦 House Commission', value: `${lottery.houseCommissionPercent}%`, inline: true },
        { name: '⏰ End Time', value: endTimeText, inline: true },
        { name: '🎫 Tickets Sold', value: lottery.totalTickets.toString(), inline: true },
        { name: '👥 Participants', value: lottery.uniqueParticipants.toString(), inline: true }
      ])
      .setColor(color)
      .setThumbnail('https://i.ibb.co/20MLJZNH/lottery-logo.png')
      .setTimestamp(new Date(lottery.endTime))
      .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
    
    // Add winning numbers if lottery has ended
    if (lottery.winningNumbers && lottery.winningNumbers.length > 0) {
      const winningNumbersDisplay = lotteryHelpers.formatNumbersForDisplay(lottery.winningNumbers);
      lotteryEmbed.addFields({
        name: '🎯 Winning Numbers',
        value: winningNumbersDisplay,
        inline: false
      });
    }
    
    // Create buttons
    const components = [];
    if (!isExpired) {
      const buyTicketButton = new ButtonBuilder()
        .setCustomId(`lottery-buy-ticket:${lotteryId}`)
        .setLabel('Buy Ticket')
        .setStyle(ButtonStyle.Primary);
      
      const luckyDipButton = new ButtonBuilder()
        .setCustomId(`lottery-lucky-dip:${lotteryId}`)
        .setLabel('Lucky Dip')
        .setStyle(ButtonStyle.Success);
      
      const myActiveTicketsButton = new ButtonBuilder()
        .setCustomId(`lottery-my-active:${lotteryId}`)
        .setLabel('My Active Tickets')
        .setStyle(ButtonStyle.Secondary);
      
      const myResultsButton = new ButtonBuilder()
        .setCustomId(`lottery-my-results:${lotteryId}`)
        .setLabel('My Results')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
      
      const buttonRow = new ActionRowBuilder()
        .addComponents(buyTicketButton, luckyDipButton, myActiveTicketsButton, myResultsButton);
      
      components.push(buttonRow);
    } else {
      // Lottery ended - enable My Results button
      const myActiveTicketsButton = new ButtonBuilder()
        .setCustomId(`lottery-my-active:${lotteryId}`)
        .setLabel('My Active Tickets')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
      
      const myResultsButton = new ButtonBuilder()
        .setCustomId(`lottery-my-results:${lotteryId}`)
        .setLabel('My Results')
        .setStyle(ButtonStyle.Secondary);
      
      const buttonRow = new ActionRowBuilder()
        .addComponents(myActiveTicketsButton, myResultsButton);
      
      components.push(buttonRow);
    }
    
    await message.edit({ embeds: [lotteryEmbed], components });
    
  } catch (error) {
    console.error(`[LOTTERY] Error updating embed for lottery ${lotteryId}:`, error.message);
  }
}

// Process lottery draw
async function processLotteryDraw(guildId, lotteryId) {
  try {
    console.log(`[LOTTERY] Processing draw for lottery ${lotteryId}`);
    
    const lottery = await dbLottery.getLottery(guildId, lotteryId);
    if (!lottery || lottery.status !== 'LIVE') {
      return;
    }
    
    // Generate winning numbers
    const winningNumbers = lotteryHelpers.generateRandomNumbers(lottery.winningNumbersCount, lottery.totalPoolNumbers);
    
    // Get all tickets for this lottery to calculate matched numbers
    const allTickets = await dbLottery.getTicketsByLottery(guildId, lotteryId);
    const ticketArray = Object.values(allTickets).filter(t => t.status === 'LIVE');
    
    // Calculate matched numbers for all tickets and find winners
    const winningTickets = [];
    for (const ticket of ticketArray) {
      const match = lotteryHelpers.checkTicketMatch(ticket.numbers, winningNumbers);
      
      // Update ticket with matched numbers
      await dbLottery.updateTicketStatus(
        guildId, 
        ticket.ticketId, 
        match.isWinner ? 'WINNER' : 'EXPIRED', 
        match.isWinner, 
        match.matchedCount
      );
      
      if (match.isWinner) {
        winningTickets.push({
          ...ticket,
          matchedNumbers: match.matchedCount
        });
      }
    }
    
    // Update lottery with winning numbers
    await dbLottery.updateLottery(guildId, lotteryId, {
      winningNumbers: winningNumbers,
      hasWinners: winningTickets.length > 0,
      status: 'EXPIRED'
    });
    
    if (winningTickets.length > 0) {
      // We have winners!
      console.log(`[LOTTERY] Found ${winningTickets.length} winning ticket(s) for lottery ${lotteryId}`);
      
      // Calculate prize distribution
      const prizeDistribution = lotteryHelpers.calculatePrizeDistribution(
        lottery.prizePoolWei,
        winningTickets.length,
        lottery.houseCommissionPercent
      );
      
      // Get token decimals
      const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
      let tokenDecimals = 8;
      for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
        if (identifier === lottery.tokenIdentifier) {
          tokenDecimals = metadata.decimals;
          break;
        }
      }
      
      // Distribute prizes (tickets already marked as WINNER above)
      for (const ticket of winningTickets) {
        
        // Credit prize to virtual account
        const prizeHuman = new BigNumber(prizeDistribution.prizePerWinner).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
        await virtualAccounts.addFundsToAccount(
          guildId,
          ticket.userId,
          lottery.tokenIdentifier,
          prizeHuman,
          null,
          'lottery_prize',
          ticket.userTag
        );
        
        // Record winner - calculate USD value
        let prizeUsd = 0;
        try {
          const priceResponse = await fetch(`https://api.multiversx.com/tokens/${lottery.tokenIdentifier}?denominated=true`);
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            const tokenPriceUsd = priceData.price || 0;
            prizeUsd = parseFloat(new BigNumber(prizeHuman).multipliedBy(tokenPriceUsd).toFixed(2));
          }
        } catch (error) {
          console.error('[LOTTERY] Error fetching token price for winner:', error.message);
        }
        
        await dbLottery.createWinner(guildId, {
          lotteryId,
          userId: ticket.userId,
          userTag: ticket.userTag,
          ticketId: ticket.ticketId,
          tokenIdentifier: lottery.tokenIdentifier,
          tokenTicker: lottery.tokenTicker,
          prizeAmountWei: prizeDistribution.prizePerWinner,
          prizeAmountUsd: prizeUsd,
          winningNumbers: winningNumbers,
          ticketNumbers: ticket.numbers
        });
      }
      
      // Track house commission (using identifier)
      // CRITICAL: Validate identifier format before tracking (prevent ticker-only storage)
      if (prizeDistribution.commission !== '0') {
        const identifierFormatCheck = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
        if (identifierFormatCheck.test(lottery.tokenIdentifier)) {
          await trackLotteryEarnings(guildId, lottery.tokenIdentifier, prizeDistribution.commission);
        } else {
          console.error(`[LOTTERY] Cannot track earnings: Invalid token identifier format in lottery ${lotteryId}: "${lottery.tokenIdentifier}". Expected full identifier format (e.g., "REWARD-cf6eac").`);
          // Try to resolve identifier from ticker as fallback
          const resolvedIdentifier = await resolveTokenIdentifier(guildId, lottery.tokenIdentifier);
          if (resolvedIdentifier && identifierFormatCheck.test(resolvedIdentifier)) {
            console.log(`[LOTTERY] Resolved identifier "${resolvedIdentifier}" from ticker "${lottery.tokenIdentifier}", tracking earnings...`);
            await trackLotteryEarnings(guildId, resolvedIdentifier, prizeDistribution.commission);
            // Update lottery with correct identifier for future draws
            await dbLottery.updateLottery(guildId, lotteryId, { tokenIdentifier: resolvedIdentifier });
          } else {
            console.error(`[LOTTERY] Failed to resolve identifier for ticker "${lottery.tokenIdentifier}". Earnings not tracked.`);
          }
        }
      }
      
      // Update embed
      await updateLotteryEmbed(guildId, lotteryId);
      
      // Calculate unique winners and group tickets by winner
      const uniqueWinnerIds = new Set(winningTickets.map(t => t.userId));
      const uniqueWinnersCount = uniqueWinnerIds.size;
      
      // Group winning tickets by userId
      const winnersMap = new Map();
      for (const ticket of winningTickets) {
        if (!winnersMap.has(ticket.userId)) {
          winnersMap.set(ticket.userId, {
            userId: ticket.userId,
            userTag: ticket.userTag,
            tickets: []
          });
        }
        winnersMap.get(ticket.userId).tickets.push(ticket.ticketId);
      }
      
      // Send winner announcement in thread and as reply in channel
      try {
        const channel = await client.channels.fetch(lottery.channelId);
        if (channel) {
          const prizeHuman = new BigNumber(prizeDistribution.prizePerWinner).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
          
          // Build winner mentions and ticket IDs list
          const winnerMentions = [];
          const winnerDetails = [];
          
          for (const [userId, winnerData] of winnersMap.entries()) {
            winnerMentions.push(`<@${userId}>`);
            const ticketIdsList = winnerData.tickets.map(id => `\`${id.substring(0, 16)}...\``).join(', ');
            winnerDetails.push(`**<@${userId}>** (${winnerData.tickets.length} ticket${winnerData.tickets.length > 1 ? 's' : ''}): ${ticketIdsList}`);
          }
          
          const winnerEmbed = new EmbedBuilder()
            .setTitle('🎉 Lottery Winners!')
            .setDescription(`**${winningTickets.length} winning ticket(s) found!**\n\n🏆 **Winners:** ${winnerMentions.join(', ')}`)
            .addFields([
              { name: '🎫 Lottery ID', value: `\`${lotteryId}\``, inline: false },
              { name: '🎯 Winning Numbers', value: lotteryHelpers.formatNumbersForDisplay(winningNumbers), inline: false },
              { name: '💰 Prize Per Winner', value: `${prizeHuman} ${lottery.tokenTicker}`, inline: true },
              { name: '🎫 Winning Tickets', value: winningTickets.length.toString(), inline: true },
              { name: '👥 Unique Winners', value: uniqueWinnersCount.toString(), inline: true },
              { name: '🎟️ Winning Ticket IDs', value: winnerDetails.join('\n') || 'N/A', inline: false }
            ])
            .setColor(0x00FF00)
            .setThumbnail('https://i.ibb.co/35ZztKrH/lottery-winner.png')
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();
          
          // Send as reply to original lottery message in channel
          if (lottery.messageId) {
            try {
              const originalMessage = await channel.messages.fetch(lottery.messageId);
              if (originalMessage) {
                await originalMessage.reply({ embeds: [winnerEmbed] });
              } else {
                // Fallback if message not found
                await channel.send({ embeds: [winnerEmbed] });
              }
            } catch (replyError) {
              console.error('[LOTTERY] Error replying to original message:', replyError.message);
              // Fallback to regular send
              await channel.send({ embeds: [winnerEmbed] });
            }
          } else {
            await channel.send({ embeds: [winnerEmbed] });
          }
          
          // Also post in thread
          if (lottery.threadId) {
            try {
              const thread = await channel.threads.cache.get(lottery.threadId) || await channel.threads.fetch(lottery.threadId);
              if (thread) {
                await thread.send({ embeds: [winnerEmbed] });
              }
            } catch (threadError) {
              console.error('[LOTTERY] Error posting to thread:', threadError.message);
            }
          }
          
          // Send DM to each unique winner
          const projectLogoUrl = await getProjectLogoUrl(guildId, 'Community Fund'); // Get project logo for DM
          for (const [userId, winnerData] of winnersMap.entries()) {
            try {
              const user = await client.users.fetch(userId);
              if (user) {
                const winnerTicketCount = winnerData.tickets.length;
                const totalPrizeForUser = new BigNumber(prizeDistribution.prizePerWinner).multipliedBy(winnerTicketCount).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
                
                const dmEmbed = new EmbedBuilder()
                  .setTitle('🎉 Congratulations! You Won the Lottery!')
                  .setDescription(`You won **${totalPrizeForUser} ${lottery.tokenTicker}** with ${winnerTicketCount} winning ticket${winnerTicketCount > 1 ? 's' : ''}!`)
                  .addFields([
                    { name: '🎫 Lottery ID', value: `\`${lotteryId}\``, inline: false },
                    { name: '🎯 Winning Numbers', value: lotteryHelpers.formatNumbersForDisplay(winningNumbers), inline: false },
                    { name: '🎟️ Your Winning Ticket IDs', value: winnerData.tickets.map(id => `\`${id}\``).join('\n'), inline: false },
                    { name: '💰 Prize Per Ticket', value: `${prizeHuman} ${lottery.tokenTicker}`, inline: true },
                    { name: '🎫 Your Tickets', value: winnerTicketCount.toString(), inline: true },
                    { name: '💎 Total Prize', value: `${totalPrizeForUser} ${lottery.tokenTicker}`, inline: true }
                  ])
                  .setColor(0x00FF00)
                  .setThumbnail(projectLogoUrl)
                  .setFooter({ text: 'Prize has been added to your virtual account! Use /check-balance-esdt to see your winnings.', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
                  .setTimestamp();
                
                await user.send({ embeds: [dmEmbed] });
                console.log(`[LOTTERY] Sent winner DM to ${user.tag} (${userId}) for lottery ${lotteryId}`);
              }
            } catch (dmError) {
              // User might have DMs disabled or blocked the bot
              console.error(`[LOTTERY] Failed to send DM to winner ${userId}:`, dmError.message);
            }
          }
        }
      } catch (error) {
        console.error('[LOTTERY] Error sending winner announcement:', error.message);
      }
      
    } else {
      // No winners - rollover
      console.log(`[LOTTERY] No winners found for lottery ${lotteryId}, creating rollover`);
      
      // Create rollover lottery
      const rolloverLotteryId = `lottery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const frequencyMs = lotteryHelpers.parseFrequency(lottery.drawingFrequency);
      const newEndTime = Date.now() + frequencyMs;
      
      await dbLottery.createLottery(guildId, rolloverLotteryId, {
        winningNumbersCount: lottery.winningNumbersCount,
        totalPoolNumbers: lottery.totalPoolNumbers,
        tokenIdentifier: lottery.tokenIdentifier,
        tokenTicker: lottery.tokenTicker,
        drawingFrequency: lottery.drawingFrequency,
        houseCommissionPercent: lottery.houseCommissionPercent,
        ticketPriceWei: lottery.ticketPriceWei,
        prizePoolWei: lottery.prizePoolWei, // Carry over prize pool
        prizePoolUsd: lottery.prizePoolUsd,
        startTime: Date.now(),
        endTime: newEndTime,
        nextDrawTime: newEndTime,
        status: 'LIVE',
        hasWinners: false,
        totalTickets: 0,
        uniqueParticipants: 0,
        isRollover: true,
        originalLotteryId: lottery.lotteryId,
        rolloverCount: lottery.rolloverCount + 1
      });
      
      // Create new embed for rollover lottery
      try {
        const channel = await client.channels.fetch(lottery.channelId);
        if (channel) {
          // Fetch token price
          let tokenPriceUsd = 0;
          try {
            const priceResponse = await fetch(`https://api.multiversx.com/tokens/${lottery.tokenIdentifier}?denominated=true`);
            if (priceResponse.ok) {
              const priceData = await priceResponse.json();
              tokenPriceUsd = priceData.price || 0;
            }
          } catch (error) {
            console.error('[LOTTERY] Error fetching token price:', error.message);
          }
          
          const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
          let tokenDecimals = 8;
          for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
            if (identifier === lottery.tokenIdentifier) {
              tokenDecimals = metadata.decimals;
              break;
            }
          }
          
          const prizePoolHuman = new BigNumber(lottery.prizePoolWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
          const ticketPriceHuman = new BigNumber(lottery.ticketPriceWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
          const prizePoolUsdValue = new BigNumber(prizePoolHuman).multipliedBy(tokenPriceUsd).toFixed(2);
          const ticketPriceUsdValue = new BigNumber(ticketPriceHuman).multipliedBy(tokenPriceUsd).toFixed(2);
          
          const rolloverEmbed = new EmbedBuilder()
            .setTitle('🎰 Lottery (Rollover)')
            .setDescription(`**Lottery ID:** \`${rolloverLotteryId}\`\n\n**Rollover #${lottery.rolloverCount + 1}** - No winners in previous draw!\n\nPick ${lottery.winningNumbersCount} numbers from 1 to ${lottery.totalPoolNumbers}`)
            .addFields([
              { name: '🎫 Ticket Price', value: `${ticketPriceHuman} ${lottery.tokenTicker} (≈ $${ticketPriceUsdValue})`, inline: true },
              { name: '💰 Prize Pool', value: `${prizePoolHuman} ${lottery.tokenTicker} (≈ $${prizePoolUsdValue})`, inline: true },
              { name: '🏦 House Commission', value: `${lottery.houseCommissionPercent}%`, inline: true },
              { name: '⏰ End Time', value: `<t:${Math.floor(newEndTime / 1000)}:R>`, inline: true },
              { name: '🎫 Tickets Sold', value: '0', inline: true },
              { name: '👥 Participants', value: '0', inline: true }
            ])
            .setColor(0x00FF00)
            .setThumbnail('https://i.ibb.co/20MLJZNH/lottery-logo.png')
            .setTimestamp(new Date(newEndTime))
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
          
          const buyTicketButton = new ButtonBuilder()
            .setCustomId(`lottery-buy-ticket:${rolloverLotteryId}`)
            .setLabel('Buy Ticket')
            .setStyle(ButtonStyle.Primary);
          
          const luckyDipButton = new ButtonBuilder()
            .setCustomId(`lottery-lucky-dip:${rolloverLotteryId}`)
            .setLabel('Lucky Dip')
            .setStyle(ButtonStyle.Success);
          
          const myActiveTicketsButton = new ButtonBuilder()
            .setCustomId(`lottery-my-active:${rolloverLotteryId}`)
            .setLabel('My Active Tickets')
            .setStyle(ButtonStyle.Secondary);
          
          const myResultsButton = new ButtonBuilder()
            .setCustomId(`lottery-my-results:${rolloverLotteryId}`)
            .setLabel('My Results')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);
          
          const buttonRow = new ActionRowBuilder()
            .addComponents(buyTicketButton, luckyDipButton, myActiveTicketsButton, myResultsButton);
          
          const rolloverMessage = await channel.send({
            embeds: [rolloverEmbed],
            components: [buttonRow]
          });
          
          // Create thread
          let threadId = null;
          try {
            const thread = await rolloverMessage.startThread({
              name: `Lottery ${rolloverLotteryId.substring(0, 8)}`,
              autoArchiveDuration: 1440
            });
            threadId = thread.id;
          } catch (threadError) {
            console.error('[LOTTERY] Error creating thread:', threadError.message);
          }
          
          // Update lottery with message/channel/thread IDs
          await dbLottery.updateLottery(guildId, rolloverLotteryId, {
            channelId: channel.id,
            messageId: rolloverMessage.id,
            threadId: threadId
          });
        }
      } catch (error) {
        console.error('[LOTTERY] Error creating rollover embed:', error.message);
      }
      
      // Update original lottery embed
      await updateLotteryEmbed(guildId, lotteryId);
    }
    
  } catch (error) {
    console.error(`[LOTTERY] Error processing draw for lottery ${lotteryId}:`, error.message);
  }
}

// Track lottery earnings (house commission)
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
async function trackLotteryEarnings(guildId, tokenIdentifier, commissionWei) {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[LOTTERY] Invalid token identifier format: ${tokenIdentifier}`);
      return;
    }
    
    // Get token metadata for ticker display
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    const tokenTicker = tokenMetadata[tokenIdentifier]?.ticker || tokenIdentifier.split('-')[0];
    
    // Get current house balance
    const currentBalance = await getHouseBalance(guildId, tokenIdentifier);
    const houseBalance = currentBalance || {
      bettingEarnings: {},
      bettingSpending: {},
      bettingPNL: {},
      auctionEarnings: {},
      auctionSpending: {},
      auctionPNL: {},
      lotteryEarnings: {},
      lotterySpending: {},
      lotteryPNL: {}
    };
    
    // Track lottery earnings (using identifier as key, not ticker)
    if (!houseBalance.lotteryEarnings[tokenIdentifier]) {
      houseBalance.lotteryEarnings[tokenIdentifier] = '0';
    }
    const currentLotteryEarnings = new BigNumber(houseBalance.lotteryEarnings[tokenIdentifier] || '0');
    const newLotteryEarnings = currentLotteryEarnings.plus(new BigNumber(commissionWei));
    houseBalance.lotteryEarnings[tokenIdentifier] = newLotteryEarnings.toString();
    
    // Recalculate lottery PNL (using identifier as key)
    const lotterySpending = new BigNumber(houseBalance.lotterySpending[tokenIdentifier] || '0');
    houseBalance.lotteryPNL[tokenIdentifier] = newLotteryEarnings.minus(lotterySpending).toString();
    
    // Save to database
    await dbServerData.updateHouseBalance(guildId, tokenIdentifier, houseBalance);
    
    // Log earnings
    const tokenDecimals = tokenMetadata[tokenIdentifier]?.decimals || 8;
    const humanAmount = new BigNumber(commissionWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
    console.log(`[HOUSE] Tracked lottery earnings: +${humanAmount} ${tokenTicker} (Lottery house balance)`);
    
  } catch (error) {
    console.error(`[HOUSE] Error tracking lottery earnings:`, error.message);
  }
}

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
  }, 5 * 60 * 1000); // Run every 5 minutes
  
  // FINISHED matches remain in database for historical records - no cleanup needed
  // Transaction history cleanup removed - Supabase can efficiently handle unlimited transactions with proper indexing

  // Set up periodic check for expired auctions
  setInterval(async () => {
    try {
      const allGuilds = await client.guilds.fetch();
      for (const [guildId, guild] of allGuilds) {
        try {
          const activeAuctions = await dbAuctions.getActiveAuctions(guildId);
          for (const auction of activeAuctions) {
            if (isAuctionExpired(auction)) {
              console.log(`[AUCTIONS] Processing expired auction ${auction.auctionId}`);
              await processAuctionClosure(guildId, auction.auctionId);
            }
          }
        } catch (error) {
          console.error(`[AUCTIONS] Error checking auctions for guild ${guildId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('[AUCTIONS] Error checking expired auctions:', error.message);
    }
  }, 60 * 1000); // Check every minute
  
  // Set up periodic check for expired lotteries
  setInterval(async () => {
    try {
      const expiredLotteries = await dbLottery.getAllLotteriesForDrawCheck();
      for (const lottery of expiredLotteries) {
        console.log(`[LOTTERY] Processing expired lottery ${lottery.lotteryId}`);
        await processLotteryDraw(lottery.guildId, lottery.lotteryId);
      }
    } catch (error) {
      console.error('[LOTTERY] Error checking expired lotteries:', error.message);
    }
  }, 60 * 1000); // Check every minute
  
  // Set up periodic update for lottery embeds (USD price)
  setInterval(async () => {
    try {
      const allGuilds = await client.guilds.fetch();
      for (const [guildId, guild] of allGuilds) {
        try {
          const activeLotteries = await dbLottery.getActiveLotteries(guildId);
          for (const lotteryId of Object.keys(activeLotteries)) {
            await updateLotteryEmbed(guildId, lotteryId);
          }
        } catch (error) {
          console.error(`[LOTTERY] Error updating embeds for guild ${guildId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('[LOTTERY] Error updating lottery embeds:', error.message);
    }
  }, 10 * 60 * 1000); // Update every 10 minutes
  
  console.log('RPS challenge cleanup scheduled (every 5 minutes)');
  console.log('Football match cleanup scheduled (once a day)');
  console.log('Auction expiration check scheduled (every minute)');
  console.log('Lottery draw check scheduled (every minute)');
  console.log('Lottery embed update scheduled (every 10 minutes)');
  
  // Set up periodic cleanup for expired NFT offers and listings
  setInterval(async () => {
    try {
      const allGuilds = await client.guilds.fetch();
      for (const [guildId, guild] of allGuilds) {
        try {
          await virtualAccountsNFT.cleanupExpiredOffers();
          await virtualAccountsNFT.cleanupExpiredListings();
        } catch (error) {
          console.error(`[NFT-MARKETPLACE] Error cleaning up expired items for guild ${guildId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error cleaning up expired NFT offers/listings:', error.message);
    }
  }, 60 * 60 * 1000); // Check every hour
  
  console.log('NFT marketplace cleanup scheduled (every hour)');
  
  // Set up periodic cleanup of old Discord embeds (listings and auctions)
  // Runs once per day at 2 AM (in milliseconds: 2 hours * 60 minutes * 60 seconds * 1000)
  const cleanupOldEmbeds = async () => {
    try {
      console.log('[CLEANUP] Starting cleanup of old Discord embeds...');
      console.log('[CLEANUP] Looking for items older than 1 day with statuses:');
      console.log('[CLEANUP]   Listings: CANCELLED, EXPIRED, SOLD');
      console.log('[CLEANUP]   Auctions: FINISHED, CANCELLED, EXPIRED');
      
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const oneDayAgo = Date.now() - ONE_DAY_MS;
      const LISTING_STATUSES = ['CANCELLED', 'EXPIRED', 'SOLD'];
      const AUCTION_STATUSES = ['FINISHED', 'CANCELLED', 'EXPIRED'];
      
      console.log(`[CLEANUP] Cutoff time: ${new Date(oneDayAgo).toISOString()} (items created before this will be cleaned)`);
      
      let listingsDeleted = 0;
      let auctionsDeleted = 0;
      let errors = 0;
      
      // Clean up old listings
      try {
        const supabase = require('./supabase-client');
        const { data: listings } = await supabase
          .from('nft_listings')
          .select('listing_id, guild_id, message_id, channel_id, thread_id, status, title')
          .in('status', LISTING_STATUSES)
          .lt('created_at', oneDayAgo)
          .not('message_id', 'is', null)
          .not('channel_id', 'is', null);
        
        if (listings && listings.length > 0) {
          console.log(`[CLEANUP] Found ${listings.length} old listing(s) to clean up`);
          for (const listing of listings) {
            try {
              const guild = await client.guilds.fetch(listing.guild_id).catch(() => null);
              if (!guild) {
                console.log(`[CLEANUP] Skipping listing ${listing.listing_id}: Guild not found`);
                continue;
              }
              
              const channel = await guild.channels.fetch(listing.channel_id).catch(() => null);
              if (!channel) {
                console.log(`[CLEANUP] Skipping listing ${listing.listing_id}: Channel not found`);
                continue;
              }
              
              // Check if it's a forum channel
              const isForumChannel = channel.type === ChannelType.GuildForum;
              
              if (isForumChannel && listing.thread_id) {
                // For forum channels, the thread IS the post - delete the thread
                try {
                  const thread = await channel.threads.fetch(listing.thread_id).catch(() => null);
                  if (thread) {
                    await thread.delete();
                    console.log(`[CLEANUP] Deleted forum post/thread: ${listing.title} (${listing.listing_id})`);
                    listingsDeleted++;
                  } else {
                    console.log(`[CLEANUP] Thread already deleted: ${listing.title} (${listing.listing_id})`);
                  }
                } catch (threadError) {
                  if (threadError.code === 10003) {
                    console.log(`[CLEANUP] Thread already deleted: ${listing.title} (${listing.listing_id})`);
                  } else {
                    console.error(`[CLEANUP] Error deleting thread ${listing.listing_id}:`, threadError.message);
                    errors++;
                  }
                }
              } else {
                // For regular channels, delete the message
                try {
                  const message = await channel.messages.fetch(listing.message_id).catch(() => null);
                  if (message) {
                    await message.delete();
                    console.log(`[CLEANUP] Deleted listing message: ${listing.title} (${listing.listing_id})`);
                    listingsDeleted++;
                  } else {
                    console.log(`[CLEANUP] Message already deleted: ${listing.title} (${listing.listing_id})`);
                  }
                  
                  // Also delete thread if it exists
                  if (listing.thread_id) {
                    const thread = await channel.threads.fetch(listing.thread_id).catch(() => null);
                    if (thread) {
                      await thread.delete().catch(() => {});
                    }
                  }
                } catch (msgError) {
                  if (msgError.code === 10008) {
                    console.log(`[CLEANUP] Message already deleted: ${listing.title} (${listing.listing_id})`);
                  } else {
                    console.error(`[CLEANUP] Error deleting message ${listing.listing_id}:`, msgError.message);
                    errors++;
                  }
                }
              }
              
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`[CLEANUP] Error processing listing ${listing.listing_id}:`, error.message);
              errors++;
            }
          }
        } else {
          console.log('[CLEANUP] No old listings found to clean up');
        }
      } catch (error) {
        console.error('[CLEANUP] Error cleaning up listings:', error.message);
      }
      
      // Clean up old auctions
      try {
        // For finished auctions, we should check end_time (when they finished), not created_at
        // For cancelled/expired, we can use created_at
        // First, let's check what auctions exist with FINISHED status
        const { data: allFinishedAuctions } = await supabase
          .from('auctions')
          .select('auction_id, guild_id, message_id, channel_id, thread_id, status, title, created_at, end_time')
          .in('status', AUCTION_STATUSES)
          .not('message_id', 'is', null)
          .not('channel_id', 'is', null);
        
        console.log(`[CLEANUP] Found ${allFinishedAuctions?.length || 0} auction(s) with cleanup statuses (before age filter)`);
        if (allFinishedAuctions && allFinishedAuctions.length > 0) {
          console.log(`[CLEANUP] Sample auction data:`, allFinishedAuctions.slice(0, 3).map(a => ({ 
            id: a.auction_id, 
            status: a.status, 
            created: a.created_at ? new Date(a.created_at).toISOString() : 'null',
            ended: a.end_time ? new Date(a.end_time).toISOString() : 'null'
          })));
        }
        
        // Query: For FINISHED auctions, check end_time. For others, check created_at
        // We'll filter in JavaScript to be more flexible
        const { data: allAuctions, error: auctionError } = await supabase
          .from('auctions')
          .select('auction_id, guild_id, message_id, channel_id, thread_id, status, title, created_at, end_time')
          .in('status', AUCTION_STATUSES)
          .not('message_id', 'is', null)
          .not('channel_id', 'is', null);
        
        if (auctionError) {
          console.error('[CLEANUP] Error querying auctions:', auctionError);
        }
        
        // Filter auctions: FINISHED ones use end_time, others use created_at
        console.log(`[CLEANUP] Total auctions found with cleanup statuses: ${allAuctions?.length || 0}`);
        
        const auctions = (allAuctions || []).filter(auction => {
          if (auction.status === 'FINISHED') {
            // For finished auctions, check if they ended more than 1 day ago
            const endedDaysAgo = auction.end_time ? Math.floor((Date.now() - auction.end_time) / (24 * 60 * 60 * 1000)) : null;
            const shouldClean = auction.end_time && auction.end_time < oneDayAgo;
            if (!shouldClean && auction.status === 'FINISHED') {
              console.log(`[CLEANUP] Skipping FINISHED auction ${auction.auction_id.substring(0, 20)}... - ended ${endedDaysAgo} days ago (needs to be > 1 day)`);
            }
            return shouldClean;
          } else {
            // For cancelled/expired, check if created more than 1 day ago
            const ageDays = auction.created_at ? Math.floor((Date.now() - auction.created_at) / (24 * 60 * 60 * 1000)) : null;
            const shouldClean = auction.created_at && auction.created_at < oneDayAgo;
            if (!shouldClean) {
              console.log(`[CLEANUP] Skipping ${auction.status} auction ${auction.auction_id.substring(0, 20)}... - created ${ageDays} days ago (needs to be > 1 day)`);
            }
            return shouldClean;
          }
        });
        
        if (auctions && auctions.length > 0) {
          console.log(`[CLEANUP] ✅ Found ${auctions.length} old auction(s) to clean up (older than 1 day)`);
          console.log(`[CLEANUP] Auction details:`, auctions.map(a => ({
            id: a.auction_id.substring(0, 30),
            title: a.title,
            status: a.status,
            ended_days_ago: a.status === 'FINISHED' && a.end_time ? Math.floor((Date.now() - a.end_time) / (24 * 60 * 60 * 1000)) : 'N/A',
            created_days_ago: a.created_at ? Math.floor((Date.now() - a.created_at) / (24 * 60 * 60 * 1000)) : 'N/A'
          })));
          for (const auction of auctions) {
            try {
              console.log(`[CLEANUP] Processing auction: ${auction.title} (${auction.auction_id.substring(0, 20)}...)`);
              console.log(`[CLEANUP]   Guild ID: ${auction.guild_id}, Channel ID: ${auction.channel_id}, Message ID: ${auction.message_id}, Thread ID: ${auction.thread_id || 'none'}`);
              
              const guild = await client.guilds.fetch(auction.guild_id).catch((err) => {
                console.error(`[CLEANUP] Error fetching guild ${auction.guild_id}:`, err.message, err.code);
                return null;
              });
              if (!guild) {
                console.log(`[CLEANUP] ❌ Skipping auction ${auction.auction_id.substring(0, 20)}...: Guild ${auction.guild_id} not found or bot not in guild`);
                continue;
              }
              console.log(`[CLEANUP] ✅ Found guild: ${guild.name} (${guild.id})`);
              
              const channel = await guild.channels.fetch(auction.channel_id).catch((err) => {
                console.error(`[CLEANUP] Error fetching channel ${auction.channel_id}:`, err.message, err.code);
                return null;
              });
              if (!channel) {
                console.log(`[CLEANUP] ❌ Skipping auction ${auction.auction_id.substring(0, 20)}...: Channel ${auction.channel_id} not found in guild ${guild.name}`);
                continue;
              }
              console.log(`[CLEANUP] ✅ Found channel: ${channel.name} (${channel.id}), Type: ${channel.type}`);
              
              // Check if it's a forum channel
              const isForumChannel = channel.type === ChannelType.GuildForum;
              
              console.log(`[CLEANUP] Channel type: ${channel.type}, Is Forum: ${isForumChannel}`);
              
              if (isForumChannel && auction.thread_id) {
                // For forum channels, the thread IS the post - delete the thread
                try {
                  console.log(`[CLEANUP] Attempting to fetch and delete forum thread: ${auction.thread_id}`);
                  const thread = await channel.threads.fetch(auction.thread_id).catch((err) => {
                    console.error(`[CLEANUP] Error fetching thread ${auction.thread_id}:`, err.message, err.code);
                    return null;
                  });
                  if (thread) {
                    await thread.delete();
                    console.log(`[CLEANUP] ✅ Deleted forum post/thread: ${auction.title} (${auction.auction_id})`);
                    auctionsDeleted++;
                  } else {
                    console.log(`[CLEANUP] ⚠️ Thread not found (may already be deleted): ${auction.title} (${auction.auction_id})`);
                  }
                } catch (threadError) {
                  if (threadError.code === 10003) {
                    console.log(`[CLEANUP] ℹ️ Thread already deleted: ${auction.title} (${auction.auction_id})`);
                  } else {
                    console.error(`[CLEANUP] ❌ Error deleting thread ${auction.auction_id}:`, threadError.message, threadError.code);
                    errors++;
                  }
                }
              } else {
                // For regular channels, delete the message
                try {
                  console.log(`[CLEANUP] Attempting to fetch and delete message: ${auction.message_id}`);
                  const message = await channel.messages.fetch(auction.message_id).catch((err) => {
                    console.error(`[CLEANUP] Error fetching message ${auction.message_id}:`, err.message, err.code);
                    return null;
                  });
                  if (message) {
                    await message.delete();
                    console.log(`[CLEANUP] ✅ Deleted auction message: ${auction.title} (${auction.auction_id})`);
                    auctionsDeleted++;
                  } else {
                    console.log(`[CLEANUP] ⚠️ Message not found (may already be deleted): ${auction.title} (${auction.auction_id})`);
                  }
                  
                  // Also delete thread if it exists
                  if (auction.thread_id) {
                    console.log(`[CLEANUP] Attempting to delete thread: ${auction.thread_id}`);
                    const thread = await channel.threads.fetch(auction.thread_id).catch(() => null);
                    if (thread) {
                      await thread.delete().catch((err) => {
                        console.error(`[CLEANUP] Error deleting thread ${auction.thread_id}:`, err.message);
                      });
                    }
                  }
                } catch (msgError) {
                  if (msgError.code === 10008) {
                    console.log(`[CLEANUP] ℹ️ Message already deleted: ${auction.title} (${auction.auction_id})`);
                  } else {
                    console.error(`[CLEANUP] ❌ Error deleting message ${auction.auction_id}:`, msgError.message, msgError.code);
                    errors++;
                  }
                }
              }
              
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`[CLEANUP] Error processing auction ${auction.auction_id}:`, error.message);
              errors++;
            }
          }
        } else {
          if (allAuctions && allAuctions.length > 0) {
            console.log(`[CLEANUP] ⚠️ Found ${allAuctions.length} auction(s) with cleanup statuses, but none are old enough (> 1 day)`);
            console.log(`[CLEANUP] They will be cleaned up once they're older than 1 day`);
          } else {
            console.log('[CLEANUP] ℹ️ No auctions found with cleanup statuses (FINISHED, CANCELLED, EXPIRED)');
          }
        }
      } catch (error) {
        console.error('[CLEANUP] Error cleaning up auctions:', error.message);
      }
      
      if (listingsDeleted > 0 || auctionsDeleted > 0) {
        console.log(`[CLEANUP] ✅ Cleanup complete: ${listingsDeleted} listing(s) and ${auctionsDeleted} auction(s) deleted`);
      } else if (errors > 0) {
        console.log(`[CLEANUP] ⚠️ Cleanup completed with ${errors} error(s)`);
      } else {
        console.log(`[CLEANUP] ℹ️ No old embeds found to clean up (all listings/auctions are either active or less than 1 day old)`);
      }
    } catch (error) {
      console.error('[CLEANUP] Error in cleanup task:', error.message);
    }
  };
  
  // Run cleanup once per day (24 hours)
  setInterval(cleanupOldEmbeds, 24 * 60 * 60 * 1000);
  
  // Run cleanup on startup (after 10 seconds delay to let bot fully initialize)
  setTimeout(cleanupOldEmbeds, 10 * 1000);
  
  console.log('Old Discord embeds cleanup scheduled (once per day, also runs on startup)');
  
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

// --- RPS Games Data (now in database) ---
// All RPS games data is stored in Supabase database
// Use dbRpsGames module directly

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
    
    // Store the token metadata in database
    await dbServerData.setTokenMetadata(guildId, tokenIdentifier, tokenMetadata);
    
    console.log(`[TOKEN] Successfully stored metadata for ${tokenIdentifier}: ${tokenMetadata.decimals} decimals`);
    return true;
  } catch (error) {
    console.error(`[TOKEN] Error updating token metadata for ${tokenIdentifier}:`, error.message);
    return false;
  }
}

// Function to get token decimals from stored metadata
async function getStoredTokenDecimals(guildId, tokenIdentifier) {
  try {
    const metadata = await dbServerData.getTokenMetadata(guildId);
    if (metadata && metadata[tokenIdentifier]) {
      return metadata[tokenIdentifier].decimals;
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

// Helper function to resolve token identifier from ticker using metadata
// Returns identifier if found, otherwise returns the input (for backward compatibility)
async function resolveTokenIdentifier(guildId, tokenInput) {
  try {
    // Clean input - remove any quotes or whitespace
    let cleanInput = typeof tokenInput === 'string' ? tokenInput.trim() : String(tokenInput).trim();
    cleanInput = cleanInput.replace(/^["']+|["']+$/g, ''); // Remove surrounding quotes
    
    // If already a full identifier, return it (cleaned)
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (esdtIdentifierRegex.test(cleanInput)) {
      return cleanInput; // Return plain string without quotes
    }
    
    // Try to find identifier from metadata
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    for (const [identifier, metadata] of Object.entries(tokenMetadata)) {
      // Clean identifier from metadata too
      const cleanIdentifier = identifier.replace(/^["']+|["']+$/g, '');
      if (metadata.ticker === cleanInput || cleanIdentifier === cleanInput) {
        return cleanIdentifier; // Return plain string without quotes
      }
    }
    
    // If not found in metadata, try API lookup
    const identifier = await getTokenIdentifier(cleanInput);
    if (identifier) {
      // Clean the identifier from API too
      return identifier.replace(/^["']+|["']+$/g, '');
    }
    return cleanInput; // Fallback to cleaned input if not found
  } catch (error) {
    console.error(`[TOKEN] Error resolving identifier for "${tokenInput}":`, error.message);
    // Clean and return input on error
    const cleanInput = typeof tokenInput === 'string' ? tokenInput.trim() : String(tokenInput).trim();
    return cleanInput.replace(/^["']+|["']+$/g, '');
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

// All football and auction data is stored in Supabase database
// Use dbFootball and dbAuctions modules directly

async function getAuctions(guildId) {
  try {
    return await dbAuctions.getAuctionsByGuild(guildId);
  } catch (error) {
    console.error(`[AUCTIONS] Error getting auctions for guild ${guildId}:`, error.message);
    return {};
  }
}

// Check if auction is expired
// Helper function to extract NFT image URL with robust fallback strategy
async function extractNFTImageUrl(nftDetails, storedImageUrl = null) {
  // Helper function to convert IPFS URL to HTTP gateway URL
  const convertIPFSToGateway = (ipfsUrl) => {
    if (!ipfsUrl) return ipfsUrl;
    if (ipfsUrl.startsWith('ipfs://')) {
      const ipfsHash = ipfsUrl.replace('ipfs://', '');
      return `https://ipfs.io/ipfs/${ipfsHash}`;
    }
    return ipfsUrl;
  };
  
  let nftImageUrl = storedImageUrl;
  
  // Convert stored image URL if it's IPFS
  if (nftImageUrl && nftImageUrl.startsWith('ipfs://')) {
    nftImageUrl = convertIPFSToGateway(nftImageUrl);
  }
  
  // If we have nftDetails from API, use the robust fallback strategy
  if (nftDetails) {
    // Decode URIs array to get IPFS URLs (standard MultiversX format)
    let ipfsImageUrl = null;
    if (nftDetails.uris && Array.isArray(nftDetails.uris) && nftDetails.uris.length > 0) {
      for (const uri of nftDetails.uris) {
        try {
          const decodedUri = Buffer.from(uri, 'base64').toString('utf-8');
          if (decodedUri.includes('.png') || decodedUri.includes('.jpg') || decodedUri.includes('.jpeg') || decodedUri.includes('.gif') || decodedUri.includes('.webp')) {
            ipfsImageUrl = decodedUri;
            break;
          }
        } catch (uriError) {
          // Ignore decode errors
        }
      }
    }
    
    // Update image URL if available from API - check multiple sources
    if (nftDetails.url && !nftDetails.url.includes('default.png')) {
      nftImageUrl = convertIPFSToGateway(nftDetails.url);
    } else if (ipfsImageUrl) {
      nftImageUrl = convertIPFSToGateway(ipfsImageUrl);
    } else if (nftDetails.media && nftDetails.media.length > 0) {
      const mediaUrl = nftDetails.media[0].url || nftDetails.media[0].thumbnailUrl;
      if (mediaUrl && !mediaUrl.includes('default.png')) {
        nftImageUrl = convertIPFSToGateway(mediaUrl);
      }
    }
    
    // Also check for image in metadata
    if (!nftImageUrl && nftDetails.metadata) {
      try {
        if (typeof nftDetails.metadata === 'string') {
          const decoded = Buffer.from(nftDetails.metadata, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          if (parsed.image) {
            nftImageUrl = convertIPFSToGateway(parsed.image);
          }
        } else if (typeof nftDetails.metadata === 'object' && nftDetails.metadata.image) {
          nftImageUrl = convertIPFSToGateway(nftDetails.metadata.image);
        }
      } catch (metaError) {
        // Ignore metadata parsing errors for image
      }
    }
  }
  
  return nftImageUrl;
}

function isAuctionExpired(auction) {
  return Date.now() >= auction.endTime || auction.status !== 'ACTIVE';
}

// Update auction embed
// Update NFT listing embed
async function updateNFTListingEmbed(guildId, listingId) {
  try {
    const listing = await virtualAccountsNFT.getListing(guildId, listingId);
    if (!listing) return;

    const channel = await client.channels.fetch(listing.channelId);
    if (!channel) return;

    const message = await channel.messages.fetch(listing.messageId);
    if (!message) return;

    const isExpired = listing.expiresAt && Date.now() > listing.expiresAt;
    const isSold = listing.status === 'SOLD';
    const isCancelled = listing.status === 'CANCELLED';
    
    const statusText = isSold ? '🔴 Sold' : isCancelled ? '⚫ Cancelled' : isExpired ? '⏰ Expired' : '🟢 Active';
    const color = isSold ? 0xFF0000 : isCancelled ? 0x808080 : isExpired ? 0xFF9900 : 0x00FF00;
    
    const tokenTicker = listing.priceTokenIdentifier.split('-')[0];
    
    // Fetch token price for USD valuation
    let priceUsd = 0;
    try {
      const priceResponse = await fetch(`https://api.multiversx.com/tokens/${listing.priceTokenIdentifier}?denominated=true`);
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        const tokenPriceUsd = priceData.price || 0;
        priceUsd = new BigNumber(listing.priceAmount).multipliedBy(tokenPriceUsd).toNumber();
      }
    } catch (error) {
      console.error('[NFT-MARKETPLACE] Error fetching token price for listing:', error.message);
    }
    
    // Format price with USD value
    const priceDisplay = priceUsd > 0 
      ? `${listing.priceAmount} ${tokenTicker} (≈ $${priceUsd.toFixed(2)})`
      : `${listing.priceAmount} ${tokenTicker}`;

    const amount = listing.amount || 1;
    const tokenType = amount > 1 ? 'SFT' : 'NFT';
    const amountText = amount > 1 ? ` (${amount}x)` : '';
    const nftDisplayName = listing.nftName || `${listing.collection}#${listing.nonce}`;

    const listingEmbed = new EmbedBuilder()
      .setTitle(listing.title)
      .setDescription(`${listing.description || ''}\n\n**${tokenType}:** ${nftDisplayName}${amountText}\n**Collection:** ${listing.collection}\n**Nonce:** ${listing.nonce}`)
      .addFields([
        { name: '💰 Price', value: priceDisplay, inline: true },
        { name: '📋 Listing Type', value: listing.listingType === 'fixed_price' ? 'Fixed Price' : 'Accept Offers', inline: true },
        { name: '👤 Seller', value: `<@${listing.sellerId}>`, inline: true },
        { name: '📊 Status', value: statusText, inline: true }
      ])
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

    if (listing.expiresAt && !isExpired && !isSold && !isCancelled) {
      listingEmbed.addFields([
        { name: '⏰ Expires', value: `<t:${Math.floor(listing.expiresAt / 1000)}:R>`, inline: true }
      ]);
    }

    // Get offer count if accept_offers
    if (listing.listingType === 'accept_offers' && !isSold && !isCancelled) {
      const offers = await virtualAccountsNFT.getOffersForListing(guildId, listingId);
      const pendingOffers = offers.filter(o => o.status === 'PENDING');
      if (pendingOffers.length > 0) {
        listingEmbed.addFields([
          { name: '💼 Pending Offers', value: `${pendingOffers.length}`, inline: true }
        ]);
      }
    }

    // Fetch NFT details from API for better image URL resolution
    let nftImageUrl = listing.nftImageUrl;
    if (listing.identifier) {
      try {
        const nftApiUrl = `https://api.multiversx.com/nfts/${listing.identifier}`;
        const nftResponse = await fetch(nftApiUrl);
        if (nftResponse.ok) {
          const nftDetails = await nftResponse.json();
          nftImageUrl = await extractNFTImageUrl(nftDetails, listing.nftImageUrl);
        }
      } catch (error) {
        console.error(`[NFT-MARKETPLACE] Error fetching NFT details for listing update: ${error.message}`);
        // Use stored image URL as fallback
        nftImageUrl = listing.nftImageUrl;
      }
    }
    
    if (nftImageUrl) {
      listingEmbed.setThumbnail(nftImageUrl);
    }

    // Create buttons based on status
    const components = [];
    if (!isSold && !isCancelled && !isExpired) {
      const buttons = [];
      
      // Always show Buy button - for fixed_price it's "Buy Now", for accept_offers it's "Buy at Listed Price"
      const buyButton = new ButtonBuilder()
        .setCustomId(`nft-buy:${listingId}`)
        .setLabel(listing.listingType === 'fixed_price' ? 'Buy Now' : 'Buy at Listed Price')
        .setStyle(ButtonStyle.Success);
      buttons.push(buyButton);
      
      // Only show offer button for accept_offers listings
      if (listing.listingType === 'accept_offers') {
        const offerButton = new ButtonBuilder()
          .setCustomId(`nft-offer:${listingId}`)
          .setLabel('Make Offer')
          .setStyle(ButtonStyle.Primary);
        buttons.push(offerButton);
      }
      
      const cancelButton = new ButtonBuilder()
        .setCustomId(`nft-listing-cancel:${listingId}`)
        .setLabel('Cancel Listing')
        .setStyle(ButtonStyle.Danger);
      buttons.push(cancelButton);
      
      if (buttons.length > 0) {
        const buttonRow = new ActionRowBuilder().addComponents(buttons);
        components.push(buttonRow);
      }
    }

    await message.edit({ embeds: [listingEmbed], components });
  } catch (error) {
    console.error(`[NFT-MARKETPLACE] Error updating embed for listing ${listingId}:`, error.message);
  }
}

async function updateAuctionEmbed(guildId, auctionId) {
  const auction = await dbAuctions.getAuction(guildId, auctionId);
  if (!auction) return;

  try {
    const channel = await client.channels.fetch(auction.channelId);
    if (!channel) return;

    const message = await channel.messages.fetch(auction.messageId);
    if (!message) return;

    const isExpired = isAuctionExpired(auction);
    const timeRemaining = isExpired ? 'Ended' : `<t:${Math.floor(auction.endTime / 1000)}:R>`;
    const statusText = isExpired ? '🔴 Finished' : '🟢 Active';
    const color = isExpired ? 0xFF0000 : 0x00FF00;

    // Resolve token identifier for price lookup
    const tokenIdentifier = await resolveTokenIdentifier(guildId, auction.tokenTicker);
    
    // Fetch token price for USD valuation
    let tokenPriceUsd = 0;
    if (tokenIdentifier) {
      try {
        const priceResponse = await fetch(`https://api.multiversx.com/tokens/${tokenIdentifier}?denominated=true`);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          tokenPriceUsd = priceData.price || 0;
        }
      } catch (error) {
        console.error('[AUCTIONS] Error fetching token price for auction:', error.message);
      }
    }
    
    // Calculate USD values
    const startingAmountUsd = tokenPriceUsd > 0 
      ? new BigNumber(auction.startingAmount).multipliedBy(tokenPriceUsd).toFixed(2)
      : null;
    const currentBidUsd = tokenPriceUsd > 0 
      ? new BigNumber(auction.currentBid).multipliedBy(tokenPriceUsd).toFixed(2)
      : null;
    const minBidIncreaseUsd = tokenPriceUsd > 0 
      ? new BigNumber(auction.minBidIncrease).multipliedBy(tokenPriceUsd).toFixed(2)
      : null;
    
    // Format display values
    const startingAmountDisplay = startingAmountUsd 
      ? `${auction.startingAmount} ${auction.tokenTicker} (≈ $${startingAmountUsd})`
      : `${auction.startingAmount} ${auction.tokenTicker}`;
    
    const currentBidText = auction.highestBidderTag 
      ? (currentBidUsd 
          ? `${auction.currentBid} ${auction.tokenTicker} (≈ $${currentBidUsd}) by ${auction.highestBidderTag}`
          : `${auction.currentBid} ${auction.tokenTicker} by ${auction.highestBidderTag}`)
      : (currentBidUsd
          ? `${auction.currentBid} ${auction.tokenTicker} (≈ $${currentBidUsd}) (No bids yet)`
          : `${auction.currentBid} ${auction.tokenTicker} (No bids yet)`);
    
    const minBidIncreaseDisplay = minBidIncreaseUsd
      ? `${auction.minBidIncrease} ${auction.tokenTicker} (≈ $${minBidIncreaseUsd})`
      : `${auction.minBidIncrease} ${auction.tokenTicker}`;

    const amount = auction.amount || 1;
    // Use token_type from database for reliable detection (bulletproof)
    const tokenType = auction.tokenType || (amount > 1 ? 'SFT' : 'NFT');
    const amountText = amount > 1 ? ` (${amount}x)` : '';
    
    const auctionEmbed = new EmbedBuilder()
        .setTitle(auction.title)
        .setDescription(`${auction.description}\n\n**${tokenType}:** ${auction.nftName}${amountText}\n**Collection:** ${auction.collection}\n**Nonce:** ${auction.nftNonce}`)
      .addFields([
        { name: 'Starting Amount', value: startingAmountDisplay, inline: true },
        { name: 'Current Bid', value: currentBidText, inline: true },
        { name: 'Minimum Increase', value: minBidIncreaseDisplay, inline: true },
        { name: 'Token', value: auction.tokenTicker, inline: true },
        { name: 'Time Remaining', value: timeRemaining, inline: true },
        { name: 'Status', value: statusText, inline: true }
      ])
      .setColor(color)
      .setTimestamp(new Date(auction.endTime))
      .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

    // Fetch NFT details from API for better image URL resolution
    let nftImageUrl = auction.nftImageUrl;
    if (auction.nftIdentifier) {
      try {
        const nftApiUrl = `https://api.multiversx.com/nfts/${auction.nftIdentifier}`;
        const nftResponse = await fetch(nftApiUrl);
        if (nftResponse.ok) {
          const nftDetails = await nftResponse.json();
          nftImageUrl = await extractNFTImageUrl(nftDetails, auction.nftImageUrl);
        }
      } catch (error) {
        console.error(`[AUCTIONS] Error fetching NFT details for auction update: ${error.message}`);
        // Use stored image URL as fallback
        nftImageUrl = auction.nftImageUrl;
      }
    }
    
    if (nftImageUrl) {
      auctionEmbed.setThumbnail(nftImageUrl);
    } else {
      auctionEmbed.setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif');
    }

    // Only show buttons if auction is active
    const components = [];
    if (!isExpired) {
      const bidButton = new ButtonBuilder()
        .setCustomId(`bid:${auctionId}`)
        .setLabel('Place Bid')
        .setStyle(ButtonStyle.Primary);

      const quickBidButton = new ButtonBuilder()
        .setCustomId(`quick-bid:${auctionId}`)
        .setLabel('Quick Bid')
        .setStyle(ButtonStyle.Success);

      const buttonRow = new ActionRowBuilder()
        .addComponents(bidButton, quickBidButton);
      
      components.push(buttonRow);
    }

    await message.edit({ embeds: [auctionEmbed], components });
  } catch (error) {
    console.error(`[AUCTIONS] Error updating embed for auction ${auctionId}:`, error.message);
  }
}

// Process auction closure
async function processAuctionClosure(guildId, auctionId) {
  const auction = await dbAuctions.getAuction(guildId, auctionId);
  if (!auction) return;

  // Mark as finished
  await dbAuctions.updateAuction(guildId, auctionId, { status: 'FINISHED' });

  // Update embed
  await updateAuctionEmbed(guildId, auctionId);

  try {
    const channel = await client.channels.fetch(auction.channelId);
    if (!channel) return;

    const thread = await channel.threads.cache.get(auction.threadId) || await channel.threads.fetch(auction.threadId);
    
    if (!auction.highestBidderId) {
      // No bids
      if (thread) {
        await thread.send('⏰ **Auction ended with no bids.**');
      }
      return;
    }

    // Resolve token identifier (use stored identifier if available, otherwise resolve from ticker)
    const tokenIdentifier = auction.tokenIdentifier || await resolveTokenIdentifier(guildId, auction.tokenTicker);
    if (!tokenIdentifier) {
      if (thread) {
        await thread.send(`❌ **Error:** Could not resolve token identifier for auction. Please contact an administrator.`);
      }
      return;
    }

    // Get user's balance before transfer (using identifier)
    const balanceBefore = await virtualAccounts.getUserBalance(guildId, auction.highestBidderId, tokenIdentifier);

    // Deduct bid amount from virtual account (using identifier)
    const deductionResult = await virtualAccounts.deductFundsFromAccount(
      guildId,
      auction.highestBidderId,
      tokenIdentifier,
      auction.currentBid,
      `Auction payment: ${auction.nftName}`,
      'auction'
    );

    if (!deductionResult.success) {
      if (thread) {
        await thread.send(`❌ **Failed to process payment.** Insufficient balance. Winner: <@${auction.highestBidderId}>`);
      }
      return;
    }

    // Handle different auction sources
    const isVirtualAccountAuction = auction.source === 'virtual_account';
    let transferResult = { success: false, errorMessage: null, txHash: null };

    if (isVirtualAccountAuction) {
      // Virtual Account Auction: Transfer NFT between virtual accounts
      if (!auction.sellerId) {
        console.error(`[AUCTIONS] Virtual account auction ${auctionId} missing sellerId`);
        if (thread) {
          await thread.send(`❌ **Error:** Auction data is missing seller information. Please contact an administrator.`);
        }
        // Refund the deduction
        await virtualAccounts.addFundsToAccount(
          guildId,
          auction.highestBidderId,
          tokenIdentifier,
          auction.currentBid,
          null,
          'auction_refund',
          null
        );
        return;
      }

      try {
        const auctionAmount = auction.amount || 1;
        // Transfer NFT/SFT from seller's VA to winner's VA
        await virtualAccountsNFT.transferNFTBetweenUsers(
          guildId,
          auction.sellerId,
          auction.highestBidderId,
          auction.collection,
          auction.nftNonce,
          {
            tokenIdentifier: tokenIdentifier,
            amount: auction.currentBid
          },
          auctionAmount
        );
        
        // Credit tokens to seller's virtual account
        await virtualAccounts.addFundsToAccount(
          guildId,
          auction.sellerId,
          tokenIdentifier,
          auction.currentBid,
          `Auction sale: ${auction.nftName}`,
          'auction_sale',
          null
        );

        transferResult = { success: true, txHash: null };
        const tokenType = auctionAmount > 1 ? 'SFT' : 'NFT';
        console.log(`[AUCTIONS] Successfully transferred ${tokenType} from seller ${auction.sellerId} to winner ${auction.highestBidderId} via virtual accounts`);
      } catch (vaError) {
        console.error(`[AUCTIONS] Error transferring NFT/SFT between virtual accounts:`, vaError);
        transferResult = { success: false, errorMessage: vaError.message, txHash: null };
      }
    } else {
      // Project Wallet Auction: Transfer NFT/SFT via blockchain
      const userWallets = await getUserWallets(guildId);
      const winnerWallet = userWallets[auction.highestBidderId];

      console.log(`[AUCTIONS] Winner ID: ${auction.highestBidderId}`);
      console.log(`[AUCTIONS] Available wallets:`, Object.keys(userWallets));
      console.log(`[AUCTIONS] Winner wallet:`, winnerWallet);

      if (!winnerWallet) {
        if (thread) {
          await thread.send(`❌ **Auction ended but winner <@${auction.highestBidderId}> has no registered wallet.** Please use /set-wallet to register your wallet.`);
        }
        // Refund the deduction
        await virtualAccounts.addFundsToAccount(
          guildId,
          auction.highestBidderId,
          tokenIdentifier,
          auction.currentBid,
          null,
          'auction_refund',
          null
        );
        return;
      }

      const auctionAmount = auction.amount || 1;
      // Transfer NFT/SFT via blockchain (auto-detects SFT vs NFT based on amount)
      transferResult = await transferNFTFromCommunityFund(
        winnerWallet,
        auction.collection,
        auction.nftNonce,
        auction.projectName,
        guildId,
        auctionAmount
      );

      // For project wallet auctions, track earnings for house balance
      if (transferResult.success) {
        const storedDecimals = await getStoredTokenDecimals(guildId, tokenIdentifier);
        if (storedDecimals !== null) {
          const amountWei = toBlockchainAmount(auction.currentBid, storedDecimals);
          await trackAuctionEarnings(guildId, auctionId, amountWei, storedDecimals, tokenIdentifier);
        }
      }
    }

    const balanceAfter = await virtualAccounts.getUserBalance(guildId, auction.highestBidderId, tokenIdentifier);

    // Get message to reply to
    const message = await channel.messages.fetch(auction.messageId);
    if (!message) return;

    if (transferResult.success) {
      const explorerUrl = transferResult.txHash
        ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
        : null;
      const txHashFieldValue = transferResult.txHash
        ? `[${transferResult.txHash}](${explorerUrl})`
        : isVirtualAccountAuction ? 'Virtual Account Transfer' : 'Not available';

      const auctionAmount = auction.amount || 1;
      // Use token_type from database for reliable detection (bulletproof)
      const tokenType = auction.tokenType || (auctionAmount > 1 ? 'SFT' : 'NFT');
      const amountText = auctionAmount > 1 ? ` (${auctionAmount}x)` : '';
      
      const successEmbed = new EmbedBuilder()
        .setTitle(`🎉 Auction Complete - ${tokenType} Transferred!`)
        .setDescription(`Congratulations <@${auction.highestBidderId}>! You won the auction for **${auction.nftName}${amountText}**!`)
        .addFields([
          { name: 'Winner', value: `<@${auction.highestBidderId}>`, inline: true },
          { name: 'Final Bid', value: `${auction.currentBid} ${auction.tokenTicker}`, inline: true },
          { name: 'Balance Before', value: `${balanceBefore} ${auction.tokenTicker}`, inline: true },
          { name: 'Balance After', value: `${balanceAfter} ${auction.tokenTicker}`, inline: true }
        ])
        .setColor(0x00FF00)
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      if (transferResult.txHash) {
        successEmbed.addFields([{ name: 'Transaction Hash', value: txHashFieldValue, inline: false }]);
      }

      if (isVirtualAccountAuction && auction.sellerId) {
        successEmbed.addFields([{ name: 'Seller', value: `<@${auction.sellerId}>`, inline: true }]);
      }

      if (auction.nftImageUrl) {
        successEmbed.setThumbnail(auction.nftImageUrl);
      }

      await message.reply({ embeds: [successEmbed] });

      // Send DM notification to highest bidder
      try {
        const winnerUser = await client.users.fetch(auction.highestBidderId);
        if (winnerUser) {
          // Get project logo URL
          const projectName = isVirtualAccountAuction ? 'Community Fund' : auction.projectName;
          const projectLogoUrl = await getProjectLogoUrl(guildId, projectName);
          
          const dmEmbed = new EmbedBuilder()
            .setTitle(`🎉 You Won the Auction!`)
            .setDescription(`Congratulations! You won the auction for **${auction.nftName}${amountText}**!`)
            .addFields([
              { name: 'Auction Title', value: auction.title || auction.nftName, inline: false },
              { name: 'NFT/SFT Name', value: auction.nftName, inline: true },
              { name: 'Collection', value: auction.collection, inline: true },
              { name: 'Nonce', value: String(auction.nftNonce), inline: true },
              { name: 'Final Bid', value: `${auction.currentBid} ${auction.tokenTicker}`, inline: true },
              { name: 'Balance Before', value: `${balanceBefore} ${auction.tokenTicker}`, inline: true },
              { name: 'Balance After', value: `${balanceAfter} ${auction.tokenTicker}`, inline: true }
            ])
            .setColor(0x00FF00)
            .setThumbnail(projectLogoUrl)
            .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
            .setTimestamp();

          if (transferResult.txHash) {
            const explorerUrl = `https://explorer.multiversx.com/transactions/${transferResult.txHash}`;
            dmEmbed.addFields([{ name: 'Transaction Hash', value: `[${transferResult.txHash}](${explorerUrl})`, inline: false }]);
          } else if (isVirtualAccountAuction) {
            dmEmbed.addFields([{ name: 'Transfer Type', value: 'Virtual Account Transfer', inline: false }]);
          }

          if (isVirtualAccountAuction && auction.sellerId) {
            dmEmbed.addFields([{ name: 'Seller', value: `<@${auction.sellerId}>`, inline: true }]);
          }

          if (auction.nftImageUrl) {
            dmEmbed.setImage(auction.nftImageUrl);
          }

          await winnerUser.send({ embeds: [dmEmbed] });
          console.log(`[AUCTIONS] Sent DM notification to winner ${winnerUser.tag} (${auction.highestBidderId}) for auction ${auctionId}`);
        }
      } catch (dmError) {
        // User might have DMs disabled or blocked the bot
        console.error(`[AUCTIONS] Failed to send DM to winner ${auction.highestBidderId}:`, dmError.message);
      }

      if (thread) {
        const tokenType = auctionAmount > 1 ? 'SFT' : 'NFT';
        await thread.send(`✅ **${tokenType} successfully transferred to winner!** Check the main channel for details.`);
      }
    } else {
      // Refund the deduction (using identifier)
      await virtualAccounts.addFundsToAccount(
        guildId,
        auction.highestBidderId,
        tokenIdentifier,
        auction.currentBid,
        null,
        'auction_refund',
        null
      );

      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Auction Complete - Transfer Failed')
        .setDescription(`Auction ended but NFT transfer failed. Payment has been refunded.`)
        .addFields([
          { name: 'Winner', value: `<@${auction.highestBidderId}>`, inline: true },
          { name: 'Final Bid', value: `${auction.currentBid} ${auction.tokenTicker}`, inline: true },
          { name: 'Error', value: transferResult.errorMessage || 'Unknown error', inline: false },
          { name: 'Status', value: 'Refunded', inline: true }
        ])
        .setColor(0xFF0000)
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

      await message.reply({ embeds: [errorEmbed] });

      if (thread) {
        await thread.send(`❌ **NFT transfer failed.** Payment has been refunded to <@${auction.highestBidderId}>.`);
      }

      await dbAuctions.updateAuction(guildId, auctionId, { status: 'FAILED' });
    }
  } catch (error) {
    console.error(`[AUCTIONS] Error processing closure for auction ${auctionId}:`, error.message);
  }
}



// Track house spending (when house pays prizes)
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
async function trackHouseSpending(guildId, amountWei, tokenIdentifier, reason = 'manual_payout', source = 'betting') {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[HOUSE] Invalid token identifier format: ${tokenIdentifier}`);
      return { success: false, error: `Invalid token identifier format: ${tokenIdentifier}` };
    }
    
    // Get token metadata for ticker display
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    const tokenTicker = tokenMetadata[tokenIdentifier]?.ticker || tokenIdentifier.split('-')[0];
    
    // Get current house balance from database (using identifier)
    const currentBalance = await getHouseBalance(guildId, tokenIdentifier);
    if (!currentBalance) {
      // Initialize if doesn't exist
      await dbServerData.updateHouseBalance(guildId, tokenIdentifier, {
        bettingEarnings: {},
        bettingSpending: {},
        bettingPNL: {},
        auctionEarnings: {},
        auctionSpending: {},
        auctionPNL: {},
        lotteryEarnings: {},
        lotterySpending: {},
        lotteryPNL: {}
      });
    }
    
    const houseBalance = currentBalance || {
      bettingEarnings: {},
      bettingSpending: {},
      bettingPNL: {},
      auctionEarnings: {},
      auctionSpending: {},
      auctionPNL: {},
      lotteryEarnings: {},
      lotterySpending: {},
      lotteryPNL: {}
    };
    
    // Track spending by source (using identifier as key, not ticker)
    if (source === 'betting') {
      // Track betting spending
      if (!houseBalance.bettingSpending[tokenIdentifier]) {
        houseBalance.bettingSpending[tokenIdentifier] = '0';
      }
      const currentBettingSpending = new BigNumber(houseBalance.bettingSpending[tokenIdentifier] || '0');
      const newBettingSpending = currentBettingSpending.plus(new BigNumber(amountWei));
      houseBalance.bettingSpending[tokenIdentifier] = newBettingSpending.toString();
      
      // Recalculate betting PNL (using identifier as key)
      const bettingEarnings = new BigNumber(houseBalance.bettingEarnings[tokenIdentifier] || '0');
      houseBalance.bettingPNL[tokenIdentifier] = bettingEarnings.minus(newBettingSpending).toString();
    } else if (source === 'auction') {
      // Track auction spending
      if (!houseBalance.auctionSpending[tokenIdentifier]) {
        houseBalance.auctionSpending[tokenIdentifier] = '0';
      }
      const currentAuctionSpending = new BigNumber(houseBalance.auctionSpending[tokenIdentifier] || '0');
      const newAuctionSpending = currentAuctionSpending.plus(new BigNumber(amountWei));
      houseBalance.auctionSpending[tokenIdentifier] = newAuctionSpending.toString();
      
      // Recalculate auction PNL (using identifier as key)
      const auctionEarnings = new BigNumber(houseBalance.auctionEarnings[tokenIdentifier] || '0');
      houseBalance.auctionPNL[tokenIdentifier] = auctionEarnings.minus(newAuctionSpending).toString();
    } else if (source === 'lottery') {
      // Track lottery spending
      if (!houseBalance.lotterySpending[tokenIdentifier]) {
        houseBalance.lotterySpending[tokenIdentifier] = '0';
      }
      const currentLotterySpending = new BigNumber(houseBalance.lotterySpending[tokenIdentifier] || '0');
      const newLotterySpending = currentLotterySpending.plus(new BigNumber(amountWei));
      houseBalance.lotterySpending[tokenIdentifier] = newLotterySpending.toString();
      
      // Recalculate lottery PNL (using identifier as key)
      const lotteryEarnings = new BigNumber(houseBalance.lotteryEarnings[tokenIdentifier] || '0');
      houseBalance.lotteryPNL[tokenIdentifier] = lotteryEarnings.minus(newLotterySpending).toString();
    }
    
    // Save to database (using identifier)
    await dbServerData.updateHouseBalance(guildId, tokenIdentifier, houseBalance);
    
    // Log spending
    const storedDecimals = await getStoredTokenDecimals(guildId, tokenIdentifier);
    const displayDecimals = storedDecimals !== null ? storedDecimals : 8;
    const humanAmount = new BigNumber(amountWei).dividedBy(new BigNumber(10).pow(displayDecimals)).toString();
    const sourceName = source === 'auction' ? 'Auction' : source === 'lottery' ? 'Lottery' : 'Betting';
    console.log(`[HOUSE] Tracked ${sourceName} spending: -${humanAmount} ${tokenTicker} (Reason: ${reason})`);
    
    // Get current balance for return value (using identifier as key)
    let currentBalanceValue;
    let totalSpent;
    if (source === 'auction') {
      currentBalanceValue = houseBalance.auctionPNL[tokenIdentifier];
      totalSpent = houseBalance.auctionSpending[tokenIdentifier] || '0';
    } else if (source === 'lottery') {
      currentBalanceValue = houseBalance.lotteryPNL[tokenIdentifier];
      totalSpent = houseBalance.lotterySpending[tokenIdentifier] || '0';
    } else {
      currentBalanceValue = houseBalance.bettingPNL[tokenIdentifier];
      totalSpent = houseBalance.bettingSpending[tokenIdentifier] || '0';
    }
    
    return {
      success: true,
      newBalance: currentBalanceValue || '0',
      totalSpent: totalSpent
    };
    
  } catch (error) {
    console.error(`[HOUSE] Error tracking house spending:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Track house earnings when no winners (betting)
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
async function trackHouseEarnings(guildId, matchId, totalPotWei, tokenDecimals, tokenIdentifier) {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[HOUSE] Invalid token identifier format: ${tokenIdentifier}`);
      return;
    }
    
    // Get token metadata for ticker display
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    const tokenTicker = tokenMetadata[tokenIdentifier]?.ticker || tokenIdentifier.split('-')[0];
    
    // Get current house balance from database (using identifier)
    const currentBalance = await getHouseBalance(guildId, tokenIdentifier);
    const houseBalance = currentBalance || {
      bettingEarnings: {},
      bettingSpending: {},
      bettingPNL: {},
      auctionEarnings: {},
      auctionSpending: {},
      auctionPNL: {}
    };
    
    // Track betting earnings (using identifier as key, not ticker)
    if (!houseBalance.bettingEarnings[tokenIdentifier]) {
      houseBalance.bettingEarnings[tokenIdentifier] = '0';
    }
    const currentBettingEarnings = new BigNumber(houseBalance.bettingEarnings[tokenIdentifier] || '0');
    const newBettingEarnings = currentBettingEarnings.plus(new BigNumber(totalPotWei));
    houseBalance.bettingEarnings[tokenIdentifier] = newBettingEarnings.toString();
    
    // Recalculate betting PNL (using identifier as key)
    const bettingSpending = new BigNumber(houseBalance.bettingSpending[tokenIdentifier] || '0');
    houseBalance.bettingPNL[tokenIdentifier] = newBettingEarnings.minus(bettingSpending).toString();
    
    // Save to database (using identifier)
    await dbServerData.updateHouseBalance(guildId, tokenIdentifier, houseBalance);
    
    // Log house earnings
    const storedDecimals = await getStoredTokenDecimals(guildId, tokenIdentifier);
    const displayDecimals = storedDecimals !== null ? storedDecimals : tokenDecimals;
    const humanAmount = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(displayDecimals)).toString();
    console.log(`[HOUSE] Tracked betting earnings from match ${matchId}: +${humanAmount} ${tokenTicker} (Betting house balance)`);
    
  } catch (error) {
    console.error(`[HOUSE] Error tracking house earnings for match ${matchId}:`, error.message);
  }
}

// Track auction earnings (when auction ends successfully)
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
async function trackAuctionEarnings(guildId, auctionId, amountWei, tokenDecimals, tokenIdentifier) {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[HOUSE] Invalid token identifier format: ${tokenIdentifier}`);
      return;
    }
    
    // Get token metadata for ticker display
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    const tokenTicker = tokenMetadata[tokenIdentifier]?.ticker || tokenIdentifier.split('-')[0];
    
    // Get current house balance from database (using identifier)
    const currentBalance = await getHouseBalance(guildId, tokenIdentifier);
    const houseBalance = currentBalance || {
      bettingEarnings: {},
      bettingSpending: {},
      bettingPNL: {},
      auctionEarnings: {},
      auctionSpending: {},
      auctionPNL: {}
    };
    
    // Track auction earnings (using identifier as key, not ticker)
    if (!houseBalance.auctionEarnings[tokenIdentifier]) {
      houseBalance.auctionEarnings[tokenIdentifier] = '0';
    }
    const currentAuctionEarnings = new BigNumber(houseBalance.auctionEarnings[tokenIdentifier] || '0');
    const newAuctionEarnings = currentAuctionEarnings.plus(new BigNumber(amountWei));
    houseBalance.auctionEarnings[tokenIdentifier] = newAuctionEarnings.toString();
    
    // Recalculate auction PNL (using identifier as key)
    const auctionSpending = new BigNumber(houseBalance.auctionSpending[tokenIdentifier] || '0');
    houseBalance.auctionPNL[tokenIdentifier] = newAuctionEarnings.minus(auctionSpending).toString();
    
    // Save to database (using identifier)
    await dbServerData.updateHouseBalance(guildId, tokenIdentifier, houseBalance);
    
    // Log auction earnings
    const humanAmount = new BigNumber(amountWei).dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
    console.log(`[HOUSE] Tracked auction earnings from auction ${auctionId}: +${humanAmount} ${tokenTicker} (Auction house balance)`);
    
  } catch (error) {
    console.error(`[HOUSE] Error tracking auction earnings for auction ${auctionId}:`, error.message);
  }
}

// Track house top-up (manual funding from Virtual Account)
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
// houseType: 'betting', 'auction', or 'lottery'
async function trackHouseTopup(guildId, amountWei, tokenIdentifier, houseType, userId, userTag, memo = 'Manual top-up') {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[HOUSE-TOPUP] Invalid token identifier format: ${tokenIdentifier}`);
      return { success: false, error: 'Invalid token identifier format' };
    }

    // Validate house type
    const validHouseTypes = ['betting', 'auction', 'lottery'];
    if (!validHouseTypes.includes(houseType)) {
      return { success: false, error: `Invalid house type: ${houseType}. Must be one of: ${validHouseTypes.join(', ')}` };
    }

    // Get token metadata for ticker display
    const tokenMetadata = await dbServerData.getTokenMetadata(guildId);
    const tokenTicker = tokenMetadata[tokenIdentifier]?.ticker || tokenIdentifier.split('-')[0];

    // Get current house balance
    const currentBalance = await getHouseBalance(guildId, tokenIdentifier);
    const houseBalance = currentBalance || {
      bettingEarnings: {},
      bettingSpending: {},
      bettingPNL: {},
      auctionEarnings: {},
      auctionSpending: {},
      auctionPNL: {},
      lotteryEarnings: {},
      lotterySpending: {},
      lotteryPNL: {}
    };

    const amountBN = new BigNumber(amountWei);

    // Update earnings based on house type
    if (houseType === 'betting') {
      if (!houseBalance.bettingEarnings[tokenIdentifier]) {
        houseBalance.bettingEarnings[tokenIdentifier] = '0';
      }
      const currentBettingEarnings = new BigNumber(houseBalance.bettingEarnings[tokenIdentifier] || '0');
      houseBalance.bettingEarnings[tokenIdentifier] = currentBettingEarnings.plus(amountBN).toString();
      
      // Recalculate betting PNL
      const bettingSpending = new BigNumber(houseBalance.bettingSpending[tokenIdentifier] || '0');
      houseBalance.bettingPNL[tokenIdentifier] = new BigNumber(houseBalance.bettingEarnings[tokenIdentifier]).minus(bettingSpending).toString();
    } else if (houseType === 'auction') {
      if (!houseBalance.auctionEarnings[tokenIdentifier]) {
        houseBalance.auctionEarnings[tokenIdentifier] = '0';
      }
      const currentAuctionEarnings = new BigNumber(houseBalance.auctionEarnings[tokenIdentifier] || '0');
      houseBalance.auctionEarnings[tokenIdentifier] = currentAuctionEarnings.plus(amountBN).toString();
      
      // Recalculate auction PNL
      const auctionSpending = new BigNumber(houseBalance.auctionSpending[tokenIdentifier] || '0');
      houseBalance.auctionPNL[tokenIdentifier] = new BigNumber(houseBalance.auctionEarnings[tokenIdentifier]).minus(auctionSpending).toString();
    } else if (houseType === 'lottery') {
      if (!houseBalance.lotteryEarnings[tokenIdentifier]) {
        houseBalance.lotteryEarnings[tokenIdentifier] = '0';
      }
      const currentLotteryEarnings = new BigNumber(houseBalance.lotteryEarnings[tokenIdentifier] || '0');
      houseBalance.lotteryEarnings[tokenIdentifier] = currentLotteryEarnings.plus(amountBN).toString();
      
      // Recalculate lottery PNL
      const lotterySpending = new BigNumber(houseBalance.lotterySpending[tokenIdentifier] || '0');
      houseBalance.lotteryPNL[tokenIdentifier] = new BigNumber(houseBalance.lotteryEarnings[tokenIdentifier]).minus(lotterySpending).toString();
    }

    // Save to database
    await dbServerData.updateHouseBalance(guildId, tokenIdentifier, houseBalance);

    // Log top-up
    const tokenDecimals = tokenMetadata[tokenIdentifier]?.decimals || 8;
    const humanAmount = amountBN.dividedBy(new BigNumber(10).pow(tokenDecimals)).toString();
    const houseTypeName = houseType === 'betting' ? 'Betting' : houseType === 'auction' ? 'Auction' : 'Lottery';
    console.log(`[HOUSE-TOPUP] Tracked top-up: +${humanAmount} ${tokenTicker} to ${houseTypeName} house by ${userTag} (${userId})`);

    return {
      success: true,
      newBalances: {
        betting: houseBalance.bettingPNL[tokenIdentifier] || '0',
        auction: houseBalance.auctionPNL[tokenIdentifier] || '0',
        lottery: houseBalance.lotteryPNL[tokenIdentifier] || '0'
      }
    };

  } catch (error) {
    console.error('[HOUSE-TOPUP] Error tracking house top-up:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Track bet amount when user places a bet
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
// tokenTicker: Token ticker for display/logging (e.g., "USDC")
async function trackBetAmount(guildId, userId, betAmountWei, tokenIdentifier, tokenTicker) {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[FOOTBALL] Invalid token identifier format: ${tokenIdentifier}`);
      return;
    }
    
    // Get current user stats
    const currentStats = await dbLeaderboard.getUserStats(guildId, userId);
    
    const currentTotalBets = new BigNumber(currentStats?.totalBetsWei || '0');
    const newTotalBets = currentTotalBets.plus(new BigNumber(betAmountWei));
    
    // Use identifier as key for tokenBets (for consistency with virtual accounts)
    const tokenBets = currentStats?.tokenBets || {};
    if (!tokenBets[tokenIdentifier]) {
      tokenBets[tokenIdentifier] = '0';
    }
    const currentTokenBets = new BigNumber(tokenBets[tokenIdentifier] || '0');
    const newTokenBets = currentTokenBets.plus(new BigNumber(betAmountWei));
    tokenBets[tokenIdentifier] = newTokenBets.toString();
    
    // Calculate PNL for this token (earnings - bets) - using identifier as key
    const tokenEarnings = currentStats?.tokenEarnings || {};
    const totalTokenEarnings = new BigNumber(tokenEarnings[tokenIdentifier] || '0');
    const tokenPNL = currentStats?.tokenPNL || {};
    tokenPNL[tokenIdentifier] = totalTokenEarnings.minus(newTokenBets).toString();
    
    // Calculate total PNL
    const totalEarnings = new BigNumber(currentStats?.totalEarningsWei || '0');
    const pnlWei = totalEarnings.minus(newTotalBets).toString();
    
    // Update leaderboard entry
    await dbLeaderboard.updateLeaderboardEntry(guildId, userId, {
      totalBetsWei: newTotalBets.toString(),
      tokenBets: tokenBets,
      tokenPNL: tokenPNL,
      pnlWei: pnlWei
    });
    
    console.log(`[FOOTBALL] Tracked bet for user ${userId}: ${betAmountWei} wei of ${tokenTicker} (${tokenIdentifier})`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error tracking bet amount for user ${userId}:`, error.message);
  }
}

// Update leaderboard when a user wins a match
// tokenIdentifier: Full token identifier (e.g., "USDC-c76f1f")
// tokenTicker: Token ticker for display/logging (e.g., "USDC")
async function updateLeaderboard(guildId, userId, prizeAmountWei, tokenDecimals, tokenIdentifier, tokenTicker) {
  try {
    // Validate token identifier format
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      console.error(`[FOOTBALL] Invalid token identifier format: ${tokenIdentifier}`);
      return;
    }
    
    // Get current user stats
    const currentStats = await dbLeaderboard.getUserStats(guildId, userId);
    
    const currentPoints = currentStats?.points || 0;
    const currentWins = currentStats?.wins || 0;
    const currentEarnings = new BigNumber(currentStats?.totalEarningsWei || '0');
    const newEarnings = currentEarnings.plus(new BigNumber(prizeAmountWei));
    
    // Use identifier as key for tokenEarnings (for consistency with virtual accounts)
    const tokenEarnings = currentStats?.tokenEarnings || {};
    if (!tokenEarnings[tokenIdentifier]) {
      tokenEarnings[tokenIdentifier] = '0';
    }
    const currentTokenEarnings = new BigNumber(tokenEarnings[tokenIdentifier] || '0');
    const newTokenEarnings = currentTokenEarnings.plus(new BigNumber(prizeAmountWei));
    tokenEarnings[tokenIdentifier] = newTokenEarnings.toString();
    
    // Calculate PNL for this token (using identifier as key)
    const tokenBets = currentStats?.tokenBets || {};
    const totalTokenBets = new BigNumber(tokenBets[tokenIdentifier] || '0');
    const tokenPNL = currentStats?.tokenPNL || {};
    tokenPNL[tokenIdentifier] = newTokenEarnings.minus(totalTokenBets).toString();
    
    // Calculate total PNL
    const totalBets = new BigNumber(currentStats?.totalBetsWei || '0');
    const pnlWei = newEarnings.minus(totalBets).toString();
    
    // Update leaderboard entry
    await dbLeaderboard.updateLeaderboardEntry(guildId, userId, {
      points: currentPoints + 3,
      wins: currentWins + 1,
      totalEarningsWei: newEarnings.toString(),
      tokenEarnings: tokenEarnings,
      tokenPNL: tokenPNL,
      pnlWei: pnlWei,
      lastWinISO: new Date().toISOString()
    });
    
    // Get stored decimals for accurate logging
    const storedDecimals = await getStoredTokenDecimals(guildId, tokenTicker);
    const displayDecimals = storedDecimals !== null ? storedDecimals : tokenDecimals;
    console.log(`[FOOTBALL] Updated leaderboard for user ${userId}: +3 points, +1 win, +${new BigNumber(prizeAmountWei).dividedBy(new BigNumber(10).pow(displayDecimals)).toString()} ${tokenTicker}`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error updating leaderboard for user ${userId}:`, error.message);
  }
}

// All football data is stored in Supabase database
// Use dbFootball module directly

// Get guild-specific stake amount for a match
// Token and stake are ONLY stored in match_guilds (per-guild)
function getMatchStakeForGuild(match, guildId) {
  // Per-guild stakes stored in requiredAmountWeiByGuild (REQUIRED)
  if (match.requiredAmountWeiByGuild && match.requiredAmountWeiByGuild[guildId]) {
    return match.requiredAmountWeiByGuild[guildId];
  }
  
  // Fallback for getMatchesByGuild (which sets match.requiredAmountWei directly)
  if (match.requiredAmountWei) {
    return match.requiredAmountWei;
  }
  
  // No stake found - this should not happen
  console.error(`[FOOTBALL] No stake found for match ${match.matchId} in guild ${guildId}`);
  return '0';
}

// Get guild-specific token configuration for a match
// Token and stake are ONLY stored in match_guilds (per-guild)
function getMatchTokenForGuild(match, guildId) {
  // Per-guild token stored in tokenByGuild (REQUIRED)
  if (match.tokenByGuild && match.tokenByGuild[guildId]) {
    return match.tokenByGuild[guildId];
  }
  
  // Fallback for getMatchesByGuild (which sets match.token directly)
  if (match.token) {
    return match.token;
  }
  
  // No token found - this should not happen
  console.error(`[FOOTBALL] No token found for match ${match.matchId} in guild ${guildId}`);
  return null;
}

// Calculate current pot size for a football match
async function calculateMatchPotSize(guildId, matchId) {
  try {
    const matchBets = await dbFootball.getBetsByMatch(guildId, matchId);
    const allBets = Object.values(matchBets || {});
    
    const totalPotWei = allBets.reduce((total, bet) => total + Number(bet.amountWei || 0), 0);
    
    // Get match data to access token decimals (guild-specific)
    const match = await dbFootball.getMatch(matchId);
    if (!match || !match.guildIds || !match.guildIds.includes(guildId)) return { totalPotWei: 0, totalPotHuman: '0' };
    
    const token = getMatchTokenForGuild(match, guildId);
    if (!token) return { totalPotWei: 0, totalPotHuman: '0' };
    
    const totalPotHuman = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
    
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
async function refreshAllMatchPotSizes() {
  try {
    console.log('[FOOTBALL] Refreshing all match pot sizes...');
    let totalMatches = 0;
    let updatedMatches = 0;
    
    // Get all scheduled matches from database
    const scheduledMatches = await dbFootball.getScheduledMatches();
    totalMatches = scheduledMatches.length;
    
    for (const match of scheduledMatches) {
      const matchId = match.matchId;
        
      if (match.status === 'SCHEDULED' || match.status === 'TIMED') {
        try {
          // Get full match data with guildIds
          const fullMatch = await dbFootball.getMatch(matchId);
          if (fullMatch && fullMatch.guildIds) {
            // Calculate pot size for each guild that has this match
            for (const guildId of fullMatch.guildIds) {
              const potSize = await calculateMatchPotSize(guildId, matchId);
              const token = getMatchTokenForGuild(fullMatch, guildId);
              if (token) {
                console.log(`[FOOTBALL] Match ${matchId} (${guildId}) pot size: ${potSize.totalPotHuman} ${token.ticker}`);
              }
            }
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
    
    // Get all unfinished matches from database (including PAUSED matches)
    const scheduledMatches = await dbFootball.getScheduledMatches();
    const pausedMatches = await dbFootball.getPausedMatches();
    const allUnfinishedMatches = [...scheduledMatches, ...pausedMatches];
    const unfinishedMatches = allUnfinishedMatches.filter(match => 
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
          
          // Update match data in database
          await dbFootball.updateMatch(match.matchId, {
            status: newStatus,
            ftScore: newScore && newScore.home !== undefined && newScore.away !== undefined 
              ? { home: newScore.home, away: newScore.away } 
              : undefined
          });
          
          // Get full match data with guild relationships
          const fullMatch = await dbFootball.getMatch(match.matchId);
          if (!fullMatch || !fullMatch.guildIds || fullMatch.guildIds.length === 0) {
            console.log(`[FOOTBALL] ⚠️ Match ${match.matchId} has no guild relationships, skipping embed/prize updates`);
            continue;
          }
          
          // Update embeds if there was a status change OR score change
          if (oldStatus !== newStatus || scoreChanged) {
            console.log(`[FOOTBALL] ${oldStatus !== newStatus ? 'Status' : 'Score'} changed, updating embeds for ${fullMatch.guildIds.length} guild(s)...`);
            for (const guildId of fullMatch.guildIds) {
              await updateMatchEmbed(guildId, match.matchId);
            }
          }
          
          // If match is finished, process prizes for all guilds
          if (newStatus === 'FINISHED') {
            console.log(`[FOOTBALL] 🏁 Match ${match.matchId} finished! Processing prizes for ${fullMatch.guildIds.length} guild(s)...`);
            for (const guildId of fullMatch.guildIds) {
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
      // Removed - using database
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
    const match = await dbFootball.getMatch(matchId);
    if (!match) {
      console.log(`[FOOTBALL] Match ${matchId} not found in database`);
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
    const potSize = await calculateMatchPotSize(guildId, matchId);
    
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
    
    // Get guild-specific token configuration
    const token = getMatchTokenForGuild(match, guildId);
    if (!token) {
      console.error(`[FOOTBALL] No token configuration found for match ${matchId} in guild ${guildId}`);
      return;
    }
    
    // Create fields array
    const stakeAmountWei = getMatchStakeForGuild(match, guildId);
    const stakeAmountHuman = new BigNumber(stakeAmountWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
    const fields = [
        { name: '🏆 Competition', value: match.compName, inline: true },
        { name: '🎮 Game ID', value: matchId, inline: true },
        { name: '💰 Stake', value: `${stakeAmountHuman} ${token.ticker}`, inline: true },
      { name: '🏆 Pot Size', value: `${potSize.totalPotHuman} ${token.ticker}`, inline: true },
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
    const match = await dbFootball.getMatch(matchId);
    if (!match || !match.guildIds || !match.guildIds.includes(guildId)) return;
    
    const matchBetsObj = await dbFootball.getBetsByMatch(guildId, matchId);
    const matchBets = Object.values(matchBetsObj || {});
    
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
        // Removed - using database
      }
    } else {
      console.log(`[FOOTBALL] No valid score data for match ${matchId}`);
      return;
    }
    
    // Step 3: Identify winners (only those who haven't received prizes yet to prevent double-counting)
    const allWinners = matchBets.filter(bet => bet.outcome === winningOutcome);
    const winners = allWinners.filter(bet => !bet.prizeSent || !bet.prizeAmount); // Only process winners who haven't received prizes
    const alreadyProcessedWinners = allWinners.filter(bet => bet.prizeSent === true && bet.prizeAmount); // Track already processed
    const losers = matchBets.filter(bet => bet.outcome !== winningOutcome);
    
    console.log(`[FOOTBALL] Match ${matchId} winners: ${allWinners.length} total (${winners.length} pending, ${alreadyProcessedWinners.length} already processed), losers: ${losers.length}`);
    
    // If all winners have already been processed, skip to avoid duplicate processing
    if (winners.length === 0 && alreadyProcessedWinners.length > 0) {
      console.log(`[FOOTBALL] Match ${matchId} prizes already processed for all winners, skipping duplicate processing`);
      return;
    }
    
    // Get guild-specific token configuration
    const token = getMatchTokenForGuild(match, guildId);
    if (!token) {
      console.error(`[FOOTBALL] No token configuration found for match ${matchId} in guild ${guildId}`);
      return;
    }
    
    // Step 4: Calculate prize distribution (use all winners for fair pot distribution)
    const totalPotWei = matchBets.reduce((total, bet) => total + Number(bet.amountWei), 0);
    const totalPotHuman = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
    
    if (allWinners.length === 0) {
      console.log(`[FOOTBALL] No winners for match ${matchId}, all bets lose`);
      
      // Track house earnings when no winners (only if not already tracked for this guild)
      const houseEarningsTracked = match.houseEarningsTrackedByGuild?.[guildId] || false;
      if (!houseEarningsTracked) {
        await trackHouseEarnings(guildId, matchId, totalPotWei, token.decimals, token.identifier);
        await dbFootball.updateMatchGuildHouseEarnings(matchId, guildId, true);
        await sendNoWinnersNotification(guildId, matchId, losers, winningOutcome, totalPotHuman);
      } else {
        console.log(`[FOOTBALL] House earnings already tracked for match ${matchId} in guild ${guildId}, skipping`);
      }
      return;
    }
    
    // Winners split the pot equally (use allWinners for fair distribution, but only process unprocessed ones)
    const prizePerWinnerWei = Math.floor(totalPotWei / allWinners.length);
    const prizePerWinnerHuman = new BigNumber(prizePerWinnerWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
    
    console.log(`[FOOTBALL] Match ${matchId} total pot: ${totalPotHuman} ${token.ticker}`);
    console.log(`[FOOTBALL] Prize per winner: ${prizePerWinnerHuman} ${token.ticker}`);
    
    // Step 5: Distribute prizes to winners using virtual accounts (only unprocessed ones)
    console.log(`[FOOTBALL] Distributing prizes to virtual accounts for ${winners.length} unprocessed winners`);
    
    for (const winner of winners) {
      try {
        // Note: Prize tracking is now handled by the database
        // Race condition protection is handled by database transactions
        
        console.log(`[FOOTBALL] Adding ${prizePerWinnerHuman} ${token.ticker} to virtual account for winner ${winner.userId}`);
        
        // Add prize to winner's virtual account (using identifier)
        const prizeResult = await virtualAccounts.addFundsToAccount(
          guildId,
          winner.userId,
          token.identifier,
          prizePerWinnerHuman,
          null, // No transaction hash for virtual prize
          'football_prize'
        );
        
        if (prizeResult.success) {
          console.log(`[FOOTBALL] Successfully added prize to virtual account for ${winner.userId}: ${prizeResult.newBalance} ${token.ticker}`);
          
          // Update bet record to mark prize as sent
          await dbFootball.updateBetPrize(winner.betId, guildId, prizePerWinnerHuman);
          
          // Update leaderboard for this winner (only if not already counted) - using identifier
          await updateLeaderboard(guildId, winner.userId, prizePerWinnerWei, token.decimals, token.identifier, token.ticker);
          
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
    const match = await dbFootball.getMatch(matchId);
    if (!match || !match.guildIds || !match.guildIds.includes(guildId) || !match.embeds[guildId]?.threadId) {
      console.log(`[FOOTBALL] No thread found for match ${matchId}, cannot send winner notification`);
      return;
    }
    
    // Get guild-specific token configuration
    const token = getMatchTokenForGuild(match, guildId);
    if (!token) {
      console.error(`[FOOTBALL] No token configuration found for match ${matchId} in guild ${guildId}`);
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
    
    // Get winner details - prizes are tracked via virtual account transactions
    const winnerDetails = winners.map(winner => {
      // Prize amount is already calculated, use it directly
      // Transaction hash is tracked in virtual account transaction history
      return {
        userId: winner.userId,
        amount: prizePerWinnerHuman,
        txHash: 'VIRTUAL_PRIZE' // Virtual prizes don't have blockchain tx hashes
      };
    });
    
    // Create winner notification embed
    const winnerEmbed = new EmbedBuilder()
      .setTitle(`🏆 ${match.home} vs ${match.away} - WINNERS ANNOUNCED!`)
      .setDescription(`**${match.compName}** • Game ID: \`${matchId}\``)
      .addFields([
        { name: '📊 Final Score', value: `${match.ftScore.home} - ${match.ftScore.away}`, inline: true },
        { name: '🎯 Winning Outcome', value: winningOutcome, inline: true },
        { name: '💰 Total Pot', value: `${totalPotHuman} ${token.ticker}`, inline: true },
        { name: '🏆 Winners', value: `${winners.length} player(s)`, inline: true },
        { name: '💎 Prize per Winner', value: `${prizePerWinnerHuman} ${token.ticker}`, inline: true },
        { name: '❌ Losers', value: `${losers.length} player(s)`, inline: true }
      ])
      .setColor('#00FF00')
      .setFooter({ text: 'Prizes have been added to your virtual accounts! Use /check-balance-esdt to see your winnings.', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
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
          value: `**Prize:** ${winner.amount} ${token.ticker}\n**Status:** Added to virtual account`,
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
    const match = await dbFootball.getMatch(matchId);
    if (!match || !match.guildIds || !match.guildIds.includes(guildId) || !match.embeds[guildId]?.threadId) {
      console.log(`[FOOTBALL] No thread found for match ${matchId}, cannot send no-winners notification`);
      return;
    }
    
    // Get guild-specific token configuration
    const token = getMatchTokenForGuild(match, guildId);
    if (!token) {
      console.error(`[FOOTBALL] No token configuration found for match ${matchId} in guild ${guildId}`);
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
        { name: '💰 Total Pot', value: `${totalPotHuman} ${token.ticker}`, inline: true },
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
      .setDescription(`All ${losers.length} player(s) bet on the wrong outcome. The total pot of **${totalPotHuman} ${token.ticker}** will be kept by the house.\n\nDon't give up! Keep betting and your luck will turn around! 🍀`)
      .setColor('#FF6B6B')
      .setTimestamp();
    
    await thread.send({ embeds: [consolationEmbed] });
    
    console.log(`[FOOTBALL] No-winners notification sent to thread ${match.embeds[guildId].threadId} for match ${matchId}`);
    
  } catch (error) {
    console.error(`[FOOTBALL] Error sending no-winners notification for match ${matchId}:`, error.message);
  }
}

// Set up simple round-robin match checking (every 15 seconds, one match at a time)
console.log('[FOOTBALL] ⏰ Setting up simple round-robin match checking every 15 seconds...');

let currentMatchIndex = 0;
let allMatches = [];

// Initialize the match list
async function initializeMatchList() {
  // Get all unfinished matches from database (including PAUSED matches)
  const scheduledMatches = await dbFootball.getScheduledMatches();
  const pausedMatches = await dbFootball.getPausedMatches();
  const allUnfinishedMatches = [...scheduledMatches, ...pausedMatches];
  const unfinishedMatches = allUnfinishedMatches.filter(match => 
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
    await initializeMatchList();
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
      
      // Update match data in database
      await dbFootball.updateMatch(match.matchId, {
        status: newStatus,
        ftScore: newScore && newScore.home !== undefined && newScore.away !== undefined 
          ? { home: newScore.home, away: newScore.away } 
          : undefined
      });
      
      // Get full match data with guild relationships
      const fullMatch = await dbFootball.getMatch(match.matchId);
      if (!fullMatch || !fullMatch.guildIds || fullMatch.guildIds.length === 0) {
        console.log(`[FOOTBALL] ⚠️ Match ${match.matchId} has no guild relationships, skipping embed/prize updates`);
        // Remove from list if no guilds
        allMatches = allMatches.filter(m => m.matchId !== match.matchId);
        if (currentMatchIndex >= allMatches.length) {
          currentMatchIndex = 0;
        }
        return;
      }
      
      // Update embeds if there was a status change OR score change
      if (oldStatus !== newStatus || scoreChanged) {
        console.log(`[FOOTBALL] ${oldStatus !== newStatus ? 'Status' : 'Score'} changed, updating embeds for ${fullMatch.guildIds.length} guild(s)...`);
        for (const guildId of fullMatch.guildIds) {
          await updateMatchEmbed(guildId, match.matchId);
        }
      }
      
      // If match is finished, process prizes for all guilds
      if (newStatus === 'FINISHED') {
        console.log(`[FOOTBALL] 🏁 Match ${match.matchId} finished! Processing prizes for ${fullMatch.guildIds.length} guild(s)...`);
        for (const guildId of fullMatch.guildIds) {
          await processMatchPrizes(guildId, match.matchId);
        }
        // Remove finished match from the list
        allMatches = allMatches.filter(m => m.matchId !== match.matchId);
        if (currentMatchIndex >= allMatches.length) {
          currentMatchIndex = 0;
        }
      }
      
      console.log(`[FOOTBALL] ✅ Updated match ${match.matchId} - Status: ${newStatus}, Score: ${newScore ? `${newScore.home}-${newScore.away}` : 'N/A'}`);
    } else {
      console.log(`[FOOTBALL] No updates for match ${match.matchId}`);
    }
    
  } catch (error) {
    console.error(`[FOOTBALL] Error checking match ${match.matchId}:`, error.message);
  }
}

// Initialize match list on startup
setTimeout(async () => {
  await initializeMatchList();
}, 5000);

// Check one match every 15 seconds
setInterval(async () => {
  try {
    await checkSingleMatch();
  } catch (error) {
    console.error('[FOOTBALL] Error in single match check:', error.message);
  }
}, 15 * 1000); // 15 seconds