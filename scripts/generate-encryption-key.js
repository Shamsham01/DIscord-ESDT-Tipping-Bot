#!/usr/bin/env node

/**
 * Generate a secure encryption key for PEM file encryption
 * 
 * Usage: node scripts/generate-encryption-key.js
 * 
 * This script generates a 32-byte (256-bit) random key suitable for AES-256 encryption.
 * Save this key securely and add it to your .env file as PEM_ENCRYPTION_KEY
 */

const crypto = require('crypto');

console.log('🔐 Generating PEM Encryption Key...\n');

// Generate a 32-byte (256-bit) random key
const key = crypto.randomBytes(32);

// Output in different formats for convenience
console.log('✅ Encryption key generated successfully!\n');
console.log('📋 Add this to your .env file:');
console.log('─────────────────────────────────────────────────────────');
console.log(`PEM_ENCRYPTION_KEY=${key.toString('hex')}`);
console.log('─────────────────────────────────────────────────────────\n');

console.log('⚠️  IMPORTANT SECURITY NOTES:');
console.log('─────────────────────────────────────────────────────────');
console.log('1. Save this key securely - you cannot decrypt PEM files without it!');
console.log('2. Never commit this key to version control');
console.log('3. Use different keys for development and production');
console.log('4. Store a backup of this key in a secure location');
console.log('5. If compromised, generate a new key and re-encrypt all PEM files');
console.log('─────────────────────────────────────────────────────────\n');

console.log('📝 Additional formats:');
console.log(`   Hex:     ${key.toString('hex')}`);
console.log(`   Base64:  ${key.toString('base64')}`);
console.log(`   Length:  ${key.length} bytes (256 bits)\n`);

