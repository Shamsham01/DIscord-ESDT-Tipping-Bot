# 🏛️ House Balance Tracking

## Overview

House balance tracking records tokens from football betting matches where **no players won** (all bets were wrong). These tokens remain in the community fund wallet and are tracked separately as "house earnings."

## How It Works

### When House Keeps Tokens

- **Scenario**: All players bet on the **wrong outcome** (no winners)
- **Result**: Total pot stays in community fund wallet
- **Tracking**: Automatically tracked in `data/leaderboard.json` under user ID `"HOUSE"`

### Data Storage

**Location**: `data/leaderboard.json`

```json
{
  "GUILD_ID": {
    "HOUSE": {
      "points": 0,
      "wins": 0,
      "totalEarningsWei": "55000000000",
      "totalBetsWei": "0",
      "pnlWei": "55000000000",
      "lastWinISO": null,
      "tokenEarnings": {
        "REWARD-cf6eac": "55000000000"
      },
      "tokenBets": {},
      "tokenPNL": {
        "REWARD-cf6eac": "55000000000"
      },
      "isHouse": true
    }
  }
}
```

## Key Features

### ✅ Automatic Tracking
- Automatically tracks house earnings when matches end with no winners
- Works with any token (multi-token support)
- Stores per-token breakdown
- Accumulates across all matches

### ✅ Admin Command
**New Command**: `/house-balance`

```bash
/house-balance [public:true]
```

**What it does:**
- Shows total house earnings from no-winner matches
- Displays per-token breakdown
- Admin-only access
- Optional public display

### ✅ Excluded from Leaderboards
- HOUSE user is **automatically excluded** from user leaderboards
- Only admins can view house balance
- Prevents regular users from seeing house stats

## Example Scenario

1. **Match**: Arsenal vs Manchester City
2. **Required Bet**: 1.0 REWARD token
3. **Bets Placed**:
   - Player A bets HOME (Arsenal)
   - Player B bets DRAW
   - Player C bets HOME (Arsenal)
4. **Final Score**: Manchester City 2-0 Arsenal (AWAY win)
5. **Result**: No winners (all bets wrong)
6. **House Gains**: 3.0 REWARD tokens tracked in `leaderboard.json`

## Implementation

### Functions Added

#### `trackHouseEarnings(guildId, matchId, totalPotWei, tokenDecimals, tokenTicker)`
- Called automatically when no winners found
- Updates HOUSE entry in leaderboard data
- Tracks per-token earnings
- Calculates PNL

### Code Changes

**File**: `index.js`

1. **Line ~6204**: Added `trackHouseEarnings()` function
2. **Line ~6762**: Call tracking when no winners
3. **Line ~3303**: Filter HOUSE from user leaderboard
4. **Line ~3500**: Added `/house-balance` command handler

**File**: `register-commands.js`

1. **Line ~491**: Registered `/house-balance` command

## Comparison: bets.json vs leaderboard.json

### Why `leaderboard.json`? ✅ **RECOMMENDED**

**Advantages:**
- ✅ **Per-token tracking** - Already structured for multi-token
- ✅ **Guild-based** - Already has guild organization
- ✅ **Consistent with user tracking** - Same data structure
- ✅ **Easy to query** - Simple lookup by "HOUSE" ID
- ✅ **Accumulative** - Tracks totals across all matches
- ✅ **PNL support** - Can calculate profit/loss if needed

**Disadvantages:**
- ⚠️ HOUSE appears in leaderboard data (but filtered from display)

### Why NOT `bets.json`? ❌

**Problems:**
- ❌ **Per-bet structure** - Would need aggregation
- ❌ **No matching IDs** - Not designed for tracking entity balances
- ❌ **Harder to query** - Would need to scan all bets
- ❌ **Complex queries** - Need to find matches with no winners

### Why NOT `matches.json`? ❌

**Problems:**
- ❌ **Match-focused** - Not designed for balance tracking
- ❌ **Clutters match data** - Mixes concerns
- ❌ **Would need aggregation** - Still need to sum up
- ❌ **Less intuitive** - Balance not tied to leaderboard

## Usage

### For Admins

1. **View House Balance**: `/house-balance`
2. **Track Growth**: Run command periodically to monitor
3. **Multi-Token**: See breakdown per token (e.g., REWARD, USDC)

### For All Users

1. **Unaware of HOUSE**: It's excluded from leaderboards
2. **Tracked Automatically**: No user action needed
3. **Persistent**: Survives bot restarts

## Technical Details

### Data Flow

```
Match Ends → No Winners → trackHouseEarnings()
    ↓
Check HOUSE entry exists
    ↓
Add totalPotWei to totalEarningsWei
    ↓
Add to tokenEarnings[tokenTicker]
    ↓
Update tokenPNL[tokenTicker]
    ↓
Save to leaderboard.json
    ↓
Log house earnings
```

### Integration Points

1. **`processMatchPrizes()`**: Calls tracking when no winners
2. **`saveLeaderboardData()`**: Persists to disk
3. **`filter()` in leaderboard**: Excludes HOUSE from display
4. **`house-balance` command**: Displays to admins

## Future Enhancements

### Potential Features

1. **Monthly Reports**: Automatically calculate house earnings per month
2. **Token Breakdown**: Show which matches contributed
3. **Export Data**: CSV export for accounting
4. **House vs Player Ratio**: Compare house earnings vs player winnings
5. **Historical Tracking**: Track house balance over time

## Summary

**Best Data Storage**: `data/leaderboard.json` ✅

**Why**: 
- Structured for balances
- Per-token tracking
- Guild-based organization
- Consistent with user tracking
- Easy to query and display

**Result**: House balance is now automatically tracked when matches have no winners, allowing admins to monitor the house's earnings from unsuccessful bets.

