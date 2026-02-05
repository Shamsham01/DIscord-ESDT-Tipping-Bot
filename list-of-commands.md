# 📋 List of Commands

Below is a list of all available commands for the ESDT Tipping Bot, grouped by category.

---

## 🛠️ Setup and Management

- **/set-wallet** — Register your MultiversX wallet address with the bot.
- **/register-project** — Admins: Register a new project wallet for sending tokens.
- **/update-project** — Admins: Update details for an existing project wallet.
- **/delete-project** — Admins: Delete a registered project wallet.
- **/set-community-fund** — Admins: Set a project wallet as the Community Fund for P2P tips and games. Optionally include QR code URL for game embeds.
- **/list-wallets** — Admins: List all registered user wallets in the server.
- **/list-projects** — List all registered project wallets.

---

## 💸 Tipping and Transfers

- **/send-esdt** — Admins: Send ESDT tokens from a project wallet to any user.
- **/tip** — Send a random tip (from the Community Fund) to another user.
- **/transfer-cross-guild-esdt** — Transfer ESDT tokens between your Virtual Accounts across different Discord servers.
- **/transfer-cross-guild-nft** — Transfer NFTs/SFTs between your Virtual Accounts across different Discord servers.

---

## 🎮 RPS Game

- **/challenge-rps** — Challenge another user to a Rock, Paper, Scissors game (requires transaction hash).
- **/join-rps** — Join an existing RPS challenge by matching the bet (requires transaction hash).
- **/play-rps** — Play your move (Rock, Paper, or Scissors) in an active RPS game.
- **/list-rps-challenges** — View all active and waiting RPS challenges.

---

## 🪂 DROP Game

- **/start-drop-game-automation** — Admins: Start automated DROP Game with hourly rounds and weekly leaderboard.
- **/stop-drop-game-automation** — Admins: Stop the active DROP Game automation.
- **/show-drop-game-leaderboard** — View the current weekly leaderboard with points and rankings.

**Note**: Users participate by reacting with 🪂 emoji on the DROP Game embed. No commands needed!

---

## 🔔 Activity Subscriptions

- **/subscribe-activity** — Admins: Subscribe your server to receive activities (Auctions, Listings, or Lotteries) from all other servers. Activities will be automatically forwarded to the specified channel.
- **/unsubscribe-activity** — Admins: Unsubscribe your server from receiving activities. You can unsubscribe from a specific channel or all channels for an activity type.

**Supported Activity Types:**
- NFT Auctions
- NFT Listings
- ESDT Lotteries

---

For more details on each command, use `/help` or refer to the documentation. 