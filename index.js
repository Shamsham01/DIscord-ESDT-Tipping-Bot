require('dotenv').config();
console.log('Starting Multi-Server ESDT Tipping Bot...');
console.log('Environment variables:', {
  TOKEN: process.env.TOKEN ? 'Set' : 'Missing',
  API_BASE_URL: process.env.API_BASE_URL ? 'Set' : 'Missing',
  API_TOKEN: process.env.API_TOKEN ? 'Set' : 'Missing',
});

const { Client, IntentsBitField, EmbedBuilder, PermissionsBitField, Partials } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');

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
const API_TOKEN = process.env.API_TOKEN;

// Global state variables - organized by server
let serverData = {};
const SERVER_DATA_FILE = 'server-data.json';

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

// Load data on startup
loadServerData();

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

    if (!project.supportedTokens.includes(tokenTicker)) {
      throw new Error(`Token "${tokenTicker}" is not supported by project "${projectName}". Supported tokens: ${project.supportedTokens.join(', ')}`);
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
      
      if (parsedResponse.txHash) {
        txHash = parsedResponse.txHash;
      } else if (parsedResponse.result && parsedResponse.result.txHash) {
        txHash = parsedResponse.result.txHash;
      } else if (parsedResponse.data && parsedResponse.data.txHash) {
        txHash = parsedResponse.data.txHash;
      } else if (parsedResponse.transaction && parsedResponse.transaction.txHash) {
        txHash = parsedResponse.transaction.txHash;
      }
      
      const errorMessage = parsedResponse.error || 
                          (parsedResponse.result && parsedResponse.result.error) ||
                          (parsedResponse.data && parsedResponse.data.error) ||
                          (!response.ok ? `API error (${response.status})` : null);
      
      const result = {
        success: response.ok || !!txHash,
        txHash: txHash,
        errorMessage: errorMessage,
        rawResponse: parsedResponse,
        httpStatus: response.status
      };
      
      if (result.success) {
        console.log(`Successfully sent ${amount} ${tokenTicker} to: ${recipientWallet} using project: ${projectName}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`API reported failure for ${tokenTicker} transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`However, transaction hash was found: ${txHash} - will consider this a success`);
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

// Handle bot interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const guildId = interaction.guildId;

  if (commandName === 'set-wallet') {
    try {
      const wallet = interaction.options.getString('wallet');
      if (!wallet.startsWith('erd1') || wallet.length !== 62) {
        await interaction.reply({ content: 'Invalid wallet address. Must be a valid MultiversX address (erd1..., 62 characters).', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      
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
        await interaction.reply({ content: `Error registering wallet: ${error.message}`, ephemeral: true });
      }
    }
  } else if (commandName === 'register-project') {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can register projects.', ephemeral: true });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const walletPem = interaction.options.getString('wallet-pem');
      const supportedTokensStr = interaction.options.getString('supported-tokens');

      const pemValid = isValidPemFormat(walletPem);
      if (!pemValid) {
        await interaction.editReply({ content: 'Invalid PEM format. Please provide a valid MultiversX wallet PEM file content.', ephemeral: true });
        return;
      }

      const supportedTokens = supportedTokensStr.split(',').map(token => token.trim()).filter(token => token.length > 0);
      
      if (supportedTokens.length === 0) {
        await interaction.editReply({ content: 'Please provide at least one supported token.', ephemeral: true });
        return;
      }

      const projects = getProjects(guildId);
      
      projects[projectName] = {
        walletPem: walletPem,
        supportedTokens: supportedTokens,
        registeredBy: interaction.user.id,
        registeredAt: Date.now()
      };

      saveServerData();

      const embed = new EmbedBuilder()
        .setTitle('Project Registered Successfully')
        .setDescription(`Project **${projectName}** has been registered for this server.`)
        .addFields([
          { name: 'Supported Tokens', value: supportedTokens.join(', '), inline: false },
          { name: 'Registered By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Status', value: '✅ Active', inline: true }
        ])
        .setColor('#00FF00')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
      console.log(`Project "${projectName}" registered for guild ${guildId} by ${interaction.user.tag}`);
    } catch (error) {
      console.error('Error registering project:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error registering project: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error registering project: ${error.message}`, ephemeral: true });
      }
    }
  } else if (commandName === 'send-esdt') {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can send ESDT tokens.', ephemeral: true });
        return;
      }

      const userTag = interaction.options.getString('user-tag');
      const tokenTicker = interaction.options.getString('token-ticker');
      const amount = interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || 'No memo provided';

      if (amount <= 0) {
        await interaction.editReply({ content: 'Amount must be greater than 0.', ephemeral: true });
        return;
      }

      // Get available projects for this server
      const projects = getProjects(guildId);
      const availableProjects = Object.keys(projects);
      
      if (availableProjects.length === 0) {
        await interaction.editReply({ 
          content: 'No projects registered for this server. Use /register-project to add a project first.', 
          ephemeral: true 
        });
        return;
      }

      // Find project that supports this token
      let selectedProject = null;
      for (const projectName of availableProjects) {
        if (projects[projectName].supportedTokens.includes(tokenTicker)) {
          selectedProject = projectName;
          break;
        }
      }

      if (!selectedProject) {
        await interaction.editReply({ 
          content: `No project supports token "${tokenTicker}". Available projects: ${availableProjects.join(', ')}`, 
          ephemeral: true 
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
          ephemeral: true 
        });
        return;
      }

      if (!recipientWallet.startsWith('erd1') || recipientWallet.length !== 62) {
        await interaction.editReply({ 
          content: `User ${userTag} has an invalid wallet address: ${recipientWallet}. Ask them to update it with /set-wallet.`, 
          ephemeral: true 
        });
        return;
      }
      
      await interaction.editReply({ 
        content: `Preparing to send ${amount} ${tokenTicker} to ${userTag} using project ${selectedProject}...\nMemo: ${memo}`, 
        ephemeral: true 
      });
      
      console.log(`Admin ${interaction.user.tag} (${interaction.user.id}) is sending ${amount} ${tokenTicker} to ${userTag} (${recipientWallet}) using project ${selectedProject}`);
      console.log(`Transfer memo: ${memo}`);
      
      const transferResult = await transferESDT(recipientWallet, tokenTicker, amount, selectedProject, guildId);
      
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
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Initiated By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '✅ Success', inline: true }
          ])
          .setColor(0x4d55dc)
          .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
          .setFooter({ text: 'Powered by MakeX API', iconURL: undefined })
          .setTimestamp();
        
        await interaction.editReply({ 
          content: `Transfer completed successfully! Posting public announcement...`, 
          ephemeral: true 
        });
        
        await interaction.channel.send({ 
          content: `🪙 **Token Transfer Announcement** 🪙`,
          embeds: [successEmbed]
        });
        
        try {
          if (interaction.guild) {
            const logChannel = interaction.guild.channels.cache.find((channel) => channel.name === 'transfer-logs');
            if (logChannel) {
              await logChannel.send({ embeds: [successEmbed] });
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
                { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
                { name: 'Project Used', value: selectedProject, inline: true },
                { name: 'Memo', value: memo, inline: false },
                { name: 'Sender', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Status', value: '✅ Success', inline: true }
              ])
              .setColor(0x4d55dc)
              .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
              .setFooter({ text: 'Powered by MakeX API', iconURL: undefined })
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
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: transferResult.txHash ? `\`${transferResult.txHash}\`` : 'Not available', inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Initiated By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '❌ Failed', inline: true }
          ])
          .setColor('#FF0000')
          .setTimestamp();
          
        await interaction.editReply({ 
          content: `Transfer failed: ${transferResult.errorMessage || 'Unknown error'}`, 
          embeds: [errorEmbed],
          ephemeral: true 
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
        await interaction.editReply({ content: `Error sending ESDT tokens: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error sending ESDT tokens: ${error.message}`, ephemeral: true });
      }
    }
  } else if (commandName === 'list-wallets') {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ 
          content: 'Only administrators can list registered wallets.', 
          ephemeral: true 
        });
        return;
      }
      
      const filter = interaction.options.getString('filter')?.toLowerCase() || '';
      const page = interaction.options.getInteger('page') || 1;
      const isPublic = interaction.options.getBoolean('public') || false;
      
      await interaction.deferReply({ ephemeral: !isPublic });
      
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
          ephemeral: !isPublic
        });
        
        console.log(`Listed ${currentPageEntries.length} wallets (${isPublic ? 'public' : 'private'} response)`);
        
      } catch (fetchError) {
        console.error('Error fetching guild members:', fetchError.message);
        await interaction.editReply({ 
          content: `Error fetching guild members: ${fetchError.message}. Displaying wallets with unknown user tags.`,
          ephemeral: !isPublic
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
          ephemeral: !isPublic
        });
      }
    } catch (error) {
      console.error('Error listing wallets:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error listing wallets: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error listing wallets: ${error.message}`, ephemeral: true });
      }
    }
  }
});

// Combined autocomplete handler for send-esdt command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  // USER AUTOCOMPLETE
  if (interaction.commandName === 'send-esdt' && interaction.options.getFocused(true).name === 'user-tag') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      let choices = [];
      const userWallets = getUserWallets(guildId);
      const userWalletEntries = Object.entries(userWallets).slice(0, 25);

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
      await interaction.respond(filtered.slice(0, 25));
    } catch (error) {
      await interaction.respond([]);
    }
    return;
  }

  // TOKEN AUTOCOMPLETE
  if (interaction.commandName === 'send-esdt' && interaction.options.getFocused(true).name === 'token-ticker') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      const availableProjects = Object.keys(projects);
      let supportedTokens = [];
      for (const projectName of availableProjects) {
        const project = projects[projectName];
        if (project && Array.isArray(project.supportedTokens)) {
          supportedTokens.push(...project.supportedTokens);
        }
      }
      supportedTokens = [...new Set(supportedTokens)];
      const filtered = supportedTokens.filter(token =>
        token.toLowerCase().includes(focusedValue.toLowerCase())
      );
      await interaction.respond(
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      await interaction.respond([]);
    }
    return;
  }
});

// Ready event
client.on('ready', async () => {
  console.log(`Multi-Server ESDT Tipping Bot is ready with ID: ${client.user.tag}`);
  console.log('Bot is using partials for: Message, Channel, User, GuildMember');
  console.log(`Bot is in ${client.guilds.cache.size} servers`);
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
