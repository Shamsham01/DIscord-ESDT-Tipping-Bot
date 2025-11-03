# Football FT Result Tipping Game

## Overview
The Football FT Result Tipping Game is an extension to the existing Discord tipping bot that allows users to bet on football match outcomes using ESDT tokens. Users place bets by sending tokens to the Community Fund wallet and submitting transaction hashes before kickoff. Winners are paid out equally from the Community Fund after the match finishes.

## Features

### 🏆 **Match Creation & Management**
- **Admin Commands**: Create fixtures for today's football matches
- **Competition Support**: Works with major football competitions (PL, CL, ELC, etc.)
- **Token Integration**: Uses Community Fund's supported ESDT tokens
- **Fixed Stakes**: All bets for a match use the same token and amount

### 🎯 **Betting System**
- **Outcome Prediction**: Users bet on Home Win (H), Draw (D), or Away Win (A)
- **Transaction Verification**: Automatic verification of ESDT payments
- **Pre-Kickoff Only**: Bets must be placed before match kickoff
- **Unique Transactions**: Each transaction hash can only be used once

### ⏰ **Match Lifecycle**
- **Scheduled**: Match created, accepting bets
- **Locked**: Kickoff time reached, betting closed
- **Finished**: Match completed, results processed

### 💰 **Settlement & Payouts**
- **Equal Split**: Winners split the total pot equally
- **No Winners**: If no correct predictions, funds remain in Community Fund
- **Automatic Processing**: Results fetched from football-data.org API
- **Leaderboard Updates**: Points and wins tracked for all players

## Commands

### Admin Commands

#### `/create-fixtures`
Creates football fixtures for today with betting enabled.

**Options:**
- `competition` (required): Football competition code (e.g., PL, CL, ELC)
- `token` (required): ESDT token to use for betting
- `amount` (required): Required bet amount in whole token units
- `channel` (optional): Channel to post fixtures in (defaults to current)

**Example:**
```
/create-fixtures competition:PL token:REWARD amount:1 channel:#football-betting
```

#### `/leaderboard-reset`
Resets the football betting leaderboard for the server.

**Options:**
- `confirm` (required): Type "RESET" to confirm

**Example:**
```
/leaderboard-reset confirm:RESET
```

### User Commands

#### `/current-bets`
Shows today's active football games with entry counts and total pots.

**Options:**
- `public` (optional): Make response visible to everyone

**Example:**
```
/current-bets public:true
```

#### `/leaderboard`
Displays the football betting leaderboard (top 10 players).

**Options:**
- `public` (optional): Make response visible to everyone

**Example:**
```
/leaderboard public:true
```

#### `/get-competition`
Shows the last competition used for creating fixtures.

**Example:**
```
/get-competition
```

## Betting Process

### 1. **Admin Creates Fixtures**
- Admin runs `/create-fixtures` with competition, token, and amount
- Bot fetches today's fixtures from football-data.org
- Creates match embeds with "Bet" buttons
- Creates threads for each match

### 2. **User Places Bet**
- User clicks "Bet" button on a match
- Modal opens requesting outcome (H/D/A) and transaction hash
- User submits form with their prediction and payment proof

### 3. **Bet Verification**
- Bot verifies transaction hash format
- Checks transaction against MultiversX explorer
- Validates payment amount, recipient, and token
- Ensures transaction timestamp is before kickoff
- Marks transaction hash as used

### 4. **Match Processing**
- At kickoff: Match status changes to "LOCKED"
- During match: Bot polls football-data.org for results
- When finished: Match status changes to "FINISHED"

### 5. **Settlement**
- Winners determined based on final score
- Total pot divided equally among winners
- Payouts sent from Community Fund to winner wallets
- Leaderboard updated with points and wins

## Data Files

### `data/matches.json`
Stores match information per guild:
```json
{
  "GUILD_ID": {
    "MATCH_ID": {
      "matchId": "string",
      "compCode": "string",
      "compName": "string",
      "home": "string",
      "away": "string",
      "kickoffISO": "2025-01-27T20:00:00Z",
      "messageId": "string",
      "threadId": "string",
      "token": { "ticker":"REWARD", "identifier":"TOKEN-XYZ", "decimals":18 },
      "requiredAmountWei": "string",
      "status": "SCHEDULED|LOCKED|FINISHED",
      "ftScore": { "home": 0, "away": 0 }
    }
  }
}
```

### `data/bets.json`
Stores user bets per guild:
```json
{
  "GUILD_ID": {
    "BET_ID": {
      "betId": "bet_MATCHID_USERID_abc123",
      "matchId": "MATCH_ID",
      "userId": "USER_ID",
      "outcome": "H|D|A",
      "token": { "ticker":"REWARD", "identifier":"TOKEN-XYZ", "decimals":18 },
      "amountWei": "string",
      "txHash": "string",
      "createdAtISO": "2025-01-27T19:30:00Z",
      "status": "ACCEPTED"
    }
  }
}
```

### `data/leaderboard.json`
Stores user scores per guild:
```json
{
  "GUILD_ID": {
    "USER_ID": { 
      "points": 12, 
      "wins": 4, 
      "lastWinISO":"2025-01-27T22:00:00Z" 
    }
  }
}
```

## Environment Variables

### Required
- `FD_TOKEN`: Football-data.org API token
- `TOKEN`: Discord bot token
- `API_BASE_URL`: MultiversX API base URL
- `API_TOKEN`: MultiversX API token

### Optional
- `FOOTBALL_POLL_INTERVAL_MS`: Result polling interval (default: 60000ms)
- `FOOTBALL_RATE_PER_MIN`: API rate limit (default: 9 requests/minute)
- `TX_VERIFY_CONFIRMATIONS`: Transaction confirmation count (default: 2)

## API Integration

### Football Data API
- **Rate Limiting**: Built-in token bucket limiting to 9 requests/minute
- **Competitions**: Cached daily for autocomplete suggestions
- **Fixtures**: Fetched for specific competitions and dates
- **Results**: Polled for finished matches

### MultiversX Integration
- **Transaction Verification**: Validates ESDT transfers
- **Token Information**: Fetches token decimals and identifiers
- **Payment Processing**: Handles winner payouts

## Security Features

### Transaction Validation
- Hash format verification
- Duplicate hash prevention
- Amount and recipient validation
- Timestamp verification (before kickoff)

### Access Control
- Admin-only fixture creation
- Admin-only leaderboard reset
- User wallet verification
- Community Fund validation

## Error Handling

### Graceful Degradation
- API failures don't crash the bot
- Missing data handled gracefully
- User-friendly error messages
- Fallback behaviors for edge cases

### Logging
- Comprehensive error logging
- Transaction verification logs
- Match processing logs
- User action logs

## Performance Considerations

### Rate Limiting
- Football API: 9 requests/minute
- MultiversX API: Respects rate limits
- Sequential payout processing
- Efficient data caching

### Data Management
- Atomic file writes
- Periodic cleanup of expired data
- Efficient data structures
- Minimal memory footprint

## Troubleshooting

### Common Issues

**"No fixtures today"**
- Check competition code is correct
- Verify there are actually matches today
- Check football-data.org API status

**"Transaction verification failed"**
- Ensure transaction hash is correct
- Verify payment was sent to Community Fund
- Check amount matches exactly
- Ensure transaction is confirmed

**"Betting closed"**
- Match has reached kickoff time
- No more bets can be placed
- Wait for next fixture creation

### Debug Commands
- Use `/debug-user` to check user wallet status
- Check bot logs for detailed error information
- Verify Community Fund project configuration

## Future Enhancements

### Potential Features
- Multiple bet types (exact score, goals, etc.)
- Tournament brackets and progression
- Historical statistics and analytics
- Mobile app integration
- Social features and sharing

### Scalability Improvements
- Database backend for large servers
- Redis caching for API responses
- Webhook-based result updates
- Multi-region support

## Support

For issues or questions:
1. Check the bot logs for error details
2. Verify environment variable configuration
3. Test with the `/test-football` command
4. Review this documentation
5. Contact the development team

---

**Note**: This football game extension maintains the same security and reliability standards as the core tipping bot, ensuring safe token handling and fair gameplay for all users.
