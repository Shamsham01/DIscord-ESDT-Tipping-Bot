---
description: >-
  Automatically grant or remove Discord roles based on NFT collection rules tied to MvX-linked wallets and/or Virtual Account inventory.
---

# NFT role verification

Admins define **rules** that tie a **role** to MultiversX **NFT collections**. The bot runs on a **daily** schedule (and **`/nft-role-verification run-now`**) over **candidate members**.

## Eligibility modes (per rule)

Each rule has an **`eligibility_mode`** (`wallet_and_va`, `wallet_or_va`, `wallet_only`, `va_only`):

| Mode | Meaning |
| --- | --- |
| **`wallet_and_va`** | MvX-linked wallet **and** Virtual Account must satisfy the collection rule. |
| **`wallet_or_va`** *(default on **slash create**, recommended)* | Satisfy **either** the MvX wallet leg **or** the VA leg. If VA already qualifies, the bot **skips MvX paging** for that member (fewer API calls). |
| **`wallet_only`** | Only the linked wallet (MvX) counts; VA is ignored. |
| **`va_only`** | Only VA (Supabase) counts; MvX is not queried. |

**Match mode (`any` / `all`)** and **minimum count per collection** apply **per leg that runs** — e.g. with `wallet_or_va`, the member passes if **either** leg meets the thresholds.

Legacy rows keep DB default **`wallet_and_va`** unless you patch them via **`create`** → **`rule-id`** (below).

## Wallet vs Virtual Account legs

1. **Wallet (MvX)** — Uses `/set-wallet` for the Discord user. Counts NFTs/SFTs via [MultiversX API](https://api.multiversx.com) `/accounts/{address}/nfts?collections=...`. Requests are paced with backoff on 429/5xx. **If MvX cannot be verified** for a decision that depends on the wallet leg, that member may be left **unchanged**. Collection matching is **ASCII case-insensitive**.
2. **Virtual Account** — Uses Supabase NFT VA balances (**staked** counts; excludes balance fully locked in **active listing/auction** when applicable logic runs).

Notifications and diag embeds show which legs were evaluated and ✅/❌ per collection ticker.

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

**New rule** — Provide **`role`**, **`notification-channel`**, **`collections`**, optional **`match-mode`**, **`min-count`**, and **`eligibility`**. Slash default for **`eligibility`** is **`wallet_or_va`** (both strict still available via explicit choice).

**Update eligibility only** — Set **`rule-id`** (autocomplete); set **`eligibility`** to the new mode and **omit** role, notification channel, and collections. Saves one subcommand versus recreating rules.

Confirmation embed posts to the channel only on **new** rule creation.

**Parameters**

- `rule-id` (optional) — If set: **updates eligibility** for this rule UUID (use **autocomplete**). Other create fields omitted.
- `role` — Required **unless** patching via `rule-id` only.
- `notification-channel` — Required **unless** patching via `rule-id` only.
- `collections` — Required **unless** patching via `rule-id` only.
- `match-mode` (optional) — `any` (default) or `all` (creates only).
- `min-count` (optional) — Minimum NFT count per collection (integer ≥ 1, default `1`, creates only).
- `eligibility` (optional, default **`wallet_or_va`** on create / patch path) — `wallet_and_va`, `wallet_or_va`, `wallet_only`, or `va_only`.

### `list`

Lists all rules for the server (with ids) and shows a **select menu** to **toggle** enabled/disabled for up to 25 rules.

### `delete`

Deletes a rule by **UUID** (copy from `list` output).

**Parameters**

- `rule-id` — Full rule id (use **autocomplete**: `RoleName · first8…last8`, or paste from `list`).

### `toggle`

Enables or disables a rule by UUID (same as using the list menu toggle).

**Parameters**

- `rule-id` — Full rule id (use **autocomplete**, or paste from `list`).

### `run-now`

Runs the verification sync **immediately** for the **current server** only (useful after changing rules or for testing). Replies with a short summary (rules processed, grants, revokes, errors).

## Bot and Supabase requirements

- The bot needs the **Manage Roles** permission (invite default in **[Getting started → Invite the bot](../getting-started/README.md)**) and its **highest role** must be **above** the role it assigns.
- Do **not** use integration-managed roles.
- The `guild_nft_role_rules` table includes **`eligibility_mode`** (`TEXT`, default **`wallet_and_va`**). Apply the repo migration **`20260514_guild_nft_role_rules_eligibility_mode.sql`** (or mirror it in hosted Supabase).

## Operational tips

- For **on-wallet-only** holders without VA inventory mirrored in Supabase, use **`wallet_or_va`** or **`wallet_only`**.
- **`wallet_and_va`** is strict; if VA is wrong or stale, deserving members will not be granted roles.
- MvX-linked **wallet counts** still require **`/set-wallet`** for that Discord user unless the rule is **`va_only`**.
- Run **`run-now`** after changing **`eligibility_mode`** (**`create`** with **`rule-id`**) so grants catch up faster than the daily job.
