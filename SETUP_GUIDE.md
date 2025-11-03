# Multi-Server ESDT Tipping Bot Setup Guide

## Overview

This bot allows multiple Discord servers to use ESDT token transfers with their own project wallets. Each server can register their own projects and manage their own user wallets independently.

## Environment Variables

Create a `.env` file with the following variables:

```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
API_BASE_URL=your_api_base_url
API_TOKEN=your_api_token
```

**Note**: No `GUILD_ID` needed - the bot uses global commands that work across all servers.

## Bot Permissions

Your bot needs these permissions when invited to servers:
- Send Messages
- Use Slash Commands
- Read Message History
- Send Messages in Threads
- Manage Messages (for logging)

## Installation

1. Install dependencies:
```bash
npm install discord.js node-fetch dotenv
```

2. Set up your environment variables in `.env`

3. Register global commands:
```bash
node register-commands.js
```

4. Start the bot:
```bash
node index.js
```

## How It Works

### Server Isolation
- Each Discord server has its own isolated data
- User wallets are stored per server
- Projects are registered per server
- No cross-server data sharing

### Project Registration
Each server can register multiple projects using `/register-project`:
- **Project Name**: Unique identifier for the project
- **Wallet PEM**: The MultiversX wallet private key (PEM format)
- **Supported Tokens**: Comma-separated list of token tickers

### Token Transfers
When an admin uses `/send-esdt`:
1. Bot finds which project supports the requested token
2. Uses that project's wallet to send tokens
3. Logs the transaction and notifies the recipient

## Commands

### For Users
- `/set-wallet [wallet]` - Register your MultiversX wallet address

### For Admins
- `/register-project [project-name] [wallet-pem] [supported-tokens]` - Register a new project
- `/update-project [project-name] [new-project-name] [wallet-pem] [supported-tokens]` - Update project credentials
- `/list-projects [public]` - List all registered projects
- `/delete-project [project-name] [confirm]` - Delete a project (requires "DELETE" confirmation)
- `/send-esdt [project-name] [user-tag] [token-ticker] [amount] [memo]` - Send ESDT tokens to a user
- `/list-wallets [filter] [page] [public]` - List registered wallets

## Data Storage

The bot stores data in `server-data.json` with this structure:
```json
{
  "guild_id_1": {
    "userWallets": {
      "user_id_1": "erd1...",
      "user_id_2": "erd1..."
    },
    "projects": {
      "project_name_1": {
        "walletPem": "-----BEGIN PRIVATE KEY-----...",
        "supportedTokens": ["REWARD-cf6eac", "HODL-b8bd81"],
        "registeredBy": "admin_user_id",
        "registeredAt": 1234567890
      }
    },
    "createdAt": 1234567890
  }
}
```

## Security Considerations

1. **PEM Storage**: Project wallet PEMs are stored in the JSON file. Consider encrypting this data for production use.

2. **Admin Permissions**: Only server administrators can register projects and send tokens.

3. **API Security**: Your API should validate requests and implement rate limiting.

4. **Backup**: The bot creates backups when updating wallet data.

## Multi-Server Benefits

- **Independent Projects**: Each server can have its own projects and tokens
- **Isolated Data**: No cross-contamination between servers
- **Scalable**: Add as many servers as needed
- **Flexible**: Each server can support different token types

## API Requirements

Your API endpoint should accept POST requests to `/execute/esdtTransfer` with:
```json
{
  "recipient": "erd1...",
  "amount": 100,
  "tokenTicker": "REWARD-cf6eac",
  "walletPem": "-----BEGIN PRIVATE KEY-----..."
}
```

And return:
```json
{
  "success": true,
  "txHash": "transaction_hash_here"
}
```

## Troubleshooting

1. **Commands not appearing**: Run `node register-commands.js` again
2. **Transfer failures**: Check API logs and wallet PEM format
3. **User not found**: Ensure user has registered wallet with `/set-wallet`
4. **Token not supported**: Register a project that supports the token

## Inviting to New Servers

1. Generate invite link with proper permissions
2. Server admin registers projects using `/register-project`
3. Users register wallets using `/set-wallet`
4. Admins can start sending tokens with `/send-esdt` 