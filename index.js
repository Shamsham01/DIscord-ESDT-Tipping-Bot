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
      
      // Check if project already exists
      if (projects[projectName]) {
        await interaction.editReply({ 
          content: `⚠️ **Warning:** Project "${projectName}" already exists!\n\nThis will **overwrite** the existing project with new credentials.\n\nIf you want to update specific fields instead, use \`/update-project\`.\n\nTo proceed with overwriting, run this command again.`, 
          ephemeral: true 
        });
        return;
      }
      
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
        .setTimestamp()
        .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });

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
  } else if (commandName === 'update-project') {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can update projects.', ephemeral: true });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const newProjectName = interaction.options.getString('new-project-name');
      const walletPem = interaction.options.getString('wallet-pem');
      const supportedTokensStr = interaction.options.getString('supported-tokens');

      const projects = getProjects(guildId);
      
      if (!projects[projectName]) {
        await interaction.editReply({ content: `Project "${projectName}" not found. Use /register-project to create it first.`, ephemeral: true });
        return;
      }

      // Check if new project name already exists (if renaming)
      if (newProjectName && newProjectName !== projectName && projects[newProjectName]) {
        await interaction.editReply({ content: `Project "${newProjectName}" already exists. Choose a different name.`, ephemeral: true });
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

      // Update wallet PEM if provided
      if (walletPem) {
        const pemValid = isValidPemFormat(walletPem);
        if (!pemValid) {
          await interaction.editReply({ content: 'Invalid PEM format. Please provide a valid MultiversX wallet PEM file content.', ephemeral: true });
          return;
        }
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.walletPem = walletPem;
        changes.push('Wallet PEM updated');
        hasChanges = true;
      }

      // Update supported tokens if provided
      if (supportedTokensStr) {
        const supportedTokens = supportedTokensStr.split(',').map(token => token.trim()).filter(token => token.length > 0);
        
        if (supportedTokens.length === 0) {
          await interaction.editReply({ content: 'Please provide at least one supported token.', ephemeral: true });
          return;
        }
        
        const targetProject = newProjectName ? projects[newProjectName] : projects[projectName];
        targetProject.supportedTokens = supportedTokens;
        changes.push(`Supported tokens: ${supportedTokens.join(', ')}`);
        hasChanges = true;
      }

      if (!hasChanges) {
        await interaction.editReply({ content: 'No changes provided. Please specify at least one field to update.', ephemeral: true });
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
      
      console.log(`Project "${finalProjectName}" updated for guild ${guildId} by ${interaction.user.tag}`);
    } catch (error) {
      console.error('Error updating project:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error updating project: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error updating project: ${error.message}`, ephemeral: true });
      }
    }
  } else if (commandName === 'send-esdt') {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can send ESDT tokens.', ephemeral: true });
        return;
      }

      const projectName = interaction.options.getString('project-name');
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
      
      if (!projects[projectName]) {
        await interaction.editReply({ 
          content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, 
          ephemeral: true 
        });
        return;
      }

      // Check if the selected project supports the requested token
      if (!projects[projectName].supportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ 
          content: `Project "${projectName}" does not support token "${tokenTicker}".\n\nSupported tokens for this project: ${projects[projectName].supportedTokens.join(', ')}`, 
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
        content: `Preparing to send ${amount} ${tokenTicker} to ${userTag} using project ${projectName}...\nMemo: ${memo}`, 
        ephemeral: true 
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
          ephemeral: true 
        });
        
        await interaction.channel.send({ 
          content: `🪙 **Token Transfer Notification** 🪙`,
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
  } else if (commandName === 'set-community-fund') {
    try {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can set the Community Tip Fund.', ephemeral: true });
        return;
      }
      const projectName = interaction.options.getString('project-name');
      const confirm = interaction.options.getString('confirm');
      const projects = getProjects(guildId);
      if (!projects[projectName]) {
        await interaction.editReply({ content: `Project "${projectName}" not found. Use /list-projects to see available projects.`, ephemeral: true });
        return;
      }
      const currentFund = serverData[guildId]?.communityFundProject;
      if (currentFund && currentFund !== projectName && confirm !== 'CONFIRM') {
        await interaction.editReply({ content: `⚠️ Warning: This will replace the current Community Tip Fund (**${currentFund}**) with **${projectName}**.\n\nIf you are sure, run the command again and type CONFIRM in the confirm field.`, ephemeral: true });
        return;
      }
      serverData[guildId].communityFundProject = projectName;
      saveServerData();
      await interaction.editReply({ content: `Community Tip Fund set to project: **${projectName}**. All /tip transactions will use this wallet.`, ephemeral: true });
      console.log(`Community Tip Fund set to ${projectName} for guild ${guildId}`);
    } catch (error) {
      console.error('Error setting Community Tip Fund:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, ephemeral: true });
      }
    }
  } else if (commandName === 'tip') {
    try {
      await interaction.deferReply({ ephemeral: true });
      const userTag = interaction.options.getString('user-tag');
      const tokenTicker = interaction.options.getString('token-ticker');
      const amount = interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || 'No memo provided';
      // Check if community fund is set
      const fundProject = serverData[guildId]?.communityFundProject;
      if (!fundProject) {
        await interaction.editReply({ content: 'No Community Tip Fund is set for this server. Please ask an admin to run /set-community-fund.', ephemeral: true });
        return;
      }
      const projects = getProjects(guildId);
      if (!projects[fundProject]) {
        await interaction.editReply({ content: `The Community Tip Fund project ("${fundProject}") no longer exists. Please ask an admin to set it again.`, ephemeral: true });
        return;
      }
      if (!projects[fundProject].supportedTokens.includes(tokenTicker)) {
        await interaction.editReply({ content: `The Community Tip Fund does not support token "${tokenTicker}". Supported tokens: ${projects[fundProject].supportedTokens.join(', ')}`, ephemeral: true });
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
        await interaction.editReply({ content: `User ${userTag} not found or has no registered wallet. Ask them to register with /set-wallet.`, ephemeral: true });
        return;
      }
      if (!recipientWallet.startsWith('erd1') || recipientWallet.length !== 62) {
        await interaction.editReply({ content: `User ${userTag} has an invalid wallet address: ${recipientWallet}. Ask them to update it with /set-wallet.`, ephemeral: true });
        return;
      }
      await interaction.editReply({ content: `Preparing to tip ${amount} ${tokenTicker} to ${userTag} using Community Tip Fund (${fundProject})...\nMemo: ${memo}`, ephemeral: true });
      console.log(`User ${interaction.user.tag} (${interaction.user.id}) is tipping ${amount} ${tokenTicker} to ${userTag} (${recipientWallet}) using Community Tip Fund (${fundProject})`);
      const transferResult = await transferESDT(recipientWallet, tokenTicker, amount, fundProject, guildId);
      if (transferResult.success) {
        const explorerUrl = transferResult.txHash
          ? `https://explorer.multiversx.com/transactions/${transferResult.txHash}`
          : null;
        const txHashFieldValue = transferResult.txHash
          ? `[${transferResult.txHash}](${explorerUrl})`
          : 'Not available';
        const successEmbed = new EmbedBuilder()
          .setTitle('Community Tip Sent!')
          .setDescription(`Successfully tipped **${amount} ${tokenTicker}** to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: 'Community Fund', value: fundProject, inline: true },
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: txHashFieldValue, inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Tipped By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '✅ Success', inline: true }
          ])
          .setColor(0x4d55dc)
          .setThumbnail('https://i.ibb.co/ZpXx9Wgt/ESDT-Tipping-Bot-Thumbnail.gif')
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
          .setTimestamp();
        await interaction.editReply({ content: `Tip sent successfully!`, embeds: [successEmbed], ephemeral: true });
        await interaction.channel.send({ content: `🎁 **Community Tip Notification** 🎁`, embeds: [successEmbed] });
        try {
          if (targetUser) {
            const dmEmbed = new EmbedBuilder()
              .setTitle('You Received a Community Tip!')
              .setDescription(`You have received **${amount} ${tokenTicker}** from a community member.`)
              .addFields([
                { name: 'Community Fund', value: fundProject, inline: true },
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
            console.log(`Sent DM notification to ${userTag} about received community tip`);
          }
        } catch (dmError) {
          console.error(`Could not send DM to ${userTag}:`, dmError.message);
        }
      } else {
        const errorEmbed = new EmbedBuilder()
          .setTitle('Community Tip Failed')
          .setDescription(`Failed to tip **${amount} ${tokenTicker}** to ${targetUser ? `<@${targetUserId}>` : userTag}`)
          .addFields([
            { name: 'Community Fund', value: fundProject, inline: true },
            { name: 'Recipient Wallet', value: `\`${recipientWallet}\``, inline: false },
            { name: 'Transaction Hash', value: transferResult.txHash ? `\`${transferResult.txHash}\`` : 'Not available', inline: false },
            { name: 'Memo', value: memo, inline: false },
            { name: 'Tipped By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Status', value: '❌ Failed', inline: true }
          ])
          .setColor('#FF0000')
          .setTimestamp()
          .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' });
        await interaction.editReply({ content: `Tip failed: ${transferResult.errorMessage || 'Unknown error'}`, embeds: [errorEmbed], ephemeral: true });
      }
    } catch (error) {
      console.error('Error sending community tip:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error sending community tip: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error sending community tip: ${error.message}`, ephemeral: true });
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
  } else if (commandName === 'list-projects') {
    try {
      // Remove admin check so all users can use this command
      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ ephemeral: !isPublic });
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
        await interaction.editReply({ embeds: [embed], ephemeral: !isPublic });
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
        embed.addFields({
          name: `${isFund ? '💰 ' : ''}📁 ${projectName}${isFund ? ' (Community Fund)' : ''}`,
          value: `**Supported Tokens:** ${project.supportedTokens.join(', ')}\n**Registered By:** ${registeredBy}\n**Registered:** ${registeredAt}`,
          inline: false
        });
      }
      await interaction.editReply({ embeds: [embed], ephemeral: !isPublic });
      console.log(`Listed ${projectNames.length} projects (${isPublic ? 'public' : 'private'} response)`);
    } catch (error) {
      console.error('Error listing projects:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: `Error listing projects: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error listing projects: ${error.message}`, ephemeral: true });
      }
    }
  } else if (commandName === 'delete-project') {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.editReply({ content: 'Only administrators can delete projects.', ephemeral: true });
        return;
      }

      const projectName = interaction.options.getString('project-name');
      const confirm = interaction.options.getString('confirm');

      if (confirm !== 'DELETE') {
        await interaction.editReply({ 
          content: `❌ **Deletion Cancelled**\n\nTo delete project "${projectName}", you must type "DELETE" in the confirm field.\n\nThis is a safety measure to prevent accidental deletions.`, 
          ephemeral: true 
        });
        return;
      }

      const projects = getProjects(guildId);
      
      if (!projects[projectName]) {
        await interaction.editReply({ content: `Project "${projectName}" not found.`, ephemeral: true });
        return;
      }

      // Store project info for logging before deletion
      const projectInfo = projects[projectName];
      const supportedTokens = projectInfo.supportedTokens.join(', ');
      const registeredBy = projectInfo.registeredBy ? `<@${projectInfo.registeredBy}>` : 'Unknown';
      const registeredAt = projectInfo.registeredAt ? new Date(projectInfo.registeredAt).toLocaleDateString() : 'Unknown';

      // Delete the project
      delete projects[projectName];
      saveServerData();

      const embed = new EmbedBuilder()
        .setTitle('Project Deleted Successfully')
        .setDescription(`Project **${projectName}** has been permanently deleted from this server.`)
        .addFields([
          { name: 'Deleted Project', value: projectName, inline: true },
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
        await interaction.editReply({ content: `Error deleting project: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Error deleting project: ${error.message}`, ephemeral: true });
      }
    }
  }
});

// Combined autocomplete handler for send-esdt command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  // PROJECT NAME AUTOCOMPLETE FOR SEND-ESDT
  if (interaction.commandName === 'send-esdt' && interaction.options.getFocused(true).name === 'project-name') {
    try {
      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guildId;
      const projects = getProjects(guildId);
      const availableProjects = Object.keys(projects);
      
      const filtered = availableProjects.filter(projectName =>
        projectName.toLowerCase().includes(focusedValue.toLowerCase())
      );
      
      await interaction.respond(
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await interaction.respond([]);
    }
    return;
  }

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
      await interaction.respond(
        filtered.slice(0, 25).map(token => ({ name: token, value: token }))
      );
    } catch (error) {
      await interaction.respond([]);
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
      
      await interaction.respond(
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await interaction.respond([]);
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
      
      await interaction.respond(
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await interaction.respond([]);
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
      await interaction.respond(
        filtered.slice(0, 25).map(projectName => ({ name: projectName, value: projectName }))
      );
    } catch (error) {
      await interaction.respond([]);
    }
    return;
  }

  // USER AUTOCOMPLETE FOR TIP
  if (interaction.commandName === 'tip' && interaction.options.getFocused(true).name === 'user-tag') {
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
