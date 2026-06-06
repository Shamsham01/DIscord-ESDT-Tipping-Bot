---
description: >-
  Guild on-chain plan — subscribe to unlock withdrawals, admin sends, swaps,
  MakeX API fee waivers, and staking pool fee benefits.
---

# On-Chain Subscription Plan

Servers need an **active on-chain plan** to use blockchain operations from **Project Wallets** and the **Community Fund**. Virtual Account operations (tips, games, in-ledger transfers) work **without** a subscription.

***

## What requires an active plan?

When the plan is **inactive or expired**, the bot blocks these **on-chain** actions:

| Area | Examples |
|------|----------|
| **User withdrawals** | `/withdraw-esdt`, `/withdraw-nft`, `/withdraw-nft-bulk` |
| **Admin sends** | `/send-esdt`, `/send-nft` from project wallets |
| **Community Fund on-chain** | `/house-withdraw`, AshSwap `/swap` approval, mass refunds |
| **Cross-guild** | `/transfer-cross-guild-nft` (on-chain leg between funds) |
| **Staking pool fee** | One-time REWARD pool-creation fee — **waived** when plan is active |

**Still works without a plan:**

* Deposits to the Community Fund (blockchain listener credits Virtual Accounts)
* `/tip-virtual-esdt`, `/tip-virtual-nft`, RPS, lotteries, auctions (in-ledger)
* `/transfer-cross-guild-esdt` (ledger-only, no chain tx)
* `/check-balance-esdt`, `/balance-history`, wallet registration

{% hint style="warning" %}
**On-chain = blocked without a plan.** Users may see an error asking an administrator to run `/subscribe-on-chain-plan`.
{% endhint %}

***

## Pricing (USDC)

Paid from the **subscribing administrator’s Virtual Account** in **USDC** (`USDC-c76f1f`). The bot transfers the same amount **on-chain** from the **Community Fund** to the HODL Token Club treasury wallet, then deducts your VA balance.

| Plan | Price | Discount |
|------|-------|----------|
| 1 month | **10 USDC** | — |
| 3 months | **20 USDC** | 10 USDC off |
| 6 months | **40 USDC** | 20 USDC off |
| 12 months | **60 USDC** | 60 USDC off |

**Before subscribing, ensure:**

1. **Community Fund** is configured (`/set-community-fund`)
2. Subscribing admin has enough **USDC** in their Virtual Account
3. Community Fund holds enough **USDC** on-chain for the payment
4. Community Fund has **EGLD** for gas (≥ **0.08 EGLD** recommended)

***

## Commands

### `/subscribe-on-chain-plan` (Admin)

Subscribe or renew the server’s on-chain plan.

```
/subscribe-on-chain-plan plan:1_month
```

**Plan choices:** `1 Month — 10 USDC`, `3 Months — 20 USDC`, `6 Months — 40 USDC`, `12 Months — 60 USDC`

**What happens:**

1. Admin permission check
2. USDC balance check (admin VA + Community Fund on-chain)
3. **Provisional MakeX whitelist** — if the Community Fund is not already whitelisted, all guild wallets are written to MakeX Supabase as `valid` *before* the payment is broadcast (so MakeX API usage fees are waived)
4. On-chain USDC transfer: Community Fund → treasury
5. **On-chain confirmation** — payment tx must reach `success` on MultiversX
6. **Confirm whitelist** — finalize entries (or rollback provisional whitelist if payment fails)
7. Subscription record saved (including **your Discord ID** for expiry reminders)
8. VA deduction from subscribing admin

If the on-chain payment fails, provisional whitelist entries are **rolled back** to their previous state and your VA is **not** deducted.

**Renewals stack:** If the plan is still active, new months are added to the current end date.

### `/on-chain-subscription-status` (Admin)

View plan status, expiry date, who subscribed, and MakeX whitelist sync preview.

```
/on-chain-subscription-status
```

***

## MakeX API fee waiver

MakeX charges **REWARD** usage fees on API calls unless a wallet is on the **usage fee whitelist**.

When your on-chain plan is active, the bot automatically maintains whitelist entries for:

* **Community Fund** wallet
* **Every registered project** wallet

Whitelist entries use the subscription end date. You only need **EGLD** for on-chain gas — not REWARD for MakeX API fees.

{% hint style="info" %}
MakeX whitelist is stored in a **separate Supabase project** (MakeX infrastructure). The bot’s own database stores subscription metadata and the subscribing admin’s Discord ID.
{% endhint %}

***

## Staking pool creation fee

Creating an NFT staking pool (`/create-staking-pool`) normally charges a one-time **REWARD** fee (default ~$5 USD equivalent).

**With an active on-chain plan:** this fee is **waived**.

You still pay the **initial reward supply** from your Virtual Account as usual.

***

## Expiry reminders

About **7 days before** expiry, the bot DMs the **administrator who subscribed** (`/subscribe-on-chain-plan`) with a renewal reminder.

Renew with `/subscribe-on-chain-plan` before expiry to avoid interruption of withdrawals and on-chain sends.

{% hint style="success" %}
**Legacy / manually whitelisted servers:** If your wallets were whitelisted directly in MakeX (e.g. until 31/12/2026), on-chain transfers continue to work via that whitelist. Expiry DMs only apply after someone subscribes via the bot command (which records their Discord ID).
{% endhint %}

***

## New wallets after subscribing

When you register a new project (`/register-project`) or recreate the Community Fund (`/set-community-fund`) **while the plan is active**, the new wallet address is **automatically added** to the MakeX whitelist.

***

## Setup checklist for bot operators

On the **hosting environment** (e.g. Render), configure:

```env
MAKEX_SUPABASE_URL=<MakeX Supabase project URL>
MAKEX_SUPABASE_SERVICE_ROLE_KEY=<service role key>
MAKEX_WHITELIST_CONTACT_EMAIL=   # optional
```

On the **bot Supabase** project, run the migration that creates `guild_on_chain_subscriptions`.

***

## Related documentation

* [Admin Setup Guide](admin-setup-guide.md) — projects, Community Fund, permissions
* [Registering Projects](getting-started/registering-projects.md) — wallet types and fees
* [Sending Tokens and Tips](getting-started/sending-tokens-and-tips.md) — EGLD vs on-chain vs VA
* [User Guide — Withdrawing](user-guide.md#withdrawing-to-your-wallet) — user-facing withdraw requirements
* [Admin Commands Reference](admin-commands-reference.md) — full command details
