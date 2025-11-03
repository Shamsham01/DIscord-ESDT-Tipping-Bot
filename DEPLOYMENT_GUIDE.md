# 🚀 Quick Deployment Guide for New Features

## What's New
Your Discord Tipping Bot now includes:
- ✅ QR code integration for community fund wallets
- ✅ Modal interface for joining RPS challenges
- ✅ Enhanced game embeds with wallet QR codes
- ✅ Better user experience with button interactions

## 🚀 Deployment Steps

### 1. Update Commands (Required)
```bash
npm run register-commands
```
This updates the `/set-community-fund` command with the new `qr-code-url` field.

### 2. Restart Your Bot
```bash
# Stop your current bot (Ctrl+C)
# Then restart it
npm start
```

### 3. Set QR Codes for Community Funds (Optional but Recommended)
For each server where you want QR codes displayed:

```bash
# Example: Set community fund with QR code
/set-community-fund project-name:YourProject qr-code-url:https://example.com/qr-code.png
```

**QR Code Requirements:**
- Must be a direct image URL (ends with .png, .jpg, .gif, etc.)
- Should be publicly accessible
- Recommended size: 256x256 pixels or larger
- Can be hosted on services like Imgur, Discord CDN, or your own server

## 🎯 How to Use New Features

### For Admins
1. **Set QR Code**: Use the updated `/set-community-fund` command
2. **QR Code Appears**: Automatically in all football and RPS game embeds
3. **Users Benefit**: Can easily scan QR codes to send payments

### For Users
1. **See QR Codes**: In all game embeds (football betting, RPS challenges)
2. **Join RPS**: Click "Join Challenge" button instead of typing commands
3. **Easy Access**: Scan QR codes to get community fund wallet addresses

## 🔧 Testing Your Setup

### Test QR Code Display
1. Set a QR code with `/set-community-fund`
2. Create football fixtures with `/create-fixtures`
3. Check if QR code appears in match embeds

### Test RPS Modal
1. Create an RPS challenge with `/challenge-rps`
2. Look for "Join Challenge" button on the embed
3. Click button to test modal interface

## 📱 Example QR Code URLs
You can use these services to host QR codes:
- **Imgur**: Upload image and copy direct link
- **Discord**: Upload to any channel and copy URL
- **GitHub**: Store in repository and use raw URL
- **Your Server**: Host on your own web server

## 🆘 Troubleshooting

### QR Code Not Showing?
- Check if URL is valid and accessible
- Ensure image format is supported (.png, .jpg, .gif)
- Verify bot has permission to display images

### Modal Not Opening?
- Check bot permissions in your server
- Ensure challenge is still active
- Verify you're the challenged user

### Button Not Working?
- Check if challenge has expired
- Ensure challenge status is "waiting"
- Verify bot has proper permissions

## 📋 Quick Checklist
- [ ] Updated commands with `npm run register-commands`
- [ ] Restarted bot
- [ ] Set QR codes for community funds (optional)
- [ ] Tested football game embeds
- [ ] Tested RPS challenge embeds
- [ ] Tested modal interface

## 🎉 You're All Set!
Your bot now provides a much better user experience with:
- Easy access to community fund wallet addresses
- Intuitive modal interfaces
- Visual enhancements to all game embeds
- Full backward compatibility

Users will love the new features and find it much easier to participate in games!
