/**
 * Utility functions for generating MultiversX wallets and PEM files
 * Uses MultiversX SDK to create wallets programmatically with proper mnemonic and PEM format
 */

const { Mnemonic, UserPem, UserSecretKey } = require('@multiversx/sdk-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Generate a MultiversX wallet and derive PEM in proper MultiversX format
 * @returns {Promise<{address: string, pem: string, secretKeyHex: string, mnemonic: string}>}
 */
async function generateMultiversXWallet() {
  try {
    // Generate a new mnemonic (24 words) using MultiversX SDK
    const mnemonic = Mnemonic.generate();
    const mnemonicWords = mnemonic.getWords();
    const mnemonicString = mnemonicWords.join(' ');
    
    // Mnemonic generated (not logged for security)
    
    // Derive secret key from mnemonic (account index 0)
    const secretKey = mnemonic.deriveKey(0);
    
    // Get secret key as hex
    const secretKeyHex = secretKey.hex();
    
    // Generate public key and address from secret key
    const publicKey = secretKey.generatePublicKey();
    const address = publicKey.toAddress().toBech32();
    
    console.log(`[WALLET-GEN] Generated wallet with address: ${address}`);
    
    // Create proper PEM file using UserPem (includes address as label)
    const userPem = new UserPem(address, secretKey);
    
    // Get PEM content by saving to a temporary file and reading it back
    // UserPem.save() writes to a file, so we'll use a temp file and read it
    const tempFilePath = path.join(__dirname, '..', 'temp_wallet.pem');
    
    try {
      // Save PEM to temporary file
      userPem.save(tempFilePath);
      
      // Read PEM content from file
      const multiversXPem = fs.readFileSync(tempFilePath, 'utf8');
      
      // Clean up temporary file
      fs.unlinkSync(tempFilePath);
      
      // Convert MultiversX PEM format to MakeX API format
      // MultiversX format: -----BEGIN PRIVATE KEY for erd1...-----\n[base64]\n-----END PRIVATE KEY for erd1...-----
      // MakeX format: -----BEGIN PRIVATE KEY-----\n[base64]\n-----END PRIVATE KEY-----
      // Extract the base64 content (everything between the headers)
      const pemLines = multiversXPem.split('\n');
      const base64Lines = pemLines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && 
               !trimmed.includes('BEGIN') && 
               !trimmed.includes('END');
      });
      
      // Reconstruct PEM in MakeX API format (standard headers without address)
      const makexPem = [
        '-----BEGIN PRIVATE KEY-----',
        ...base64Lines,
        '-----END PRIVATE KEY-----'
      ].join('\n');
      
      console.log(`[WALLET-GEN] MultiversX PEM length: ${multiversXPem.length} characters`);
      console.log(`[WALLET-GEN] MakeX PEM length: ${makexPem.length} characters`);
      console.log(`[WALLET-GEN] PEM format: MakeX API compliant (address removed from headers)`);
      
      return {
        address: address,
        pem: makexPem,
        secretKeyHex: secretKeyHex,
        mnemonic: mnemonicString
      };
    } catch (fileError) {
      // Clean up temp file if it exists
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
      throw fileError;
    }
  } catch (error) {
    console.error('[WALLET-GEN] Error generating wallet:', error);
    throw new Error(`Failed to generate wallet: ${error.message}`);
  }
}

/**
 * Generate a complete MultiversX wallet with address (alias for generateMultiversXWallet)
 * @returns {Promise<{address: string, pem: string, secretKeyHex: string, mnemonic: string}>}
 */
async function generateCompleteWallet() {
  return await generateMultiversXWallet();
}

module.exports = {
  generateMultiversXWallet,
  generateCompleteWallet
};

