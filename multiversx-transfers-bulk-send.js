/**
 * MultiNFTTransfer Endpoint for Make.com API
 * 
 * This module handles bulk NFT transfers (up to 50 NFTs) in a single transaction.
 * It accepts full identifiers (e.g., "EMP-897b49-0112") and extracts collection and nonce automatically.
 * 
 * Endpoint: /execute/multiNFTTransfer
 * Method: POST
 * 
 * Request Body:
 * {
 *   "walletPem": "...",
 *   "recipient": "erd1...",
 *   "tokenIdentifiers": ["EMP-897b49-0112", "EMP-897b49-014d", ...]
 * }
 * 
 * Response:
 * {
 *   "success": true/false,
 *   "txHash": "...",
 *   "errorMessage": null or error string,
 *   "nftCount": 50,
 *   "httpStatus": 200
 * }
 */

// Helper function to extract collection and nonce from full identifier
// Full identifier format: "COLLECTION-abc123-02" or "COLLECTION-abc123-0112"
// Returns: { collection: "COLLECTION-abc123", nonce: "02" or "0112" }
function extractCollectionAndNonce(fullTokenIdentifier) {
  if (!fullTokenIdentifier || typeof fullTokenIdentifier !== 'string') {
    throw new Error('Invalid full token identifier: must be a non-empty string');
  }

  // Check if identifier contains nonce appended (format: COLLECTION-NONCE)
  // If fullTokenIdentifier has 3+ parts separated by '-', the last part is likely the nonce
  if (fullTokenIdentifier.includes('-')) {
    const parts = fullTokenIdentifier.split('-');
    // If we have 3+ parts, the last part is likely the nonce
    // Example: "EMP-897b49-0112" -> ["EMP", "897b49", "0112"]
    if (parts.length >= 3) {
      // Extract collection ticker by removing the last part (nonce)
      const collection = parts.slice(0, -1).join('-');
      const nonce = parts[parts.length - 1];
      return { collection, nonce };
    }
  }

  // If format doesn't match expected pattern, throw error
  throw new Error(`Invalid full token identifier format: "${fullTokenIdentifier}". Expected format: "COLLECTION-abc123-02"`);
}

/**
 * Transfer multiple NFTs using wallet PEM
 * 
 * @param {string} recipientWallet - Recipient wallet address (erd1...)
 * @param {string[]} tokenIdentifiers - Array of full identifiers (e.g., ["EMP-897b49-0112"])
 * @param {string} walletPem - Wallet PEM content
 * @param {string} apiBaseUrl - API base URL
 * @param {string} apiToken - API authentication token
 * @returns {Promise<Object>} Transfer result with txHash, success status, etc.
 */
async function transferMultipleNFTs(recipientWallet, tokenIdentifiers, walletPem, apiBaseUrl, apiToken) {
  try {
    if (!apiBaseUrl || !apiToken) {
      throw new Error('API configuration missing. Please set API_BASE_URL and API_TOKEN environment variables.');
    }

    if (!Array.isArray(tokenIdentifiers) || tokenIdentifiers.length === 0) {
      throw new Error('tokenIdentifiers must be a non-empty array of full token identifiers');
    }

    if (tokenIdentifiers.length > 50) {
      throw new Error('Maximum 50 NFTs can be transferred in a single transaction');
    }

    if (!walletPem || walletPem.trim().length === 0) {
      throw new Error('Wallet PEM is required');
    }

    // Validate PEM format
    if (!walletPem.includes('BEGIN') || !walletPem.includes('END')) {
      throw new Error('Invalid PEM format. PEM must include BEGIN and END markers.');
    }

    // Restore PEM line breaks if needed
    let pemToSend = walletPem;
    if (!pemToSend.includes('\n')) {
      // Replace the spaces between the header/footer and base64 with line breaks
      pemToSend = pemToSend
        .replace(/-----BEGIN ([A-Z ]+)-----\s*/, '-----BEGIN $1-----\n')
        .replace(/\s*-----END ([A-Z ]+)-----/, '\n-----END $1-----')
        .replace(/ ([A-Za-z0-9+/=]{64})/g, '\n$1') // Break base64 into lines of 64 chars
        .replace(/ ([A-Za-z0-9+/=]+)-----END/, '\n$1-----END'); // Final line before footer
    }

    // Validate PEM after processing
    if (!pemToSend || pemToSend.trim().length === 0) {
      throw new Error('PEM processing failed - PEM became empty after processing');
    }

    // Validate and extract collection/nonce from each identifier
    const validatedIdentifiers = [];
    for (const identifier of tokenIdentifiers) {
      try {
        const { collection, nonce } = extractCollectionAndNonce(identifier);
        validatedIdentifiers.push({
          fullIdentifier: identifier,
          collection: collection,
          nonce: nonce
        });
      } catch (error) {
        throw new Error(`Invalid token identifier "${identifier}": ${error.message}`);
      }
    }

    const requestBody = {
      walletPem: pemToSend,
      recipient: recipientWallet,
      tokenIdentifiers: tokenIdentifiers, // Array of full identifiers (e.g., ["EMP-897b49-0112"])
    };
    
    const fullEndpoint = apiBaseUrl.endsWith('/') 
      ? `${apiBaseUrl}execute/multiNFTTransfer` 
      : `${apiBaseUrl}/execute/multiNFTTransfer`;
    
    console.log(`Transferring ${tokenIdentifiers.length} NFTs to: ${recipientWallet}`);
    console.log(`API endpoint: ${fullEndpoint}`);
    console.log(`NFTs: ${tokenIdentifiers.join(', ')}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout for bulk transfers
    
    try {
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      console.log(`API response status: ${response.status}`);
      console.log(`API response for multi NFT transfer: ${responseText}`);
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Error parsing API response:', parseError.message);
        parsedResponse = { success: response.ok, message: responseText };
      }
      
      let txHash = null;
      let txStatus = null;
      
      if (parsedResponse.txHash) {
        txHash = parsedResponse.txHash;
      } else if (parsedResponse.result && parsedResponse.result.txHash) {
        txHash = parsedResponse.result.txHash;
      } else if (parsedResponse.data && parsedResponse.data.txHash) {
        txHash = parsedResponse.data.txHash;
      } else if (parsedResponse.transaction && parsedResponse.transaction.txHash) {
        txHash = parsedResponse.transaction.txHash;
      }
      
      // Check for transaction status in the response
      if (parsedResponse.result && parsedResponse.result.status) {
        txStatus = parsedResponse.result.status;
      } else if (parsedResponse.status) {
        txStatus = parsedResponse.status;
      }
      
      // Handle error messages from API
      let errorMessage = null;
      if (!response.ok) {
        // Check for error message in various possible locations
        errorMessage = parsedResponse.message || 
                      parsedResponse.error || 
                      (parsedResponse.result && parsedResponse.result.error) ||
                      (parsedResponse.data && parsedResponse.data.error);
        
        // Add HTTP status context if no specific error message
        if (!errorMessage) {
          if (response.status === 400) {
            errorMessage = 'Bad Request - Invalid parameters or validation error';
          } else if (response.status === 401) {
            errorMessage = 'Unauthorized - Missing or invalid API token';
          } else if (response.status === 404) {
            errorMessage = 'Not Found - Invalid API endpoint';
          } else if (response.status === 500) {
            errorMessage = 'Internal Server Error - Transaction failed or server error';
          } else {
            errorMessage = `API error (${response.status})`;
          }
        }
      }
      
      // Only treat as success if status is 'success', HTTP is OK, and txHash exists
      const isApiSuccess = response.ok && txStatus === 'success' && !!txHash;
      
      const result = {
        success: isApiSuccess,
        txHash: txHash,
        errorMessage: errorMessage || (txStatus && txStatus !== 'success' ? `Transaction status: ${txStatus}` : null),
        rawResponse: parsedResponse,
        httpStatus: response.status,
        nftCount: tokenIdentifiers.length
      };
      
      if (result.success) {
        console.log(`Successfully sent ${tokenIdentifiers.length} NFTs to: ${recipientWallet}${txHash ? ` (txHash: ${txHash})` : ''}`);
      } else {
        console.error(`API reported failure for multi NFT transfer: ${errorMessage || 'Unknown error'}`);
        if (txHash) {
          console.log(`Transaction hash was returned (${txHash}), but transaction failed (status: ${txStatus}).`);
        }
      }
      
      return result;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('Multi NFT transfer API request timed out after 120 seconds');
        throw new Error('API request timed out after 120 seconds');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error(`Error transferring multiple NFTs:`, error.message);
    throw error;
  }
}

// Export functions for use in API endpoint
module.exports = {
  extractCollectionAndNonce,
  transferMultipleNFTs
};
