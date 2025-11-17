---
description: >-
  This page explains how admins can send ESDT tokens and tips, and how users can
  initiate P2P tips using the ESDT Tipping Bot.
---

# Sending Tokens and Tips

***

### 🏦 Admin Transfers & Tips

* **Admins** can use `/send-esdt` to send tokens from a Project Wallet to any user.
* **Admins** can use `/tip` to send a random tip from the Community Fund (if set) or from a Project Wallet (if no min/max limits are set).
* **Project Owners** can donate tokens to the Community Fund to support community tipping and games.

***

### 🤝 P2P Tips (Community Fund)

* **Any user** can tip another user using `/tip` if a Community Fund is set up and min/max limits are configured for the token.
* **Community members** can also donate tokens to the Community Fund wallet to help grow the pool for tips and games.

***

### 💡 Wallet Funding Requirements

* **Both Project and Community Fund wallets must hold:**
  * **EGLD** (for blockchain transaction fees)
  * **REWARD** (for MakeX API usageFee)
  * **Supported ESDT tokens** (for sending/tipping)
* If any of these are missing, transfers, tips, and games will not work.

***

### 🔍 Checking Wallets & Balances

* Use `/list-projects` to see all registered wallets, which is the Project main wallet, and which is set as the Community Fund.
* The Community Fund wallet's MultiversX explorer link is embedded in the button on Community Tip notifications—click to view wallet address and token balances.

***

### 💸 Usage Fee (usageFee)

**Important**: Usage fees depend on which wallet type is used:

#### Project Wallets (Admin-Controlled)
* **All operations charge usageFee**: Every transfer from Project Wallets incurs a **$0.03 fee in REWARD tokens**
* **Commands that charge**:
  * `/send-esdt` - Sending tokens
  * `/send-nft` - Sending NFTs
  * `/create-auction` - Creating auctions
* This is because all operations result in **on-chain blockchain transfers**

#### Community Fund (Virtual Account Operations)
* **Most operations are FREE**: Virtual Account operations do **NOT charge usageFee**
* **Commands that are FREE**:
  * `/tip-virtual-esdt` - User-to-user tips
  * `/tip-virtual-nft` - User-to-user NFT transfers
  * `/challenge-rps` - RPS game challenges
* **Commands that DO charge usageFee**:
  * `/withdraw-esdt` - Withdrawing to user wallets (on-chain transfer)
  * `/house-withdraw` - Withdrawing from House Balance to Project Wallets (on-chain transfer)

**Why the difference?**
- Project Wallet operations = On-chain transfers = UsageFee charged
- Community Fund Virtual Account operations = Balance updates only = No UsageFee
- Withdrawals = On-chain transfers = UsageFee charged

**Buy REWARD:** Buy REWARD on DEX or in xPortal.
**Pro Tip:** We strongly recommend investing in HODL Token Club DeFi and farming REWARD on OneDEX instead of buying directly.

***

### ✅ Best Practices

* Always ensure your wallet has enough EGLD, REWARD, and supported tokens before sending/tipping.
* Use `/list-projects` to check wallet status and balances.
* Donate to the Community Fund to support more tips and games!
