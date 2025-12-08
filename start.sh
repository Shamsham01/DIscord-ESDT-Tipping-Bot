#!/bin/bash
# Startup script that handles git pull with automatic merge resolution

# Configure git to prefer remote changes when branches diverge
git config pull.rebase false
git config pull.ff only

# Try to pull, if it fails due to divergence, reset to remote
if ! git pull 2>&1 | grep -q "divergent branches"; then
    echo "Git pull successful"
else
    echo "Divergent branches detected, resetting to remote..."
    git fetch origin
    git reset --hard origin/main
fi

# Run npm install if needed
if [ -f package.json ] && [ "${NPM_INSTALL}" == "1" ]; then
    npm install
fi

# Start the bot
node ${BOT_JS_FILE:-index.js}

