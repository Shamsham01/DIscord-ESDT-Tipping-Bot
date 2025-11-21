---
description: >-
  This page explains how admins can send ESDT, NFT tokens and tips, and how
  users can initiate P2P tips using the ESDT Tipping Bot.
---

# Sending Tokens and Tips

***

### 🏦 Admin Transfers, Tips & Auctions

* **Admins** can use `/send-esdt` or `/send-nft` to send tokens, NFTs, and SFTs from a Project Wallet to any user (on-chain transfers)
* **Admins** can use `/create-auction` to list NFT or SFT from Project Wallet. The raised tokens will be credited to House Balance and can be withdrawn to Project Wallet anytime using `/house-withdraw`

**Note**: The bot supports both NFTs (Non-Fungible Tokens) and SFTs (Semi-Fungible Tokens). SFTs have a quantity (amount) field. All NFT-related commands work with both NFTs and SFTs.
* **Project Owners** can donate tokens to the Community Fund to support community tipping and games.

***

### 🤝 P2P Tips (Community Fund)

* **Any user** can tip another user using `/tip-virtual-esdt` or `/tip-virtual-nft` if a Community Fund is set.
* **Users** must register wallet first using `/set-wallet` and ensure they have sufficient amount of supported tokens on Virtual Account to facilitate tips.

**Note**: `/tip-virtual-nft` supports both NFTs and SFTs. For SFTs, you can specify the `amount` parameter to tip a specific quantity.

***

### 💡 Wallet Funding Requirements

* **Both Project and Community Fund wallets must hold:**
  * **EGLD** (for blockchain transaction fees)
  * **REWARD** (for MakeX API usageFee)

{% hint style="danger" %}
If any of these are missing, on-chain transfers and withdraws will not work! Before every on-chain transfer, bot will check if there is sufficient amount of EGLD and REWARD to cover transfer fees.
{% endhint %}

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
  * `/send-nft` - Sending NFTs and SFTs
  * `/house-withdraw` - Withdrawing from House Balance to Project Wallets
* This is because all operations result in **on-chain blockchain transfers**

#### Community Fund (Virtual Account Operations)

* **Most operations are FREE**: Virtual Account operations do **NOT charge usageFee**
* **Commands that are FREE**:
  * `/tip-virtual-esdt` - User-to-user tips
  * `/tip-virtual-nft` - User-to-user NFT/SFT transfers
  * `/challenge-rps` - RPS game challenges
* **Commands that DO charge usageFee**:
  * `/withdraw-esdt` - Withdrawing ESDT to user wallets (on-chain transfer)
  * `/withdraw-nft` - Withdrawing NFT/SFT to user wallets (on-chain transfer)

**Why the difference?**

* Project Wallet operations = On-chain transfers = UsageFee charged
* Community Fund Virtual Account operations = Balance updates only = No UsageFee
* Withdrawals = On-chain transfers = UsageFee charged

**Buy REWARD:** Buy REWARD on any DEX or in xPortal.&#x20;

{% hint style="success" %}
**Pro Tip:** We strongly recommend investing in [HODL Token Club](https://hodltokenclub.gitbook.io/hodl-token-club-litepaper-v2/) DeFi and farming REWARD on [OneDEX](https://swap.onedex.app/pool) instead of buying directly. That way projects using bot will generate sufficient amount of REWARDs without need of buying.
{% endhint %}

***

### ✅ Best Practices

* Always ensure Community Fund or Project Wallet has enough EGLD, REWARD, before initiating on-chain transfers.
* Use `/list-projects` to check server wallets.
* Always check list of supported tokens using `/show-community-fund-address` before top-up.

{% hint style="success" %}
**Safety Feature**: If you send tokens to the Community Fund **before** registering your wallet, don't worry! The bot automatically stores these transactions and credits them to your account when you register your wallet. The bot processes transactions from the last 30 days when you register.

**Best Practice**: While the safety feature protects you, it's still recommended to register your wallet first, then top-up. Always send small amounts first to verify successful Virtual Account creation.
{% endhint %}
