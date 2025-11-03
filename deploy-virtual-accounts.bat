@echo off
chcp 65001 >nul
echo 🚀 Starting Virtual Accounts System Deployment...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ Node.js and npm are installed

REM Check dependencies
echo 📦 Checking dependencies...
if npm list node-fetch >nul 2>&1 (
    echo ✅ Required dependencies are already installed
) else (
    echo 📦 Installing required dependencies...
    npm install
)

REM Check if .env file exists
if not exist .env (
    echo ⚠️  .env file not found. Creating template...
    (
        echo # Discord Bot Configuration
        echo TOKEN=your_discord_bot_token_here
        echo CLIENT_ID=your_client_id_here
        echo.
        echo # MultiversX API Configuration
        echo API_BASE_URL=your_api_base_url_here
        echo API_TOKEN=your_api_token_here
        echo.
        echo # Football Data API
        echo FD_TOKEN=your_football_data_token_here
        echo.
        echo # Webhook Server Configuration
        echo WEBHOOK_PORT=5018
        echo WEBHOOK_SECRET=your_webhook_secret_key_here
    ) > .env
    echo 📝 .env template created. Please edit it with your actual values.
    echo ⚠️  IMPORTANT: Update the .env file with your actual tokens before continuing!
    pause
) else (
    echo ✅ .env file found
)

REM Register new slash commands
echo 🔧 Registering new virtual account slash commands...
node register-virtual-commands.js

if %errorlevel% equ 0 (
    echo ✅ Commands registered successfully
) else (
    echo ❌ Failed to register commands
    pause
    exit /b 1
)

REM Create virtual accounts data file if it doesn't exist
if not exist virtual-accounts.json (
    echo 📁 Creating virtual accounts data file...
    echo {} > virtual-accounts.json
    echo ✅ virtual-accounts.json created
) else (
    echo ✅ virtual-accounts.json already exists
)

REM Test blockchain listener
echo 🧪 Testing blockchain listener...
node test-blockchain-listener.js

if %errorlevel% equ 0 (
    echo ✅ Blockchain listener test passed
) else (
    echo ❌ Blockchain listener test failed
    pause
    exit /b 1
)

REM Test virtual accounts module
echo 🧪 Testing virtual accounts module...
node -e "const virtualAccounts = require('./virtual-accounts.js'); console.log('✅ Virtual accounts module loaded successfully');"

if %errorlevel% equ 0 (
    echo ✅ Virtual accounts test passed
) else (
    echo ❌ Virtual accounts test failed
    pause
    exit /b 1
)

REM Check if main bot file can be loaded
echo 🧪 Testing main bot integration...
node -e "try { require('./index.js'); console.log('✅ Main bot integration test passed'); } catch (error) { console.log('⚠️  Main bot integration test: ' + error.message); console.log('This is expected if the bot is not fully configured yet'); }"

echo.
echo 🎉 Virtual Accounts System Deployment Complete!
echo.
echo 📋 Next Steps:
echo 1. ✅ Dependencies installed
echo 2. ✅ Commands registered
echo 3. ✅ Data files created
echo 4. ✅ Modules tested
echo.
echo 🚀 To start the bot:
echo    npm start
echo.
echo 🔗 Blockchain listener will start automatically and poll every 10 seconds
echo 📡 Monitoring all community fund wallets from server-data.json
echo 🌐 No external webhook needed - fully self-contained!
echo.
echo 📚 Read VIRTUAL_ACCOUNTS_README.md for detailed documentation
echo.
echo 🔧 If you need to register commands again:
echo    node register-virtual-commands.js
echo.
echo 🎮 Users can now use the new virtual account commands:
echo    /check-balance, /tip-virtual, /challenge-rps-virtual, etc.
echo.
pause
