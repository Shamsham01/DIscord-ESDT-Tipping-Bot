# Virtual Accounts System - ESDT Tipping Bot

## Overview

The ESDT Tipping Bot has been upgraded with a **Virtual Accounts System** that eliminates the need for users to manually input transaction hashes. Users can now play games, tip others, and participate in activities using their virtual balance, which is automatically updated when they make transfers to Community Fund wallets.

## 🚀 Key Features

### 1. **Automatic Balance Tracking**
- Users make transfers to Community Fund wallets
- Bot automatically detects transfers via webhook
- Virtual account balances are updated in real-time
- No more manual transaction hash input required

### 2. **New Slash Commands**
- `/check-balance` - View your virtual account balance
- `/balance-history` - View transaction history
- `/tip-virtual` - Tip other users using virtual balance
- `/challenge-rps-virtual` - Challenge users to RPS using virtual balance
- `/join-rps-virtual` - Join RPS challenges using virtual balance
- `/bet-virtual` - Place football bets using virtual balance
- `/server-balances` - Admin view of server-wide balances
- `/blockchain-status` - Check blockchain listener status (Admin only)

### 3. **Blockchain Listener**
- Automatically monitors all community fund wallets
- Polls MultiversX API every 10 seconds
- Maps wallet addresses to Discord users
- Updates virtual account balances in real-time

## 🔧 Setup Instructions

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Environment Variables**
Add this to your `.env` file (if not already present):
```env
API_BASE_URL=https://api.multiversx.com
```

### 3. **Register New Commands**
```bash
node register-virtual-commands.js
```

### 4. **Start the Bot**
```bash
npm start
```

The bot will automatically start both the Discord bot and the blockchain listener.

## 🔗 Blockchain Listener Integration

The bot now includes an **internal blockchain listener** that automatically monitors all community fund wallets from your `server-data.json` file. This eliminates the need for external webhook setup and manual whitelisting.

### How It Works
- **Automatic Discovery**: Reads all community fund wallet addresses from `server-data.json`
- **Continuous Monitoring**: Polls the MultiversX API every 10 seconds for each wallet
- **Real-time Processing**: Automatically credits user virtual accounts when deposits are detected
- **No External Dependencies**: Fully self-contained within your Discord bot

### API Endpoint Used
```
GET https://api.multiversx.com/accounts/{walletAddress}/transactions?size=1&receiver={walletAddress}&status=success&function=ESDTTransfer&order=asc
```

### Benefits
- ✅ **No manual whitelisting** - all guilds automatically supported
- ✅ **No external apps** - everything runs within your bot
- ✅ **Real-time monitoring** - 10-second polling ensures quick detection
- ✅ **Automatic scaling** - new guilds added to `server-data.json` are automatically monitored

### Monitoring Status
Use `/blockchain-status` (Admin only) to check:
- Listener status (running/stopped)
- Number of monitored wallets
- Polling interval
- Processed transaction count

## 💰 How Virtual Accounts Work

### 1. **User Registration**
- Users register their wallet with `/set-wallet`
- Bot creates a virtual account for the user

### 2. **Deposits**
- User transfers tokens to any Community Fund wallet
- Blockchain listener automatically detects the transfer
- Bot automatically credits user's virtual account
- Balance is updated in real-time

### 3. **Spending**
- Users can tip others, play games, place bets
- All transactions use virtual balance
- No blockchain transactions required for spending
- Instant transactions with no gas fees

### 4. **Balance Management**
- Balances are stored in `virtual-accounts.json`
- Each server has separate virtual accounts
- Users can have multiple token balances
- Full transaction history is maintained

## 🎮 Game Integration

### Rock, Paper, Scissors
- **Before**: Users needed to provide transaction hash
- **Now**: Users can challenge directly using virtual balance
- Commands: `/challenge-rps-virtual`, `/join-rps-virtual`

### Football Betting
- **Before**: Users needed to provide transaction hash
- **Now**: Users can bet directly using virtual balance
- Command: `/bet-virtual`

### Tipping
- **Before**: Users needed to provide transaction hash
- **Now**: Users can tip directly using virtual balance
- Command: `/tip-virtual`

## 📊 Data Files

### New Files
- `virtual-accounts.json` - Virtual account balances and transactions
- `blockchain-listener.js` - Internal blockchain monitoring system
- `virtual-accounts.js` - Virtual account management functions

### Updated Files
- `index.js` - Main bot with virtual account integration
- `package.json` - No additional dependencies needed

## 🔒 Security Features

### 1. **Balance Validation**
- All spending operations check available balance
- Insufficient balance prevents transactions
- No negative balances allowed

### 2. **Transaction Logging**
- All virtual transactions are logged
- Full audit trail maintained
- Transaction IDs for tracking

### 3. **Admin Controls**
- Server admins can view all balances
- Admin-only commands for server management
- Balance summaries for monitoring

## 🚨 Error Handling

### Insufficient Balance
```
❌ Insufficient balance!

You have: 50 REWARD
Required: 100 REWARD

Top up your account by making a transfer to any Community Fund wallet!
```

### User Not Found
```
❌ User username not found.
```

### Invalid Amount
```
❌ Invalid amount. Please provide a positive number.
```

## 📈 Benefits

### For Users
- **Simplified Experience**: No more copying/pasting transaction hashes
- **Instant Transactions**: No waiting for blockchain confirmations
- **Lower Costs**: No gas fees for spending (only for deposits)
- **Better UX**: Button-based interactions instead of forms

### For Admins
- **Reduced Support**: No more helping users with transaction issues
- **Better Tracking**: Full visibility into user balances and spending
- **Automated Management**: Webhook handles all blockchain events
- **Real-time Updates**: Instant balance updates

### For the Bot
- **Improved Reliability**: No dependency on user-provided transaction hashes
- **Better Performance**: Faster response times for games and tips
- **Enhanced Security**: No risk of fake or invalid transaction hashes
- **Scalability**: Can handle more users and transactions

## 🔄 Migration from Old System

### What's Changed
1. **Transaction Hash Input**: No longer required for games/tips
2. **Balance Management**: Now handled automatically
3. **User Experience**: Simplified to button clicks and direct commands

### What's Still Available
1. **Old Commands**: Still work for backward compatibility
2. **Transaction Verification**: Still available for manual verification
3. **Admin Functions**: All admin features remain unchanged

### What's New
1. **Virtual Accounts**: Automatic balance tracking
2. **Webhook Server**: Real-time blockchain event processing
3. **New Commands**: Virtual balance-based interactions

## 🧪 Testing

### 1. **Test Webhook**
```bash
curl -X POST http://localhost:5018/webhook/blockchain-event \
  -H "Content-Type: application/json" \
  -d '[{"txHash":"test","receiver":"test","sender":"test","action":{"category":"esdtNft","name":"transfer","arguments":{"transfers":[{"type":"FungibleESDT","ticker":"REWARD","value":"10000000000000"}]}}}]'
```

### 2. **Test Health Check**
```bash
curl http://localhost:5018/health
```

### 3. **Test Status**
```bash
curl http://localhost:5018/status
```

## 🐛 Troubleshooting

### Webhook Server Not Starting
- Check if port 5018 is available
- Verify environment variables are set
- Check console for error messages

### Virtual Accounts Not Updating
- Verify webhook is receiving events
- Check blockchain event format
- Ensure user wallet is registered

### Commands Not Working
- Verify commands are registered
- Check bot permissions
- Ensure virtual accounts are loaded

## 📞 Support

For issues or questions:
1. Check the console logs for error messages
2. Verify all dependencies are installed
3. Ensure environment variables are set correctly
4. Test webhook endpoints manually

## 🔮 Future Enhancements

### Planned Features
- **Multi-token Support**: Better handling of different token types
- **Advanced Analytics**: Detailed spending and earning reports
- **Mobile App**: Companion app for balance checking
- **API Integration**: External services can query balances

### Potential Improvements
- **Batch Processing**: Handle multiple blockchain events at once
- **Caching**: Improve performance with Redis caching
- **Web Dashboard**: Admin panel for managing virtual accounts
- **Notifications**: Push notifications for balance changes

---

**Note**: This system maintains full backward compatibility while adding powerful new virtual account functionality. Users can still use the old system if needed, but the new virtual accounts provide a much better experience.
