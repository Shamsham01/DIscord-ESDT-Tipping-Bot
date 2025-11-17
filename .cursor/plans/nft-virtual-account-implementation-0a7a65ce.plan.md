<!-- 0a7a65ce-2cd8-4542-b84f-f6d788e9e8d3 04757121-e543-40e9-b7fd-874745ad2238 -->
# NFT Virtual Account Balances Implementation Plan

## Overview

Add NFT support to virtual accounts alongside existing ESDT balances, enabling users to deposit NFTs, view balances, list NFTs for sale, and purchase/offer on marketplace listings. All NFTs are tracked individually by collection and nonce.

## Phase 1: Database Schema

### 1.1 Create Migration File

**File:** `supabase-schema-nft.sql` or add to existing migration

**Tables to create:**

- `virtual_account_nft_balances` - Stores NFT ownership (one row per NFT per user)
- `virtual_account_nft_transactions` - Transaction history for NFT operations
- `nft_listings` - Active marketplace listings
- `nft_offers` - Offers on listings (with expiration support)
- `house_nft_balance` - Tracks NFTs deposited to Community Fund

**Key constraints:**

- Unique constraint on `(guild_id, user_id, collection, nonce)` for balances
- Indexes on `guild_id`, `user_id`, `collection` for performance
- Foreign key relationships where applicable

### 1.2 Schema Details

- NFT balances: Store collection, identifier (collection-nonce), nonce, name, image_url, metadata JSONB
- Transactions: Track all NFT movements (deposit, transfer, sale, purchase, offer)
- Listings: Support both fixed_price and accept_offers listing types
- Offers: Include expiration timestamp (optional, configurable)
- House balance: Track NFT inventory per collection in Community Fund

## Phase 2: Database Layer Functions

### 2.1 Create `db/virtual-accounts-nft.js`

**Functions to implement:**

**Balance Management:**

- `getUserNFTBalances(guildId, userId, collection = null)` - Get all NFTs or filter by collection
- `getUserNFTBalance(guildId, userId, collection, nonce)` - Get specific NFT
- `getUserCollections(guildId, userId)` - Get list of collections user owns NFTs from
- `addNFTToAccount(guildId, userId, collection, identifier, nonce, metadata)` - INSERT new NFT
- `removeNFTFromAccount(guildId, userId, collection, nonce)` - DELETE NFT
- `transferNFTBetweenUsers(guildId, fromUserId, toUserId, collection, nonce, priceData)` - DELETE + INSERT pattern

**Transaction History:**

- `addNFTTransaction(guildId, userId, transaction)` - Record transaction
- `getNFTTransactionHistory(guildId, userId, collection = null, limit = 50)` - Get history

**House Balance:**

- `trackNFTTopup(guildId, collection, identifier, nonce, userId, txHash, metadata)` - Track Community Fund deposit
- `getHouseNFTBalance(guildId, collection = null)` - Get house NFT inventory

**Listings:**

- `createListing(guildId, listingId, listingData)` - Create marketplace listing
- `getListing(guildId, listingId)` - Get listing details
- `getActiveListings(guildId, collection = null)` - Get active listings
- `updateListing(guildId, listingId, updates)` - Update listing status/fields
- `getUserListings(guildId, userId, status = 'ACTIVE')` - Get user's listings

**Offers:**

- `createOffer(guildId, offerId, offerData)` - Create offer on listing
- `getOffersForListing(guildId, listingId)` - Get all offers for a listing
- `getUserOffers(guildId, userId, status = 'PENDING')` - Get user's offers
- `updateOffer(guildId, offerId, updates)` - Accept/reject/expire offers
- `cleanupExpiredOffers()` - Remove expired offers (cron job)

## Phase 3: Blockchain Listener Integration

### 3.1 Modify `blockchain-listener.js`

**File:** `blockchain-listener.js`

**Changes:**

- Extend `processTransaction()` function to detect NFT transfers
- Check `transfer.type === 'NonFungibleESDT' || transfer.type === 'SemiFungibleESDT'`
- Extract: collection, nonce, identifier from transfer object
- Call new `processNFTDeposit()` function
- Use same timestamp tracking mechanism (no API changes needed)

**New function:**

- `processNFTDeposit(guildId, senderWallet, receiverWallet, collection, identifier, nonce, txHash)` - Process incoming NFT
- Fetch NFT metadata from MultiversX API (`/accounts/{wallet}/nfts`)
- Find sender's Discord user_id via wallet lookup
- Add NFT to virtual account using `virtualAccountsNFT.addNFTToAccount()`
- Track in house balance
- Create transaction record
- Send Discord notification (similar to ESDT deposits)

**API endpoint:** Same as ESDT - `/accounts/{wallet}/transactions` - filter by transfer type in response

## Phase 4: Command Implementations

### 4.1 `/list-nft` Command

**File:** `index.js` (add to command handler)
**Registration:** `register-commands.js`

**Command options:**

- `collection` (autocomplete) - Filter user's NFTs by collection
- `nft-name` (autocomplete) - Select specific NFT from user's balance
- `title` (required) - Listing title
- `description` (optional) - Listing description
- `price-token` (autocomplete) - Token for payment (from Community Fund supported tokens)
- `price-amount` (required) - Fixed price amount
- `listing-type` (choice) - "Fixed Price" or "Accept Offers"
- `expires-in` (optional) - Hours until expiration (default: no expiration)

**Implementation flow:**

1. Get user's NFT balances filtered by collection
2. Fetch NFT details from MultiversX API if needed (for image/metadata)
3. Validate user owns the NFT
4. Create listing in database
5. Create embed with NFT image, details, price, listing type
6. Create buttons: "Buy" (if fixed price) and "Make Offer" (always available)
7. Post message and create thread
8. Store message_id and thread_id in listing record

**Autocomplete handlers:**

- Collection: Query `virtual_account_nft_balances` for user's collections
- NFT name: Query user's NFTs in selected collection, match by name

### 4.2 `/check-balance-nft` Command

**File:** `index.js`
**Registration:** `register-commands.js`

**Command options:**

- `collection` (autocomplete, optional) - Filter by collection
- `public` (boolean, optional) - Show publicly

**Implementation:**

1. Get user's NFT balances (filtered by collection if provided)
2. Group by collection
3. Create embed with:

- Collection name as field name
- NFT count and list of NFT names
- Thumbnail of first NFT in collection (if available)

4. If no collection specified, show all collections user owns
5. Paginate if more than 25 collections (Discord embed limit)

**Autocomplete:**

- Collection: Get distinct collections from user's `virtual_account_nft_balances`

### 4.3 `/balance-history-nft` Command

**File:** `index.js`
**Registration:** `register-commands.js`

**Command options:**

- `collection` (autocomplete, optional) - Filter by collection
- `limit` (integer, optional, max 50) - Number of transactions
- `public` (boolean, optional) - Show publicly

**Implementation:**

1. Get NFT transaction history (filtered by collection if provided)
2. Create embed with transaction list:

- Type (deposit, transfer, sale, purchase, offer)
- NFT name and collection
- Amount (if applicable)
- Timestamp
- Other party (if transfer/sale)

3. Format similar to existing `/balance-history` command

## Phase 5: Marketplace Functionality

### 5.1 Button Interaction Handlers

**File:** `index.js` (add to button interaction handler around line 9469)

**Button custom IDs:**

- `nft-buy:{listingId}` - Buy button
- `nft-offer:{listingId}` - Make offer button
- `nft-offer-accept:{offerId}` - Accept offer (seller)
- `nft-offer-reject:{offerId}` - Reject offer (seller)
- `nft-listing-cancel:{listingId}` - Cancel listing (seller)

### 5.2 Buy Flow (`nft-buy:`)

1. Verify listing exists and is ACTIVE
2. Check buyer has sufficient ESDT balance
3. Verify seller still owns NFT
4. Deduct ESDT from buyer's virtual account
5. Add ESDT to seller's virtual account
6. Transfer NFT (DELETE from seller, INSERT for buyer)
7. Create transaction records for both users
8. Update listing status to SOLD
9. Update listing embed (disable buttons, mark as sold)
10. Send notifications to buyer and seller

### 5.3 Offer Flow (`nft-offer:`)

1. Open modal for offer amount
2. Validate offer amount (must be > 0)
3. Check buyer has sufficient balance (reserve, don't deduct yet)
4. Create offer record in database
5. Notify seller in listing thread
6. Update listing embed to show offer count
7. If listing has expiration, set offer expiration (default: 7 days)

### 5.4 Offer Acceptance (`nft-offer-accept:`)

1. Verify offer exists and is PENDING
2. Verify seller owns NFT
3. Deduct ESDT from offerer's account
4. Add ESDT to seller's account
5. Transfer NFT
6. Update offer status to ACCEPTED
7. Reject/expire all other offers on this listing
8. Update listing to SOLD
9. Update embeds and send notifications

### 5.5 Listing Management

- Auto-expire listings (if expiration set)
- Cancel listing: Verify ownership, update status, refund if needed
- Update listing embed when offers are made/accepted

## Phase 6: Embed Management

### 6.1 Listing Embed Structure

**Fields:**

- Title: Listing title
- Description: Listing description + NFT details
- NFT Name, Collection, Nonce
- Price: Amount + Token
- Listing Type: Fixed Price / Accept Offers
- Status: Active / Sold / Cancelled / Expired
- Seller: Discord mention
- Offers: Count of pending offers (if accept_offers)
- Expiration: Time remaining (if set)
- Thumbnail: NFT image

**Buttons:**

- Buy (if fixed_price and active)
- Make Offer (if active)
- Cancel (if seller, always visible)

### 6.2 Offer Embed Structure

**Shown in listing thread when offer is made:**

- Offerer: Discord mention
- Amount: Token + amount
- Status: Pending / Accepted / Rejected
- Expiration: Time remaining
- Buttons: Accept / Reject (seller only)

### 6.3 Update Functions

- `updateListingEmbed(guildId, listingId)` - Refresh listing embed
- `updateOfferEmbeds(guildId, listingId)` - Update offer list in thread
- Call these after: purchase, offer creation, offer acceptance, listing updates

## Phase 7: Integration Points

### 7.1 Extend `/create-auction` Command

**File:** `index.js` (modify existing command)

**Changes:**

- Add option: `source` (choice) - "Project Wallet" or "Virtual Account"
- If "Virtual Account" selected:
- Change autocomplete to fetch from user's `virtual_account_nft_balances`
- Verify user owns NFT before creating auction
- Don't transfer NFT yet (transfer on auction completion)
- Store `source: 'virtual_account'` and `seller_id` in auction record

**Auction completion:**

- If source is virtual_account, transfer NFT from seller's VA to winner's VA
- Deduct ESDT from winner's VA
- Add ESDT to seller's VA
- No blockchain transfer needed

### 7.2 NFT Metadata Caching

- Store NFT name, image_url, metadata in `virtual_account_nft_balances` on deposit
- Refresh metadata periodically or on-demand if needed
- Use cached data for embeds to reduce API calls

## Phase 8: Error Handling & Validation

### 8.1 Validation Checks

- Verify NFT ownership before listing/transferring
- Check sufficient ESDT balance before purchase/offer
- Validate listing is active before purchase
- Check offer hasn't expired before acceptance
- Verify user permissions (seller can cancel, etc.)

### 8.2 Error Responses

- User-friendly error messages in embeds
- Log errors with context for debugging
- Handle race conditions (multiple buyers simultaneously)
- Rollback on partial failures (use database transactions where possible)

### 8.3 Edge Cases

- NFT already sold (check before processing)
- Insufficient balance after offer creation
- Listing expired during purchase
- User deleted account
- NFT metadata unavailable

## Phase 9: Testing & Cleanup

### 9.1 Cleanup Jobs

- `cleanupExpiredOffers()` - Remove expired offers (run periodically)
- `cleanupExpiredListings()` - Mark expired listings as EXPIRED
- `cleanupOldNFTTransactions()` - Keep transaction history manageable (similar to ESDT)

### 9.2 Monitoring

- Log all NFT operations
- Track marketplace activity
- Monitor API rate limits for MultiversX
- Alert on failed transfers

## Phase 10: Documentation

### 10.1 Update Files

- `register-commands.js` - Add command registrations
- `README.md` - Document new commands
- `VIRTUAL_ACCOUNTS_README.md` - Add NFT section
- Create `NFT_MARKETPLACE_README.md` - Marketplace guide

## Implementation Order

1. Database schema migration
2. Database layer functions (`db/virtual-accounts-nft.js`)
3. Blockchain listener NFT detection
4. `/check-balance-nft` command (simplest)
5. `/balance-history-nft` command
6. `/list-nft` command with marketplace
7. Button handlers (buy/offer)
8. Offer management (accept/reject)
9. Extend `/create-auction` for virtual accounts
10. Cleanup jobs and monitoring

## Critical Considerations

- **Atomicity**: Use database transactions for NFT transfers (DELETE + INSERT)
- **Race conditions**: Check ownership/balance immediately before transfer
- **API rate limits**: Cache NFT metadata, batch API calls where possible
- **Data consistency**: Verify NFT still exists in user's balance before operations
- **Backward compatibility**: All changes are additive, no breaking changes
- **Performance**: Indexes on frequently queried fields (guild_id, user_id, collection)
- **Offer expiration**: Default 7 days, configurable per listing
- **Listing expiration**: Optional, no default expiration

### To-dos

- [ ] Create database schema migration file with all NFT tables (virtual_account_nft_balances, virtual_account_nft_transactions, nft_listings, nft_offers, house_nft_balance)
- [ ] Create db/virtual-accounts-nft.js with all balance management, transaction, listing, and offer functions
- [ ] Extend blockchain-listener.js to detect and process NFT transfers (NonFungibleESDT and SemiFungibleESDT types)
- [ ] Implement /check-balance-nft command with collection autocomplete and embed display
- [ ] Implement /balance-history-nft command with collection filtering and transaction history display
- [ ] Implement /list-nft command with collection/NFT autocomplete, listing creation, and embed with buy/offer buttons
- [ ] Implement button interaction handlers for buy, offer, accept offer, reject offer, and cancel listing
- [ ] Implement marketplace purchase flow (ESDT transfer + NFT transfer), offer creation/acceptance, and listing management
- [ ] Create embed update functions for listings and offers, handle embed refreshes after state changes
- [ ] Extend /create-auction command to support virtual account NFTs as source, modify auction completion to handle VA transfers
- [ ] Implement cleanup functions for expired offers and listings, add to periodic job scheduler
- [ ] Register all new commands in register-commands.js with proper options and autocomplete configurations