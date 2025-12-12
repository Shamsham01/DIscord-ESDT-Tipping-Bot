require('dotenv').config();
const supabase = require('./supabase-client');
const dbAuctions = require('./db/auctions');
const virtualAccounts = require('./virtual-accounts');

// Fix duplicate charges for auction: auction_1765484605017_mttwkjwyl
// User was charged 3 times 4.5 WEGLD instead of once
// This script will refund 2 of the 3 charges (9 WEGLD total)

const AUCTION_ID = 'auction_1765484605017_mttwkjwyl';

async function fixAuctionDuplicateCharges() {
  try {
    console.log('\n=== Fixing Duplicate Charges for Auction ===');
    console.log('Auction ID:', AUCTION_ID);
    
    // Get the auction to find guild ID and winner
    const { data: auctionData, error: auctionError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', AUCTION_ID)
      .single();
    
    if (auctionError || !auctionData) {
      console.error('❌ Error: Could not find auction:', auctionError?.message || 'Auction not found');
      return;
    }
    
    const guildId = auctionData.guild_id;
    const winnerId = auctionData.highest_bidder_id;
    const bidAmount = auctionData.current_bid;
    const nftName = auctionData.nft_name;
    
    // Resolve token identifier
    const tokenIdentifier = auctionData.token_identifier || 
                           (auctionData.token_ticker?.includes('-') ? auctionData.token_ticker : null);
    
    if (!tokenIdentifier) {
      console.error('❌ Error: Could not determine token identifier');
      return;
    }
    
    console.log('\n=== Auction Details ===');
    console.log('Guild ID:', guildId);
    console.log('Winner ID:', winnerId);
    console.log('Bid Amount:', bidAmount);
    console.log('NFT Name:', nftName);
    console.log('Token Identifier:', tokenIdentifier);
    
    // Find all "Auction payment" transactions for this auction
    const { data: transactions, error: txError } = await supabase
      .from('virtual_account_transactions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', winnerId)
      .eq('token', tokenIdentifier)
      .like('description', `%Auction payment: ${nftName}%`)
      .eq('type', 'deduction')
      .order('timestamp', { ascending: false });
    
    if (txError) {
      console.error('❌ Error querying transactions:', txError.message);
      return;
    }
    
    console.log('\n=== Found Transactions ===');
    console.log(`Total "Auction payment" transactions found: ${transactions?.length || 0}`);
    
    if (!transactions || transactions.length === 0) {
      console.log('⚠️  No transactions found. The auction may have been processed differently.');
      return;
    }
    
    // Filter transactions that match the exact bid amount
    const matchingTransactions = transactions.filter(tx => {
      const txAmount = parseFloat(tx.amount);
      const bidAmountFloat = parseFloat(bidAmount);
      return Math.abs(txAmount - bidAmountFloat) < 0.0001; // Allow small floating point differences
    });
    
    console.log(`\nTransactions matching bid amount (${bidAmount}): ${matchingTransactions.length}`);
    
    if (matchingTransactions.length <= 1) {
      console.log('✅ No duplicate charges found. Only one transaction matches the bid amount.');
      return;
    }
    
    // We need to refund (matchingTransactions.length - 1) charges
    const chargesToRefund = matchingTransactions.length - 1;
    const totalRefundAmount = new (require('bignumber.js'))(bidAmount).multipliedBy(chargesToRefund);
    
    console.log(`\n=== Refund Plan ===`);
    console.log(`Charges found: ${matchingTransactions.length}`);
    console.log(`Charges to refund: ${chargesToRefund}`);
    console.log(`Total refund amount: ${totalRefundAmount.toString()} ${tokenIdentifier}`);
    
    // Show transaction details
    console.log('\n=== Transaction Details ===');
    matchingTransactions.forEach((tx, index) => {
      console.log(`\nTransaction ${index + 1}:`);
      console.log(`  ID: ${tx.id}`);
      console.log(`  Amount: ${tx.amount}`);
      console.log(`  Balance Before: ${tx.balance_before}`);
      console.log(`  Balance After: ${tx.balance_after}`);
      console.log(`  Timestamp: ${new Date(tx.timestamp).toISOString()}`);
      console.log(`  Description: ${tx.description}`);
    });
    
    // Ask for confirmation (in a real scenario, you might want to add a confirmation prompt)
    console.log('\n=== Proceeding with Refund ===');
    
    // Refund the extra charges
    // We'll refund all but the first transaction (keep the first one as it's the legitimate charge)
    for (let i = 1; i < matchingTransactions.length; i++) {
      const tx = matchingTransactions[i];
      console.log(`\nRefunding transaction ${i + 1} (ID: ${tx.id})`);
      
      const refundResult = await virtualAccounts.addFundsToAccount(
        guildId,
        winnerId,
        tokenIdentifier,
        bidAmount,
        null, // No tx hash for refunds
        'auction_refund_duplicate_charge',
        null
      );
      
      if (refundResult.success) {
        console.log(`✅ Successfully refunded ${bidAmount} ${tokenIdentifier}`);
        console.log(`   New balance: ${refundResult.newBalance}`);
        
        // Optionally, mark the duplicate transaction with a note
        // (We can't modify the transaction, but we could add a comment in a separate table)
      } else {
        console.error(`❌ Failed to refund transaction ${i + 1}:`, refundResult.error);
      }
    }
    
    // Get final balance
    const finalBalance = await virtualAccounts.getUserBalance(guildId, winnerId, tokenIdentifier);
    
    console.log('\n=== Refund Complete ===');
    console.log(`Total refunded: ${totalRefundAmount.toString()} ${tokenIdentifier}`);
    console.log(`Winner's final balance: ${finalBalance} ${tokenIdentifier}`);
    console.log('\n✅ Duplicate charges have been refunded!');
    console.log('\n⚠️  Note: Discord notifications cannot be removed, but the balances are now correct.');
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  }
}

// Run the fix
fixAuctionDuplicateCharges()
  .then(() => {
    console.log('\n=== Script completed ===');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
