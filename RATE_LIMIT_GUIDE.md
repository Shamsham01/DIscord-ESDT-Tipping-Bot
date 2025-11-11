# Discord Rate Limit Guide

## Current Situation

If you've been trying to register commands for **4+ hours** with no luck, you've likely hit one of these limits:

1. **Daily Limit (200 updates/day)** - Most likely if you've been trying repeatedly
2. **Stricter Rate Limit** - Discord may apply stricter limits after repeated attempts
3. **Global Rate Limit** - Can be stricter than the standard limits

## Discord Rate Limits

### Application Commands Endpoint
- **Daily Limit**: 200 command updates per day per application
- **Per-Endpoint**: 5 requests per 5 seconds
- **Global Rate Limit**: Can be stricter if daily limit is hit
- **Reset Time**: Midnight UTC (00:00 UTC)

## Wait Time Recommendations

### If You've Been Trying for 4+ Hours:
**Wait 24 hours** - You've likely hit the daily limit (200 updates/day)

### If You Get a 429 Error:
1. **Check the `retry_after` value** in the error response
2. **Wait at least that long** before trying again
3. **If no `retry_after` is provided**: Wait 24 hours

### Best Practices:
- **Try during off-peak hours**: Late night/early morning UTC (2-6 AM UTC)
- **Use skip-delete mode**: Use `register-commands-skip-delete.js` to avoid deletion requests
- **Use essential commands only**: Use `register-commands-essential.js` for fewer commands
- **Wait the full time**: Don't retry immediately after a rate limit error

## New Scripts Available

### 1. `check-rate-limit.js`
**Purpose**: Check if you're currently rate limited before attempting registration

**Usage**:
```bash
node check-rate-limit.js
```

**What it does**:
- Makes a simple GET request to check rate limit status
- Shows if you're currently rate limited
- Displays exact wait time if rate limited
- Shows when you can try again

### 2. `register-commands-improved.js`
**Purpose**: Improved registration script with better rate limit handling

**Usage**:
```bash
node register-commands-improved.js
```

**Features**:
- Checks rate limit status before attempting registration
- Properly handles Discord's rate limit headers
- Shows exact wait times from Discord's response
- Better error messages with specific recommendations

## Recommended Workflow

### Step 1: Check Rate Limit Status
```bash
node check-rate-limit.js
```

This will tell you:
- If you're currently rate limited
- How long to wait (if rate limited)
- When you can try again

### Step 2: Wait if Needed
If rate limited, wait the full time shown before proceeding.

### Step 3: Register Commands
Once the rate limit check passes, use one of these:

**Option A: Skip Delete (Recommended)**
```bash
node register-commands-skip-delete.js
```
- Skips deletion step (reduces API calls)
- Updates existing commands directly
- Faster and less likely to hit rate limits

**Option B: Essential Commands Only**
```bash
node register-commands-essential.js
```
- Registers only essential commands
- Removes commands with button/modal alternatives
- Removes debug commands
- Fewer commands = less likely to hit rate limits

**Option C: Full Registration**
```bash
node register-commands.js
```
- Full registration with all commands
- Deletes old commands first, then registers new ones
- More API calls = higher chance of rate limits

**Option D: Improved Registration**
```bash
node register-commands-improved.js
```
- Checks rate limit status first
- Better rate limit handling
- Shows exact wait times

## Understanding Rate Limit Errors

### 429 Error (Rate Limited)
- **Meaning**: Too many requests
- **Action**: Wait for the time specified in `retry_after` header
- **If no `retry_after`**: Wait 24 hours (likely hit daily limit)

### 401 Error (Authentication)
- **Meaning**: Invalid token or client ID
- **Action**: Check your `.env` file for correct `TOKEN` and `CLIENT_ID`

### Timeout Errors
- **Meaning**: Discord API is slow or rate limiting
- **Action**: Wait 15-30 minutes, then try again

## Tips to Avoid Rate Limits

1. **Use Skip-Delete Mode**: Reduces API calls by 50%
2. **Register During Off-Peak Hours**: 2-6 AM UTC is usually best
3. **Use Essential Commands Only**: Fewer commands = fewer API calls
4. **Don't Retry Immediately**: Wait the full time before retrying
5. **Check Rate Limit Status First**: Use `check-rate-limit.js` before attempting registration
6. **Register Once Per Day**: If possible, only register commands once per day

## If You're Still Having Issues

If you've waited 24+ hours and still can't register:

1. **Verify your credentials**: Make sure `TOKEN` and `CLIENT_ID` are correct
2. **Check Discord Status**: Visit https://discordstatus.com/ to see if there are API issues
3. **Try a different time**: Try during off-peak hours (2-6 AM UTC)
4. **Contact Discord Support**: If the issue persists, contact Discord support

## Summary

**For your current situation (4+ hours of trying):**
- **Wait 24 hours** before trying again
- You've likely hit the daily limit (200 updates/day)
- Use `check-rate-limit.js` first to verify you're not rate limited
- Use `register-commands-skip-delete.js` to reduce API calls
- Try during off-peak hours (late night/early morning UTC)

