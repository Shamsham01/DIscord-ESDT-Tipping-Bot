# Getting Started

### 0. Invite the Bot & Set Channel Permissions

* **Invite the bot to your server:**
  * [Invite Link](https://discord.com/oauth2/authorize?client_id=1391865587185225868\&permissions=1126314371573824\&integration_type=0\&scope=bot+applications.commands)
* **Set up channel permissions:**
  1. Go to your desired channel's settings > **Permissions** > **Advanced Permissions**.
  2. Under **Roles/Members**, add the bot (e.g., `ESDT Tipping Bot`).
  3. Enable the following for the bot:
     * ✅ View Channel
     * ✅ Send Messages
     * ✅ Embed Links
  4. Ensure that users/roles who should interact with the bot can use **slash commands** in that channel.

> ⚠️ **These permissions are required for the bot to function properly!**

***

Welcome! Follow these steps to quickly set up your ESDT Tipping Bot and register new wallets.

***

### 1. Create a New MultiversX Wallet

* Go to: [https://wallet.multiversx.com/create](https://wallet.multiversx.com/create)
* Follow the instructions to generate a new wallet.
* **Save your seed phrase and wallet address securely!**

***

### 2. Generate a PEM File

* Go to: [https://subtle-crepe-8124c7.netlify.app/](https://subtle-crepe-8124c7.netlify.app/)
* Type in all 24 secret words in correct order and click "Generate PEM File" Button.
* **Download and save the PEM file.**

***

### 3. Prepare Supported Tokens List

* Make a list of all ESDT tokens you want the bot to support, separated by commas.
* Example:  `WEGLD-bd4d79,USDC-c76f1f,REWARD-cf6eac,UTK-2f80e9`
* You will need this list when registering a project wallet.

***

### 4. Use Notepad for Easy Copy & Paste

* Open Notepad (or any text editor).
* Paste your wallet address, PEM file content, and supported tokens list.
* This makes it easy to copy/paste info into the bot's registration commands.

***

### 5. Next Steps

* Ask your Community to register their wallets with `/set-wallet` command.
