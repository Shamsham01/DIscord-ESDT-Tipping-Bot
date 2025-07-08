# Multi-Server ESDT Tipping Bot

A Discord bot that enables ESDT token transfers across multiple Discord servers. Each server can register their own MultiversX projects and manage independent token transfers.

## Features

- 🏦 **Multi-Server Support**: Works across multiple Discord servers
- 🔐 **Project Isolation**: Each server can have its own projects and wallets
- 💰 **ESDT Transfers**: Send various ESDT tokens to users
- 👥 **User Management**: Register and manage user wallets per server
- 📊 **Admin Tools**: List wallets, manage projects, and track transfers
- 🔔 **Notifications**: DM notifications for token recipients

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

### For Admins
- `/register-project [project-name] [wallet-pem] [supported-tokens]` - Register a new project
- `/send-esdt [user-tag] [token-ticker] [amount] [memo]` - Send ESDT tokens to a user
- `/list-wallets [filter] [page] [public]` - List registered wallets

## Project Structure

```
├── index.js                 # Main bot file
├── register-commands.js     # Command registration
├── server-data.json        # Server data storage (auto-generated)
├── package.json            # Dependencies and scripts
├── env.example            # Environment variables template
├── SETUP_GUIDE.md         # Detailed setup guide
└── README.md              # This file
```

## How It Works

1. **Server Admin** registers projects using `/register-project`
2. **Users** register wallets using `/set-wallet`
3. **Admin** sends tokens using `/send-esdt`
4. **Bot** automatically selects the appropriate project wallet and sends tokens

## Data Storage

All data is stored in `server-data.json` with server isolation:
- User wallets are stored per server
- Projects are registered per server
- No cross-server data sharing

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
