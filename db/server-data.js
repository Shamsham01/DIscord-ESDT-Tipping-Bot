const supabase = require('../supabase-client');
const { encryptPEM, decryptPEM } = require('../utils/encryption');

// User Wallets
async function getUserWallet(guildId, userId) {
  try {
    const { data, error } = await supabase
      .from('user_wallets')
      .select('wallet_address')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data?.wallet_address || null;
  } catch (error) {
    console.error('[DB] Error getting user wallet:', error);
    throw error;
  }
}

async function getUserWallets(guildId) {
  try {
    const { data, error } = await supabase
      .from('user_wallets')
      .select('user_id, wallet_address')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const wallets = {};
    (data || []).forEach(row => {
      wallets[row.user_id] = row.wallet_address;
    });
    return wallets;
  } catch (error) {
    console.error('[DB] Error getting user wallets:', error);
    throw error;
  }
}

async function setUserWallet(guildId, userId, walletAddress) {
  try {
    const { error } = await supabase
      .from('user_wallets')
      .upsert({
        guild_id: guildId,
        user_id: userId,
        wallet_address: walletAddress
      }, {
        onConflict: 'guild_id,user_id'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error setting user wallet:', error);
    throw error;
  }
}

async function deleteUserWallet(guildId, userId) {
  try {
    const { error } = await supabase
      .from('user_wallets')
      .delete()
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error deleting user wallet:', error);
    throw error;
  }
}

// Projects
async function getProject(guildId, projectName) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('guild_id', guildId)
      .eq('project_name', projectName)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    // Decrypt PEM if encrypted
    let walletPem = data.wallet_pem;
    try {
      walletPem = decryptPEM(data.wallet_pem);
    } catch (error) {
      console.error('[DB] Error decrypting PEM for project:', error.message);
      // If decryption fails, return null to prevent using corrupted data
      throw new Error('Failed to decrypt wallet PEM');
    }
    
    return {
      walletAddress: data.wallet_address,
      walletPem: walletPem,
      supportedTokens: data.supported_tokens || [],
      userInput: data.user_input,
      registeredBy: data.registered_by,
      registeredAt: data.registered_at,
      projectLogoUrl: data.project_logo_url
    };
  } catch (error) {
    console.error('[DB] Error getting project:', error);
    throw error;
  }
}

async function getAllProjects(guildId) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const projects = {};
    (data || []).forEach(row => {
      // Decrypt PEM if encrypted
      let walletPem = row.wallet_pem;
      try {
        // Log encrypted PEM info (no sensitive content)
        console.log(`[DB] Decrypting PEM for project ${row.project_name}. Encrypted length: ${row.wallet_pem?.length || 0} characters`);
        
        walletPem = decryptPEM(row.wallet_pem);
        
        // Log decrypted PEM info (no sensitive content)
        console.log(`[DB] Decrypted PEM for project ${row.project_name}. Decrypted length: ${walletPem?.length || 0} characters`);
        
        // Validate decrypted PEM is not empty
        if (!walletPem || walletPem.trim().length === 0) {
          console.error(`[DB] Decrypted PEM is empty for project ${row.project_name}`);
          console.warn(`[DB] Skipping project ${row.project_name} due to empty PEM`);
          return;
        }
        
        // Validate PEM format
        if (!walletPem.includes('BEGIN') || !walletPem.includes('END')) {
          console.error(`[DB] Invalid PEM format for project ${row.project_name}. PEM length: ${walletPem.length} characters`);
          console.warn(`[DB] Skipping project ${row.project_name} due to invalid PEM format`);
          return;
        }
        
        // Validate PEM has reasonable length (should be at least 90 chars)
        // Short PEM format (from seed phrase tools): ~98 chars (44 char base64 for 32-byte key)
        // Long PEM format (from SDK with address): ~250+ chars (address + secret key, multi-line base64)
        // Both formats are valid for signing MultiversX transactions
        if (walletPem.length < 90) {
          console.error(`[DB] PEM too short for project ${row.project_name}. Length: ${walletPem.length}, expected 90+`);
          console.warn(`[DB] Skipping project ${row.project_name} due to suspiciously short PEM`);
          return;
        }
      } catch (error) {
        console.error(`[DB] Error decrypting PEM for project ${row.project_name}:`, error.message);
        console.error(`[DB] Error stack:`, error.stack);
        // Skip this project if decryption fails
        console.warn(`[DB] Skipping project ${row.project_name} due to decryption error`);
        return;
      }
      
      projects[row.project_name] = {
        walletAddress: row.wallet_address,
        walletPem: walletPem,
        supportedTokens: row.supported_tokens || [],
        userInput: row.user_input,
        registeredBy: row.registered_by,
        registeredAt: row.registered_at,
        projectLogoUrl: row.project_logo_url
      };
    });
    return projects;
  } catch (error) {
    console.error('[DB] Error getting all projects:', error);
    throw error;
  }
}

async function setProject(guildId, projectName, projectData) {
  try {
    // Validate PEM before encrypting
    if (projectData.walletPem) {
      if (projectData.walletPem.trim().length === 0) {
        throw new Error('PEM is empty');
      }
      if (!projectData.walletPem.includes('BEGIN') || !projectData.walletPem.includes('END')) {
        throw new Error('Invalid PEM format');
      }
      // Validate PEM length (should be at least 90 characters)
      // Short PEM format (from seed phrase tools): ~98 chars (44 char base64 for 32-byte key)
      // Long PEM format (from SDK with address): ~250+ chars (address + secret key, multi-line base64)
      // Both formats are valid for signing MultiversX transactions
      if (projectData.walletPem.length < 90) {
        console.error(`[DB] PEM too short for project ${projectName}: ${projectData.walletPem.length} characters (expected 90+)`);
        throw new Error(`PEM is too short (${projectData.walletPem.length} chars, expected 90+)`);
      }
      console.log(`[DB] Storing PEM for project ${projectName}. PEM length: ${projectData.walletPem.length} characters`);
    }
    
    // Encrypt PEM before storing
    let encryptedPem = projectData.walletPem;
    if (projectData.walletPem) {
      try {
        encryptedPem = encryptPEM(projectData.walletPem);
        console.log(`[DB] Encrypted PEM for project ${projectName}. Encrypted length: ${encryptedPem.length} characters`);
      } catch (error) {
        console.error('[DB] Error encrypting PEM for project:', error.message);
        throw new Error('Failed to encrypt wallet PEM');
      }
    }
    
    const { error, data } = await supabase
      .from('projects')
      .upsert({
        guild_id: guildId,
        project_name: projectName,
        wallet_address: projectData.walletAddress,
        wallet_pem: encryptedPem,
        supported_tokens: projectData.supportedTokens || [],
        user_input: projectData.userInput || null,
        registered_by: projectData.registeredBy,
        registered_at: projectData.registeredAt,
        project_logo_url: projectData.projectLogoUrl || null
      }, {
        onConflict: 'guild_id,project_name'
      });
    
    if (error) {
      console.error(`[DB] Error storing project ${projectName}:`, error);
      throw error;
    }
    
    // Verify the encrypted PEM was stored correctly
    console.log(`[DB] Verifying stored encrypted PEM for project ${projectName}...`);
    const { data: verifyData, error: verifyError } = await supabase
      .from('projects')
      .select('wallet_pem')
      .eq('guild_id', guildId)
      .eq('project_name', projectName)
      .single();
    
    if (verifyError) {
      console.error(`[DB] Error verifying stored PEM for project ${projectName}:`, verifyError);
      throw new Error(`Failed to verify stored PEM: ${verifyError.message}`);
    }
    
    if (!verifyData || !verifyData.wallet_pem) {
      throw new Error('Failed to verify stored PEM: PEM not found after storage');
    }
    
    if (verifyData.wallet_pem.length !== encryptedPem.length) {
      console.error(`[DB] Encrypted PEM length mismatch! Original: ${encryptedPem.length}, Stored: ${verifyData.wallet_pem.length}`);
      throw new Error(`Encrypted PEM length mismatch after storage! Original: ${encryptedPem.length}, Stored: ${verifyData.wallet_pem.length}`);
    }
    
    if (verifyData.wallet_pem !== encryptedPem) {
      console.error(`[DB] Encrypted PEM content mismatch after storage!`);
      throw new Error('Encrypted PEM content mismatch after storage! The PEM may have been corrupted during storage.');
    }
    
    console.log(`[DB] ✅ Encrypted PEM verified successfully after storage (length: ${verifyData.wallet_pem.length} chars)`);
    
    return true;
  } catch (error) {
    console.error('[DB] Error setting project:', error);
    throw error;
  }
}

async function deleteProject(guildId, projectName) {
  try {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('guild_id', guildId)
      .eq('project_name', projectName);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error deleting project:', error);
    throw error;
  }
}

// Guild Settings
async function getGuildSettings(guildId) {
  try {
    const { data, error } = await supabase
      .from('guild_settings')
      .select('*')
      .eq('guild_id', guildId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    return {
      communityFundProject: data.community_fund_project,
      lastCompetition: data.last_competition,
      createdAt: data.created_at
    };
  } catch (error) {
    console.error('[DB] Error getting guild settings:', error);
    throw error;
  }
}

async function updateGuildSettings(guildId, settings) {
  try {
    // Check if record exists
    const existing = await getGuildSettings(guildId);
    
    const updateData = {
      guild_id: guildId,
      updated_at: new Date().toISOString()
    };
    
    // Set created_at only if this is a new record
    // If record exists, preserve the existing created_at value
    if (!existing) {
      updateData.created_at = Date.now();
    } else if (existing.createdAt) {
      // Preserve existing created_at when updating
      updateData.created_at = existing.createdAt;
    } else {
      // Fallback: if existing record has no created_at, set it now
      updateData.created_at = Date.now();
    }
    
    if (settings.communityFundProject !== undefined) {
      updateData.community_fund_project = settings.communityFundProject;
    }
    if (settings.lastCompetition !== undefined) {
      updateData.last_competition = settings.lastCompetition;
    }
    if (settings.createdAt !== undefined) {
      updateData.created_at = settings.createdAt;
    }
    
    const { error } = await supabase
      .from('guild_settings')
      .upsert(updateData, {
        onConflict: 'guild_id'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating guild settings:', error);
    throw error;
  }
}

// Community Fund QR
async function getCommunityFundQR(guildId) {
  try {
    const { data, error } = await supabase
      .from('community_fund_qr')
      .select('*')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const qrCodes = {};
    (data || []).forEach(row => {
      qrCodes[row.project_name] = row.qr_url;
    });
    return qrCodes;
  } catch (error) {
    console.error('[DB] Error getting community fund QR:', error);
    throw error;
  }
}

async function setCommunityFundQR(guildId, projectName, qrUrl) {
  try {
    const { error } = await supabase
      .from('community_fund_qr')
      .upsert({
        guild_id: guildId,
        project_name: projectName,
        qr_url: qrUrl
      }, {
        onConflict: 'guild_id,project_name'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error setting community fund QR:', error);
    throw error;
  }
}

// Token Metadata
async function getTokenMetadata(guildId) {
  try {
    const { data, error } = await supabase
      .from('token_metadata')
      .select('*')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const metadata = {};
    (data || []).forEach(row => {
      metadata[row.token_identifier] = {
        identifier: row.token_identifier,
        ticker: row.ticker,
        name: row.name,
        decimals: row.decimals,
        isPaused: row.is_paused,
        lastUpdated: row.last_updated
      };
    });
    return metadata;
  } catch (error) {
    console.error('[DB] Error getting token metadata:', error);
    throw error;
  }
}

async function setTokenMetadata(guildId, tokenIdentifier, metadata) {
  try {
    const { error } = await supabase
      .from('token_metadata')
      .upsert({
        guild_id: guildId,
        token_identifier: tokenIdentifier,
        ticker: metadata.ticker,
        name: metadata.name,
        decimals: metadata.decimals,
        is_paused: metadata.isPaused || false,
        last_updated: metadata.lastUpdated || new Date().toISOString()
      }, {
        onConflict: 'guild_id,token_identifier'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error setting token metadata:', error);
    throw error;
  }
}

// House Balance
async function getHouseBalance(guildId, tokenIdentifier) {
  try {
    const { data, error } = await supabase
      .from('house_balance')
      .select('*')
      .eq('guild_id', guildId)
      .eq('token_identifier', tokenIdentifier)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    return {
      bettingEarnings: data.betting_earnings || {},
      bettingSpending: data.betting_spending || {},
      bettingPNL: data.betting_pnl || {},
      auctionEarnings: data.auction_earnings || {},
      auctionSpending: data.auction_spending || {},
      auctionPNL: data.auction_pnl || {},
      lotteryEarnings: data.lottery_earnings || {},
      lotterySpending: data.lottery_spending || {},
      lotteryPNL: data.lottery_pnl || {}
    };
  } catch (error) {
    console.error('[DB] Error getting house balance:', error);
    throw error;
  }
}

async function getAllHouseBalances(guildId) {
  try {
    const { data, error } = await supabase
      .from('house_balance')
      .select('*')
      .eq('guild_id', guildId);
    
    if (error) throw error;
    
    const balances = {};
    (data || []).forEach(row => {
      balances[row.token_identifier] = {
        bettingEarnings: row.betting_earnings || {},
        bettingSpending: row.betting_spending || {},
        bettingPNL: row.betting_pnl || {},
        auctionEarnings: row.auction_earnings || {},
        auctionSpending: row.auction_spending || {},
        auctionPNL: row.auction_pnl || {},
        lotteryEarnings: row.lottery_earnings || {},
        lotterySpending: row.lottery_spending || {},
        lotteryPNL: row.lottery_pnl || {}
      };
    });
    return balances;
  } catch (error) {
    console.error('[DB] Error getting all house balances:', error);
    throw error;
  }
}

async function updateHouseBalance(guildId, tokenIdentifier, balanceData) {
  try {
    const { error } = await supabase
      .from('house_balance')
      .upsert({
        guild_id: guildId,
        token_identifier: tokenIdentifier,
        betting_earnings: balanceData.bettingEarnings || {},
        betting_spending: balanceData.bettingSpending || {},
        betting_pnl: balanceData.bettingPNL || {},
        auction_earnings: balanceData.auctionEarnings || {},
        auction_spending: balanceData.auctionSpending || {},
        auction_pnl: balanceData.auctionPNL || {},
        lottery_earnings: balanceData.lotteryEarnings || {},
        lottery_spending: balanceData.lotterySpending || {},
        lottery_pnl: balanceData.lotteryPNL || {},
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'guild_id,token_identifier'
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating house balance:', error);
    throw error;
  }
}

// Delete all server data for a guild (hard reset)
async function deleteAllServerData(guildId) {
  try {
    console.log(`[DELETE-ALL] Starting deletion of all data for guild ${guildId}`);
    
    // Delete from all tables with guild_id
    // Note: football_matches doesn't have guild_id, so it's handled separately below
    const tables = [
      'user_wallets',
      'projects',
      'guild_settings',
      'community_fund_qr',
      'token_metadata',
      'house_balance',
      'virtual_accounts',
      'virtual_account_transactions',
      'rps_games',
      'match_guilds',
      'football_bets',
      'leaderboard',
      'auctions',
      'auction_bids',
      'lotteries',
      'lottery_tickets',
      'lottery_winners'
    ];
    
    const results = {};
    
    for (const table of tables) {
      try {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('guild_id', guildId);
        
        if (error) {
          console.error(`[DELETE-ALL] Error deleting from ${table}:`, error);
          results[table] = { success: false, error: error.message };
        } else {
          console.log(`[DELETE-ALL] Successfully deleted from ${table}`);
          results[table] = { success: true };
        }
      } catch (error) {
        console.error(`[DELETE-ALL] Exception deleting from ${table}:`, error.message);
        results[table] = { success: false, error: error.message };
      }
    }
    
    // Also delete football_matches that might be referenced via match_guilds
    // (if foreign key doesn't cascade)
    try {
      // Get all match_ids for this guild from match_guilds
      const { data: matchGuilds, error: matchGuildsError } = await supabase
        .from('match_guilds')
        .select('match_id')
        .eq('guild_id', guildId);
      
      if (!matchGuildsError && matchGuilds && matchGuilds.length > 0) {
        const matchIds = [...new Set(matchGuilds.map(mg => mg.match_id))];
        
        // Check if any other guilds reference these matches
        for (const matchId of matchIds) {
          const { data: otherGuilds, error: checkError } = await supabase
            .from('match_guilds')
            .select('guild_id')
            .eq('match_id', matchId)
            .neq('guild_id', guildId);
          
          if (!checkError && (!otherGuilds || otherGuilds.length === 0)) {
            // No other guilds reference this match, safe to delete
            const { error: deleteMatchError } = await supabase
              .from('football_matches')
              .delete()
              .eq('match_id', matchId);
            
            if (deleteMatchError) {
              console.error(`[DELETE-ALL] Error deleting orphaned match ${matchId}:`, deleteMatchError);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[DELETE-ALL] Error cleaning up orphaned matches:`, error.message);
    }
    
    const allSuccess = Object.values(results).every(r => r.success);
    
    return {
      success: allSuccess,
      results: results
    };
  } catch (error) {
    console.error('[DB] Error deleting all server data:', error);
    throw error;
  }
}

module.exports = {
  getUserWallet,
  getUserWallets,
  setUserWallet,
  deleteUserWallet,
  getProject,
  getAllProjects,
  setProject,
  deleteProject,
  getGuildSettings,
  updateGuildSettings,
  getCommunityFundQR,
  setCommunityFundQR,
  getTokenMetadata,
  setTokenMetadata,
  getHouseBalance,
  getAllHouseBalances,
  updateHouseBalance,
  deleteAllServerData
};

