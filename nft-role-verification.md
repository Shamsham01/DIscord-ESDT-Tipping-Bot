---
description: >-
  Automatically grant or remove a Discord role when members satisfy both
  MultiversX wallet NFT holdings and Virtual Account inventory rules.
---

# NFT role verification

Admins can define **rules** that tie a Discord **role** to MultiversX **NFT collections**. The bot evaluates members on a **daily** schedule (and on demand with **`run-now`**) and manages the role for you.

## How eligibility works (both must pass)

Each rule checks **two** things for every candidate member:

1. **Wallet leg** — The member must have a **registered wallet** (`/set-wallet`). The bot uses the [MultiversX public API](https://api.multiversx.com) to count NFTs in the configured collections on that address. Calls are **paced at most one per second** for this feature only (daily sync can take many minutes), with **retries** on rate limits. If the API still cannot be read for that member in this run, their role is **not changed** (no grant and **no revoke** on ambiguity).
2. **Virtual Account (VA) leg** — The member must hold enough of the same collections in their **NFT Virtual Account**, counting **staked** NFTs. Balance that is **fully locked** in an active **marketplace listing** or **auction** does **not** count toward the VA leg.

The member gets the role only when **both** legs satisfy the same **match mode** and **minimum count** (see below).

## Match mode and minimum count

- **`any`** — At least **one** of the listed collections must meet the minimum count (per collection) on **each** leg (wallet and VA separately).
- **`all`** — **Every** listed collection must meet the minimum count on **each** leg.

**Minimum count** applies per collection (default: `1`).

## Who is checked

For each rule, the bot builds a list of Discord users from:

- Everyone with a **`user_wallets`** row in the server,
- Everyone with **NFT VA balance** rows in the server,
- Members who **already have** the managed role (so the role can be removed if they no longer qualify).

Users who left the server are skipped.

## Notifications

When you **create** a rule, the bot posts a **confirmation embed** in the **notification channel** you chose (rule id, role, collections, match mode, creator).

On each **sync run**, the bot sends **batched embeds** to that same channel listing **grants** and **removals** (when there are changes).

## Commands (Administrator only)

All subcommands are under **`/nft-role-verification`**.

### `create`

Creates a rule and sends the setup confirmation to the notification channel.

**Parameters**

- `role` — Discord role to grant when eligible.
- `notification-channel` — Text, announcement, or thread channel for setup + sync messages. The bot needs **View Channel**, **Send Messages**, and **Embed Links** there.
- `collections` — Comma-separated MultiversX **collection tickers** (same identifiers as VA and API).
- `match-mode` (optional) — `any` (default) or `all`.
- `min-count` (optional) — Minimum NFT count per collection (integer ≥ 1, default `1`).

### `list`

Lists all rules for the server (with ids) and shows a **select menu** to **toggle** enabled/disabled for up to 25 rules.

### `delete`

Deletes a rule by **UUID** (copy from `list` output).

**Parameters**

- `rule-id` — Full rule id (use **autocomplete**: `RoleName · first8…last8`, or paste from `list`).

### `toggle`

Enables or disables a rule by UUID (same as using the list menu toggle).

**Parameters**

- `rule-id` — Full rule id (use **autocomplete**: `RoleName · first8…last8`, or paste from `list`).

### `run-now`

Runs the verification sync **immediately** for the **current server** only (useful after changing rules or for testing). Replies with a short summary (rules processed, grants, revokes, errors).

## Bot and Supabase requirements

- The bot must be able **Manage Roles** and its **highest role** must be **above** the role it assigns.
- Do **not** use integration-managed roles.
- The `guild_nft_role_rules` table must allow the bot’s Supabase client to read/write rows (same pattern as other guild tables; if you use RLS, add policies or use a service role for the bot).

## Operational tips

- Members must run **`/set-wallet`** or the wallet leg never passes.
- NFTs only on-chain and **never deposited** to the VA will fail the VA leg.
- Use **`run-now`** after creating or editing rules if you do not want to wait for the next daily run.
