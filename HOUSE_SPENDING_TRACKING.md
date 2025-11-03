# 💸 House Spending Tracking

## Overview

House balance now tracks **both earnings AND spending**:
- **Earnings**: From matches with no winners (automatic)
- **Spending**: When house pays out for competitions/prizes (manual tracking)

## Current House Balance Calculation

```
House Balance = Earnings - Spending
              = totalEarningsWei - totalBetsWei
```

### Why This Works

Since HOUSE never places bets, we can repurpose:
- `totalBetsWei` → **HOUSE spending**
- `tokenBets{}` → **HOUSE spending per token**
- `pnlWei` → **Net house balance** (earnings - spending)

## Data Structure

### Before (Only Earnings)
```json
{
  "HOUSE": {
    "totalEarningsWei": "100000000000",  // From no-winner matches
    "totalBetsWei": "0",                 // Always 0 (house doesn't bet)
    "pnlWei": "100000000000"             // Total earnings
  }
}
```

### After (Earnings + Spending)
```json
{
  "HOUSE": {
    "totalEarningsWei": "100000000000",  // From no-winner matches
    "totalBetsWei": "30000000000",       // House spent on prizes
    "pnlWei": "70000000000",             // Current balance
    "tokenEarnings": {
      "REWARD-cf6eac": "100000000000"    // Earned
    },
    "tokenBets": {
      "REWARD-cf6eac": "30000000000"     // Spent
    },
    "tokenPNL": {
      "REWARD-cf6eac": "70000000000"     // Net balance
    }
  }
}
```

## Implementation

### New Function: `trackHouseSpending()`

Tracks when house pays out prizes for competitions:

```javascript
function trackHouseSpending(guildId, amountWei, tokenTicker) {
  // Subtract from HOUSE balance
  houseData.totalBetsWei += amountWei;
  houseData.tokenBets[tokenTicker] = amountWei;
  
  // Recalculate PNL
  houseData.pnlWei = totalEarningsWei - totalBetsWei;
  houseData.tokenPNL[tokenTicker] = earnings - spending;
}
```

## Usage Scenarios

### Weekly Competition Prize

**Scenario**: Admin awards 50 REWARD tokens to weekly winner

1. Get total pot from `/house-balance`
2. Use `/send-esdt` to send 50 tokens to winner
3. **Track spending**: Call `trackHouseSpending(50 tokens)`
4. New house balance shown in `/house-balance`

### Monthly Grand Prize

**Scenario**: Admin awards 200 REWARD tokens monthly

1. House has accumulated 500 tokens (no winners)
2. Admin awards 200 tokens
3. Track 200 spent
4. New balance: 500 - 200 = 300 tokens

## Commands

### View Current Balance
```bash
/house-balance
```
Shows **current net balance** (earnings - spending)

### Track Spending (Manual)
**Command**: `/house-spend` (needs to be created)

Or manually via code when `/send-esdt` is used with house funds.

## Benefits of This Approach

### ✅ Single File
- No new JSON files needed
- Everything in `leaderboard.json`
- Same structure as user tracking

### ✅ Automatic PNL
- `pnlWei` automatically calculates net balance
- Per-token PNL shows token-specific balance
- Consistent with user tracking

### ✅ Historical Tracking
- Can see total earnings over time
- Can see total spending over time
- Can see net balance

### ✅ Per-Token Support
- Track spending per token
- Multi-token support
- Separate balances

## Data Integrity

### Validation
- **Earnings**: Only from automated no-winner matches
- **Spending**: Manually tracked by admins
- **Balance**: Always equals earnings - spending

### Audit Trail
1. Start: 0 tokens
2. Match 1: No winners → +50 tokens (earnings)
3. Match 2: Winner → -25 tokens (spending)
4. Match 3: No winners → +100 tokens (earnings)
5. Current balance: 125 tokens

## Future Enhancements

### Spending Command
Create `/house-spend` command:
- `amount` - Amount to spend
- `token` - Token to spend
- `reason` - Reason for spending (competition, prize, etc.)
- Automatically tracks in leaderboard

### Spending History
Track individual spending transactions:
- Date
- Amount
- Token
- Reason
- Recipient

### Competition Integration
Automatically track spending:
- Weekly prizes
- Monthly prizes
- Special events
- Leader rewards

