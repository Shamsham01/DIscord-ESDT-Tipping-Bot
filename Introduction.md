# 😊 Introduction

**ESDT Tipping Bot** is a Discord bot that enables tipping and transferring any ESDT (Electronic Standard Digital Token) issued on the MultiversX blockchain.

---

## Key Features

- **Admin-Controlled Transfers:**  
  Admins can transfer ESDT tokens from wallets registered to the bot using the `/send-esdt` command.

- **Community Fund & P2P Tipping:**  
  Admins can register a Community Fund wallet, allowing users to send peer-to-peer (P2P) tips.  
  Users can deposit or donate tokens to the Community Fund and send random tips using the `/tip` command.

- **Rock, Paper, Scissors (RPS) Game:**  
  The bot supports a fully on-chain, P2P RPS game. Two users can challenge each other, stake tokens, and the winner receives the combined prize.  
  The game is fair, transparent, and all actions are recorded on the blockchain.

---

## How It Works

- **Wallet Registration:**  
  Admins and users must register their MultiversX wallet addresses with the bot.

- **Token Support:**  
  The bot supports any ESDT token added by the admin.

- **Transparency:**  
  All transactions are performed via secure API calls and require valid transaction hashes for verification. All actions are on-chain and visible.

---

## Security & Best Practices

- **Wallet PEM Keys:**  
  Wallet PEM Keys are required for project registration and are securely stored in the database.
- **New Wallets Recommended:**  
  Admins are strongly advised to create brand new wallets for the bot (do not use personal or exchange wallets).
- **Minimal Token Storage:**  
  Store as little tokens as possible in bot wallets and top up regularly. **No more than $50 is advised.**
- **Wallet Requirements:**  
  Each wallet must have:
  - **EGLD** for blockchain transaction fees
  - **REWARD** token for usageFee (charged by MakeX API)
  - Supported tokens for tips and transfers
- **MakeX API Usage Fee:**  
  $0.03 per transfer, paid in REWARD tokens (automatically calculated at the time of transfer based on actual REWARD price).
- **Transparency:**  
  We are fully transparent about how your data and funds are handled. Please follow best practices for security and never store large amounts in bot wallets.

---

## What Can You Do With ESDT Tipping Bot?

- Send and receive ESDT tips in your Discord community.
- Organize community giveaways and rewards.
- Play and wager tokens in Rock, Paper, Scissors games.
- Build trust and engagement with transparent, on-chain transactions.

---

**Get started by registering your wallet and exploring the available commands!** 