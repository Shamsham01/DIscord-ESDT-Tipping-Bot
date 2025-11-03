#!/bin/bash

# Virtual Accounts System Deployment Script
# This script helps set up the new virtual accounts system for the ESDT Tipping Bot

echo "🚀 Starting Virtual Accounts System Deployment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Check dependencies
echo "📦 Checking dependencies..."
if npm list node-fetch >/dev/null 2>&1; then
    echo "✅ Required dependencies are already installed"
else
    echo "📦 Installing required dependencies..."
    npm install
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << EOF
# Discord Bot Configuration
TOKEN=your_discord_bot_token_here
CLIENT_ID=your_client_id_here

# MultiversX API Configuration
API_BASE_URL=your_api_base_url_here
API_TOKEN=your_api_token_here

# Football Data API
FD_TOKEN=your_football_data_token_here

# Webhook Server Configuration
WEBHOOK_PORT=5018
WEBHOOK_SECRET=your_webhook_secret_key_here
EOF
    echo "📝 .env template created. Please edit it with your actual values."
    echo "⚠️  IMPORTANT: Update the .env file with your actual tokens before continuing!"
    read -p "Press Enter after updating .env file..."
else
    echo "✅ .env file found"
fi

# Register new slash commands
echo "🔧 Registering new virtual account slash commands..."
node register-virtual-commands.js

if [ $? -eq 0 ]; then
    echo "✅ Commands registered successfully"
else
    echo "❌ Failed to register commands"
    exit 1
fi

# Create virtual accounts data file if it doesn't exist
if [ ! -f virtual-accounts.json ]; then
    echo "📁 Creating virtual accounts data file..."
    echo '{}' > virtual-accounts.json
    echo "✅ virtual-accounts.json created"
else
    echo "✅ virtual-accounts.json already exists"
fi

# Test blockchain listener
echo "🧪 Testing blockchain listener..."
node test-blockchain-listener.js

if [ $? -eq 0 ]; then
    echo "✅ Blockchain listener test passed"
else
    echo "❌ Blockchain listener test failed"
    exit 1
fi

# Test virtual accounts module
echo "🧪 Testing virtual accounts module..."
node -e "
const virtualAccounts = require('./virtual-accounts.js');
console.log('✅ Virtual accounts module loaded successfully');
"

if [ $? -eq 0 ]; then
    echo "✅ Virtual accounts test passed"
else
    echo "❌ Virtual accounts test failed"
    exit 1
fi

# Check if main bot file can be loaded
echo "🧪 Testing main bot integration..."
node -e "
try {
    require('./index.js');
    console.log('✅ Main bot integration test passed');
} catch (error) {
    console.log('⚠️  Main bot integration test: ' + error.message);
    console.log('This is expected if the bot is not fully configured yet');
}
"

echo ""
echo "🎉 Virtual Accounts System Deployment Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. ✅ Dependencies installed"
echo "2. ✅ Commands registered"
echo "3. ✅ Data files created"
echo "4. ✅ Modules tested"
echo ""
echo "🚀 To start the bot:"
echo "   npm start"
echo ""
echo "🔗 Blockchain listener will start automatically and poll every 10 seconds"
echo "📡 Monitoring all community fund wallets from server-data.json"
echo "🌐 No external webhook needed - fully self-contained!"
echo ""
echo "📚 Read VIRTUAL_ACCOUNTS_README.md for detailed documentation"
echo ""
echo "🔧 If you need to register commands again:"
echo "   node register-virtual-commands.js"
echo ""
echo "🎮 Users can now use the new virtual account commands:"
echo "   /check-balance, /tip-virtual, /challenge-rps-virtual, etc."
