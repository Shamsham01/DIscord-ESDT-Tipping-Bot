---
description: >-
  This page explains how admins can send ESDT, NFT tokens and tips, and how
  users can initiate P2P tips using the ESDT Tipping Bot.
---

# Sending Tokens and Tips

***

### 🏦 Admin Transfers, Tips & Auctions

* **Admins** can use `/send-esdt` or `/send-nft` to send tokens, NFTs, and SFTs from a Project Wallet to any user (on-chain transfers — requires an **active on-chain plan**; see [On-Chain Subscription Plan](../on-chain-subscription.md))
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

* **Active on-chain plan** — Server must have subscribed via `/subscribe-on-chain-plan` (or valid legacy MakeX whitelist) before any on-chain send or withdraw.
* **Project and Community Fund wallets must hold enough EGLD** for blockchain transaction fees (minimum **0.08 EGLD** enforced before each on-chain transfer).
* **MakeX usage fees are waived** for whitelisted bot wallets (auto-synced when plan is active) — you do **not** need REWARD for API usage fees.

{% hint style="danger" %}
Without an active on-chain plan, withdrawals and admin on-chain sends are blocked. If EGLD is too low, on-chain transfers are also blocked. Use `/on-chain-subscription-status` and `/check-community-fund-balance` to diagnose.
{% endhint %}

***

### 🔍 Checking Wallets & Balances

* Use `/list-projects` to see all registered wallets, which is the Project main wallet, and which is set as the Community Fund.
* The Community Fund wallet's MultiversX explorer link is embedded in the button on Community Tip notifications—click to view wallet address and token balances.

***

### 💸 Fees: EGLD vs Virtual Account operations

**On-chain plan** — Subscribe with `/subscribe-on-chain-plan` (USDC; see [On-Chain Subscription Plan](../on-chain-subscription.md)).

**MakeX usage fees** (`usageFee` in REWARD) are **waived** for whitelisted Project and Community Fund wallets. You only need **EGLD** for on-chain gas.

#### Project Wallets (Admin-Controlled)

* On-chain commands (`/send-esdt`, `/send-nft`, `/house-withdraw`, etc.) require an **active on-chain plan** and **EGLD** in the project wallet (≥ **0.08 EGLD** minimum).

#### Community Fund

* **In-ledger (no plan, no gas)**: `/tip-virtual-esdt`, `/tip-virtual-nft`, `/challenge-rps`, and similar — balance updates only.
* **On-chain (plan + EGLD)**: `/withdraw-esdt`, `/withdraw-nft`, `/withdraw-nft-bulk`, cross-guild NFT transfers, swaps, mass refunds — plan and EGLD checked before each transaction.

**Ledger health:** Admins can run `/sync-community-fund-ledger` to verify that Community Fund on-chain holdings match virtual account + house ledger totals (ESDT, NFT, SFT).

***

### ✅ Best Practices

* Always ensure Community Fund or Project Wallet has enough **EGLD** before initiating on-chain transfers.
* Use `/list-projects` to check server wallets.
* Always check list of supported tokens using `/show-community-fund-address` before top-up.

{% hint style="success" %}
**Safety Feature**: If you send tokens to the Community Fund **before** registering your wallet, don't worry! The bot automatically stores these transactions and credits them to your account when you register your wallet. The bot processes transactions from the last 30 days when you register.

**Best Practice**: While the safety feature protects you, it's still recommended to register your wallet first, then top-up. Always send small amounts first to verify successful Virtual Account creation.
{% endhint %}
