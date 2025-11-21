# ESDT Tipping Bot - Complete Documentation

## Table of Contents

1. [Admin Setup Guide](#admin-setup-guide)
   - [Channel Permissions](#channel-permissions)
   - [Creating Your First Project](#creating-your-first-project)
   - [Setting Up Community Fund](#setting-up-community-fund)
   - [Updating Project Settings](#updating-project-settings)
   - [Understanding House Balance](#understanding-house-balance)
2. [Running Activities](#running-activities)
   - [Lotteries](#lotteries)
   - [Football Betting](#football-betting)
   - [NFT Auctions](#nft-auctions)
   - [Rock Paper Scissors](#rock-paper-scissors)
3. [User Guide](#user-guide)
   - [Registering Your Wallet](#registering-your-wallet)
   - [Topping Up Your Account](#topping-up-your-account)
   - [Managing Your Virtual Account](#managing-your-virtual-account)
4. [Admin Commands Reference](#admin-commands-reference)
5. [Troubleshooting](#troubleshooting)

---

# Admin Setup Guide

This guide will walk you through setting up the ESDT Tipping Bot for your Discord server.

## Channel Permissions

Before you start, ensure the bot has the following permissions in the channels where it will operate:

### Required Permissions

1. **Send Messages** - Bot needs to send messages and embeds
2. **Embed Links** - Bot needs to create rich embeds for games and activities
3. **Create Public Threads** - Required for football betting matches (bot creates threads for each match)
4. **Read Message History** - Bot needs to read previous messages
5. **Use External Emojis** - For better visual presentation

### How to Set Permissions

#### Option 1: Server-Wide Permissions (Recommended)

1. Go to **Server Settings** → **Roles**
2. Find the bot's role (or create one)
3. Enable these permissions:
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

1. **Display wallet details in the command response** (embed)
2. **Send you a DM** with:
   - Wallet address
   - Seed phrase (24 words)
   - PEM file content
   - Downloadable PEM file (if possible)

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

---

# Running Activities

This section covers how to set up and run different activities for your community.

## Lotteries

Lotteries allow users to buy tickets with a chance to win prizes.

### Creating a Lottery

```
/create-lottery winning-numbers total-numbers token ticket-price drawing-frequency [house-commission] [channel] [initial-prize-pool]
```

#### Parameters Explained

- **`winning-numbers`**: How many numbers users need to match to win (e.g., `3`)
- **`total-numbers`**: Total pool of numbers to choose from (e.g., `50`)
- **`token`**: Token ticker for tickets (e.g., `REWARD-cf6eac`)
- **`ticket-price`**: Price per ticket in tokens (e.g., `10`)
- **`drawing-frequency`**: When to draw winners:
  - `daily` - Every 24 hours
  - `weekly` - Once per week
  - `manual` - Admin triggers draw manually
- **`house-commission`** (Optional): Percentage the house takes (e.g., `5` for 5%)
- **`channel`** (Optional): Channel to post lottery (default: current channel)
- **`initial-prize-pool`** (Optional): Starting prize pool from Lottery House

#### Example

```
/create-lottery 3 50 REWARD-cf6eac 10 daily 5 #lottery 1000
```

This creates:
- Match 3 out of 50 numbers
- 10 REWARD tokens per ticket
- Daily drawings
- 5% house commission
- Posted in #lottery channel
- 1000 tokens initial prize pool

### How Lotteries Work

1. **Users Buy Tickets**: Users purchase tickets using their Virtual Account balance
2. **Prize Pool Grows**: Each ticket purchase adds to the prize pool
3. **House Commission**: A percentage goes to Lottery House
4. **Drawing**: At the scheduled time, winning numbers are drawn
5. **Winners**: Users with matching numbers split the prize pool (minus commission)
6. **Rollover**: If no winners, prize pool rolls over to next drawing

### Managing Lotteries

- **View Active Lotteries**: Check the lottery embed in the channel
- **Manual Draw**: Use button on lottery embed to trigger draw early
- **View Results**: Click "View Results" button on lottery embed

---

## Football Betting

Football betting allows users to bet on real football matches.

### Creating Football Fixtures

```
/create-fixtures competition token amount [channel]
```

#### Parameters Explained

- **`competition`**: Competition code (e.g., `PL` for Premier League, `CL` for Champions League)
- **`token`**: Token ticker for bets (e.g., `REWARD-cf6eac`)
- **`amount`**: Bet amount per match (e.g., `100`)
- **`channel`** (Optional): Channel to post matches (default: current channel)

#### Example

```
/create-fixtures PL REWARD-cf6eac 100 #betting
```

This creates betting opportunities for all Premier League matches with:
- 100 REWARD tokens per bet
- Posted in #betting channel

### How Football Betting Works

1. **Admin Creates Fixtures**: Bot fetches upcoming matches from Football-Data.org API
2. **Matches Posted**: Each match gets its own thread with betting options
3. **Users Place Bets**: Users bet on Home Win, Draw, or Away Win
4. **Match Ends**: Bot automatically processes results
5. **Winners Paid**: Winners split the pot equally
6. **No Winners**: If no one bet correctly, all bets go to Betting House

### Betting Options

Users can bet on:
- **Home Win** (1) - Home team wins
- **Draw** (X) - Match ends in a draw
- **Away Win** (2) - Away team wins

### Viewing Statistics

- **Leaderboard**: `/leaderboard` - Top bettors
- **Filtered Leaderboard**: `/leaderboard-filtered` - By date range or competition
- **Your Stats**: `/my-football-stats` - Your betting statistics and PNL

---

## NFT Auctions

NFT auctions allow users to sell NFTs and SFTs (Semi-Fungible Tokens) to the highest bidder.

**Note**: The bot supports both NFTs and SFTs. SFTs are similar to NFTs but have a quantity (amount) field. All NFT-related commands work with both NFTs and SFTs.

### Creating an Auction

```
/create-auction collection nft-name starting-amount duration [token] [min-bid-increase] [title] [description] [amount]
```

#### Parameters Explained

- **`collection`**: NFT/SFT collection identifier (e.g., `COLLECTION-abc123`)
- **`nft-name`**: Specific NFT/SFT name (e.g., `NFT-NAME-1`)
- **`starting-amount`**: Starting bid amount (e.g., `100`)
- **`duration`**: Auction duration in hours (e.g., `24`)
- **`token`** (Optional): Token for bidding (default: Community Fund token)
- **`min-bid-increase`** (Optional): Minimum bid increase (e.g., `10`)
- **`title`** (Optional): Auction title
- **`description`** (Optional): Auction description
- **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs)

#### Example

```
/create-auction COLLECTION-abc123 NFT-NAME-1 100 24 REWARD-cf6eac 10 "Rare NFT" "One of a kind collectible"
```

For SFTs with quantity:
```
/create-auction COLLECTION-abc123 SFT-NAME-1 100 24 REWARD-cf6eac 10 "Rare SFT" "Limited edition" amount:5
```

### How Auctions Work

1. **Auction Created**: Admin creates auction with starting bid
2. **Users Bid**: Users place bids using Virtual Account balance
3. **Bid Validation**: Each bid must exceed previous bid + minimum increase
4. **Auction Ends**: Automatically closes at end time
5. **Winner Pays**: Highest bidder's balance is deducted
6. **Seller Receives**: Payment goes to Auction House (or seller's account)
7. **NFT/SFT Transferred**: NFT or SFT sent to winner's wallet (with specified amount for SFTs)

### Bidding

Users click "Place Bid" button on auction embed and enter bid amount in modal.

---

## Rock Paper Scissors

Rock Paper Scissors allows users to challenge each other with token prizes.

### How RPS Works

1. **Challenge Created**: User challenges another user with a bet amount
2. **Challenge Accepted**: Other user joins by matching the bet
3. **Players Make Moves**: Both players choose Rock, Paper, or Scissors
4. **Winner Determined**: Standard RPS rules apply
5. **Prize Distributed**: Winner receives total pot (both bets)
6. **Draw Handling**: If draw, game continues with additional rounds

### Creating a Challenge

Users create challenges with:

```
/challenge-rps user-tag bet-amount [token] [memo] [public]
```

#### Example

```
/challenge-rps @user 100 REWARD-cf6eac "Let's play!" true
```

### Viewing Challenges

```
/list-rps-challenges [public]
```

Shows all active and waiting challenges.

---

# User Guide

This section helps users understand how to use the bot.

## Registering Your Wallet

Before you can use the bot, you need to register your MultiversX wallet address.

### Step 1: Get Your Wallet Address

You need a MultiversX wallet address that starts with `erd1...` and is 62 characters long.

### Step 2: Register with Bot

Use the `/set-wallet` command:

```
/set-wallet erd1abc123def456...
```

**Important**: 
- Must be a valid MultiversX address
- Must start with `erd1`
- Must be exactly 62 characters

### Step 3: Confirmation

After registration, you'll receive:
- ✅ Confirmation message
- Community Fund wallet address (for top-ups)
- QR code (if available)
- Supported tokens list

**Important**: If you sent tokens to the Community Fund **before** registering your wallet, the bot will automatically:
- ✅ Process all past transactions from your wallet address (last 30 days)
- ✅ Credit them to your Virtual Account
- ✅ Show you a confirmation of how many transactions were processed

Your Virtual Account is now created and ready to use!

---

## Topping Up Your Account

To add funds to your Virtual Account, transfer tokens to the Community Fund wallet.

### Step 1: Get Community Fund Address

```
/show-community-fund-address
```

This shows:
- The wallet address to send tokens to
- QR code (scan with your wallet app)
- Supported tokens

### Step 2: Transfer Tokens

1. Open your MultiversX wallet (xPortal, Maiar, etc.)
2. Send tokens to the Community Fund address
3. Use one of the supported tokens (shown in the address display)

### Step 3: Automatic Credit

The bot automatically:
- ✅ Detects your transfer (within 10 seconds)
- ✅ Credits your Virtual Account
- ✅ Updates your balance

**No transaction hash needed!** The bot detects transfers automatically.

### Safety Feature: Pre-Registration Transfers

**Important**: If you send tokens to the Community Fund wallet **before** registering your wallet, don't worry! The bot has a safety feature that:

- ✅ **Stores all incoming transfers** from non-registered wallets
- ✅ **Automatically credits your account** when you register your wallet
- ✅ **Processes transactions from the last 30 days** when you register

**How it works**:
1. You send tokens to Community Fund (before wallet registration)
2. The bot detects the transfer but can't credit it yet (wallet not registered)
3. The transaction is stored in the database
4. When you register your wallet with `/set-wallet`, the bot automatically:
   - Finds all past transactions from your wallet address
   - Credits them to your Virtual Account
   - Shows you a confirmation message

This prevents the common user error of sending funds before registering your wallet!

### Step 4: Verify Balance

Check your balance:

```
/check-balance-esdt
```

You should see your newly deposited tokens.

---

## Managing Your Virtual Account

### Checking Balance

```
/check-balance-esdt [public]
```

Shows all your token balances.

### Viewing Transaction History

```
/balance-history [token] [limit] [public]
```

Shows your recent transactions:
- Deposits (from blockchain transfers)
- Tips received
- Tips sent
- Game winnings
- Withdrawals

### Tipping Other Users

```
/tip-virtual-esdt user token amount [memo] [public]
```

**Example**:
```
/tip-virtual-esdt @friend REWARD-cf6eac 50 "Thanks for help!"
```

### Withdrawing to Your Wallet

```
/withdraw-esdt token amount [public]
```

**Requirements**:
- Sufficient balance in Virtual Account
- Community Fund must have sufficient balance
- Your wallet must be registered

**Example**:
```
/withdraw-esdt REWARD-cf6eac 1000
```

### Transferring to House Balance

You can fund House Balance for activities:

```
/virtual-house-topup token amount house-type [memo]
```

**House Types**:
- `betting` - For football betting
- `auction` - For NFT auctions
- `lottery` - For lotteries

**Example**:
```
/virtual-house-topup REWARD-cf6eac 500 lottery "Supporting community lottery"
```

---

## NFT and SFT Virtual Accounts

The bot supports both **NFTs (Non-Fungible Tokens)** and **SFTs (Semi-Fungible Tokens)** through a unified Virtual Account system. SFTs are similar to NFTs but have a quantity (amount) field, allowing you to own multiple copies of the same token.

**Key Points**:
- ✅ **Unified System**: NFTs and SFTs share the same Virtual Account
- ✅ **Amount Support**: SFTs show quantity in your balance
- ✅ **Same Commands**: All NFT commands work with both NFTs and SFTs
- ✅ **Auto-Detection**: The bot automatically detects whether a token is an NFT or SFT

### Checking NFT/SFT Balance

```
/check-balance-nft [collection] [public]
```

Shows all NFTs and SFTs in your Virtual Account. SFTs will display their quantity (amount).

### Viewing NFT/SFT Details

```
/show-my-nft collection nft-name [public]
```

Shows detailed information about an NFT or SFT:
- NFT/SFT image
- Attributes
- Metadata
- Collection information
- Quantity (for SFTs)

### Tipping NFTs/SFTs

```
/tip-virtual-nft user collection nft-name [amount] [public]
```

Send an NFT or SFT from your Virtual Account to another user's Virtual Account.

**Parameters**:
- **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs)

**Example**:
```
/tip-virtual-nft @friend COLLECTION-abc123 NFT-NAME-1
```

For SFTs with quantity:
```
/tip-virtual-nft @friend COLLECTION-abc123 SFT-NAME-1 amount:5
```

### Selling NFTs/SFTs

```
/sell-nft collection nft-name starting-amount duration [token] [min-bid-increase] [title] [description] [amount]
```

List an NFT or SFT for sale on the marketplace.

**Parameters**:
- **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs)

### Withdrawing NFTs/SFTs

```
/withdraw-nft collection nft-name [amount] [public]
```

Withdraw an NFT or SFT from your Virtual Account to your registered wallet.

**Parameters**:
- **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs, required for SFTs)

**Example**:
```
/withdraw-nft COLLECTION-abc123 NFT-NAME-1
```

For SFTs with quantity:
```
/withdraw-nft COLLECTION-abc123 SFT-NAME-1 amount:10
```

---

# Admin Commands Reference

Complete reference of all admin commands for managing the bot.

## Project Management

### `/register-project`
Register a new project with auto-generated wallet.

**Usage**: `/register-project project-name supported-tokens [project-logo-url] [user-input]`

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
```

### `/list-projects`
List all registered projects.

**Usage**: `/list-projects [public]`

### `/delete-project`
Delete a project (requires "DELETE" confirmation).

**Usage**: `/delete-project project-name confirm:DELETE`

### `/set-community-fund`
Create and set Community Fund (auto-generated wallet).

**Usage**: `/set-community-fund fund-name supported-tokens [qr-code-url]`

**Example**:
```
/set-community-fund MainFund REWARD-cf6eac,EGLD https://qr-code.png
```

## Token & NFT Management

### `/send-esdt`
Send ESDT tokens to a user.

**Usage**: `/send-esdt project-name user-tag token-ticker amount [memo]`

**Example**:
```
/send-esdt MainWallet @user REWARD-cf6eac 100 "Welcome bonus"
```

### `/send-nft`
Send NFT or SFT to a user.

**Usage**: `/send-nft project-name collection nft-name user-tag [memo] [amount]`

**Note**: Supports both NFTs and SFTs. For SFTs, specify the `amount` parameter.

**Example**:
```
/send-nft MainWallet COLLECTION-abc123 NFT-NAME @user "Airdrop"
```

For SFTs:
```
/send-nft MainWallet COLLECTION-abc123 SFT-NAME @user "Airdrop" amount:5
```

### `/house-tip`
Tip user from House Balance.

**Usage**: `/house-tip user token amount source [memo]`

**Example**:
```
/house-tip @user REWARD-cf6eac 500 betting "Reward"
```

### `/update-token-metadata`
Update token information.

**Usage**: `/update-token-metadata token-ticker name decimals`

**Example**:
```
/update-token-metadata REWARD-cf6eac REWARD 18
```

## Activity Management

### `/create-lottery`
Create a new lottery game.

**Usage**: `/create-lottery winning-numbers total-numbers token ticket-price drawing-frequency [house-commission] [channel] [initial-prize-pool]`

**Example**:
```
/create-lottery 3 50 REWARD-cf6eac 10 daily 5 #lottery 1000
```

### `/create-fixtures`
Create football matches for betting.

**Usage**: `/create-fixtures competition token amount [channel]`

**Example**:
```
/create-fixtures PL REWARD-cf6eac 100 #betting
```

### `/create-auction`
Create an NFT or SFT auction.

**Usage**: `/create-auction collection nft-name starting-amount duration [token] [min-bid-increase] [title] [description] [amount]`

**Note**: Supports both NFTs and SFTs. For SFTs, specify the `amount` parameter to set the quantity being auctioned.

**Example**:
```
/create-auction COLLECTION-abc123 NFT-NAME 100 24 REWARD-cf6eac 10
```

For SFTs:
```
/create-auction COLLECTION-abc123 SFT-NAME 100 24 REWARD-cf6eac 10 "Rare SFT" "Limited edition" amount:5
```

## Monitoring & Debugging

### `/server-balances`
View server-wide virtual account summary.

**Usage**: `/server-balances [public]`

### `/house-balance`
View House Balance (earnings, spending, PNL).

**Usage**: `/house-balance [public]`

### `/blockchain-status`
Check blockchain listener status.

**Usage**: `/blockchain-status`

### `/list-wallets`
List registered wallets.

**Usage**: `/list-wallets [filter] [page] [public]`

### `/check-community-fund-balance`
Check Community Fund balances for withdrawals.

**Usage**: `/check-community-fund-balance [transfers]`

### `/update-usernames`
Update Discord usernames for all virtual accounts.

**Usage**: `/update-usernames`

### `/test-football-api`
Test Football-Data.org API connectivity.

**Usage**: `/test-football-api`

### `/debug-server-config`
Debug server configuration.

**Usage**: `/debug-server-config`

### `/debug-user`
Debug user information.

**Usage**: `/debug-user user`

### `/leaderboard-reset`
Reset betting leaderboard (requires "DELETE" confirmation).

**Usage**: `/leaderboard-reset confirm:DELETE`

### `/delete-all-server-data`
Delete ALL server data and perform mass refund (requires "DELETE ALL DATA" confirmation).

**Usage**: `/delete-all-server-data confirm:"DELETE ALL DATA"`

**⚠️ WARNING**: This is a destructive operation that cannot be undone!

---

# Troubleshooting

## Common Issues

### Bot Not Responding

**Problem**: Bot doesn't respond to commands.

**Solutions**:
1. Check if bot is online in Discord
2. Verify bot has necessary permissions (see [Channel Permissions](#channel-permissions))
3. Check console logs for errors
4. Restart the bot

### Commands Not Appearing

**Problem**: Slash commands don't show up in Discord.

**Solutions**:
1. Run `npm run register-commands`
2. Wait a few minutes for Discord to sync
3. Refresh Discord (Ctrl+R)
4. Check rate limits (see Rate Limit Guide)

### Virtual Accounts Not Updating

**Problem**: Balance doesn't update after transfer.

**Solutions**:
1. Check blockchain listener: `/blockchain-status`
2. Verify wallet is registered: `/list-wallets`
3. Confirm transfer was successful on blockchain explorer
4. Wait up to 10 seconds (polling interval)
5. Check Community Fund address is correct

### Insufficient Balance Errors

**Problem**: "Insufficient balance" when withdrawing.

**Solutions**:
1. Check your balance: `/check-balance-esdt`
2. Check Community Fund balance: `/check-community-fund-balance`
3. Ensure Community Fund has required tokens
4. Verify sufficient EGLD for gas fees

### Permission Errors

**Problem**: "I don't have permission" errors.

**Solutions**:
1. Verify bot has required permissions (see [Channel Permissions](#channel-permissions))
2. Check bot role has administrator or specific permissions
3. Verify channel-specific permissions if using them

### House Balance Issues

**Problem**: House Balance not updating correctly.

**Solutions**:
1. Check House Balance: `/house-balance`
2. Verify activity completed successfully
3. Check transaction logs in console
4. Use `/debug-server-config` to verify setup

---

## Getting Help

If you encounter issues not covered here:

1. **Check Logs**: Review console output for error messages
2. **Verify Configuration**: Check `.env` file and database setup
3. **Test Commands**: Use debug commands to diagnose issues
4. **Check Documentation**: Review relevant sections
5. **Contact Support**: Reach out with detailed error information

---

**Powered by MakeX**

*Last Updated: 2024*
