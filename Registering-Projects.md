# 🏦 Registering Projects & Setting Up the Community Fund

This guide explains how to register project wallets and set up the Community Fund for your ESDT Tipping Bot.

---

## 🔑 Project Wallets vs. Community Fund

- **Project Wallet:**
  - Used by admins for `/send-esdt` and `/tip` (no min/max limits).
  - Intended for admin-controlled transfers and unrestricted tipping.
  - **Not recommended** for P2P tips or games.

- **Community Fund:**
  - Special project wallet for P2P tips (`/tip`) and RPS games.
  - Requires min/max limits for each supported ESDT token.
  - Enables users to tip each other and play games with safe, controlled limits.

> ⚠️ **Warning:**
> If you only register one wallet for admin use, **do NOT set it as the Community Fund**. This could expose admin funds to public tipping and games.

---

## 📝 How to Register a Project Wallet

1. **Prepare your wallet address, PEM file, and supported tokens list.**
2. Use the `/register-project` command:
   - `project-name`: Choose a unique name for this wallet.
   - `wallet-address`: Paste your MultiversX wallet address.
   - `wallet-pem`: Paste the PEM file content (use Notepad for easy copy/paste).
   - `supported-tokens`: Comma-separated list (e.g., `EGLD,REWARD,USDC,MYTOKEN`).
   - (Optional) `user-input`: Add notes for this project.
3. The bot will confirm registration and show your project in `/list-projects`.

---

## 🏦 How to Set Up the Community Fund

1. **Register a project wallet** (see above).
2. Use `/set-community-fund` to designate a project as the Community Fund.
3. Use `/set-tip-limits` to set min and max tip amounts for each supported token:
   - `token-ticker`: The ESDT token (e.g., `REWARD`).
   - `min-amount`: Minimum allowed tip.
   - `max-amount`: Maximum allowed tip.

> ⚠️ **Important:**
> - You **must** set min/max limits for every token you want to use for `/tip` or RPS games.
> - If limits are not set, `/tip` and RPS will not work for that token.

---

## ✅ Best Practices

- Use separate wallets for admin transfers and the Community Fund.
- Only set a wallet as Community Fund if you want users to tip each other and play games.
- Regularly review and update supported tokens and tip limits.

---

If you need help, refer to the documentation or ask an admin. 