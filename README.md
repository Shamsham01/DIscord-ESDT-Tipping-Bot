# Multi-Server ESDT Tipping Bot

A Discord bot that enables ESDT token transfers across multiple Discord servers. Each server can register their own MultiversX projects and manage independent token transfers. Includes Rock Paper Scissors games and Football Betting game with virtual accounts.

## Features

- 🏦 **Multi-Server Support**: Works across multiple Discord servers with complete data isolation
- 🔐 **Project Isolation**: Each server can have its own projects and wallets
- 💰 **ESDT Transfers**: Send various ESDT tokens to users
- 👥 **User Management**: Register and manage user wallets per server
- 📊 **Admin Tools**: List wallets, manage projects, and track transfers
- 🔔 **Notifications**: DM notifications for token recipients
- 🎮 **Rock, Paper, Scissors Game**: Challenge users with ESDT token prizes
- ⚽ **Football Betting Game**: Bet on football matches with virtual accounts
- 💳 **Virtual Accounts**: Automatic balance tracking from Community Fund transfers
- 📈 **PNL Tracking**: Profit & Loss tracking for football betting
- 🏛️ **House Balance**: Track earnings from matches with no winners
- 📱 **QR Code Integration**: Community fund wallet QR codes displayed in game embeds
- 🎯 **Modal Interface**: User-friendly modal for joining RPS challenges

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `env.example` to `.env` and fill in your values:
```bash
cp env.example .env
```

Required environment variables:
- `TOKEN`: Your Discord bot token
- `CLIENT_ID`: Your Discord application client ID
- `API_BASE_URL`: Your MultiversX ESDT transfer API endpoint
- `API_TOKEN`: Your API authentication token
- `FD_TOKEN`: (Optional) Football-data.org API token for football betting features

### 3. Register Commands
```bash
npm run register-commands
```

### 4. Start the Bot
```bash
npm start
```

## Commands

### For Users
- `/set-wallet [wallet]` - Register your MultiversX wallet address
- `/check-balance` - View your virtual account balance
- `/balance-history` - View your transaction history
- `/tip-virtual [user] [token] [amount]` - Tip another user with virtual balance
- `/withdraw [token] [amount]` - Withdraw funds to your wallet
- `/challenge-rps [user-tag] [transaction-hash] [memo]` - Challenge a user to Rock, Paper, Scissors
- `/join-rps [challenge-id] [transaction-hash]` - Join an RPS challenge
- `/play-rps [challenge-id] [choice]` - Play your move in an active RPS game
- `/list-rps-challenges [public]` - List active RPS challenges
- `/bet-virtual [match-id] [outcome]` - Place a bet on a football match
- `/current-bets [public]` - View active betting matches
- `/leaderboard [public]` - View betting leaderboard
- `/leaderboard-filtered [start-date] [end-date] [competition] [public]` - View filtered leaderboard
- `/my-stats [public]` - View your betting statistics & PNL

### For Admins
- `/register-project [project-name] [wallet-pem] [supported-tokens]` - Register a new project
- `/update-project [project-name] [new-project-name] [wallet-pem] [supported-tokens]` - Update project credentials
- `/list-projects [public]` - List all registered projects
- `/delete-project [project-name] [confirm]` - Delete a project (requires "DELETE" confirmation)
- `/send-esdt [project-name] [user-tag] [token-ticker] [amount] [memo]` - Send ESDT tokens to a user
- `/set-community-fund [project-name]` - Set community fund project
- `/show-community-fund-address` - View community fund address
- `/list-wallets [filter] [page] [public]` - List registered wallets
- `/create-fixtures [competition] [token] [amount] [channel]` - Create football matches for betting
- `/leaderboard-reset [confirm]` - Reset the leaderboard
- `/house-balance [public]` - View house balance (no-winner matches)
- `/house-tip [user] [token] [amount] [memo]` - Tip from house balance

## Project Structure

```
├── index.js                      # Main bot file
├── register-commands.js          # Command registration
├── virtual-accounts.js           # Virtual account management
├── blockchain-listener.js        # Blockchain transaction listener
├── package.json                  # Dependencies and scripts
├── SETUP_GUIDE.md               # Detailed setup guide
├── FOOTBALL_GAME_README.md      # Football betting documentation
├── VIRTUAL_ACCOUNTS_README.md   # Virtual accounts documentation
└── README.md                     # This file

# Data files (auto-generated, excluded from git)
├── server-data.json              # Server configurations
├── virtual-accounts.json         # Virtual account balances
├── rps-games.json                # RPS game data
├── data/
│   ├── bets.json                # Football bets data
│   ├── matches.json             # Football matches data
│   └── leaderboard.json         # Leaderboard data
```

## How It Works

1. **Server Admin** registers projects using `/register-project`
2. **Users** register wallets using `/set-wallet`
3. **Admin** sends tokens using `/send-esdt`
4. **Bot** automatically selects the appropriate project wallet and sends tokens

## Rock, Paper, Scissors Game

The bot includes a complete Rock, Paper, Scissors game with ESDT token prizes:

1. **Challenge Creation**: User challenges another user with `/challenge-rps`, providing a transaction hash of their payment to the Community Fund
2. **Challenge Joining**: The challenged user can join via:
   - **Modal Interface**: Click the "Join Challenge" button on the challenge embed for a user-friendly form
   - **Slash Command**: Use `/join-rps` with challenge ID and transaction hash (legacy method)
3. **Game Play**: Both players use `/play-rps` to make their moves (rock, paper, or scissors)
4. **Prize Distribution**: The winner receives the total prize (both players' contributions)
5. **Draw Handling**: If it's a draw, the game continues with additional rounds until there's a winner
6. **Timeout**: Challenges expire after 30 minutes if not joined

## Data Storage

All data is stored with complete server isolation:
- **server-data.json**: Server configurations, projects, user wallets
- **virtual-accounts.json**: Virtual account balances per server
- **data/bets.json**: Football bets per server
- **data/matches.json**: Football matches (shared metadata, per-server stakes)
- **data/leaderboard.json**: Leaderboard and PNL data per server
- **rps-games.json**: RPS game data per server

Each server's data is completely isolated - no cross-server data sharing.

## Security

- Only server administrators can register projects and send tokens
- PEM files are stored in the JSON file (consider encryption for production)
- API requests are validated and logged
- Backup files are created when updating data

## API Requirements

Your API should accept POST requests to `/execute/esdtTransfer` with:
```json
{
  "recipient": "erd1...",
  "amount": 100,
  "tokenTicker": "REWARD-cf6eac",
  "walletPem": "-----BEGIN PRIVATE KEY-----..."
}
```

## Development

For development with auto-restart:
```bash
npm run dev
```

## License

MIT License - see LICENSE file for details.

## Support

For detailed setup instructions, see [SETUP_GUIDE.md](SETUP_GUIDE.md). 