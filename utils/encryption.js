const crypto = require('crypto');

// Get encryption key from environment variable
// This should be a 32-byte (256-bit) key encoded in hex or base64
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const ENCRYPTION_KEY = process.env.PEM_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.warn('[ENCRYPTION] WARNING: PEM_ENCRYPTION_KEY not set in environment variables!');
  console.warn('[ENCRYPTION] PEM files will NOT be encrypted. Set PEM_ENCRYPTION_KEY to enable encryption.');
}

// Algorithm: AES-256-GCM (Galois/Counter Mode) - provides authenticated encryption
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for GCM
const SALT_LENGTH = 64; // For key derivation
const TAG_LENGTH = 16; // GCM authentication tag length

/**
 * Derive a 32-byte key from the encryption key using PBKDF2
 * This ensures we always have a 32-byte key even if the env var is shorter
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

/**
 * Encrypt a PEM file string
 * @param {string} plaintext - The PEM file content to encrypt
 * @returns {string} - Encrypted data in format: iv:salt:tag:encryptedData (all base64)
 */
function encryptPEM(plaintext) {
  if (!ENCRYPTION_KEY) {
    // If encryption key is not set, return plaintext (backward compatibility)
    console.warn('[ENCRYPTION] Encryption key not set, storing PEM in plaintext');
    return plaintext;
  }

  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Invalid plaintext for encryption');
  }

  try {
    // Generate random IV and salt
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    // Derive key from password and salt
    const key = deriveKey(ENCRYPTION_KEY, salt);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // Get authentication tag
    const tag = cipher.getAuthTag();
    
    // Combine: iv:salt:tag:encryptedData (all base64 encoded)
    const result = [
      iv.toString('base64'),
      salt.toString('base64'),
      tag.toString('base64'),
      encrypted
    ].join(':');
    
    return result;
  } catch (error) {
    console.error('[ENCRYPTION] Error encrypting PEM:', error.message);
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt a PEM file string
 * @param {string} encryptedData - Encrypted data in format: iv:salt:tag:encryptedData
 * @returns {string} - Decrypted PEM file content
 */
function decryptPEM(encryptedData) {
  if (!ENCRYPTION_KEY) {
    // If encryption key is not set, assume it's plaintext (backward compatibility)
    return encryptedData;
  }

  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Invalid encrypted data for decryption');
  }

  // Check if data is encrypted (contains colons) or plaintext (old format)
  if (!encryptedData.includes(':')) {
    // Plaintext (backward compatibility with unencrypted data)
    console.warn('[ENCRYPTION] Decrypting plaintext PEM (not encrypted)');
    return encryptedData;
  }

  try {
    // Split: iv:salt:tag:encryptedData
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [ivBase64, saltBase64, tagBase64, encrypted] = parts;
    
    // Decode from base64
    const iv = Buffer.from(ivBase64, 'base64');
    const salt = Buffer.from(saltBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');
    
    // Derive key from password and salt
    const key = deriveKey(ENCRYPTION_KEY, salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[ENCRYPTION] Error decrypting PEM:', error.message);
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Check if a string is encrypted (has the encrypted format)
 * @param {string} data - Data to check
 * @returns {boolean} - True if encrypted, false if plaintext
 */
function isEncrypted(data) {
  if (!data || typeof data !== 'string') return false;
  // Encrypted format: iv:salt:tag:encryptedData (4 parts separated by colons)
  const parts = data.split(':');
  return parts.length === 4;
}

module.exports = {
  encryptPEM,
  decryptPEM,
  isEncrypted
};

