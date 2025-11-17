---
description: Complete reference of all admin commands for managing the ESDT Tipping Bot
---

# Admin Commands Reference

Complete reference of all admin commands for managing the bot.

## Project Management

### `/register-project`
Register a new project with auto-generated wallet.

**Usage**: `/register-project project-name supported-tokens [project-logo-url] [user-input]`

**Parameters**:
- `project-name` (Required): Unique name for the project
- `supported-tokens` (Required): Comma-separated list of token tickers
- `project-logo-url` (Optional): URL to project logo image
- `user-input` (Optional): Additional notes

**Example**:
```
/register-project MainWallet REWARD-cf6eac,EGLD https://logo.png
```

**Note**: The bot automatically generates a new MultiversX wallet for your project. Wallet details (address, seed phrase, PEM file) will be displayed in the command response and sent to you via DM. Make sure to save the PEM file and seed phrase securely. You must top up the wallet with EGLD (for fees) and REWARD tokens (for usage fees) before using it.

### `/update-project`
Update project settings.

**Usage**: `/update-project project-name [new-project-name] [wallet-address] [wallet-pem] [supported-tokens] [project-logo-url] [qr-code-url] [user-input]`

**Examples**:
```
/update-project MainWallet project-logo-url:https://new-logo.png
/update-project Community Fund qr-code-url:https://new-qr.png
/update-project MainWallet supported-tokens:REWARD-cf6eac,EGLD,USDC
```

### `/list-projects`
List all registered projects.

**Usage**: `/list-projects [public]`

### `/delete-project`
Delete a project (requires "DELETE" confirmation).

**Usage**: `/delete-project project-name confirm:DELETE`

**⚠️ Warning**: This action cannot be undone!

### `/set-community-fund`
Create and set Community Fund (auto-generated wallet).

**Usage**: `/set-community-fund fund-name supported-tokens [qr-code-url]`

**Example**:
```
/set-community-fund MainFund REWARD-cf6eac,EGLD https://qr-code.png
```

---

## Token & NFT Management

### `/send-esdt`
Send ESDT tokens to a user.

**Usage**: `/send-esdt project-name user-tag token-ticker amount [memo]`

**Example**:
```
/send-esdt MainWallet @user REWARD-cf6eac 100 "Welcome bonus"
```

### `/send-nft`
Send NFT to a user.

**Usage**: `/send-nft project-name collection nft-name user-tag [memo]`

**Example**:
```
/send-nft MainWallet COLLECTION-abc123 NFT-NAME @user "Airdrop"
```

### `/house-tip`
Tip user from House Balance.

**Usage**: `/house-tip user token amount source [memo]`

**Parameters**:
- `user`: Discord user to tip
- `token`: Token ticker
- `amount`: Amount to send
- `source`: Which house to use (`betting`, `auction`, or `lottery`)
- `memo` (Optional): Note about the tip

**Example**:
```
/house-tip @user REWARD-cf6eac 500 betting "Reward for participation"
```

### `/update-token-metadata`
Update token information.

**Usage**: `/update-token-metadata token-ticker name decimals`

**Example**:
```
/update-token-metadata REWARD-cf6eac REWARD 18
```

---

## Activity Management

### `/create-lottery`
Create a new lottery game.

**Usage**: `/create-lottery winning-numbers total-numbers token ticket-price drawing-frequency [house-commission] [channel] [initial-prize-pool]`

**Parameters**:
- `winning-numbers`: Number of numbers to match (e.g., `3`)
- `total-numbers`: Total pool of numbers (e.g., `50`)
- `token`: Token ticker for tickets
- `ticket-price`: Price per ticket
- `drawing-frequency`: `daily`, `weekly`, or `manual`
- `house-commission` (Optional): House commission percentage
- `channel` (Optional): Channel to post lottery
- `initial-prize-pool` (Optional): Starting prize pool from Lottery House

**Example**:
```
/create-lottery 3 50 REWARD-cf6eac 10 daily 5 #lottery 1000
```

### `/create-fixtures`
Create football matches for betting.

**Usage**: `/create-fixtures competition token amount [channel]`

**Parameters**:
- `competition`: Competition code (e.g., `PL` for Premier League)
- `token`: Token ticker for bets
- `amount`: Bet amount per match
- `channel` (Optional): Channel to post matches

**Example**:
```
/create-fixtures PL REWARD-cf6eac 100 #betting
```

### `/create-auction`
Create an NFT auction.

**Usage**: `/create-auction collection nft-name starting-amount duration [token] [min-bid-increase] [title] [description]`

**Parameters**:
- `collection`: NFT collection identifier
- `nft-name`: Specific NFT name
- `starting-amount`: Starting bid amount
- `duration`: Auction duration in hours
- `token` (Optional): Token for bidding
- `min-bid-increase` (Optional): Minimum bid increase
- `title` (Optional): Auction title
- `description` (Optional): Auction description

**Example**:
```
/create-auction COLLECTION-abc123 NFT-NAME 100 24 REWARD-cf6eac 10
```

---

## Monitoring & Debugging

### `/server-balances`
View server-wide virtual account summary.

**Usage**: `/server-balances [public]`

Shows:
- Total virtual account balances
- House balance
- Community Fund balance
- Token breakdowns

### `/house-balance`
View House Balance (earnings, spending, PNL).

**Usage**: `/house-balance [public]`

Shows:
- **Betting House**: Earnings, Spending, PNL
- **Auction House**: Earnings, Spending, PNL
- **Lottery House**: Earnings, Spending, PNL

### `/blockchain-status`
Check blockchain listener status.

**Usage**: `/blockchain-status`

Shows:
- Listener status (running/stopped)
- Number of monitored wallets
- Polling interval
- Processed transaction count

### `/list-wallets`
List registered wallets.

**Usage**: `/list-wallets [filter] [page] [public]`

**Parameters**:
- `filter` (Optional): Filter by username or wallet address
- `page` (Optional): Page number for pagination
- `public` (Optional): Show publicly or privately

### `/check-community-fund-balance`
Check Community Fund balances for withdrawals.

**Usage**: `/check-community-fund-balance [transfers]`

**Parameters**:
- `transfers` (Optional): Number of transfers to check (default: 1)

Shows:
- EGLD balance
- REWARD balance
- Required amounts for withdrawals
- Balance breakdown

### `/update-usernames`
Update Discord usernames for all virtual accounts.

**Usage**: `/update-usernames`

Updates usernames in the database to match current Discord usernames.

### `/test-football-api`
Test Football-Data.org API connectivity.

**Usage**: `/test-football-api`

Verifies that the Football-Data.org API is accessible and working.

### `/debug-server-config`
Debug server configuration.

**Usage**: `/debug-server-config`

Shows detailed server configuration information for troubleshooting.

### `/debug-user`
Debug user information.

**Usage**: `/debug-user user`

Shows detailed information about a specific user for troubleshooting.

### `/leaderboard-reset`
Reset betting leaderboard (requires "DELETE" confirmation).

**Usage**: `/leaderboard-reset confirm:DELETE`

**⚠️ Warning**: This resets all betting statistics!

### `/delete-all-server-data`
Delete ALL server data and perform mass refund (requires "DELETE ALL DATA" confirmation).

**Usage**: `/delete-all-server-data confirm:"DELETE ALL DATA"`

**⚠️ WARNING**: This is a destructive operation that cannot be undone! It will:
- Delete all projects
- Delete all user wallets
- Delete all virtual accounts
- Delete all game data
- Delete all activity data
- Perform mass refunds (if possible)

---

## Utility Commands

### `/show-community-fund-address`
Display the Community Fund wallet address and QR code.

**Usage**: `/show-community-fund-address [public]`

Shows:
- Community Fund wallet address
- QR code (if available)
- Supported tokens

### `/get-competition`
View last used competition code.

**Usage**: `/get-competition`

Useful for remembering which competition code was used for football betting.

---

## Command Permissions

All admin commands require **Administrator** permissions in the Discord server.

If you don't have administrator permissions, contact your server admins.

---

## Best Practices

### Project Management

- Use separate wallets for different purposes
- Keep project logos and QR codes updated
- Regularly review and update supported tokens
- Monitor project balances

### Activity Management

- Set reasonable bet amounts and ticket prices
- Monitor House Balance regularly
- Use House Balance to seed initial prize pools
- Track activity performance

### Monitoring

- Check blockchain listener status regularly
- Monitor server balances
- Review House Balance PNL
- Keep usernames updated

### Security

- Never share PEM files
- Use new wallets for the bot
- Keep minimal tokens in bot wallets
- Regularly review registered wallets

---

For more detailed information on specific commands, refer to the relevant sections in the documentation.

