/**
 * Cleanup Script: Remove Duplicate NFT Identifiers and Fix Amount Values
 * 
 * This script:
 * 1. Finds duplicate NFT identifiers for the same user in the same guild
 * 2. Keeps the first record (by created_at) and removes duplicates
 * 3. Ensures all NFTs have amount = 1 (fixes any NFTs with amount > 1)
 * 4. Reports statistics on what was cleaned up
 */

const supabase = require('./supabase-client');

async function cleanupDuplicateNFTIdentifiers() {
  try {
    console.log('[CLEANUP] Starting NFT identifier cleanup and amount fix...\n');

    // Step 1: Find all duplicate identifiers (same guild_id, user_id, identifier)
    console.log('[CLEANUP] Step 1: Finding duplicate identifiers...');
    
    // Fetch all records and group in JavaScript (more reliable than SQL grouping)
    const { data: allRecords, error: fetchError } = await supabase
      .from('virtual_account_nft_balances')
      .select('guild_id, user_id, identifier, id, created_at');
    
    if (fetchError) {
      throw new Error(`Error fetching records: ${fetchError.message}`);
    }
    
    // Group by (guild_id, user_id, identifier) and find duplicates
    const grouped = {};
    allRecords.forEach(record => {
      const key = `${record.guild_id}|${record.user_id}|${record.identifier}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(record);
    });
    
    // Filter to only groups with more than 1 record
    const duplicates = [];
    Object.values(grouped).forEach(records => {
      if (records.length > 1) {
        duplicates.push({
          guild_id: records[0].guild_id,
          user_id: records[0].user_id,
          identifier: records[0].identifier,
          count: records.length,
          records: records.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        });
      }
    });

    let totalDuplicatesRemoved = 0;
    let fixedCount = 0;
    let fixedTypeCount = 0;

    if (!duplicates || duplicates.length === 0) {
      console.log('[CLEANUP] ✅ No duplicate identifiers found.\n');
    } else {
      console.log(`[CLEANUP] Found ${duplicates.length} duplicate identifier group(s).\n`);

      // For each duplicate group, keep the first record and remove others
      for (const dup of duplicates) {
        console.log(`[CLEANUP] Processing duplicates for identifier: ${dup.identifier} (user: ${dup.user_id}, guild: ${dup.guild_id})`);

        const records = dup.records || [];
        if (records.length <= 1) {
          continue; // Shouldn't happen, but skip if only one record
        }

        // Keep the first record (oldest), remove the rest
        const keepRecord = records[0];
        const removeRecords = records.slice(1);

        console.log(`[CLEANUP]   Keeping record ID: ${keepRecord.id} (created: ${keepRecord.created_at})`);
        console.log(`[CLEANUP]   Removing ${removeRecords.length} duplicate record(s)...`);

        // Remove duplicate records
        const idsToRemove = removeRecords.map(r => r.id);
        const { error: deleteError } = await supabase
          .from('virtual_account_nft_balances')
          .delete()
          .in('id', idsToRemove);

        if (deleteError) {
          console.error(`[CLEANUP]   Error removing duplicates:`, deleteError.message);
        } else {
          totalDuplicatesRemoved += removeRecords.length;
          console.log(`[CLEANUP]   ✅ Removed ${removeRecords.length} duplicate record(s).`);
        }
      }

      console.log(`\n[CLEANUP] ✅ Removed ${totalDuplicatesRemoved} duplicate record(s) total.\n`);
    }

    // Step 2: Fix NFTs with amount > 1 (should always be 1 for NFTs)
    console.log('[CLEANUP] Step 2: Fixing NFTs with amount > 1...');
    const { data: nftsWithWrongAmount, error: amountError } = await supabase
      .from('virtual_account_nft_balances')
      .select('id, identifier, collection, nonce, amount, token_type')
      .or('token_type.eq.NFT,token_type.is.null')
      .gt('amount', 1);

    if (amountError) {
      throw new Error(`Error finding NFTs with wrong amount: ${amountError.message}`);
    }

    if (!nftsWithWrongAmount || nftsWithWrongAmount.length === 0) {
      console.log('[CLEANUP] ✅ No NFTs with amount > 1 found.\n');
    } else {
      console.log(`[CLEANUP] Found ${nftsWithWrongAmount.length} NFT(s) with amount > 1.\n`);

      for (const nft of nftsWithWrongAmount) {
        console.log(`[CLEANUP]   Fixing ${nft.identifier} (collection: ${nft.collection}, nonce: ${nft.nonce}): amount ${nft.amount} → 1`);

        const { error: updateError } = await supabase
          .from('virtual_account_nft_balances')
          .update({ 
            amount: 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', nft.id);

        if (updateError) {
          console.error(`[CLEANUP]   Error fixing ${nft.identifier}:`, updateError.message);
        } else {
          fixedCount++;
        }
      }

      console.log(`\n[CLEANUP] ✅ Fixed ${fixedCount} NFT(s) with incorrect amount.\n`);
    }

    // Step 3: Also fix any records where token_type is null or missing (default to NFT)
    console.log('[CLEANUP] Step 3: Fixing NFTs with missing token_type...');
    const { data: nftsWithMissingType, error: typeError } = await supabase
      .from('virtual_account_nft_balances')
      .select('id, identifier, token_type, amount')
      .is('token_type', null);

    if (typeError) {
      throw new Error(`Error finding NFTs with missing token_type: ${typeError.message}`);
    }

    if (!nftsWithMissingType || nftsWithMissingType.length === 0) {
      console.log('[CLEANUP] ✅ No NFTs with missing token_type found.\n');
    } else {
      console.log(`[CLEANUP] Found ${nftsWithMissingType.length} NFT(s) with missing token_type.\n`);

      for (const nft of nftsWithMissingType) {
        // If amount > 1, it might be an SFT, but we'll default to NFT and set amount to 1
        const finalAmount = nft.amount > 1 ? 1 : (nft.amount || 1);
        console.log(`[CLEANUP]   Fixing ${nft.identifier}: token_type null → NFT, amount ${nft.amount || 'null'} → ${finalAmount}`);

        const { error: updateError } = await supabase
          .from('virtual_account_nft_balances')
          .update({ 
            token_type: 'NFT',
            amount: finalAmount,
            updated_at: new Date().toISOString()
          })
          .eq('id', nft.id);

        if (updateError) {
          console.error(`[CLEANUP]   Error fixing ${nft.identifier}:`, updateError.message);
        } else {
          fixedTypeCount++;
        }
      }

      console.log(`\n[CLEANUP] ✅ Fixed ${fixedTypeCount} NFT(s) with missing token_type.\n`);
    }

    // Step 4: Final verification - check for any remaining issues
    console.log('[CLEANUP] Step 4: Final verification...');
    
    // Check for remaining duplicates (fetch all and group in JavaScript)
    const { data: allRecordsForCheck } = await supabase
      .from('virtual_account_nft_balances')
      .select('guild_id, user_id, identifier');
    
    const groupedForCheck = {};
    allRecordsForCheck.forEach(record => {
      const key = `${record.guild_id}|${record.user_id}|${record.identifier}`;
      groupedForCheck[key] = (groupedForCheck[key] || 0) + 1;
    });
    
    const remainingDups = Object.values(groupedForCheck).filter(count => count > 1);

    // Check for NFTs with amount > 1
    const { data: remainingWrongAmount } = await supabase
      .from('virtual_account_nft_balances')
      .select('id, identifier, amount, token_type')
      .or('token_type.eq.NFT,token_type.is.null')
      .gt('amount', 1);

    if (remainingDups && remainingDups.length > 0) {
      console.log(`[CLEANUP] ⚠️  WARNING: ${remainingDups.length} duplicate identifier group(s) still remain.`);
    } else {
      console.log('[CLEANUP] ✅ No duplicate identifiers remaining.');
    }

    if (remainingWrongAmount && remainingWrongAmount.length > 0) {
      console.log(`[CLEANUP] ⚠️  WARNING: ${remainingWrongAmount.length} NFT(s) with amount > 1 still remain.`);
    } else {
      console.log('[CLEANUP] ✅ All NFTs have amount = 1.');
    }

    console.log('\n[CLEANUP] ✅ Cleanup completed successfully!');
    return {
      success: true,
      duplicatesRemoved: totalDuplicatesRemoved || 0,
      amountsFixed: fixedCount || 0,
      typesFixed: fixedTypeCount || 0
    };

  } catch (error) {
    console.error('[CLEANUP] ❌ Error during cleanup:', error.message);
    console.error(error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run cleanup if this file is executed directly
if (require.main === module) {
  cleanupDuplicateNFTIdentifiers()
    .then(result => {
      if (result.success) {
        console.log('\n[CLEANUP] Summary:');
        console.log(`  - Duplicates removed: ${result.duplicatesRemoved}`);
        console.log(`  - Amounts fixed: ${result.amountsFixed}`);
        console.log(`  - Types fixed: ${result.typesFixed}`);
        process.exit(0);
      } else {
        console.error('\n[CLEANUP] Cleanup failed:', result.error);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n[CLEANUP] Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { cleanupDuplicateNFTIdentifiers };

