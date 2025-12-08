#!/bin/bash
# Git configuration script to handle divergent branches automatically
# This should be run once on the server

git config --global pull.rebase false
git config --global pull.ff only

# If pull fails due to divergence, reset to remote
if ! git pull 2>&1 | grep -q "divergent branches"; then
    echo "Git pull successful"
else
    echo "Divergent branches detected, resetting to remote..."
    git fetch origin
    git reset --hard origin/main
fi

