#!/usr/bin/env node

/**
 * Test script for blockchain listener module
 * Run with: node test-blockchain-listener.js
 */

console.log('🧪 Testing Blockchain Listener Module...\n');

try {
  // Test 1: Load the module
  console.log('1️⃣ Loading blockchain listener module...');
  const blockchainListener = require('./blockchain-listener.js');
  console.log('✅ Module loaded successfully\n');

  // Test 2: Check status
  console.log('2️⃣ Checking listener status...');
  const status = blockchainListener.getListenerStatus();
  console.log('Status:', status);
  console.log('✅ Status check completed\n');

  // Test 3: Test wallet discovery
  console.log('3️⃣ Testing wallet discovery...');
  const fs = require('fs');
  
  if (fs.existsSync('server-data.json')) {
    const serverData = JSON.parse(fs.readFileSync('server-data.json', 'utf8'));
    let walletCount = 0;
    
    for (const [guildId, server] of Object.entries(serverData)) {
      const projects = server.projects || {};
      for (const [projectName, project] of Object.entries(projects)) {
        if (project.walletAddress) {
          walletCount++;
          console.log(`   Found wallet: ${project.walletAddress} (${projectName})`);
        }
      }
    }
    
    console.log(`✅ Found ${walletCount} community fund wallets\n`);
  } else {
    console.log('⚠️  server-data.json not found - create it first with some community fund wallets\n');
  }

  // Test 4: Test virtual accounts module
  console.log('4️⃣ Testing virtual accounts module...');
  const virtualAccounts = require('./virtual-accounts.js');
  virtualAccounts.loadVirtualAccountsData();
  console.log('✅ Virtual accounts module loaded successfully\n');

  console.log('🎉 All tests passed! Blockchain listener is ready to use.\n');
  console.log('💡 To start monitoring, run: npm start');
  console.log('💡 To check status, use: /blockchain-status (Admin only)');

} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error('\n🔧 Troubleshooting:');
  console.error('1. Make sure all required files exist');
  console.error('2. Check that server-data.json has valid community fund wallets');
  console.error('3. Verify your .env file has API_BASE_URL set');
  process.exit(1);
}
