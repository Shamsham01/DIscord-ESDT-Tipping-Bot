require('dotenv').config();
const supabase = require('./supabase-client');
const dbAuctions = require('./db/auctions');

// This script attempts to fix the recent auction by manually processing it
// Note: This should only be run if the auction data can be recovered

async function fixRecentAuction() {
  try {
    // Get the most recent finished auction
    const { data, error } = await supabase
      .from('auctions')
      .select('*')
      .eq('status', 'FINISHED')
      .order('end_time', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('Error querying auctions:', error);
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('No finished auctions found.');
      return;
    }
    
    const auction = data[0];
    console.log('\n=== Fixing Recent Finished Auction ===');
    console.log('Auction ID:', auction.auction_id);
    console.log('Guild ID:', auction.guild_id);
    console.log('NFT:', auction.nft_name);
    console.log('Collection:', auction.collection);
    console.log('Nonce:', auction.nft_nonce);
    console.log('Highest Bidder ID:', auction.highest_bidder_id);
    console.log('Current Bid:', auction.current_bid);
    console.log('Token Ticker:', auction.token_ticker);
    console.log('Project Name:', auction.project_name);
    console.log('Creator ID:', auction.creator_id);
    
    // Try to determine if this was a virtual account auction
    // If project_name is null, it's likely a virtual account auction
    const likelyVirtualAccount = !auction.project_name;
    const sellerId = auction.seller_id || (likelyVirtualAccount ? auction.creator_id : null);
    
    console.log('\n=== Inferred Information ===');
    console.log('Likely Virtual Account Auction:', likelyVirtualAccount);
    console.log('Inferred Seller ID:', sellerId);
    
    // Update the auction with inferred data
    if (!auction.source || !auction.seller_id || !auction.token_identifier) {
      console.log('\n=== Updating Auction Data ===');
      
      const updateData = {};
      if (!auction.source) {
        updateData.source = likelyVirtualAccount ? 'virtual_account' : 'project_wallet';
        console.log('Setting source to:', updateData.source);
      }
      if (!auction.seller_id && sellerId) {
        updateData.seller_id = sellerId;
        console.log('Setting seller_id to:', updateData.seller_id);
      }
      if (!auction.token_identifier) {
        // We can't resolve this without the guild context, so leave it null
        // It will be resolved when processing
        console.log('token_identifier will be resolved during processing');
      }
      
      if (Object.keys(updateData).length > 0) {
        await dbAuctions.updateAuction(auction.guild_id, auction.auction_id, updateData);
        console.log('✅ Auction data updated successfully!');
      }
    } else {
      console.log('✅ Auction already has all required fields.');
    }
    
    console.log('\n=== Next Steps ===');
    console.log('1. Run the migration SQL to add the missing columns (if not already done)');
    console.log('2. The auction closure process should now work correctly for future auctions');
    console.log('3. For this specific auction, you may need to manually:');
    console.log('   - Transfer the NFT from seller VA to winner VA');
    console.log('   - Credit tokens to seller VA');
    console.log('   - Remove NFT from seller VA balance');
    console.log('\n⚠️  Note: This script only updates the database records.');
    console.log('   You may need to manually process the NFT transfer and token credit.');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

fixRecentAuction();

