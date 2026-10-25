---
description: >-
  Automatically grant or remove Discord roles based on NFT collection rules tied to MvX-linked wallets and/or Virtual Account inventory.
---

# NFT role verification

Admins define **rules** that tie a **role** to MultiversX **NFT collections**. Automated mode **spreads candidate members evenly across 24 hours** (a slice every **10 minutes**, both guilds sharing the same drip so they no longer all fire at once). **`/nft-role-verification run-now`** still checks the current server immediately.

## Eligibility modes (per rule)

Each rule has an **`eligibility_mode`** (`wallet_and_va`, `wallet_or_va`, `wallet_only`, `va_only`):

| Mode | Meaning |
| --- | --- |
| **`wallet_and_va`** | MvX-linked wallet **and** Virtual Account must satisfy the collection rule. |
| **`wallet_or_va`** *(default on **slash create**, recommended)* | **Wallet and VA counts are added together** per collection (e.g. 218 on-chain + 35 staked in VA = 253). If VA **alone** already meets the minimum, the bot **skips the wallet indexer** for that member (fewer API calls). |
| **`wallet_only`** | Only the linked wallet (MvX) counts; VA is ignored. |
| **`va_only`** | Only VA (Supabase) counts; MvX is not queried. |

**Match mode (`any` / `all`)** and **minimum count per collection** apply to the counts used for that mode. With **`wallet_or_va`**, the threshold is applied to **wallet + VA combined** per ticker (a split holding that only totals over the min still qualifies). With **`wallet_and_va`**, each source must meet the threshold **on its own**.

Legacy rows keep DB default **`wallet_and_va`** unless you update them via **`create`** → **`rule-id`** (below).

## Wallet vs Virtual Account legs

1. **Wallet (OOX)** — Uses `/set-wallet` for the Discord user. Counts NFTs via [OOX](https://api.oox.art) `GET /accounts/{address}/collections/{ticker}` (one call per collection; includes marketplace custody attributed back to the owner). SFT/MetaESDT quantities still page NFT rows so nonce balances sum correctly. If OOX fails, the same collection-count endpoint on [MultiversX API](https://api.multiversx.com) is used. Requests are paced with backoff on 429/5xx. **If the wallet indexer cannot be verified** for a decision that depends on the wallet leg, that member may be left **unchanged**. Collection matching is **ASCII case-insensitive**.

   Full collection **holder snapshots** (`/collections/{ticker}/holders`) are **not** used for role checks: that OOX endpoint always embeds every `nftIds` list, which is far heavier than per-user counts for Discord-sized candidate sets. There is no public OOX CLI/SDK npm package; the bot calls the REST API directly.
2. **Virtual Account** — Uses Supabase NFT VA balances (**staked** counts; excludes balance fully locked in **active listing/auction** when applicable logic runs).

Notifications and diag embeds show wallet vs VA counts (and a **Combined** total for **`wallet_or_va`**) with ✅/❌ per collection ticker.

## Who is checked

For each rule, the bot builds a list of Discord users from:

- Everyone with a **`user_wallets`** row in the server,
- Everyone with **NFT VA balance** rows in the server,
- Members who **already have** the managed role (so the role can be removed if they no longer qualify).

Every enabled rule evaluates that full list. A check is stored **per rule**. If the wallet indexer cannot be verified, that member stays pending for **that rule** and is retried later; another role already succeeding does not count as a check. The cycle summary is posted only after every remaining member has actually been evaluated, and **Members checked** is shown as `checked / candidates`.

Users who left the server are skipped. The bot refreshes the guild member list so someone who still has the role but no longer has a wallet row is included and can be removed.

## Notifications

When you **create** a rule, the bot posts a **confirmation embed** in the **notification channel** you chose (rule id, role, collections, match mode, creator).

On each **sync run**, the bot sends **batched embeds** to that same channel listing **grants** and **removals** (when there are changes).

**Automated (scheduled) cycles** also post a **completion summary embed** per rule when that rule’s 24-hour pass finishes (members checked, grants, removals, errors) even when nothing changed. Grant/removal embeds still post as members are checked during the day. Manual **`run-now`** replies to the admin ephemerally instead.

## Commands (Administrator only)

All subcommands are under **`/nft-role-verification`**.

### `create`

**New rule** — Provide **`role`**, **`notification-channel`**, **`collections`**, optional **`match-mode`**, **`min-count`**, and **`eligibility`**. Slash default for **`eligibility`** is **`wallet_or_va`** (both strict still available via explicit choice).

**Update an existing rule** — Set **`rule-id`** (autocomplete), then supply **only** the field(s) you want to change: any of **`role`**, **`notification-channel`**, **`collections`**, **`match-mode`**, **`min-count`**, or **`eligibility`**. Fields you omit are left untouched, and the reply lists exactly what changed. Saves recreating rules just to move a channel or tweak a threshold.

Confirmation embed posts to the channel only on **new** rule creation.

**Parameters**

- `rule-id` (optional) — If set: **updates** this rule UUID (use **autocomplete**). Provide any subset of the fields below to change them; omitted fields are unchanged.
- `role` — Required **when creating**; optional when updating via `rule-id`.
- `notification-channel` — Required **when creating**; optional when updating via `rule-id`. Changing it reroutes future setup/sync notifications to the new channel.
- `collections` — Required **when creating**; optional when updating via `rule-id`.
- `match-mode` (optional) — `any` (default) or `all`.
- `min-count` (optional) — Minimum NFT count per collection (integer ≥ 1, default `1`).
- `eligibility` (optional, default **`wallet_or_va`** on create; only changed on update when explicitly provided) — `wallet_and_va`, `wallet_or_va` (wallet + VA **summed** per collection), `wallet_only`, or `va_only`.

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

Runs the verification sync **immediately** for the **current server** (useful after changing rules or for testing). Replies with a short summary (rules processed, grants, revokes, errors).

**Parameters**

- `rule-id` (optional) — If set: sync **only** this rule (use **autocomplete**). Omit to sync **all enabled** rules in the server. Disabled rules are rejected when targeted explicitly.

## Bot and Supabase requirements

- The bot needs the **Manage Roles** permission (invite default in **[Getting started → Invite the bot](../getting-started/README.md)**) and its **highest role** must be **above** the role it assigns.
- Do **not** use integration-managed roles.
- The `guild_nft_role_rules` table includes **`eligibility_mode`** (`TEXT`, default **`wallet_and_va`**). Apply the repo migration **`20260514_guild_nft_role_rules_eligibility_mode.sql`** (or mirror it in hosted Supabase).

## Operational tips

- For **on-wallet-only** holders without VA inventory mirrored in Supabase, use **`wallet_or_va`** or **`wallet_only`**. **`wallet_or_va`** also covers split holdings (part on-chain, part in VA).
- **`wallet_and_va`** is strict; if VA is wrong or stale, deserving members will not be granted roles.
- MvX-linked **wallet counts** still require **`/set-wallet`** for that Discord user unless the rule is **`va_only`**.
- Wallet collection counts are **cached for the duration of a tick / run-now**, so Dolphin/Shark/Whale-style rules on the same ticker do not each re-query OOX for the same address.
- Automated mode processes about `ceil(candidates / 144)` members every 10 minutes (144 ticks per 24h), so two guilds no longer dump every wallet at the same instant. After a restart the drip still respects that budget (no stampede).
- VA inventory queries **page past Supabase’s 1000-row default**, so large guild inventories are not silently truncated.
- Run **`run-now`** after updating a rule (**`create`** with **`rule-id`** — e.g. changing **`eligibility_mode`**, collections, or thresholds) so grants catch up immediately instead of waiting for that member’s next 24h slot.
