---
description: >-
  Guide for running lotteries, football betting, NFT/SFT auctions, and Rock
  Paper Scissors games
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

* **`winning-numbers`**: How many numbers users need to match to win (e.g., `3`)
* **`total-numbers`**: Total pool of numbers to choose from (e.g., `50`)
* **`token`**: Token ticker for tickets (e.g., `REWARD-cf6eac`)
* **`ticket-price`**: Price per ticket in tokens (e.g., `10`)
* **`drawing-frequency`**: When to draw winners:
  * `hourly` - every 1 hour
  * `daily` - Every 24 hours
  * `weekly` - Once per week
  * `monthly` - Once per month
* **`house-commission`** (Optional): Percentage the house takes (e.g., `5` for 5%)
* **`channel`** (Optional): Channel to post lottery (default: current channel)
* **`initial-prize-pool`** (Optional): Starting prize pool from Lottery House

#### Example

```
/create-lottery 3 50 REWARD-cf6eac 10 daily 5 #lottery 1000
```

This creates:

* Match 3 out of 50 numbers
* 10 REWARD tokens per ticket
* Daily drawings
* 5% house commission
* Posted in #lottery channel
* 1000 tokens initial prize pool (from Lottery House)

### How Lotteries Work

1. **Users Buy Tickets**: Users purchase tickets using their Virtual Account balance
2. **Prize Pool Grows**: Each ticket purchase adds to the prize pool
3. **House Commission**: A percentage goes to Lottery House
4. **Drawing**: At the scheduled time, winning numbers are drawn
5. **Winners**: Users with matching numbers split the prize pool (minus commission)
6. **Rollover**: If no winners, prize pool rolls over to next drawing

### Managing Lotteries

* **View Active Tickets**: Click button to see the list of current live tickets (in-play)
* **View Results**: Click button to see results (works only when lottery ends)
* `/my-lottery-stats`  - Shows lottery statistics
* `/my-expired-tickes`  - Shows all expired tickets ever bought
* `/my-active-tickets`  - same as using button **View Active Tickets**

### Using House Balance for Lotteries (Admins Only)

When creating a lottery, you can fund the initial prize pool from Lottery House by specifying `initial-prize-pool`. The bot will:

1. Check Lottery House balance for that token
2. Deduct the amount from Lottery House
3. Add it to the lottery's prize pool

This allows you to seed lotteries with funds from previous lottery commissions.

### Updating Lotteries

Admins can update active lotteries using the `/update-lottery` command:

```
/update-lottery lottery_id topup_prize_pool [update_ticket_price]
```

#### Parameters Explained

* **`lottery_id`** (Required): Select the lottery to update (autocomplete available)
* **`topup_prize_pool`** (Optional): Amount to add to the prize pool from Lottery House balance
* **`update_ticket_price`** (Optional): New ticket price for future ticket purchases

#### Important Notes

* Only **LIVE** lotteries can be updated
* Prize pool top-ups are deducted from Lottery House balance for the lottery's token
* Ticket price updates only affect new ticket purchases (existing tickets remain unchanged)
* At least one update option (`topup_prize_pool` or `update_ticket_price`) must be provided

#### Example

```
/update-lottery lottery-123 topup_prize_pool:500 update_ticket_price:15
```

This updates the lottery by:
* Adding 500 tokens to the prize pool from Lottery House
* Changing the ticket price to 15 tokens for new purchases

***

## Football Betting

Football betting allows users to bet on real football matches.

### Creating Football Fixtures

```
/create-fixtures competition token amount [channel]
```

#### Parameters Explained

* **`competition`**: Competition code (e.g., `PL` for Premier League, `CL` for Champions League)
* **`token`**: Token ticker for bets (e.g., `REWARD-cf6eac`)
* **`amount`**: Bet amount per match (e.g., `100`)
* **`channel`** (Optional): Channel to post matches (default: current channel)

#### Example

```
/create-fixtures PL REWARD-cf6eac 100 #betting
```

This creates betting opportunities for all Premier League matches with:

* 100 REWARD tokens per bet
* Posted in #betting channel

### How Football Betting Works

1. **Admin Creates Fixtures**: Bot fetches upcoming matches from Football-Data.org API
2. **Matches Posted**: Each match gets its own thread with betting options
3. **Users Place Bets**: Users bet on Home Win, Draw, or Away Win using Virtual Account balance
4. **Match Ends**: Bot automatically processes results
5. **Winners Paid**: Winners split the pot equally
6. **No Winners**: If no one bet correctly, all bets go to Betting House

### Betting Options

Users can bet on:

* **Home Win** (1) - Home team wins
* **Draw** (X) - Match ends in a draw
* **Away Win** (2) - Away team wins

### Viewing Statistics

* **Leaderboard**: `/football-leaderboard-all` - Top bettors
* **Filtered Leaderboard**: `/football-leaderboard-filtered` - By date range or competition
* **Your Stats**: `/my-football-stats` - Your betting statistics and PNL

### House Balance Integration

When a match has **no winners**, all bets go to the Betting House. This balance can be:

* Used to fund prizes for special matches
* Tipped to users via `/house-tip`
* Viewed with `/house-balance`

### Updating Football Matches

Admins can top up the bonus pot (prize pool) for active football matches to create a larger prize pool:

```
/update-football-match game_id topup-pot-size
```

#### Parameters Explained

* **`game_id`** (Required): Select the match to update (autocomplete available)
* **`topup-pot-size`** (Required): Amount to add to the bonus pot (prize pool)

#### Important Notes

* Only matches with status **SCHEDULED**, **TIMED**, or **IN_PLAY** can be updated
* This adds to the existing bonus pot, increasing the total prize pool for winners
* The bonus pot is distributed to winning bettors when the match concludes
* The match must be available in your server

#### Example

```
/update-football-match 12345 topup-pot-size:200
```

This adds 200 tokens to the bonus pot, increasing the total prize pool for this match.

***

## NFT Staking

NFT staking allows users to stake their NFTs from their Virtual Account to earn rewards. Pool creators set up staking pools with reward tokens, and users can stake eligible NFTs to earn daily rewards.

### Creating a Staking Pool

Admins can create NFT staking pools using:

```
/create-staking-pool collection_ticker reward_token_identifier initial_supply reward_per_nft_per_day duration_months [pool_name] [staking_total_limit] [staking_limit_per_user]
```

**Note:** All required parameters must be provided. Optional parameters can be omitted.

#### Parameters Explained

* **`collection_ticker`** (Required): Collection identifier for NFTs that can be staked
* **`reward_token_identifier`** (Required): Token identifier for staking rewards (e.g., `REWARD-cf6eac`)
* **`initial_supply`** (Required): Initial reward supply amount (e.g., `10000`)
* **`reward_per_nft_per_day`** (Required): Daily reward amount per NFT (e.g., `10`)
* **`duration_months`** (Required): Pool duration in months (1-12)
* **`pool_name`** (Optional): Display name for the pool (defaults to collection name)
* **`staking_total_limit`** (Optional): Maximum NFTs that can be staked in the pool
* **`staking_limit_per_user`** (Optional): Maximum NFTs a single user can stake

#### Example

```
/create-staking-pool COLLECTION-abc123 REWARD-cf6eac 10000 10 "My Staking Pool" 1000 50 6
```

This creates a staking pool with:
* Collection: COLLECTION-abc123
* Reward token: REWARD-cf6eac
* Initial supply: 10,000 tokens
* Daily reward: 10 tokens per NFT
* Pool name: "My Staking Pool"
* Total limit: 1,000 NFTs
* Per-user limit: 50 NFTs
* Duration: 6 months

### How NFT Staking Works

1. **Pool Creation**: Admin creates a staking pool with reward configuration
2. **Users Stake NFTs**: Users select NFTs from their Virtual Account to stake
3. **Rewards Accumulate**: Rewards accumulate daily based on `reward_per_nft_per_day`
4. **Reward Distribution**: Rewards are distributed automatically every 24 hours
5. **Unstaking**: Users can unstake their NFTs at any time (no lock period)
6. **Pool Closure**: Pool creator can close the pool, which returns all NFTs and distributes final rewards

### Staking NFTs

Users interact with staking pools through the pool embed:

* **Stake Button**: Click to select NFTs from your Virtual Account to stake
* **Unstake Button**: Click to unstake your NFTs and claim rewards
* **View Staked NFTs**: See which NFTs you have staked in the pool

**Requirements**:
* NFTs must be in your Virtual Account (not staked elsewhere)
* NFTs must match the pool's collection ticker
* NFTs must meet any trait filter requirements (if set)
* Pool must have available slots (if total limit is set)
* You must not exceed your personal limit (if set)

### Updating Staking Pools

Pool creators can update their staking pools:

```
/update-staking-pool staking_pool [topup_staking_pool] [change_reward_per_nft] [increase_nft_pool_limit] [increase_user_staking_limit] [trait_filter_action] [trait_filter_type] [trait_filter_value] [trait_filter_index]
```

#### Update Options

* **`topup_staking_pool`**: Add more reward tokens to the pool supply
* **`change_reward_per_nft`**: Update the daily reward per NFT
* **`increase_nft_pool_limit`**: Increase the total NFT limit (must be higher than current)
* **`increase_user_staking_limit`**: Increase the per-user staking limit (must be higher than current)
* **`trait_filter_action`**: Manage trait filters (`add`, `remove`, or `clear`)
* **`trait_filter_type`**: Trait type to filter (when adding filters)
* **`trait_filter_value`**: Specific trait value (optional, leave empty for any value)
* **`trait_filter_index`**: Filter index to remove (when removing filters)

#### Example

```
/update-staking-pool pool-123 topup_staking_pool:5000 change_reward_per_nft:15
```

This updates the pool by:
* Adding 5,000 tokens to the reward supply
* Changing daily reward to 15 tokens per NFT

### Closing Staking Pools

Pool creators can close their staking pools:

```
/close-staking-pool staking_pool_name
```

**What happens when a pool is closed**:
* All staked NFTs are automatically returned to users' Virtual Accounts
* Final rewards (last 24 hours) are automatically distributed to all stakers
* Pool status changes to CLOSED
* Users can no longer stake or unstake

**Note**: Only the pool creator can close their pool.

### Trait Filtering

Staking pools can include trait filters to restrict which NFTs can be staked:

* **Add Filter**: Restrict staking to NFTs with specific traits
* **Remove Filter**: Remove a specific trait filter
* **Clear Filters**: Remove all trait filters (allow all NFTs)

Example: A pool might only allow NFTs with "Rarity: Legendary" to be staked.

### Pool Status

Staking pools can have the following statuses:

* **ACTIVE**: Pool is open and accepting stakes
* **PAUSED**: Pool is temporarily paused (no new stakes, rewards still accumulate)
* **CLOSED**: Pool is closed (no new stakes, NFTs returned, final rewards distributed)

***

## NFT Auctions

NFT auctions allow users to sell NFTs and SFTs (Semi-Fungible Tokens) to the highest bidder.

**Note**: The bot supports both NFTs and SFTs. SFTs are similar to NFTs but have a quantity (amount) field. All NFT-related commands work with both NFTs and SFTs.

### Creating an Auction

```
/create-auction collection nft-name starting-amount duration [token] [min-bid-increase] [title] [description] [amount]
```

#### Parameters Explained

* **`collection`**: NFT/SFT collection identifier (e.g., `COLLECTION-abc123`)
* **`nft-name`**: Specific NFT/SFT name (e.g., `NFT-NAME-1`)
* **`starting-amount`**: Starting bid amount (e.g., `100`)
* **`duration`**: Auction duration in hours (e.g., `24`)
* **`token`** (Optional): Token for bidding (default: Community Fund token)
* **`min-bid-increase`** (Optional): Minimum bid increase (e.g., `10`)
* **`title`** (Optional): Auction title
* **`description`** (Optional): Auction description
* **`amount`** (Optional): Quantity for SFTs (default: 1 for NFTs)

#### Example

```
/create-auction COLLECTION-abc123 NFT-NAME-1 100 24 REWARD-cf6eac 10 "Rare NFT" "One of a kind collectible"
```

For SFTs with quantity:

```
/create-auction COLLECTION-abc123 SFT-NAME-1 100 24 REWARD-cf6eac 10 "Rare SFT" "Limited edition" amount:5
```

### How Auctions Work

1. **Auction Created**: Admin creates auction with starting bid
2. **Users Bid**: Users place bids using Virtual Account balance
3. **Bid Validation**: Each bid must exceed previous bid + minimum increase
4. **Auction Ends**: Automatically closes at end time
5. **Winner Pays**: Highest bidder's balance is deducted
6. **Seller Receives**: Payment goes to Auction House (for Project Auctions) or seller (Virtual Account Auctions)
7. **NFT/SFT Transferred**: NFT or SFT sent to winner's wallet (with specified amount for SFTs)

### Bidding

* Users click "Place Bid" button on auction embed and enter bid amount in modal.
* Users click "Quick Bid" button on auction embed to increase by `minimum-bid-increase` amount

### House Balance Integration

When an NFT or SFT is sold at auction, the sale amount goes to Auction House. This balance can be:

* Used to pay NFT/SFT sellers
* Tipped to users via `/house-tip`
* Viewed with `/house-balance`

***

## Rock Paper Scissors

Rock Paper Scissors allows users to challenge each other with token prizes. The Community Fund wallet acts as a secure middleman (like a smart contract), holding both players' deposits until a winner is determined.

### How RPS Works

#### 1. Challenge Creation

* **Challenger**: Initiates the game by choosing a token and amount to wager
* The challenger uses `/challenge-rps` command with:
  * The Discord tag of the user they want to challenge
  * The token ticker (e.g., `REWARD-cf6eac`)
  * The bet amount
  * Optional memo
* The bet amount is automatically deducted from the challenger's Virtual Account balance

#### 2. Challenge Notification

* The challenged user is notified in the channel and via DM (if their DMs are open)
* The notification includes the token, amount, and instructions to join

#### 3. Accepting the Challenge

* The challenged user reviews the token and amount
* If they accept, they use `/join-rps` command (or click the "Join Challenge" button)
* The bot automatically deducts the matching bet amount from their Virtual Account balance
* The bot verifies that both deposits match in token and amount

#### 4. Game Play

* Once both players have joined and deposited, the game becomes active
* Players take turns making their moves (rock, paper, or scissors) using the `/play-rps` command
* The winner is determined by standard RPS rules:
  * Rock beats Scissors
  * Scissors beats Paper
  * Paper beats Rock
  * If both pick the same, it's a draw and a new round starts

#### 5. Prize Distribution

* The winner receives the **total prize** (both players' deposits) directly to their Virtual Account
* The bot announces the winner in the channel and sends a DM (if possible)

### Game Rules & Dynamics

* **Both players must deposit the same amount and token.** The bot enforces this automatically
* **No self-challenges:** You cannot challenge yourself
* **Virtual Account Integration:** All bets use Virtual Account balance - no blockchain transactions needed for gameplay
* **Timeout & Refunds:** If the challenged user does not join within 30 minutes, the challenge expires and the challenger is automatically refunded to their Virtual Account
* **Transparency:** All moves, results, and prize transfers are announced in the channel for fairness

### Creating a Challenge

```
/challenge-rps user-tag bet-amount [token] [memo] [public]
```

#### Example

```
/challenge-rps @user 100 REWARD-cf6eac "Let's play!" true
```

### Joining a Challenge

The challenged user can join by:

* Clicking the "Join Challenge" button on the challenge embed (opens a modal)
* Or using `/join-rps` command with the challenge ID

**No transaction hash needed!** The bot uses Virtual Account balance automatically.

### Viewing Challenges

```
/list-rps-challenges [public]
```

Shows all active and waiting challenges.

### Virtual Account Integration

RPS challenges use Virtual Account balance, so users don't need to:

* Provide transaction hashes
* Wait for blockchain confirmations
* Pay gas fees for each game
* Make on-chain transfers

The bot automatically:

* Deducts from Virtual Accounts when challenges are created and joined
* Credits the winner's Virtual Account with the prize
* Refunds expired challenges automatically

***

## DROP Game

The DROP Game is an automated engagement system that runs hourly rounds where users can participate by reacting with a 🪂 emoji. Winners are selected randomly from participants, and weekly leaderboard winners receive airdrops based on their points and supporter status multiplier.

### How DROP Game Works

#### 1. Game Setup (Admin Only)

Admins start the DROP Game automation using:

```
/start-drop-game-automation token-ticker base-amount min-droppers [collection-identifier] [nft-collection-multiplier]
```

**Parameters Explained**:

* **`token-ticker`** (Required): Token identifier for airdrop rewards (e.g., `REWARD-cf6eac`)
* **`base-amount`** (Required): Base amount per point for weekly airdrops (e.g., `10`)
* **`min-droppers`** (Required): Minimum number of participants required to close a round (e.g., `5`)
* **`collection-identifier`** (Optional): NFT collection identifier for supporter status calculation
* **`nft-collection-multiplier`** (Optional): Enable NFT-based multiplier system (`true` or `false`)

**Example**:

```
/start-drop-game-automation REWARD-cf6eac 10 5 COLLECTION-abc123 true
```

This creates a DROP Game with:
* Reward token: REWARD (REWARD-cf6eac)
* Base amount: 10 tokens per point
* Minimum droppers: 5 participants
* NFT collection: COLLECTION-abc123 (for multiplier calculation)
* Multiplier enabled: Yes

#### 2. Hourly Rounds

* **Round Creation**: Every hour, the bot automatically creates a new DROP round
* **Embed Display**: A Discord embed is posted showing:
  * Round information and countdown timer
  * Current number of participants
  * Reward token for airdrops
  * Supporter status multiplier (if enabled)
  * Instructions to join
* **Joining**: Users react with 🪂 emoji to enter the round
* **Countdown**: The embed shows a live countdown until the round closes

#### 3. Round Closure

* **Minimum Participants**: A round only closes if the minimum number of "droppers" (participants) is met
* **Insufficient Participants**: If minimum is not met:
  * Embed turns orange
  * Shows how many more participants are needed
  * Round stays open until minimum is reached
* **Sufficient Participants**: When minimum is met:
  * Round closes automatically
  * Winner is selected randomly from all participants
  * Winner receives 1 point added to their weekly leaderboard score

#### 4. Winner Selection

* **Random Selection**: One winner is chosen randomly from all participants
* **Point Award**: Winner receives 1 point added to their weekly leaderboard
* **Announcement**: Winner is announced via a new embed
* **Next Round**: A new round embed is automatically created for the next hour

#### 5. Weekly Leaderboard & Airdrops

* **Leaderboard Period**: Weekly leaderboard runs from Sunday 18:00 ECT (European Central Time) to the following Sunday 18:00 ECT
* **Point Tracking**: Each win adds 1 point to the user's weekly total
* **Airdrop Distribution**: Every Sunday at 18:00 ECT, weekly airdrops are automatically distributed
* **Airdrop Calculation**: 
  ```
  Airdrop Amount = Total Points × Base Amount × Supporter Status Multiplier
  ```

### Supporter Status Multiplier

If NFT collection multiplier is enabled, users receive multipliers based on their NFT ownership:

| Status | NFT Count | Multiplier |
|--------|-----------|-----------|
| **Mega Whale** | 500+ NFTs | ×10 |
| **Whale** | 250-499 NFTs | ×8 |
| **Shark** | 100-249 NFTs | ×5 |
| **Dolphin** | 50-99 NFTs | ×4 |
| **Crab** | 25-49 NFTs | ×3 |
| **Fish** | 10-24 NFTs | ×2 |
| **Plankton** | 1-9 NFTs | ×1 |

**Example Calculation**:

* User has 275 NFTs (Whale status = ×8 multiplier)
* User won 24 rounds in the week (24 points)
* Base amount: 10 tokens
* **Airdrop**: 24 × 10 × 8 = **1,920 tokens**

### Commands

#### Admin Commands

**`/start-drop-game-automation`**
Start the DROP Game automation system.

**`/stop-drop-game-automation`**
Stop the active DROP Game automation.

**`/show-drop-game-leaderboard`**
Display the current weekly leaderboard with points and rankings.

#### User Participation

Users participate by simply reacting with 🪂 emoji on the DROP Game embed. No commands needed!

### Game Rules & Dynamics

* **Automated System**: Game runs automatically once started - no manual intervention needed
* **Hourly Rounds**: New rounds start every hour automatically
* **Minimum Participants**: Rounds require minimum participants before closing
* **Fair Selection**: Winners are selected randomly from all participants
* **Weekly Reset**: Leaderboard resets every Sunday at 18:00 ECT
* **House Balance**: Airdrops are funded from Drop House balance (top up using `/virtual-house-topup` with house type `drop`)
* **Virtual Account Integration**: All airdrops are credited directly to users' Virtual Accounts
* **Guild Segregation**: Each Discord server has its own independent DROP Game

### Managing DROP Game

#### Starting a Game

```
/start-drop-game-automation token-ticker:REWARD-cf6eac base-amount:10 min-droppers:5 collection-identifier:COLLECTION-abc123 nft-collection-multiplier:true
```

#### Stopping a Game

```
/stop-drop-game-automation
```

#### Viewing Leaderboard

```
/show-drop-game-leaderboard
```

The leaderboard shows:
* Current week's top participants
* Points earned
* Supporter status (if multiplier enabled)
* Rankings

### House Balance Integration

DROP Game airdrops are funded from Drop House balance. Admins can:

* **Top Up**: Use `/virtual-house-topup` with house type `drop` to add funds
* **View Balance**: Use `/house-balance` to see Drop House balance
* **Monitor**: Track earnings and spending for the drop category

### Best Practices

* **Set Reasonable Minimums**: Choose a minimum participant count that ensures engagement but isn't too high
* **Base Amount**: Set base amount based on your community size and available funds
* **NFT Multiplier**: Enable multiplier system to reward loyal NFT holders
* **Monitor House Balance**: Ensure Drop House has sufficient funds for weekly airdrops
* **Weekly Cutoff**: Remember airdrops distribute every Sunday at 18:00 ECT

### Troubleshooting

**Round Not Closing**:
* Check if minimum participants requirement is met
* Verify the game is still active (not stopped)

**Airdrops Not Distributing**:
* Verify it's Sunday 18:00 ECT
* Check Drop House balance has sufficient funds
* Ensure game is still active

**Leaderboard Not Showing**:
* Verify game is active
* Check if any rounds have been completed in the current week

***

## Cleanup Feature

The bot automatically cleans up old messages to keep channels tidy:

* **Finished Listings**: NFT listings that are sold, canceled, or expired are automatically deleted
* **Ended Auctions**: Completed auctions are automatically removed
* **Expired Challenges**: RPS challenges that expired are cleaned up
* **Finished Matches**: Football betting matches that ended are cleaned up

This helps maintain clean, organized channels and makes it easier for users to find active listings and activities.

> 💡 **Tip**: The cleanup feature runs automatically. You don't need to manually delete old messages.

## Best Practices

### For NFT/SFT Listings (Forum Channels)

**Recommended Setup**: Use Discord Forum Channels for NFT and SFT listings

1. **Create a Forum Channel**: Set up a forum channel (not a regular text channel)
2. **Create Posts per Collection**: Make a separate post for each NFT/SFT collection
3. **List NFTs/SFTs in Posts**: Users can list NFTs and SFTs using `/sell-nft` in the collection post
4. **Clean Browsing**: With the cleanup feature, finished listings are automatically removed, keeping each collection post clean and organized

**Benefits:**

* ✅ Clean, organized browsing of all listings
* ✅ Easy to find NFTs by collection
* ✅ Automatic cleanup keeps posts tidy
* ✅ Better user experience

**Limitations:**

* ❌ No threads are created (users can't comment directly on listings)
* ❌ Offers are made via DM (not in comments)

**Example Structure:**

```
#nft-marketplace (Forum Channel)
  ├── OlivePantheon Collection (Post)
  │   ├── Perseus Olive - 1750 OLV
  │   ├── Diogenes Olive - 2000 OLV
  │   └── (Finished listings auto-removed)
  ├── Basturds Collection (Post)
  │   └── (Active listings)
  └── SuperVictor Collection (Post)
      └── (Active listings)
```

### For Lotteries

* Start with a reasonable ticket price
* Set appropriate house commission (5-10% is common)
* Use House Balance to seed initial prize pools
* Monitor ticket sales and adjust frequency if needed

### For Football Betting

* Choose popular competitions for better engagement
* Set reasonable bet amounts
* Monitor House Balance from no-winner matches
* Use filtered leaderboards to track performance

### For Auctions

* Set realistic starting bids
* Use appropriate minimum bid increases
* Provide clear descriptions and titles
* Monitor Auction House balance
* **Use Forum Channels**: Create a forum channel and make posts for each NFT/SFT collection (see best practices below)
* **SFT Support**: When auctioning SFTs, specify the `amount` parameter to set the quantity being auctioned

### For RPS

* Encourage fair play
* Set reasonable bet amounts
* Monitor challenge activity
* Use Virtual Accounts for seamless gameplay

***

## Troubleshooting

### Lottery Not Drawing

* Check if drawing frequency is set correctly
* Verify lottery is still active
* Use manual draw button if needed

### Football Matches Not Appearing

* Check Football-Data.org API connectivity: `/test-football-api`
* Verify channel permissions (Create Public Threads)
* Check competition code is valid

### Auction Not Closing

* Verify auction end time
* Check if auction is still active
* Manually close if needed

### RPS Challenge Not Working

* Verify both users have sufficient Virtual Account balance
* Check Community Fund is set up
* Ensure users have registered wallets

***

For more detailed information on each activity, refer to the specific sections in the documentation.
