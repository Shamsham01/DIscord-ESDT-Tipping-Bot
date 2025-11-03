# 🎉 New Features: PNL Tracking & Filtered Leaderboards

## Overview
Two major features have been added to enhance the football betting experience: private stats viewing and flexible leaderboard filtering for competitive betting competitions.

---

## ✨ Feature 1: Private Stats `/my-stats`

### What Changed
The `/my-stats` command now supports a **privacy option** to keep your betting statistics private.

### Usage
```
/my-stats              → Private (only you can see)
/my-stats public:true  → Public (everyone can see)
/my-stats public:false → Private (explicitly)
```

### Benefits
✅ **Privacy Control**: Choose who sees your stats
✅ **Default Private**: Stats are private by default for user privacy
✅ **Flexible Display**: Share your stats when you want to

### Example Output

**Private Mode (Ephemeral)**:
```
📊 Your Football Betting Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Only visible to you]

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

---

## ✨ Feature 2: Filtered Leaderboard `/leaderboard-filtered`

### What It Does
Create **time-based competitive leaderboards** for weekly/monthly betting competitions!

### Usage
```
# Weekly competition (US format)
/leaderboard-filtered start-date:2025-01-01 end-date:2025-01-07

# Monthly competition (EU format)
/leaderboard-filtered start-date:01-01-2025 end-date:31-01-2025

# Premier League only (EU format)
/leaderboard-filtered start-date:01-01-2025 end-date:31-01-2025 competition:PL

# Champions League only (US format)
/leaderboard-filtered start-date:2025-01-01 end-date:2025-01-31 competition:CL public:true
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `start-date` | ✅ Yes | Start date in YYYY-MM-DD format |
| `end-date` | ✅ Yes | End date in YYYY-MM-DD format |
| `competition` | ❌ No | Competition code (PL, CL, ELC, etc.) |
| `public` | ❌ No | Show leaderboard publicly (default: private) |

### Features
✅ **Date Range Filtering**: Show stats for any time period
✅ **Competition Filtering**: Filter by specific leagues
✅ **PNL Tracking**: Shows profit/loss for filtered period
✅ **Points & Wins**: Separate leaderboard stats
✅ **Autocomplete**: Competition codes with descriptions
✅ **Privacy Control**: Choose private or public display

### Example Output

```
🏆 Filtered Leaderboard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Top 20 players from 2025-01-01 to 2025-01-31 in CL

🥇 User123
Points: 30 | Wins: 10 | Bets: 15
PNL: 🟢 +850.00 REWARD-cf6eac

🥈 User456
Points: 27 | Wins: 9 | Bets: 14
PNL: 🟢 +720.00 REWARD-cf6eac

🥉 User789
Points: 24 | Wins: 8 | Bets: 12
PNL: 🔴 -45.00 REWARD-cf6eac
```

---

## 🎯 Use Cases

### Weekly Competitions
Run weekly betting competitions with prizes:
```
Week 1: /leaderboard-filtered start-date:2025-01-06 end-date:2025-01-12
Week 2: /leaderboard-filtered start-date:2025-01-13 end-date:2025-01-19
Week 3: /leaderboard-filtered start-date:2025-01-20 end-date:2025-01-26
```

### Monthly Tournaments
Track monthly performance:
```
January: /leaderboard-filtered start-date:2025-01-01 end-date:2025-01-31
February: /leaderboard-filtered start-date:2025-02-01 end-date:2025-02-28
```

### Competition-Specific Events
Focus on specific leagues:
```
Premier League Week: /leaderboard-filtered start-date:2025-01-13 end-date:2025-01-20 competition:PL
Champions League: /leaderboard-filtered start-date:2025-01-01 end-date:2025-01-31 competition:CL
```

---

## 📊 How It Works

### Date Range Filtering
1. **Collects bets** from the specified date range
2. **Filters by competition** (if specified)
3. **Calculates stats** only for filtered bets:
   - Points from wins in that period
   - Wins count in that period
   - Bet amounts in that period
   - Prize earnings in that period
   - PNL (profit/loss) for that period

### Competition Filtering
- **Optional**: Filter by competition code
- **Supported**: PL, CL, ELC, EL, BL1, PD, SA, FL1, MLS
- **Autocomplete**: Available when typing competition code

---

## 🎁 Benefits for Server Owners

### Run Competitive Events
- **Weekly Challenges**: Quick competitions
- **Monthly Tournaments**: Longer competitions
- **League-Specific**: Focus on specific competitions

### Flexible Scoring
- **Points**: 3 per win (in filtered period)
- **PNL Tracking**: Profit/loss calculation
- **Win Rate**: Percentage calculation

### Privacy Options
- **Private**: Keep stats private
- **Public**: Share with community
- **Flexible**: Choose per command

---

## 🚀 Setup Instructions

### 1. Register Commands
```bash
node register-commands.js
```

### 2. Test Features
```bash
# Test private stats
/my-stats public:false

# Test filtered leaderboard
/leaderboard-filtered start-date:2025-01-01 end-date:2025-01-31
```

### 3. Announce to Community
Create an announcement for weekly/monthly competitions!

---

## 📝 Notes

### Date Format
- **US Format**: `YYYY-MM-DD` (e.g., `2025-01-15`)
- **EU Format**: `DD-MM-YYYY` (e.g., `15-01-2025`)
- **Validation**: Invalid dates will error

### Competition Codes
- **PL**: Premier League
- **CL**: UEFA Champions League
- **ELC**: Championship
- **EL**: UEFA Europa League
- **BL1**: Bundesliga
- **PD**: La Liga
- **SA**: Serie A
- **FL1**: Ligue 1
- **MLS**: Major League Soccer

### PNL Calculation
```
PNL = Total Earnings - Total Bets

Example:
Bets placed in period: 500 tokens
Winnings in period: 800 tokens
PNL = +300 tokens 🟢
```

---

## 🔧 Future Enhancements

Potential additions:
- Automatic weekly/monthly competitions
- Prize distribution for winners
- Historical performance graphs
- Best/worst performing dates
- Export filtered data to CSV

---

**Version**: 2.0
**Status**: ✅ Implemented
**Last Updated**: 2025-01-XX

