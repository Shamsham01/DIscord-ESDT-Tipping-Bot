# Auction Bid Reservations - Migration Notes

## Impact on Currently Live Auctions

**✅ No Impact - Fully Backward Compatible**

The fund reservation system is designed to be **fully backward compatible** with existing live auctions:

### How It Works

1. **New Bids (After Migration)**
   - All new bids will automatically reserve funds
   - Users cannot spend reserved funds on other activities
   - Previous bidder's reservation is released when outbid

2. **Existing Live Auctions (Before Migration)**
   - Auctions that were created before the migration **will continue to work normally**
   - When these auctions end, the system will:
     - Check for a reservation (won't find one for old auctions)
     - Fall back to the original deduction method
     - Process payment as before
   - **No changes needed** - existing auctions will close normally

3. **Mixed Scenarios**
   - If an old auction receives new bids after migration:
     - New bids will create reservations
     - Old bids (if any) won't have reservations
     - System handles both gracefully

## Automated Cleanup

The system includes **automated cleanup** that runs once per day:

- Cleans up reservations for auctions that ended more than 7 days ago
- Prevents database bloat
- Runs automatically - no manual intervention needed

## Migration Steps

1. **Run the database migration:**
   ```sql
   -- Execute: migration-add-auction-bid-reservations.sql
   ```

2. **Restart the bot:**
   - The new code will automatically start reserving funds for new bids
   - Existing auctions will continue to work as before

3. **No data migration needed:**
   - Old auctions don't need reservations created retroactively
   - The system handles both old and new auctions seamlessly

## Testing Recommendations

1. **Test with a new auction:**
   - Create a new auction
   - Place bids
   - Verify funds are reserved (check balance - should show available balance minus reserved)
   - Try to spend reserved funds (should fail)
   - Let someone outbid you (your reservation should be released)

2. **Test with existing auction:**
   - Find an existing live auction
   - Let it end normally
   - Verify it closes successfully (will use fallback method)

3. **Test cleanup:**
   - Wait 7+ days after an auction ends
   - Check that reservations are cleaned up (runs daily)

## Benefits

- ✅ **Zero downtime** - existing auctions continue working
- ✅ **Gradual adoption** - new auctions get reservations, old ones work as before
- ✅ **Automatic cleanup** - no manual maintenance needed
- ✅ **Safe fallback** - if reservation system has issues, falls back to original method
