# 💰 House Tip Command

## Overview

The `/house-tip` command allows admins to tip users using tokens from the **house balance** (accumulated from matches with no winners).

## How It Works

1. **Source**: Community Fund wallet (where house earnings accumulate)
2. **Destination**: User's blockchain wallet
3. **Tracking**: Automatically updates house spending in leaderboard
4. **Virtual Account**: Also adds to recipient's virtual account

## Usage

### Command

```bash
/house-tip user:@username token:REWARD amount:50 memo:Weekly winner
```

### Options

- **user** (required): Discord user to tip
- **token** (required, autocomplete): Token to send (only tokens with positive house balance)
- **amount** (required): Amount to tip
- **memo** (optional): Reason for the tip

## Workflow

### Example: Awarding Weekly Competition Winner

```bash
# Admin checks house balance
/house-balance

# Admin awards winner
/house-tip user:@Winner token:REWARD amount:50 memo:Weekly competition

# What happens:
# 1. ✅ Validates house has enough balance
# 2. ✅ Transfers tokens from community fund wallet
# 3. ✅ Sends to user's blockchain wallet
# 4. ✅ Tracks spending in house balance
# 5. ✅ Adds to recipient's virtual account
```

## Automatic Features

### ✅ Balance Validation
- Checks house has sufficient balance
- Shows current balance if insufficient
- Prevents overspending

### ✅ Auto-Tracking
- Updates house spending in `leaderboard.json`
- Reduces house balance automatically
- Shows new balance in confirmation

### ✅ Virtual Account Integration
- Adds to recipient's virtual account
- Can be used for betting/tipping
- Full transaction history

### ✅ Token Filtering
- Autocomplete only shows tokens with positive balance
- Prevents attempting to tip unavailable tokens

## Balance Impact

### Before Tip
```
House Balance: 100 REWARD
Earned: 100 (from no-winner matches)
Spent: 0
```

### After Tip
```
House Balance: 50 REWARD
Earned: 100
Spent: 50 (awarded to weekly winner)
```

## Example Scenarios

### Weekly Competition
1. **Sunday**: Create fixtures with `/create-fixtures`
2. **Monday-Friday**: Players bet, some matches have no winners
3. **Saturday**: `/house-balance` shows accumulated funds
4. **Sunday**: `/house-tip` award weekly winner
5. **Check**: `/house-balance` shows new balance

### Monthly Grand Prize
1. **Accumulate**: Many no-winner matches throughout month
2. **Check Balance**: `/house-balance` shows 500 tokens
3. **Award Winner**: `/house-tip` 200 tokens to monthly winner
4. **Remaining**: 300 tokens for future prizes

## Permissions

- **Required**: Administrator
- **Users**: Cannot access house funds
- **Admins**: Can tip from house balance

## Difference from `/send-esdt`

| Feature | `/send-esdt` | `/house-tip` |
|---------|--------------|--------------|
| Source | Any project wallet | Community fund only |
| Tracking | No automatic tracking | Tracks house spending |
| Balance Check | No | Yes, validates house balance |
| Virtual Account | No | Yes, adds to recipient |
| Purpose | Admin transfers | House prize payouts |

## Technical Details

### Process Flow

```
User runs /house-tip
    ↓
Validate admin permissions
    ↓
Check house has sufficient balance
    ↓
Transfer from community fund wallet
    ↓
Track house spending (trackHouseSpending)
    ↓
Add to recipient virtual account
    ↓
Send confirmation
```

### Functions Called

1. `transferESDTFromCommunityFund()` - Sends tokens
2. `trackHouseSpending()` - Updates house balance
3. `virtualAccounts.addFundsToAccount()` - Adds to virtual account

## Error Handling

### Insufficient Balance
```
❌ Insufficient house balance!

Current house balance: 25 REWARD
Required: 50 REWARD

House needs more no-winner matches to accumulate funds.
```

### No Balance Yet
```
❌ House has no balance for this token yet.
No matches have had zero winners.
```

### User Has No Wallet
```
❌ User @username has not registered a wallet yet.
They must run /set-wallet first.
```

## Summary

**New Command**: `/house-tip` ✅

**What It Does**:
- Tips users from house balance
- Uses community fund wallet
- Tracks spending automatically
- Updates both house balance and virtual accounts

**Benefits**:
- Easy prize distribution
- Automatic tracking
- Balance validation
- Admin-only safety

Perfect for **weekly/monthly competitions** and **player rewards**! 🎉

