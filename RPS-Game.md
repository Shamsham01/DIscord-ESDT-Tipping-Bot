# Rock, Paper, Scissors (RPS) Game

## Game Overview

The RPS game lets two Discord users compete for ESDT tokens in a fair, peer-to-peer (P2P) challenge. The Community Fund wallet acts as a secure middleman (like a smart contract), holding both players’ entry funds and ensuring the winner receives the full prize.

## How It Works

### 1. Challenge Creation

- **Challenger**: Initiates the game by choosing a token and amount to wager.
- The challenger must send the chosen amount of the selected token to the Community Fund wallet (set by server admins).
- After sending, the challenger copies the transaction hash (tx hash) and uses the `/challenge-rps` command to create the challenge, providing:
  - The Discord tag of the user they want to challenge
  - The token ticker (e.g., MEX, RIDE)
  - The amount
  - The transaction hash (no URL, just the hash string)

### 2. Challenge Notification

- The challenged user is notified in the channel and via DM (if their DMs are open).
- The notification includes the token, amount, and instructions to join.

### 3. Accepting the Challenge

- The challenged user reviews the token and amount.
- If they accept, they must send the **same amount** of the **same token** to the Community Fund wallet.
- After sending, they copy their transaction hash and use the `/join-rps` command, selecting the challenge and providing their tx hash.
- The bot verifies that both deposits match in token and amount.

### 4. Game Play

- Once both players have joined and deposited, the game becomes active.
- Players take turns making their moves (rock, paper, or scissors) using the `/play-rps` command.
- The winner is determined by standard RPS rules:
  - Rock beats Scissors
  - Scissors beats Paper
  - Paper beats Rock
  - If both pick the same, it’s a draw and a new round starts.

### 5. Prize Distribution

- The winner receives the **total prize** (both players’ deposits) directly from the Community Fund wallet.
- The bot announces the winner in the channel and sends a DM (if possible), including transaction details.

## Game Rules & Dynamics

- **Both players must deposit the same amount and token.** The bot enforces this by verifying transaction hashes and amounts.
- **No self-challenges:** You cannot challenge yourself.
- **No duplicate tx hashes:** Each transaction hash can only be used once.
- **Timeout & Refunds:** If the challenged user does not join within 30 minutes, the challenge expires and the challenger is automatically refunded.
  - Refunds are processed automatically the next time any ESDT Tipping Bot command is used in the server.
  - To trigger an instant refund, the challenger can run `/list-rps-challenges` after the 30-minute window.
- **Transparency:** All moves, results, and prize transfers are announced in the channel for fairness.

## Example Flow

1. Alice wants to challenge Bob for 100 MEX.
2. Alice sends 100 MEX to the Community Fund wallet and copies the tx hash.
3. Alice runs `/challenge-rps` with Bob’s tag, “MEX”, “100”, and her tx hash.
4. Bob is notified. If he accepts, he sends 100 MEX to the Community Fund wallet and copies his tx hash.
5. Bob runs `/join-rps`, selects the challenge, and enters his tx hash.
6. The game starts. Both play their moves using `/play-rps`.
7. The winner receives 200 MEX, and the result is announced.

---

**Tip:** Always double-check the token and amount before joining a challenge. Only join games you trust! 