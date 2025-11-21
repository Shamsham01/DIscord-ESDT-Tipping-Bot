---
description: >-
  Complete guide for users to register wallets, top up accounts, and manage
  virtual accounts
---

# User Guide

This section helps users understand how to use the ESDT Tipping Bot.

## Registering Your Wallet

Before you can use the bot, you need to register your MultiversX wallet address.

### Step 1: Get Your Wallet Address

You need a MultiversX wallet address that starts with `erd1...` and is 62 characters long.

If you don't have a wallet yet:

* Create one at [wallet.multiversx.com](https://wallet.multiversx.com/create)
* Or use [xPortal](https://xportal.app)

### Step 2: Register with Bot

Use the `/set-wallet` command:

```
/set-wallet erd1abc123def456...
```

**Important**:

* Must be a valid MultiversX address
* Must start with `erd1`
* Must be exactly 62 characters

### Step 3: Confirmation

After registration, you'll receive:

* ✅ Confirmation message
* Community Fund wallet address (for top-ups)
* QR code (if available)
* Supported tokens list

**Important**: If you sent tokens to the Community Fund **before** registering your wallet, the bot will automatically:

* ✅ Process all past transactions from your wallet address (last 30 days)
* ✅ Credit them to your Virtual Account
* ✅ Show you a confirmation of how many transactions were processed

Your Virtual Account is now created and ready to use!

***

## Topping Up Your Account

To add funds to your Virtual Account, transfer tokens to the Community Fund wallet.

### Step 1: Get Community Fund Address

```
/show-community-fund-address
```

This shows:

* The wallet address to send tokens to
* QR code (scan with your wallet app)
* Supported tokens

### Step 2: Transfer Tokens

1. Open your MultiversX wallet (xPortal, Extension, Web, etc.)
2. Send tokens to the Community Fund address
3. Use one of the supported tokens (shown in the address display)

### Step 3: Automatic Credit

The bot automatically:

* ✅ Detects your transfer (within 10 seconds)
* ✅ Credits your Virtual Account
* ✅ Updates your balance

**No transaction hash needed!** The bot detects transfers automatically via blockchain listener.

### Safety Feature: Pre-Registration Transfers

**Important**: If you send tokens to the Community Fund wallet **before** registering your wallet, don't worry! The bot has a safety feature that:

* ✅ **Stores all incoming transfers** from non-registered wallets
* ✅ **Automatically credits your account** when you register your wallet
* ✅ **Processes transactions from the last 30 days** when you register

**How it works**:

1. You send tokens to Community Fund (before wallet registration)
2. The bot detects the transfer but can't credit it yet (wallet not registered)
3. The transaction is stored in the database
4. When you register your wallet with `/set-wallet`, the bot automatically:
   * Finds all past transactions from your wallet address
   * Credits them to your Virtual Account
   * Shows you a confirmation message

This prevents the common user error of sending funds before registering your wallet!

### Step 4: Verify Balance

Check your balance:

```
/check-balance-esdt
```

You should see your newly deposited tokens.

### How It Works

The bot includes a **blockchain listener** that:

* Monitors the Community Fund wallet
* Polls the MultiversX API every 10 seconds
* Automatically detects incoming transfers
* Credits your Virtual Account when a transfer is detected

This means you don't need to:

* Copy/paste transaction hashes
* Wait for manual verification
* Contact admins for balance updates

***

## Managing Your Virtual Account

### Checking Balance

```
/check-balance-esdt [public]
```

Shows all your token balances in your Virtual Account.

### Viewing Transaction History

```
/balance-history [token] [limit] [public]
```

Shows your recent transactions:

* Deposits (from blockchain transfers)
* Tips received
* Tips sent
* Game winnings
* Withdrawals
* House top-ups

**Parameters**:

* `token` (optional): Filter by specific token
* `limit` (optional): Number of transactions to show (default: 10)
* `public` (optional): Show publicly or privately

### Tipping Other Users

```
/tip-virtual-esdt user token amount [memo] [public]
```

**Example**:

```
/tip-virtual-esdt @friend REWARD-cf6eac 50 "Thanks for help!"
```

This instantly transfers tokens from your Virtual Account to the recipient's Virtual Account.

**Benefits**:

* ✅ Instant transfers (no blockchain wait)
* ✅ No gas fees
* ✅ No transaction hash needed
* ✅ Works immediately

### Withdrawing to Your Wallet

```
/withdraw-esdt token amount [public]
```

**Requirements**:

* Sufficient balance in Virtual Account
* Community Fund must have sufficient balance
* Your wallet must be registered

**Example**:

```
/withdraw-esdt REWARD-cf6eac 1000
```

This transfers tokens from your Virtual Account to your registered wallet address on the blockchain.

**Note**: Withdrawals require:

* Community Fund to have the tokens available
* EGLD for gas fees
* REWARD for usage fees

### Transferring to House Balance

You can fund House Balance for activities:

```
/virtual-house-topup token amount house-type [memo]
```

**House Types**:

* `betting` - For football betting
* `auction` - For NFT auctions
* `lottery` - For lotteries

**Example**:

```
/virtual-house-topup REWARD-cf6eac 500 lottery "Supporting community lottery"
```

This transfers tokens from your Virtual Account to the specified House Balance pool.

***

## NFT and SFT Virtual Accounts

The bot supports both **NFTs (Non-Fungible Tokens)** and **SFTs (Semi-Fungible Tokens)** through a unified Virtual Account system. SFTs are similar to NFTs but have a quantity (amount) field, allowing you to own multiple copies of the same token.

**Key Points**:

* ✅ **Unified System**: NFTs and SFTs share the same Virtual Account
* ✅ **Amount Support**: SFTs show quantity in your balance
* ✅ **Same Commands**: All NFT commands work with both NFTs and SFTs
* ✅ **Auto-Detection**: The bot automatically detects whether a token is an NFT or SFT

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

* NFT/SFT image
* Attributes
* Metadata
* Collection information
* Quantity (for SFTs)

### Tipping NFTs/SFTs

```
/tip-virtual-nft user collection nft-name [amount] [public]
```

Send an NFT or SFT from your Virtual Account to another user's Virtual Account.

**Parameters**:

* **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs)

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

* **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs)

### Withdrawing NFTs/SFTs

```
/withdraw-nft collection nft-name [amount] [public]
```

Withdraw an NFT or SFT from your Virtual Account to your registered wallet.

**Parameters**:

* **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs, required for SFTs)

**Example**:

```
/withdraw-nft COLLECTION-abc123 NFT-NAME-1
```

For SFTs with quantity:

```
/withdraw-nft COLLECTION-abc123 SFT-NAME-1 amount:10
```

***

## Using Virtual Accounts for Games

### Rock Paper Scissors

When challenging someone to RPS, the bet amount is automatically deducted from your Virtual Account:

```
/challenge-rps @user 100 REWARD-cf6eac
```

No transaction hash needed! The bot uses your Virtual Account balance.

### Football Betting

When placing bets, the bet amount is automatically deducted from your Virtual Account:

```
/bet-virtual match-id outcome
```

The bot automatically:

* Checks your balance
* Deducts the bet amount
* Records your bet

### Lotteries

When buying lottery tickets, the ticket price is automatically deducted from your Virtual Account. Just click the "Buy Ticket" button on the lottery embed!

***

## Tips and Best Practices

### Security

* **Never share your wallet private key or seed phrase**
* Only register wallets you control
* Keep your Discord account secure
* Verify all transactions in your wallet

### Balance Management

* **Check your balance regularly**: `/check-balance-esdt`
* **Review transaction history**: `/balance-history`
* **Monitor withdrawals**: Check your wallet after withdrawing

### Getting Help

* **Check your balance**: `/check-balance-esdt`
* **View transaction history**: `/balance-history`
* **Contact admins**: If you have issues, reach out to server admins
* **Support**: See [Support and Reporting Bugs](support-and-reporting-bugs.md)

### Common Issues

**Balance not updating after transfer?**

* Wait up to 10 seconds (blockchain listener polling interval)
* Verify transfer was successful on blockchain explorer
* Check you sent to the correct Community Fund address
* Ensure your wallet is registered

**Insufficient balance error?**

* Check your balance: `/check-balance-esdt`
* Top up by transferring to Community Fund
* For withdrawals, ensure Community Fund has sufficient balance

**Can't withdraw?**

* Check Community Fund balance (admins can check this)
* Ensure Community Fund has required tokens
* Verify your wallet is registered correctly

***

## Next Steps

Now that you've registered your wallet and topped up your account, you can:

1. **Tip other users**: Use `/tip-virtual-esdt` to send tokens
2. **Play games**: Challenge others to RPS or place football bets
3. **Buy lottery tickets**: Participate in community lotteries
4. **Sell NFTs**: List your NFTs for auction
5. **Withdraw funds**: Transfer tokens back to your wallet when needed

Enjoy using the ESDT Tipping Bot! 🎉
