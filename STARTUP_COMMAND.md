# Pterodactyl Startup Command

Replace your current startup command in Pterodactyl with this:

```bash
if [[ -d .git ]] && [[ ${AUTO_UPDATE} == "1" ]]; then git fetch origin && git reset --hard origin/main; fi; if [[ ! -z ${NODE_PACKAGES} ]] && [[ ${NPM_INSTALL} == "1" ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ] && [[ ${NPM_INSTALL} == "1" ]]; then /usr/local/bin/npm install; fi; /usr/local/bin/node /home/container/${BOT_JS_FILE:-index.js}
```

**Key change:** Replaced `git pull` with `git fetch origin && git reset --hard origin/main`

This will:
- Always use the remote version (no merge conflicts)
- Ensure you're running the latest code
- Prevent divergent branch issues

**To fix the current issue immediately:**

SSH into your server and run:
```bash
cd /home/container
git fetch origin
git reset --hard origin/main
```

Then restart the server.

