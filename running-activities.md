---
description: Guide for running lotteries, football betting, NFT auctions, and Rock Paper Scissors games
---

# Running Activities

This section covers how to set up and run different activities for your community.

## Lotteries

Lotteries allow users to buy tickets with a chance to win prizes.

### Creating a Lottery

```
/create-lottery winning-numbers total-numbers token ticket-price drawing-frequency [house-commission] [channel] [initial-prize-pool]
```

#### Parameters Explained

- **`winning-numbers`**: How many numbers users need to match to win (e.g., `3`)
- **`total-numbers`**: Total pool of numbers to choose from (e.g., `50`)
- **`token`**: Token ticker for tickets (e.g., `REWARD-cf6eac`)
- **`ticket-price`**: Price per ticket in tokens (e.g., `10`)
- **`drawing-frequency`**: When to draw winners:
  - `daily` - Every 24 hours
  - `weekly` - Once per week
  - `manual` - Admin triggers draw manually
- **`house-commission`** (Optional): Percentage the house takes (e.g., `5` for 5%)
- **`channel`** (Optional): Channel to post lottery (default: current channel)
- **`initial-prize-pool`** (Optional): Starting prize pool from Lottery House

#### Example

```
/create-lottery 3 50 REWARD-cf6eac 10 daily 5 #lottery 1000
```

This creates:
- Match 3 out of 50 numbers
- 10 REWARD tokens per ticket
- Daily drawings
- 5% house commission
- Posted in #lottery channel
- 1000 tokens initial prize pool (from Lottery House)

### How Lotteries Work

1. **Users Buy Tickets**: Users purchase tickets using their Virtual Account balance
2. **Prize Pool Grows**: Each ticket purchase adds to the prize pool
3. **House Commission**: A percentage goes to Lottery House
4. **Drawing**: At the scheduled time, winning numbers are drawn
5. **Winners**: Users with matching numbers split the prize pool (minus commission)
6. **Rollover**: If no winners, prize pool rolls over to next drawing

### Managing Lotteries

- **View Active Lotteries**: Check the lottery embed in the channel
- **Manual Draw**: Use button on lottery embed to trigger draw early
- **View Results**: Click "View Results" button on lottery embed

### Using House Balance for Lotteries

When creating a lottery, you can fund the initial prize pool from Lottery House by specifying `initial-prize-pool`. The bot will:
1. Check Lottery House balance for that token
2. Deduct the amount from Lottery House
3. Add it to the lottery's prize pool

This allows you to seed lotteries with funds from previous lottery commissions.

---

## Football Betting

Football betting allows users to bet on real football matches.

### Creating Football Fixtures

```
/create-fixtures competition token amount [channel]
```

#### Parameters Explained

- **`competition`**: Competition code (e.g., `PL` for Premier League, `CL` for Champions League)
- **`token`**: Token ticker for bets (e.g., `REWARD-cf6eac`)
- **`amount`**: Bet amount per match (e.g., `100`)
- **`channel`** (Optional): Channel to post matches (default: current channel)

#### Example

```
/create-fixtures PL REWARD-cf6eac 100 #betting
```

This creates betting opportunities for all Premier League matches with:
- 100 REWARD tokens per bet
- Posted in #betting channel

### How Football Betting Works

1. **Admin Creates Fixtures**: Bot fetches upcoming matches from Football-Data.org API
2. **Matches Posted**: Each match gets its own thread with betting options
3. **Users Place Bets**: Users bet on Home Win, Draw, or Away Win using Virtual Account balance
4. **Match Ends**: Bot automatically processes results
5. **Winners Paid**: Winners split the pot equally
6. **No Winners**: If no one bet correctly, all bets go to Betting House

### Betting Options

Users can bet on:
- **Home Win** (1) - Home team wins
- **Draw** (X) - Match ends in a draw
- **Away Win** (2) - Away team wins

### Viewing Statistics

- **Leaderboard**: `/leaderboard` - Top bettors
- **Filtered Leaderboard**: `/leaderboard-filtered` - By date range or competition
- **Your Stats**: `/my-football-stats` - Your betting statistics and PNL

### House Balance Integration

When a match has **no winners**, all bets go to the Betting House. This balance can be:
- Used to fund prizes for special matches
- Tipped to users via `/house-tip`
- Viewed with `/house-balance`

---

## NFT Auctions

NFT auctions allow users to sell NFTs to the highest bidder.

### Creating an Auction

```
/create-auction collection nft-name starting-amount duration [token] [min-bid-increase] [title] [description]
```

#### Parameters Explained

- **`collection`**: NFT collection identifier (e.g., `COLLECTION-abc123`)
- **`nft-name`**: Specific NFT name (e.g., `NFT-NAME-1`)
- **`starting-amount`**: Starting bid amount (e.g., `100`)
- **`duration`**: Auction duration in hours (e.g., `24`)
- **`token`** (Optional): Token for bidding (default: Community Fund token)
- **`min-bid-increase`** (Optional): Minimum bid increase (e.g., `10`)
- **`title`** (Optional): Auction title
- **`description`** (Optional): Auction description

#### Example

```
/create-auction COLLECTION-abc123 NFT-NAME-1 100 24 REWARD-cf6eac 10 "Rare NFT" "One of a kind collectible"
```

### How Auctions Work

1. **Auction Created**: Admin creates auction with starting bid
2. **Users Bid**: Users place bids using Virtual Account balance
3. **Bid Validation**: Each bid must exceed previous bid + minimum increase
4. **Auction Ends**: Automatically closes at end time
5. **Winner Pays**: Highest bidder's balance is deducted
6. **Seller Receives**: Payment goes to Auction House (or seller's account)
7. **NFT Transferred**: NFT sent to winner's wallet

### Bidding

Users click "Place Bid" button on auction embed and enter bid amount in modal.

### House Balance Integration

When an NFT is sold at auction, the sale amount goes to Auction House. This balance can be:
- Used to pay NFT sellers
- Tipped to users via `/house-tip`
- Viewed with `/house-balance`

---

## Rock Paper Scissors

Rock Paper Scissors allows users to challenge each other with token prizes.

### How RPS Works

1. **Challenge Created**: User challenges another user with a bet amount
2. **Challenge Accepted**: Other user joins by matching the bet
3. **Players Make Moves**: Both players choose Rock, Paper, or Scissors
4. **Winner Determined**: Standard RPS rules apply
5. **Prize Distributed**: Winner receives total pot (both bets)
6. **Draw Handling**: If draw, game continues with additional rounds

### Creating a Challenge

Users create challenges with:

```
/challenge-rps user-tag bet-amount [token] [memo] [public]
```

#### Parameters

- **`user-tag`**: Discord user to challenge
- **`bet-amount`**: Amount to bet
- **`token`** (Optional): Token to use (default: Community Fund token)
- **`memo`** (Optional): Optional message
- **`public`** (Optional): Show publicly or privately

#### Example

```
/challenge-rps @user 100 REWARD-cf6eac "Let's play!" true
```

### Joining a Challenge

The challenged user can join by matching the bet. They use their Virtual Account balance - no transaction hash needed!

### Viewing Challenges

```
/list-rps-challenges [public]
```

Shows all active and waiting challenges.

### Virtual Account Integration

RPS challenges use Virtual Account balance, so users don't need to:
- Provide transaction hashes
- Wait for blockchain confirmations
- Pay gas fees for each game

The bot automatically deducts from Virtual Accounts when challenges are created and joined.

---

## Best Practices

### For Lotteries

- Start with a reasonable ticket price
- Set appropriate house commission (5-10% is common)
- Use House Balance to seed initial prize pools
- Monitor ticket sales and adjust frequency if needed

### For Football Betting

- Choose popular competitions for better engagement
- Set reasonable bet amounts
- Monitor House Balance from no-winner matches
- Use filtered leaderboards to track performance

### For Auctions

- Set realistic starting bids
- Use appropriate minimum bid increases
- Provide clear descriptions and titles
- Monitor Auction House balance

### For RPS

- Encourage fair play
- Set reasonable bet amounts
- Monitor challenge activity
- Use Virtual Accounts for seamless gameplay

---

## Troubleshooting

### Lottery Not Drawing

- Check if drawing frequency is set correctly
- Verify lottery is still active
- Use manual draw button if needed

### Football Matches Not Appearing

- Check Football-Data.org API connectivity: `/test-football-api`
- Verify channel permissions (Create Public Threads)
- Check competition code is valid

### Auction Not Closing

- Verify auction end time
- Check if auction is still active
- Manually close if needed

### RPS Challenge Not Working

- Verify both users have sufficient Virtual Account balance
- Check Community Fund is set up
- Ensure users have registered wallets

---

For more detailed information on each activity, refer to the specific sections in the documentation.

