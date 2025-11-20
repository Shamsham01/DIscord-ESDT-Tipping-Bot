<!-- 1870cfe9-16a0-4109-942c-9451f97b0d33 83265a76-d522-474b-a78e-0ae1b049700a -->
# SFT Support Implementation Plan

## Overview

Add SFT support to the existing NFT virtual accounts system. SFTs differ from NFTs by having an `amount` field (quantity). The implementation will use aggregated amounts in Supabase (one row per user/collection/nonce with amount), automatically detect SFTs vs NFTs, and integrate into existing commands.

## Phase 1: Database Schema Migration

### 1.1 Add Amount Column

**File:** `supabase-schema.sql` (create migration file)

Add `amount` column to `virtual_account_nft_balances`:

```sql
ALTER TABLE virtual_account_nft_balances 
ADD COLUMN IF NOT EXISTS amount BIGINT DEFAULT 1 NOT NULL;

-- Set existing records to amount = 1 (all current NFTs are unique)
UPDATE virtual_account_nft_balances 
SET amount = 1 
WHERE amount IS NULL;
```

**Key Points:**

- Default value: 1 (for existing NFTs)
- NOT NULL constraint
- Existing NFTs remain unchanged (amount = 1)
- Unique constraint `(guild_id, user_id, collection, nonce)` remains (aggregated amounts)

## Phase 2: Database Layer Updates

### 2.1 Update `db/virtual-accounts-nft.js`

**Function: `addNFTToAccount()` (lines 68-91)**

- Change from INSERT to UPSERT logic
- If record exists: increment `amount` by deposit amount
- If new: INSERT with amount
- Accept `amount` parameter (default: 1 for backward compatibility)

**Function: `getUserNFTBalance()` (lines 30-47)**

- Return `amount` field in response
- No other changes needed

**Function: `removeNFTFromAccount()` (lines 93-109)**

- Change to handle partial removal
- Accept `amount` parameter (default: 1)
- If amount < current amount: decrement
- If amount >= current amount: DELETE row
- Throw error if amount > current amount

**Function: `transferNFTBetweenUsers()` (lines 111-193)**

- Accept `amount` parameter (default: 1)
- Validate sender has sufficient amount
- Partial transfer: decrement sender, increment/add recipient
- Update transaction records with amount

**New Function: `updateNFTAmount()`**

- Increment or decrement amount for a specific NFT balance
- Used internally by add/remove/transfer functions

## Phase 3: Blockchain Listener Updates

### 3.1 Extract Amount from SFT Transfers

**File:** `blockchain-listener.js`

**Function: `processTransaction()` (lines 229-396)**

- Line 311: When processing `SemiFungibleESDT`, extract `amount` from `transfer.value`
- Pass `amount` to `processNFTDeposit()` function

**Function: `processNFTDeposit()` (lines 399-524)**

- Add `amount` parameter (default: 1 for backward compatibility)
- Line 473: Pass `amount` to `addNFTToAccount()`
- Extract amount from transfer data: `transfer.value || transfer.amount || '1'`

**Key Changes:**

```javascript
// In processTransaction(), line ~311:
else if (transfer.type === 'NonFungibleESDT' || transfer.type === 'SemiFungibleESDT') {
  const amount = transfer.type === 'SemiFungibleESDT' 
    ? (transfer.value || transfer.amount || '1')
    : '1';
  // ... rest of processing
  await processNFTDeposit(..., amount);
}
```

## Phase 4: API Integration - SFT Transfer Function

### 4.1 Create SFT Transfer Function

**File:** `index.js`

**New Function: `transferSFTFromCommunityFund()`**

- Similar structure to `transferNFTFromCommunityFund()` (lines 1517-1661)
- Use endpoint: `/execute/sftTransfer` (not `/execute/nftTransfer`)
- Request body includes `amount` field:
  ```javascript
  {
    walletPem: pemToSend,
    recipient: recipientWallet,
    tokenTicker: tokenIdentifier,  // Collection ticker (e.g., "XPACHIEVE-5a0519")
    tokenNonce: Number(tokenNonce),  // Nonce (e.g., 15)
    amount: amount.toString()  // Amount to transfer
  }
  ```


**Update Function: `transferNFTFromCommunityFund()` (lines 1517-1661)**

- Add logic to detect SFT vs NFT
- Detection method: Check if `amount > 1` in database or if user specified amount > 1
- If SFT: Call `transferSFTFromCommunityFund()`
- If NFT: Use existing logic (amount = 1)

## Phase 5: Command Modifications

### 5.1 Add Amount Parameter to Commands

**File:** `index.js` and `register-commands.js`

**Command: `/withdraw-nft` (lines 8127-8272)**

- Add optional `amount` parameter (default: 1)
- Validate user has sufficient amount
- Auto-detect SFT: If amount > 1 or database shows amount > 1, use SFT endpoint
- Update balance after successful withdrawal

**Command: `/tip-virtual-nft` (lines 9029-9175)**

- Add optional `amount` parameter (default: 1)
- Validate sender has sufficient amount
- Update `transferNFTBetweenUsers()` call to include amount
- Display amount in success message

**Command: `/sell-nft` (lines 7775-7819)**

- Add optional `amount` parameter (default: 1)
- Validate user has sufficient amount
- Store amount in listing record
- Update listing display to show amount for SFTs

**Command: `/create-auction` (auction creation code)**

- Add optional `amount` parameter (default: 1)
- Validate user has sufficient amount
- Store amount in auction record
- Update auction display to show amount for SFTs

**Command: `/check-balance-nft` (balance display code)**

- Display amount field for SFTs (amount > 1)
- Show "Amount: X" for SFTs, "Unique" for NFTs (amount = 1)

### 5.2 Update Command Registration

**File:** `register-commands.js`

Add `amount` option to:

- `/withdraw-nft` (line 794)
- `/tip-virtual-nft` (line 950)
- `/sell-nft` (line 815)
- `/create-auction` (find auction command registration)

## Phase 6: SFT Detection Logic

### 6.1 Automated Detection

**Implementation Strategy:**

1. **Database Check:** Query `virtual_account_nft_balances` for `amount > 1`
2. **Transfer Type:** Check blockchain transfer type (`SemiFungibleESDT` vs `NonFungibleESDT`)
3. **User Input:** If user specifies `amount > 1`, treat as SFT

**Helper Function: `isSFT()`**

- Check database for existing record with amount > 1
- Return boolean
- Used in withdrawal and transfer functions

## Phase 7: Display and UI Updates

### 7.1 Update Embeds and Messages

**File:** `index.js`

**Balance Display:**

- Show "Amount: X" for SFTs (amount > 1)
- Show "Unique" or no amount for NFTs (amount = 1)

**Listing/Auction Embeds:**

- Include amount in title/description for SFTs
- Format: "Selling 25x XPACHIEVE-5a0519-0f" vs "Selling XPACHIEVE-5a0519-0f"

**Transaction History:**

- Include amount in transaction descriptions
- Format: "Transferred 25x SFT" vs "Transferred NFT"

## Phase 8: Validation and Error Handling

### 8.1 Amount Validation

- Ensure amount > 0
- Ensure user has sufficient balance before operations
- Clear error messages: "Insufficient SFT balance. You have X, need Y"
- Handle edge cases: amount = 0, negative amounts, non-numeric values

### 8.2 Backward Compatibility

- All existing NFTs (amount = 1) continue working
- Commands without amount parameter default to 1
- Existing listings/auctions remain valid

## Phase 9: Testing Checklist

1. **Deposit Testing:**

   - Deposit SFT with amount > 1
   - Verify amount aggregation in database
   - Deposit same SFT again, verify amount increment

2. **Withdrawal Testing:**

   - Withdraw partial SFT amount
   - Withdraw full SFT amount
   - Verify `/execute/sftTransfer` endpoint called correctly
   - Verify balance updated correctly

3. **Transfer Testing:**

   - Tip partial SFT amount
   - Tip full SFT amount
   - Verify both users' balances updated

4. **Marketplace Testing:**

   - List SFT for sale with amount
   - Create auction with SFT amount
   - Verify amount displayed correctly

5. **Backward Compatibility:**

   - Existing NFT commands work without amount parameter
   - Existing NFTs (amount = 1) function normally

## Implementation Order

1. Database migration (Phase 1)
2. Database layer updates (Phase 2)
3. Blockchain listener updates (Phase 3)
4. API integration (Phase 4)
5. Command modifications (Phase 5)
6. Detection logic (Phase 6)
7. Display updates (Phase 7)
8. Validation (Phase 8)
9. Testing (Phase 9)

## Key Files to Modify

- `supabase-schema.sql` - Add amount column
- `db/virtual-accounts-nft.js` - Update all balance functions
- `blockchain-listener.js` - Extract and pass amount
- `index.js` - Add SFT transfer function, update commands
- `register-commands.js` - Add amount parameters to commands

### To-dos

- [ ] Create database migration to add amount column to virtual_account_nft_balances table with default value 1
- [ ] Update addNFTToAccount() to use UPSERT logic with amount aggregation (increment if exists, insert if new)
- [ ] Update removeNFTFromAccount() to handle partial removal with amount parameter (decrement or delete)
- [ ] Update transferNFTBetweenUsers() to accept amount parameter and handle partial transfers
- [ ] Update blockchain-listener.js processTransaction() to extract amount from SemiFungibleESDT transfers
- [ ] Update processNFTDeposit() to accept and use amount parameter when adding NFTs to accounts
- [ ] Create transferSFTFromCommunityFund() function using /execute/sftTransfer endpoint with amount field
- [ ] Update transferNFTFromCommunityFund() to auto-detect SFT vs NFT and route to appropriate endpoint
- [ ] Add amount parameter to /withdraw-nft command and implement SFT withdrawal logic
- [ ] Add amount parameter to /tip-virtual-nft command and update transfer logic
- [ ] Add amount parameter to /sell-nft command and update listing creation
- [ ] Add amount parameter to /create-auction command and update auction creation
- [ ] Update /check-balance-nft to display amount field for SFTs
- [ ] Update register-commands.js to add amount option to all modified commands
- [ ] Update all embeds and messages to show amount for SFTs in listings, auctions, and transactions
- [ ] Add amount validation (sufficient balance checks, positive numbers) to all SFT operations