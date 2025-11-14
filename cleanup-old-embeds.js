/**
 * Cleanup Script for Old Discord Embeds
 * 
 * This script removes Discord messages (embeds) for NFT listings and auctions that are:
 * - At least 1 day old
 * - Have status: CANCELLED, EXPIRED, or SOLD (for listings) / FINISHED, CANCELLED, or EXPIRED (for auctions)
 * 
 * Usage:
 *   node cleanup-old-embeds.js              # Run cleanup (dry-run mode)
 *   node cleanup-old-embeds.js --execute     # Actually delete messages
 *   node cleanup-old-embeds.js --days=3     # Clean up items older than 3 days (dry-run)
 *   node cleanup-old-embeds.js --execute --days=3  # Clean up items older than 3 days (execute)
 * 
 * The script will:
 * 1. Find all old listings/auctions matching criteria
 * 2. Delete the main embed message
 * 3. Delete associated threads (if they exist)
 * 4. Handle errors gracefully (messages already deleted, channels not found, etc.)
 */

require('dotenv').config();
const { Client, IntentsBitField, Partials } = require('discord.js');
const supabase = require('./supabase-client');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const daysArg = args.find(arg => arg.startsWith('--days='));
const DAYS_OLD = daysArg ? parseInt(daysArg.split('=')[1]) || 1 : 1;

// Initialize Discord client
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
  ],
});

// Configuration
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OLDER_THAN_MS = DAYS_OLD * ONE_DAY_MS;

// Statuses to clean up
const LISTING_STATUSES_TO_CLEAN = ['CANCELLED', 'EXPIRED', 'SOLD'];
const AUCTION_STATUSES_TO_CLEAN = ['FINISHED', 'CANCELLED', 'EXPIRED'];

async function cleanupOldListings() {
  console.log('\n=== Cleaning up old NFT listings ===');
  
  const oneDayAgo = Date.now() - OLDER_THAN_MS;
  
  try {
    // Get old listings with cleanup statuses
    const { data: listings, error } = await supabase
      .from('nft_listings')
      .select('listing_id, guild_id, message_id, channel_id, thread_id, status, title, created_at')
      .in('status', LISTING_STATUSES_TO_CLEAN)
      .lt('created_at', oneDayAgo)
      .not('message_id', 'is', null)
      .not('channel_id', 'is', null);
    
    if (error) {
      console.error('Error fetching listings:', error);
      return { success: 0, failed: 0, skipped: 0 };
    }
    
    if (!listings || listings.length === 0) {
      console.log('No old listings found to clean up.');
      return { success: 0, failed: 0, skipped: 0 };
    }
    
    console.log(`Found ${listings.length} old listing(s) to clean up.`);
    
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    for (const listing of listings) {
      try {
        const guild = await client.guilds.fetch(listing.guild_id);
        if (!guild) {
          console.log(`  ⚠️  Skipping listing ${listing.listing_id}: Guild not found`);
          skippedCount++;
          continue;
        }
        
        const channel = await guild.channels.fetch(listing.channel_id).catch(() => null);
        if (!channel) {
          console.log(`  ⚠️  Skipping listing ${listing.listing_id}: Channel not found`);
          skippedCount++;
          continue;
        }
        
        // Delete the main message
        try {
          const message = await channel.messages.fetch(listing.message_id);
          if (DRY_RUN) {
            console.log(`  🔍 [DRY-RUN] Would delete listing message: ${listing.title} (${listing.listing_id})`);
          } else {
            await message.delete();
            console.log(`  ✅ Deleted listing message: ${listing.title} (${listing.listing_id})`);
          }
        } catch (msgError) {
          if (msgError.code === 10008) {
            // Message already deleted
            console.log(`  ℹ️  Listing message already deleted: ${listing.title} (${listing.listing_id})`);
          } else {
            console.error(`  ❌ Error deleting listing message ${listing.listing_id}:`, msgError.message);
            failedCount++;
            continue;
          }
        }
        
        // Delete thread if it exists
        if (listing.thread_id) {
          try {
            const thread = await channel.threads.fetch(listing.thread_id).catch(() => null);
            if (thread) {
              if (DRY_RUN) {
                console.log(`  🔍 [DRY-RUN] Would delete listing thread: ${listing.title} (${listing.listing_id})`);
              } else {
                await thread.delete();
                console.log(`  ✅ Deleted listing thread: ${listing.title} (${listing.listing_id})`);
              }
            }
          } catch (threadError) {
            if (threadError.code === 10003) {
              // Thread already deleted
              console.log(`  ℹ️  Listing thread already deleted: ${listing.title} (${listing.listing_id})`);
            } else {
              console.error(`  ⚠️  Error deleting listing thread ${listing.listing_id}:`, threadError.message);
              // Don't count thread deletion failures as failures
            }
          }
        }
        
        successCount++;
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`  ❌ Error processing listing ${listing.listing_id}:`, error.message);
        failedCount++;
      }
    }
    
    console.log(`\nListing cleanup complete: ${successCount} succeeded, ${failedCount} failed, ${skippedCount} skipped`);
    return { success: successCount, failed: failedCount, skipped: skippedCount };
    
  } catch (error) {
    console.error('Error in cleanupOldListings:', error);
    return { success: 0, failed: 0, skipped: 0 };
  }
}

async function cleanupOldAuctions() {
  console.log('\n=== Cleaning up old auctions ===');
  
  const oneDayAgo = Date.now() - OLDER_THAN_MS;
  
  try {
    // Get old auctions with cleanup statuses
    const { data: auctions, error } = await supabase
      .from('auctions')
      .select('auction_id, guild_id, message_id, channel_id, thread_id, status, title, created_at')
      .in('status', AUCTION_STATUSES_TO_CLEAN)
      .lt('created_at', oneDayAgo)
      .not('message_id', 'is', null)
      .not('channel_id', 'is', null);
    
    if (error) {
      console.error('Error fetching auctions:', error);
      return { success: 0, failed: 0, skipped: 0 };
    }
    
    if (!auctions || auctions.length === 0) {
      console.log('No old auctions found to clean up.');
      return { success: 0, failed: 0, skipped: 0 };
    }
    
    console.log(`Found ${auctions.length} old auction(s) to clean up.`);
    
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    for (const auction of auctions) {
      try {
        const guild = await client.guilds.fetch(auction.guild_id);
        if (!guild) {
          console.log(`  ⚠️  Skipping auction ${auction.auction_id}: Guild not found`);
          skippedCount++;
          continue;
        }
        
        const channel = await guild.channels.fetch(auction.channel_id).catch(() => null);
        if (!channel) {
          console.log(`  ⚠️  Skipping auction ${auction.auction_id}: Channel not found`);
          skippedCount++;
          continue;
        }
        
        // Delete the main message
        try {
          const message = await channel.messages.fetch(auction.message_id);
          if (DRY_RUN) {
            console.log(`  🔍 [DRY-RUN] Would delete auction message: ${auction.title} (${auction.auction_id})`);
          } else {
            await message.delete();
            console.log(`  ✅ Deleted auction message: ${auction.title} (${auction.auction_id})`);
          }
        } catch (msgError) {
          if (msgError.code === 10008) {
            // Message already deleted
            console.log(`  ℹ️  Auction message already deleted: ${auction.title} (${auction.auction_id})`);
          } else {
            console.error(`  ❌ Error deleting auction message ${auction.auction_id}:`, msgError.message);
            failedCount++;
            continue;
          }
        }
        
        // Delete thread if it exists
        if (auction.thread_id) {
          try {
            const thread = await channel.threads.fetch(auction.thread_id).catch(() => null);
            if (thread) {
              if (DRY_RUN) {
                console.log(`  🔍 [DRY-RUN] Would delete auction thread: ${auction.title} (${auction.auction_id})`);
              } else {
                await thread.delete();
                console.log(`  ✅ Deleted auction thread: ${auction.title} (${auction.auction_id})`);
              }
            }
          } catch (threadError) {
            if (threadError.code === 10003) {
              // Thread already deleted
              console.log(`  ℹ️  Auction thread already deleted: ${auction.title} (${auction.auction_id})`);
            } else {
              console.error(`  ⚠️  Error deleting auction thread ${auction.auction_id}:`, threadError.message);
              // Don't count thread deletion failures as failures
            }
          }
        }
        
        successCount++;
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`  ❌ Error processing auction ${auction.auction_id}:`, error.message);
        failedCount++;
      }
    }
    
    console.log(`\nAuction cleanup complete: ${successCount} succeeded, ${failedCount} failed, ${skippedCount} skipped`);
    return { success: successCount, failed: failedCount, skipped: skippedCount };
    
  } catch (error) {
    console.error('Error in cleanupOldAuctions:', error);
    return { success: 0, failed: 0, skipped: 0 };
  }
}

async function main() {
  console.log('Starting cleanup of old Discord embeds...');
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY-RUN (no messages will be deleted)' : '⚡ EXECUTE (messages will be deleted)'}`);
  console.log(`Looking for listings/auctions older than ${DAYS_OLD} day(s) with cleanup statuses.`);
  console.log(`Listing statuses: ${LISTING_STATUSES_TO_CLEAN.join(', ')}`);
  console.log(`Auction statuses: ${AUCTION_STATUSES_TO_CLEAN.join(', ')}`);
  console.log('');
  
  // Login to Discord
  try {
    await client.login(process.env.TOKEN);
    console.log('✅ Connected to Discord');
  } catch (error) {
    console.error('❌ Failed to connect to Discord:', error.message);
    process.exit(1);
  }
  
  // Wait for client to be ready
  await new Promise(resolve => {
    if (client.isReady()) {
      resolve();
    } else {
      client.once('ready', resolve);
    }
  });
  
  // Run cleanup
  const listingResults = await cleanupOldListings();
  const auctionResults = await cleanupOldAuctions();
  
  // Summary
  console.log('\n=== Cleanup Summary ===');
  console.log(`Listings: ${listingResults.success} succeeded, ${listingResults.failed} failed, ${listingResults.skipped} skipped`);
  console.log(`Auctions: ${auctionResults.success} succeeded, ${auctionResults.failed} failed, ${auctionResults.skipped} skipped`);
  console.log(`Total: ${listingResults.success + auctionResults.success} succeeded, ${listingResults.failed + auctionResults.failed} failed, ${listingResults.skipped + auctionResults.skipped} skipped`);
  
  // Logout and exit
  await client.destroy();
  console.log('\n✅ Cleanup script completed');
  process.exit(0);
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

