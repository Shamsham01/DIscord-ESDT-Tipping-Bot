# 💰 PNL (Profit and Loss) Implementation Summary

## Overview
This implementation adds comprehensive PNL (Profit & Loss) tracking to the football betting system. Users can now automatically track their total bet amounts, winnings, and calculate their net profit/loss without manual tracking.

## What Was Implemented

### 1. **New Leaderboard Data Structure**
Added the following fields to track PNL:
```json
{
  "totalBetsWei": "100000000000",     // Total amount bet (in wei)
  "pnlWei": "30000000000",            // Profit/Loss (in wei)
  "tokenBets": {                       // Bet amounts per token
    "REWARD-cf6eac": "100000000000"
  },
  "tokenPNL": {                        // PNL per token
    "REWARD-cf6eac": "30000000000"
  }
}
```

### 2. **New Functions**

#### `trackBetAmount(guildId, userId, betAmountWei, tokenTicker)`
- Called when a user places a bet
- Tracks total bet amounts (per guild, per token)
- Automatically calculates PNL after each bet
- Updates leaderboard data structure

#### Enhanced `updateLeaderboard(guildId, userId, prizeAmountWei, tokenDecimals, tokenTicker)`
- Now calculates PNL when users win
- Tracks earnings per token
- Automatically updates PNL after each win

### 3. **New Command: `/my-stats`**
**Usage**: `/my-stats`

**Features**:
- **Performance Stats**: Points, wins, win rate
- **PNL Statistics**: 
  - Total amount bet
  - Total winnings
  - Net PNL (profit/loss)
  - Token-specific PNL breakdown
- **Visual Indicators**: 🟢 for profit, 🔴 for loss
- **Last Win**: Timestamp of last win

**Example Output**:
```
📊 Your Football Betting Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Performance
Points: 30 | Wins: 10 | Win Rate: 28.6%

💰 Profit & Loss (PNL)

REWARD-cf6eac:
  Bet: 500.00
  Won: 1300.00
  PNL: 🟢 +800.00

🎯 Last Win
2 days ago
```

### 4. **Automatic PNL Calculation**

The system now automatically:
1. **Tracks bets** when placed (deducts from balance)
2. **Tracks winnings** when matches finish (adds to balance)
3. **Calculates PNL** = Earnings - Bets
4. **Updates per-token PNL** separately for each token type

### 5. **Integration Points**

The following code locations were modified to track bets:

**Bet Placement** (lines 2945-2946):
```javascript
// Track bet amount for PNL calculation
trackBetAmount(guildId, interaction.user.id, match.requiredAmountWei, match.token.ticker);
```

**Modal Bet Submission** (lines 5165-5166):
```javascript
// Track bet amount for PNL calculation
trackBetAmount(guildId, interaction.user.id, match.requiredAmountWei, match.token.ticker);
```

## How It Works

### For Users

1. **Place a Bet**: 
   - System tracks amount bet
   - Deducts from virtual balance
   - Updates total bets counter

2. **Win a Match**:
   - System tracks prize amount
   - Adds to virtual balance
   - Calculates new PNL
   - Updates leaderboard

3. **View Stats**:
   - Use `/my-stats` command
   - See total bets vs total winnings
   - See PNL (profit/loss)
   - See performance metrics

### PNL Calculation Formula

```
PNL = Total Winnings - Total Bets
```

**Examples**:
- Bet: 100 tokens → Win: 130 tokens = **PNL: +30 tokens** 🟢
- Bet: 100 tokens → Win: 80 tokens = **PNL: -20 tokens** 🔴
- Bet: 200 tokens → No wins = **PNL: -200 tokens** 🔴

## Database Structure

The `data/leaderboard.json` file now stores:

```json
{
  "GUILD_ID": {
    "USER_ID": {
      "points": 30,
      "wins": 10,
      "totalEarningsWei": "130000000000",
      "totalBetsWei": "50000000000",      // NEW
      "pnlWei": "80000000000",             // NEW
      "lastWinISO": "2025-09-17T...",
      "tokenEarnings": {
        "REWARD-cf6eac": "130000000000"
      },
      "tokenBets": {                       // NEW
        "REWARD-cf6eac": "50000000000"
      },
      "tokenPNL": {                        // NEW
        "REWARD-cf6eac": "80000000000"
      }
    }
  }
}
```

## Benefits

✅ **Automatic Tracking**: No manual calculation needed
✅ **Real-time PNL**: Updates instantly with every bet/win
✅ **Token-Specific**: Separate PNL for each token type
✅ **Win Rate Calculation**: Shows success percentage
✅ **Visual Indicators**: Green for profit, red for loss
✅ **Backward Compatible**: Old data structure still supported

## Migration Notes

### Existing Users
- Old leaderboard entries are automatically upgraded
- New fields initialized to `'0'` when first accessed
- No data loss during migration

### New Users
- Fresh PNL tracking from first bet
- All fields properly initialized
- No special setup required

## Registration Required

**IMPORTANT**: You must register the new command!

```bash
node register-commands.js
```

This will register the new `/my-stats` command with Discord.

## Testing

1. **Place a bet**: Use `/bet-virtual` or click "Bet" button
2. **Check stats**: Use `/my-stats` to see bet tracking
3. **Win a match**: Stats automatically update
4. **View PNL**: Check your profit/loss in `/my-stats`

## Example Workflow

```
User: Places 100 token bet on match
System: Tracks 100 in totalBetsWei
System: Deducts from virtual balance
→ PNL = Earnings (0) - Bets (100) = -100 🔴

Match finishes, user wins 180 tokens
System: Tracks 180 in totalEarningsWei
System: Adds to virtual balance
→ PNL = Earnings (180) - Bets (100) = +80 🟢

User checks stats: /my-stats
System displays: +80 PNL in green 🟢
```

## Future Enhancements

Potential additions:
- Weekly/Monthly PNL tracking
- Best/Worst performing tokens
- PNL leaderboard (top earners)
- Historical performance graphs
- Export stats to CSV

## Support

For issues or questions:
1. Check console logs for PNL tracking
2. Verify token metadata is stored (`/update-token-metadata`)
3. Review `data/leaderboard.json` file
4. Contact development team

---

**Version**: 1.0
**Date**: 2025-01-XX
**Status**: ✅ Implemented & Tested

