---
description: >-
  Registering Projects & Setting Up the Community Fund This guide explains how
  to register project wallets and set up the Community Fund for your ESDT
  Tipping Bot.
---

# Registering Projects

***

### 🔑 Project Wallets vs. Community Fund

Understanding the difference between these two wallet types is crucial for proper bot setup and security.

#### Project Wallets (Admin-Controlled)

* **Control**: Fully controlled by admins
* **Purpose**: Used for admin-controlled transfers and operations
* **Commands**:
  * `/send-esdt` - Send tokens to users
  * `/send-nft` - Send NFTs to users
  * `/create-auction` - Create NFT auctions
* **On-Chain Transfers**: All operations result in **on-chain blockchain transfers** (require an **active on-chain plan** — see [On-Chain Subscription Plan](../on-chain-subscription.md))
* **Fees**: **EGLD** for blockchain gas; **active on-chain plan** for permission to send on-chain; MakeX usage fees **waived** when plan syncs wallets to whitelist
* **Security**: Admins have full control - can delete projects, manage funds, etc.

> ⚠️ **Important**: Project Wallets are controlled by admins. Deletion commands result in mass withdrawals to user wallets for safety.

#### Community Fund Wallet (User-Focused)

* **Control**: **NOT controlled by admins** - auto-generated and managed by the bot
* **Purpose**: Used for user-to-user interactions and Virtual Account operations
* **Commands**:
  * `/tip-virtual-esdt` - User-to-user tips
  * `/tip-virtual-nft` - User-to-user NFT transfers
  * `/challenge-rps` - RPS game challenges
  * `/withdraw-esdt` - User withdrawals
* **Virtual Account Operations**: Most operations happen **inside the Community Fund** - bot just updates balance records
* **Fees**: Virtual Account operations (tips, RPS, in-VA NFT transfers) do **not** use on-chain gas
* **On-chain withdrawals**: `/withdraw-esdt`, `/withdraw-nft`, `/house-withdraw`, etc. require an **active on-chain plan** plus **EGLD** in the Community Fund (or project wallet) for blockchain fees
* **Security**: Cannot be deleted by admins - protects user funds. All deletion commands result in mass withdrawals to user wallets

#### Key Differences Summary

| Feature        | Project Wallets                              | Community Fund                                          |
| -------------- | -------------------------------------------- | ------------------------------------------------------- |
| **Control**    | Admin-controlled                             | Bot-managed (not admin-controlled)                      |
| **Operations** | On-chain transfers                           | Virtual Account (balance updates)                       |
| **On-chain fees** | Active plan + EGLD (usage fees waived)   | Active plan + EGLD for withdrawals / mass refund         |
| **Commands**   | `/send-esdt`, `/send-nft`, `/create-auction` | `/tip-virtual-esdt`, `/challenge-rps`, `/withdraw-esdt` |
| **Deletion**   | Admin can delete                             | Protected - mass withdrawal only                        |

> ⚠️ **Warning:** If you only register one wallet for admin use, **do NOT set it as the Community Fund**. This could expose admin funds to public tipping and games. Always use separate wallets.

***

### 📝 How to Register a Project Wallet

1. **Prepare your supported tokens list.**
2. Use the `/register-project` command:
   * `project-name`: Choose a unique name for this wallet.
   * `supported-tokens`: Comma-separated list (e.g., `EGLD,REWARD,USDC,MYTOKEN`).
   * (Optional) `project-logo-url`: URL to your project logo image (will be used in notifications and embeds).
   * (Optional) `user-input`: Add notes for this project.
3. The bot will automatically generate a new MultiversX wallet for your project.
4. **Save the wallet information** that will be displayed in the command response and sent to you via DM:
   * Wallet address
   * Seed phrase (24 words) - you can use this to log in to xPortal or Extension wallet
   * PEM file content - save this to a secure location (e.g., `WalletKey.pem`)
5. **Top up the wallet** with **EGLD** for blockchain transaction fees (at least **0.08 EGLD** recommended per wallet).
6. The bot will confirm registration and show your project in `/list-projects`.

**Example:**

```
/register-project MainWallet REWARD-cf6eac,WEGLD-bd4d79 https://example.com/logo.png "Main community wallet"
```

{% hint style="info" %}
**Note**: The bot automatically generates a new MultiversX wallet for your project. You don't need to provide a wallet address or PEM file - the bot creates and manages this wallet automatically, and you'll receive the wallet details via DM.
{% endhint %}

***

### 🏦 How to Set Up the Community Fund

1. **Create Community Fund** using `/set-community-fund`:
   * `fund-name`: Name for your Community Fund (e.g., "Main Fund", "Gaming Fund").
   * `supported-tokens`: Comma-separated list of supported tokens (e.g., `REWARD-cf6eac,WEGLD-bd4d79`    ).
2. **Get Community Fund Address** using `/show-community-fund-address` to display the wallet address and QR code for users. [The embed will contain Wallet Registration button for seamless user registration without need to use registration command.](#user-content-fn-1)[^1]

{% hint style="info" %}
**Note:** The Community Fund wallet and QR code are **auto-generated** by the bot. You don't need to provide a PEM file or QR image URL — the bot creates and manages both automatically.
{% endhint %}

> ⚠️ **Important:**
>
> * The Community Fund is used for Virtual Account top-ups, P2P tips, and games.
> * Users transfer tokens to the Community Fund address to top up their Virtual Accounts.
> * The bot automatically detects transfers and credits Virtual Accounts (no transaction hash needed).

***

### 🖼️ Updating Project Logo

You can update project settings using `/update-project`:

**To update a project logo** (for non-Community Fund projects):

```
/update-project project-name project-logo-url:https://example.com/new-logo.png
```

**Important Notes:**

* **Project Logo** (`project-logo-url`): For regular projects, used in notifications and DM embeds
* **QR Code**: Auto-generated for Community Fund when you run `/set-community-fund`, displayed in game embeds and wallet registration
* Regular projects use `project-logo-url`; Community Fund uses an auto-generated QR code instead

### 🏛️ Understanding House Balance

The **House Balance** is a special account that tracks earnings and spending for different activities. It's separate from the Community Fund and Virtual Accounts.

**House Balance tracks three separate pools:**

1. **⚽ Betting House** - Earnings from football matches with no winners
2. **🎨 Auction House** - Earnings from NFT auction sales
3. **🎲 Lottery House** - Commission from lottery ticket sales

**How it works:**

* **Earnings**: When activities generate revenue (no-winner matches, auction sales, lottery commission), funds go to the respective House Balance
* **Spending**: House Balance can be used to fund prizes, tip users, or seed initial prize pools
* **Top-Up**: Users can transfer tokens from their Virtual Account to House Balance using `/virtual-house-topup`
* **Tips**: Admins can tip users from House Balance using `/house-tip`
* **Withdraws**: Admins can withdraw from House Balancxe using `/house-withdraw`

**View House Balance:**

```
/house-balance
```

This shows earnings, spending, and PNL (Profit & Loss) for each house type.

**Using House Balance for Lotteries:** When creating a lottery, you can fund the initial prize pool from Lottery House by specifying `initial-prize-pool` in the `/create-lottery` command.

### ✅ Best Practices

* Regularly review and update supported tokens.
* Add project logos for regular projects; Community Fund QR codes are created automatically.
* Monitor House Balance to track activity earnings and spending.

[^1]: Useful Tip!
