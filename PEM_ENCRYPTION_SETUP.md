# PEM File Encryption Setup Guide

## Overview

PEM files (private keys) are now encrypted at rest in the database. Even if someone gains access to your database, they cannot decrypt the PEM files without the encryption key.

## Security Features

- **AES-256-GCM Encryption**: Industry-standard authenticated encryption
- **Key Derivation**: Uses PBKDF2 with 100,000 iterations for key derivation
- **Unique IVs**: Each encryption uses a random initialization vector
- **Authentication Tags**: GCM mode provides built-in authentication
- **Backward Compatible**: Works with existing unencrypted PEM files

## Setup Instructions

### 1. Generate Encryption Key

Run this command to generate a secure 32-byte encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This will output a 64-character hexadecimal string (e.g., `a1b2c3d4e5f6...`).

**IMPORTANT**: Save this key securely! If you lose it, you cannot decrypt existing PEM files.

### 2. Set Environment Variable

Add the encryption key to your `.env` file:

```env
PEM_ENCRYPTION_KEY=your_generated_key_here
```

Or set it in your environment:

```bash
export PEM_ENCRYPTION_KEY=your_generated_key_here
```

### 3. Restart the Bot

After setting the environment variable, restart your bot. The encryption will be automatically enabled.

## How It Works

### Encryption Flow

1. **When registering/updating a project** (`/register-project` or `/update-project`):
   - PEM file is encrypted before storing in the database
   - Encrypted format: `iv:salt:tag:encryptedData` (all base64)

2. **When reading a project** (for transactions):
   - PEM file is automatically decrypted in memory
   - Decrypted PEM is only used for signing transactions
   - Never logged or stored in plaintext

### Security Guarantees

- ✅ **Database Access**: Even with full database access, PEM files cannot be decrypted without the key
- ✅ **Memory Safety**: PEM files are only decrypted in memory when needed
- ✅ **No Logging**: Decrypted PEMs are never logged to console or files
- ✅ **Authenticated Encryption**: GCM mode ensures data integrity

## Migration from Unencrypted Data

If you have existing projects with unencrypted PEM files:

1. Set `PEM_ENCRYPTION_KEY` in your environment
2. Re-register or update each project using `/update-project`
3. The PEM will be automatically encrypted on save

The system is backward compatible - it can read both encrypted and unencrypted PEM files.

## Key Management Best Practices

### For Production

1. **Store the key securely**:
   - Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
   - Never commit the key to version control
   - Use different keys for development and production

2. **Key Rotation**:
   - If you suspect the key is compromised, generate a new key
   - Re-encrypt all PEM files with the new key
   - Update the environment variable

3. **Backup**:
   - Keep a secure backup of your encryption key
   - Store it separately from your database backups
   - Use a password manager or hardware security module (HSM)

### For Development

- Use a different key for development
- Never use production keys in development
- Rotate keys regularly

## Troubleshooting

### Error: "Encryption key not set"

**Solution**: Set `PEM_ENCRYPTION_KEY` in your environment variables.

### Error: "Decryption failed"

**Possible causes**:
1. Wrong encryption key
2. Corrupted encrypted data
3. Data encrypted with a different key

**Solution**: 
- Verify the encryption key is correct
- If you changed the key, you need to re-encrypt all PEM files
- Check database for corrupted entries

### Warning: "Storing PEM in plaintext"

**Cause**: `PEM_ENCRYPTION_KEY` is not set.

**Solution**: Set the environment variable and restart the bot.

## Technical Details

### Encryption Algorithm
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Size**: 256 bits (32 bytes)
- **IV Size**: 128 bits (16 bytes)
- **Tag Size**: 128 bits (16 bytes)
- **Salt Size**: 512 bits (64 bytes)

### Key Derivation
- **Function**: PBKDF2
- **Hash**: SHA-256
- **Iterations**: 100,000
- **Key Length**: 32 bytes

### Data Format
Encrypted data is stored as: `iv:salt:tag:encryptedData`
- All components are base64-encoded
- Separated by colons (`:`)
- Total size: ~4x original size + overhead

## Security Considerations

1. **Key Storage**: The encryption key should be stored securely and never exposed
2. **Key Access**: Limit access to the encryption key to only necessary personnel
3. **Key Rotation**: Rotate keys periodically or if compromised
4. **Audit Logging**: Consider logging when PEM files are decrypted (without logging the PEM itself)
5. **Database Security**: Even with encryption, secure your database with proper access controls

## Support

If you encounter issues with encryption/decryption, check:
1. Environment variable is set correctly
2. Encryption key hasn't changed
3. Database entries are not corrupted
4. Node.js crypto module is available

