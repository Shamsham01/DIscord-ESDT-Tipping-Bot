---
description: Complete guide for admins to set up and configure the ESDT Tipping Bot
---

# Admin Setup Guide

This comprehensive guide will walk you through setting up the ESDT Tipping Bot for your Discord server.

## Channel Permissions

Before you start, ensure the bot has the following permissions in the channels where it will operate.

### Required Permissions

1. **View Channel** - Bot needs to see the channel
2. **Send Messages** - Bot needs to send messages and embeds
3. **Embed Links** - Bot needs to create rich embeds for games and activities
4. **Create Public Threads** - Required for football betting matches (bot creates threads for each match)
5. **Send Messages in Threads** - Bot needs to post in threads
6. **Read Message History** - Bot needs to read previous messages
7. **Use External Emojis** - For better visual presentation

### How to Set Permissions

#### Option 1: Server-Wide Permissions (Recommended)

1. Go to **Server Settings** → **Roles**
2. Find the bot's role (or create one)
3. Enable these permissions:
   - ✅ View Channel
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Read Message History
   - ✅ Use External Emojis
   - ✅ Create Public Threads
   - ✅ Send Messages in Threads

#### Option 2: Channel-Specific Permissions

1. Right-click on the channel → **Edit Channel**
2. Go to **Permissions** tab
3. Add the bot's role or user
4. Enable the same permissions listed above

### Verification

Test permissions by running:
```
/help
```

If the bot responds with an embed, permissions are correctly set.

---

## Creating Your First Project

A **project** represents a wallet that can send tokens and NFTs to users. You can have multiple projects per server.

### Step 1: Register the Project

Use the `/register-project` command to create a new project with an **auto-generated wallet**:

```
/register-project project-name supported-tokens [project-logo-url] [user-input]
```

#### Parameters Explained

- **`project-name`** (Required): A unique name for your project (e.g., "Main Wallet", "Gaming Fund")
- **`supported-tokens`** (Required): Comma-separated list of token tickers (e.g., `REWARD-cf6eac,EGLD,USDC`)
- **`project-logo-url`** (Optional): URL to your project logo image (will be used in notifications and embeds)
- **`user-input`** (Optional): Additional notes or description for the project

#### Example

```
/register-project MainWallet REWARD-cf6eac,EGLD https://example.com/logo.png "Main community wallet"
```

**Note**: The bot will automatically generate a new MultiversX wallet for your project. You don't need to provide a wallet address or PEM file.

### Step 2: Save Your Wallet Information

After registering the project, the bot will:

1. **Display wallet details in the command response** (embed) including:
   - Wallet address
   - Seed phrase (24 words)
   - PEM file content
2. **Send you a DM** with the same information plus a downloadable PEM file (if possible)

**⚠️ Important**: 
- **Save the PEM file** to a secure location (copy/paste into a text editor and save as `WalletKey.pem`)
- **Save the Seed Phrase** - you can use it to log in to xPortal or Extension wallet
- **Keep this information secure** - you have full control of this wallet

### Step 3: Top Up Your Wallet

**Before using the wallet, you must top it up with:**

- **EGLD** - Required for blockchain transaction fees
- **REWARD tokens** - Required for MakeX API usage fees ($0.03 per transaction)

Without these, the bot cannot send tokens or NFTs from this wallet.

### Step 4: Verify Project Registration

Check that your project was created:

```
/list-projects
```

You should see your project listed with its wallet address and supported tokens.

---

## Setting Up Community Fund

The **Community Fund** is a special project wallet that:
- Receives deposits from users (for virtual account top-ups)
- Powers P2P tips and games
- Is used for Rock Paper Scissors challenges
- Can be used for football betting

### Step 1: Create Community Fund

Use the `/set-community-fund` command:

```
/set-community-fund fund-name supported-tokens [qr-code-url]
```

#### Parameters Explained

- **`fund-name`** (Required): Name for your Community Fund (e.g., "Main Fund", "Gaming Fund")
- **`supported-tokens`** (Required): Comma-separated list of supported tokens (e.g., `REWARD-cf6eac,EGLD`)
- **`qr-code-url`** (Optional): URL to a QR code image of the Community Fund wallet address

#### Example

```
/set-community-fund MainFund REWARD-cf6eac,EGLD https://example.com/qr-code.png
```

**Note**: The Community Fund wallet is **auto-generated** by the bot. You don't need to provide a PEM file - the bot creates and manages this wallet automatically.

### Step 2: Get Community Fund Address

After creating the Community Fund, get its address:

```
/show-community-fund-address
```

This will display:
- The wallet address (users need this to top up)
- QR code (if you provided a URL)
- Supported tokens

**Share this address with your users** so they can transfer tokens to top up their virtual accounts.

### Step 3: Verify Setup

Check blockchain listener status:

```
/blockchain-status
```

This shows:
- ✅ Listener is running
- Number of monitored wallets
- Polling interval (10 seconds)
- Processed transaction count

---

## Updating Project Settings

You can update project details at any time using `/update-project`.

### Updating Project Logo

To add or update a project logo (for non-Community Fund projects):

```
/update-project project-name project-logo-url:https://example.com/new-logo.png
```

**Note**: Project logos are stored in the `projects` table and used in:
- DM notifications when sending tokens
- Embed footers
- Project listings

### Updating Community Fund QR Code

To add or update the Community Fund QR code:

```
/update-project Community Fund qr-code-url:https://example.com/new-qr.png
```

**Note**: 
- QR code URLs are stored in the `community_fund_qr` table
- Only the Community Fund project can have a QR code URL
- QR codes are displayed in:
  - Game embeds (RPS, Football Betting)
  - Wallet registration confirmations
  - Community Fund address displays

### Updating Other Project Fields

You can update multiple fields at once:

```
/update-project project-name new-project-name:NewName wallet-address:erd1... supported-tokens:REWARD,EGLD project-logo-url:https://...
```

#### Available Update Options

- **`new-project-name`**: Change the project name
- **`wallet-address`**: Update wallet address
- **`wallet-pem`**: Update PEM file content
- **`supported-tokens`**: Update supported tokens list
- **`project-logo-url`**: Update project logo (non-Community Fund only)
- **`qr-code-url`**: Update QR code (Community Fund only)
- **`user-input`**: Update project notes/description

### Important Notes

1. **Project Logo vs QR Code**:
   - **Project Logo** (`project-logo-url`): For regular projects, used in notifications
   - **QR Code** (`qr-code-url`): Only for Community Fund, displayed in game embeds

2. **You can't mix them**:
   - Regular projects can only have `project-logo-url`
   - Community Fund can only have `qr-code-url`

3. **Both are optional** but recommended for better user experience

---

## Understanding House Balance

The **House Balance** is a special account that tracks earnings and spending for different activities. It's separate from the Community Fund and Virtual Accounts.

### What is House Balance?

House Balance tracks three separate pools:
1. **⚽ Betting House** - Earnings from football matches with no winners
2. **🎨 Auction House** - Earnings from NFT auction sales
3. **🎲 Lottery House** - Commission from lottery ticket sales

### How House Balance Works

#### Earnings (Money In)

**Betting House**:
- When a football match has **no winners**, all bets go to the Betting House
- Example: 10 users bet 100 tokens each, no one wins → 1000 tokens to Betting House

**Auction House**:
- When an NFT is sold at auction, the sale amount goes to Auction House
- Example: NFT sells for 500 tokens → 500 tokens to Auction House

**Lottery House**:
- When lottery tickets are sold, a percentage (house commission) goes to Lottery House
- Example: 1000 tokens in ticket sales, 5% commission → 50 tokens to Lottery House

#### Spending (Money Out)

**Betting House**:
- Can be used to fund prizes for special matches
- Can be tipped to users via `/house-tip`

**Auction House**:
- Used to pay NFT sellers when auctions complete
- Can be tipped to users

**Lottery House**:
- Used to fund initial prize pools for new lotteries
- Can be tipped to users

### Top-Up House Balance

Users can transfer tokens from their Virtual Account to House Balance:

```
/virtual-house-topup token amount house-type [memo]
```

#### Parameters

- **`token`**: Token ticker (e.g., `REWARD-cf6eac`)
- **`amount`**: Amount to transfer
- **`house-type`**: Which house to top up:
  - `betting` - Betting House
  - `auction` - Auction House
  - `lottery` - Lottery House
- **`memo`** (Optional): Note about the transfer

#### Example

```
/virtual-house-topup REWARD-cf6eac 1000 lottery "Funding new lottery"
```

This transfers 1000 REWARD tokens from your Virtual Account to the Lottery House.

### Withdrawing from House Balance

Admins can tip users from House Balance:

```
/house-tip user token amount source [memo]
```

#### Parameters

- **`user`**: Discord user to tip
- **`token`**: Token ticker
- **`amount`**: Amount to send
- **`source`**: Which house to use:
  - `betting` - From Betting House
  - `auction` - From Auction House
  - `lottery` - From Lottery House
- **`memo`** (Optional): Note about the tip

#### Example

```
/house-tip @user REWARD-cf6eac 500 betting "Reward for participation"
```

This sends 500 REWARD tokens from Betting House to the user's Virtual Account.

### Checking House Balance

View current House Balance:

```
/house-balance [public]
```

This shows:
- **Betting House**: Earnings, Spending, PNL (Profit & Loss)
- **Auction House**: Earnings, Spending, PNL
- **Lottery House**: Earnings, Spending, PNL

**PNL** = Earnings - Spending (positive = profit, negative = loss)

### Using House Balance for Lotteries

When creating a lottery, you can fund the initial prize pool from Lottery House:

```
/create-lottery winning-numbers total-numbers token ticket-price drawing-frequency [house-commission] [channel] [initial-prize-pool]
```

If you specify `initial-prize-pool`, the bot will:
1. Check Lottery House balance for that token
2. Deduct the amount from Lottery House
3. Add it to the lottery's prize pool

**Example**:
```
/create-lottery 3 50 REWARD-cf6eac 10 daily 5 #lottery 1000
```

This creates a lottery with:
- Match 3 out of 50 numbers
- 10 tokens per ticket
- 5% house commission
- 1000 tokens initial prize pool (from Lottery House)

### House Balance Top-Up Workaround

**Important**: To top up House Balance, you need a Virtual Account. Here's the recommended workaround:

1. **Create a Generic Discord Profile**: Create a separate Discord account for your project (e.g., "Project Bot Account")
2. **Register Project Wallet**: Use `/set-wallet` with the generic account to register your Project Wallet address
3. **Deposit to Community Fund**: Transfer tokens/NFTs to the Community Fund wallet address
4. **Top Up House Balance**: Use `/virtual-house-topup` with the generic account to transfer from Virtual Account to House Balance
5. **Fund Lotteries**: Once House Balance is funded, you can use it to sponsor initial prize pools when creating lotteries

**Why This Works:**
- The generic Discord account gets a Virtual Account when you register the Project Wallet
- Deposits to Community Fund automatically credit the Virtual Account
- You can then transfer from Virtual Account to House Balance
- This allows you to fund House Balance without exposing admin wallets

**Example Flow:**
```
1. Create generic Discord account: "ProjectBot"
2. Register Project Wallet: /set-wallet erd1... (as ProjectBot)
3. Transfer 1000 REWARD to Community Fund wallet
4. Bot auto-credits ProjectBot's Virtual Account
5. Top up House Balance: /virtual-house-topup REWARD-cf6eac 1000 lottery
6. Create lottery with initial prize pool: /create-lottery ... initial-prize-pool:1000
```

---

## Next Steps

Now that you've set up your projects and Community Fund, you can:

1. **Run Activities**: Set up lotteries, football betting, auctions, and RPS games
2. **Manage Users**: Help users register wallets and top up their accounts
3. **Monitor Activity**: Use admin commands to track balances and activity

See the [Running Activities](running-activities.md) guide for details on setting up games and activities.

