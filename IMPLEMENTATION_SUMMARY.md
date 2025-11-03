# 📊 House Balance & Spending Implementation Summary

## Answer: You DON'T Need a New JSON File!

We can track **both earnings AND spending** in the **existing `leaderboard.json`** by repurposing fields that HOUSE never uses.

## The Solution

### Repurpose Existing Fields for HOUSE

Since HOUSE never places bets, we can use those fields for tracking:

| Field | Original Meaning | HOUSE Meaning |
|-------|-----------------|---------------|
| `tokenBets` | User's bets | **House spending** |
| `totalBetsWei` | User's total bets | **House total spending** |
| `pnlWei` | Earnings - Bets | **Net balance (Earnings - Spending)** |

### Data Structure

```json
{
  "GUILD_ID": {
    "HOUSE": {
      "totalEarningsWei": "100000000000",  // Earned from no-winners
      "totalBetsWei": "30000000000",       // Spent on prizes
      "pnlWei": "70000000000",             // Current balance
      "tokenEarnings": {
        "REWARD-cf6eac": "100000000000"    // Earned per token
      },
      "tokenBets": {
        "REWARD-cf6eac": "30000000000"     // Spent per token
      },
      "tokenPNL": {
        "REWARD-cf6eac": "70000000000"     // Balance per token
      }
    }
  }
}
```

## Balance Calculation

```
Current Balance = Earnings - Spending
                = tokenEarnings - tokenBets
                = tokenPNL
```

## Implementation

### 1. Automatic Earnings (Already Implemented)
✅ Tracked when no winners: `trackHouseEarnings()`

### 2. Manual Spending (New)
📝 New function: `trackHouseSpending(guildId, amountWei, tokenTicker, reason)`

**Usage Example:**
```javascript
// After awarding 50 tokens from house balance
trackHouseSpending(guildId, '5000000000', 'REWARD-cf6eac', 'weekly_competition');
```

### 3. Display (Enhanced)
✅ `/house-balance` now shows:
- **Current Balance** (earnings - spending)
- Earnings breakdown
- Spending breakdown
- Status indicators (🟢 positive, 🔴 negative)

## Workflow

### Spending House Funds

1. **Check Balance**: `/house-balance`
2. **Award Prizes**: Use `/send-esdt` with community fund
3. **Track Spending**: Call `trackHouseSpending()` with amount
4. **Verify**: Check `/house-balance` again

### Example Scenario

**Week 1:**
- Match 1: No winners → +50 REWARD (earnings)
- Check balance: 50 tokens

**Week 2:**
- Weekly competition prize: Award 30 REWARD
- Track spending: -30 REWARD
- Check balance: 20 tokens (50 - 30)

**Week 3:**
- Match 2: No winners → +100 REWARD (earnings)
- Check balance: 120 tokens (20 + 100)

## No New File Needed!

### Why `leaderboard.json` Works

✅ **Per-token tracking** - Already structured
✅ **Guild-based** - Already has organization
✅ **PNL calculation** - Already computes net balance
✅ **Accumulative** - Tracks totals
✅ **Consistent** - Same structure as user tracking
✅ **Automatic** - PNL updates when spending changes

### Why NOT Create New File?

❌ Would duplicate data structure
❌ Would need to sync with leaderboard
❌ Would complicate queries
❌ Would require extra maintenance

## Usage

### For Admins

**View Balance:**
```bash
/house-balance
```
Shows: Current balance (earnings - spending) per token

**Spend Funds:**
```javascript
// In code after awarding prizes
trackHouseSpending(guildId, amountWei, tokenTicker, 'competition_prize');
```

**Track Weekly:**
1. Create weekly competition with `/create-fixtures`
2. No winners accumulate in house
3. Award weekly winner with house funds
4. Track spending automatically

## Summary

**Best Approach**: Use existing `leaderboard.json` ✅

**Repurpose Fields**:
- `tokenBets` → House spending
- `pnlWei` → Current balance

**Benefits**:
- No new files
- Automatic calculations
- Per-token tracking
- Historical data
- Consistent structure

**Result**: Complete house balance tracking with earnings AND spending in one place! 🎉

## Code Usage Example

### After Awarding Competition Prizes

```javascript
// Example: Awarding weekly winner 50 REWARD tokens from house balance

// 1. User runs /send-esdt to send 50 tokens to winner
// (This uses community fund wallet - tokens are already there)

// 2. Track the spending in code:
const amountWei = new BigNumber(50).multipliedBy(new BigNumber(10).pow(8)).toFixed(0);
trackHouseSpending(guildId, amountWei, 'REWARD-cf6eac', 'weekly_competition');

// 3. Balance automatically updated in leaderboard.json
// Now /house-balance shows new balance

console.log(`[HOUSE] Awarded competition prize: -50 REWARD`);
console.log(`[HOUSE] New balance: ${houseBalance} REWARD`);
```

### Checking Balance Before Awarding

```javascript
// Before awarding, check if house has enough balance
const houseData = footballLeaderboardData[guildId]['HOUSE'];
const balance = new BigNumber(houseData.tokenPNL['REWARD-cf6eac'] || '0')
  .dividedBy(new BigNumber(10).pow(8))
  .toNumber();

if (balance < prizeAmount) {
  console.log(`❌ Insufficient house balance! Need ${prizeAmount}, have ${balance}`);
} else {
  // Safe to award prize
  console.log(`✅ House balance sufficient: ${balance} tokens`);
}
```

## Automatic vs Manual Tracking

### Automatic ✅
- **Earnings** (no winners) → Tracked automatically
- Calls `trackHouseEarnings()` in `processMatchPrizes()`

### Manual 📝  
- **Spending** (prize payouts) → Track manually
- Call `trackHouseSpending()` after awarding prizes
- Reason for logging/audit trail

## Next Steps

1. ✅ Earnings tracking: **Already implemented**
2. ✅ Spending function: **Already created (`trackHouseSpending()`)**  
3. ✅ Spending command: **New `/house-tip` command created**
4. ✅ Balance display: **Enhanced in `/house-balance`**

## New Commands Available

### `/house-balance`
View current house balance (earnings - spending) per token

### `/house-tip`
Tip users from house balance - automatically tracks spending!

**Usage:**
```bash
/house-tip user:@Winner token:REWARD amount:50 memo:Weekly competition
```

**What it does:**
- ✅ Transfers from community fund wallet
- ✅ Validates house has sufficient balance
- ✅ Automatically tracks spending
- ✅ Adds to recipient's virtual account
- ✅ Updates house balance immediately

**Perfect for:** Weekly/monthly competition prizes! 🎉

No new files needed - everything works with existing `leaderboard.json`! 🎉

