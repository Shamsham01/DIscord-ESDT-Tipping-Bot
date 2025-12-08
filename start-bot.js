#!/usr/bin/env node
// Wrapper script that configures git and then starts the bot
// This can be used as BOT_JS_FILE in Pterodactyl

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('[STARTUP] Configuring git to handle divergent branches...');

try {
  // Configure git to handle merges automatically
  execSync('git config pull.rebase false', { stdio: 'inherit' });
  execSync('git config pull.ff only', { stdio: 'inherit' });
  
  // Try to pull, if it fails due to divergence, reset to remote
  try {
    execSync('git pull', { stdio: 'inherit' });
    console.log('[STARTUP] Git pull successful');
  } catch (pullError) {
    if (pullError.message && pullError.message.includes('divergent branches')) {
      console.log('[STARTUP] Divergent branches detected, resetting to remote...');
      execSync('git fetch origin', { stdio: 'inherit' });
      execSync('git reset --hard origin/main', { stdio: 'inherit' });
      console.log('[STARTUP] Reset to remote main branch');
    } else {
      throw pullError;
    }
  }
} catch (error) {
  console.error('[STARTUP] Warning: Git configuration failed:', error.message);
  console.error('[STARTUP] Continuing anyway...');
}

// Start the actual bot
console.log('[STARTUP] Starting bot...');
require('./index.js');

