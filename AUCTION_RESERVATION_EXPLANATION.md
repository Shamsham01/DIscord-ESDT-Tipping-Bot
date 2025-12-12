# How Auction Bid Reservations Work

## Overview

When you place a bid on an auction, your funds are **reserved** (locked) but **NOT deducted** until the auction ends and you win.

## The Process

### 1. **When You Place a Bid**
- ✅ Funds are **reserved** in the `auction_bid_reservations` table
- ❌ Funds are **NOT deducted** from your balance yet
- ❌ **NO transaction** is created in your history yet
- ✅ Your **available balance decreases** (total - reserved)
- ✅ You **cannot spend** the reserved funds on other things

### 2. **While Auction is Active**
- Your balance shows: **Available Balance = Total Balance - Reserved Amount**
- Reserved funds are "locked" - you can't use them for:
  - Lottery tickets
  - Tips
  - Withdrawals
  - Other auctions
- But they're still "yours" - just not available to spend

### 3. **If You Get Outbid**
- ✅ Your reservation is **released** (unlocked)
- ✅ Funds become **available** again immediately
- ❌ Still **NO transaction** in history (nothing was deducted)

### 4. **When Auction Ends**

**If You Win:**
- ✅ Reservation is **converted to payment**
- ✅ Funds are **deducted** from your balance
- ✅ **Transaction is created** in your history: "Auction payment: [NFT Name]"
- ✅ NFT is transferred to you

**If You Lose:**
- ✅ Reservation is **released** (unlocked)
- ✅ Funds become **available** again
- ❌ Still **NO transaction** in history (nothing was deducted)

## Why No Transaction Until You Win?

This is by design:
- **If you're outbid**: No money changes hands, so no transaction needed
- **If you win**: Transaction is created when payment is processed
- This keeps your transaction history clean and accurate

## Balance Display

The `/check-balance-esdt` command now shows:
- **Available Balance** = Total Balance - Reserved Funds
- Reserved funds are automatically subtracted from what you see
- You can only spend the "available" amount

## Example Scenario

1. **You have 10 WEGLD**
2. **You place a bid of 3.4 WEGLD**
   - Total Balance: 10 WEGLD
   - Reserved: 3.4 WEGLD
   - **Available Balance: 6.6 WEGLD** ← This is what you see
3. **You try to buy lottery tickets for 7 WEGLD**
   - ❌ **Fails** - you only have 6.6 WEGLD available
4. **Someone outbids you**
   - Reserved: 0 WEGLD
   - **Available Balance: 10 WEGLD** ← Back to full amount
5. **You place another bid of 4 WEGLD**
   - Total Balance: 10 WEGLD
   - Reserved: 4 WEGLD
   - **Available Balance: 6 WEGLD** ← Updated
6. **Auction ends, you win**
   - ✅ **Transaction created**: "Auction payment: xEmpyreans #12" (-4 WEGLD)
   - Total Balance: 6 WEGLD
   - Reserved: 0 WEGLD
   - **Available Balance: 6 WEGLD**

## Fix Applied

The balance display command (`/check-balance-esdt`) has been updated to automatically subtract reserved funds, so you'll now see the correct available balance.

## Troubleshooting

**If your balance still shows the same amount after placing a bid:**

1. **Check if reservation was created:**
   ```sql
   SELECT * FROM auction_bid_reservations 
   WHERE user_id = 'YOUR_USER_ID' 
   AND status = 'ACTIVE';
   ```

2. **Verify token identifier matches:**
   - Reservation uses: `WEGLD-bd4d79` (full identifier)
   - Balance should also use: `WEGLD-bd4d79`
   - If there's a mismatch, the reservation won't be subtracted

3. **Restart the bot** to ensure the updated code is running
