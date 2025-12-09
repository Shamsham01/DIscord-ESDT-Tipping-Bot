const supabase = require('../supabase-client');
const fetch = require('node-fetch');

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

// Helper function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to fetch with exponential backoff retry
async function fetchWithRetry(url, maxRetries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      
      // If rate limited (429), retry with exponential backoff
      if (response.status === 429) {
        if (attempt < maxRetries) {
          // Calculate exponential backoff delay
          const delay = Math.min(
            INITIAL_RETRY_DELAY * Math.pow(2, attempt),
            MAX_RETRY_DELAY
          );
          
          // Check for Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;
          
          console.warn(`[NFT-CACHE] Rate limited (429) for ${url}, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await sleep(waitTime);
          continue;
        } else {
          throw new Error(`Failed to fetch NFT: ${response.status} ${response.statusText} (rate limited after ${maxRetries + 1} attempts)`);
        }
      }
      
      // For other errors, throw immediately
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`NFT not found: ${url}`);
        }
        throw new Error(`Failed to fetch NFT: ${response.status} ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      lastError = error;
      
      // If it's a 429 error and we have retries left, continue
      if (error.message && error.message.includes('429') && attempt < maxRetries) {
        const delay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, attempt),
          MAX_RETRY_DELAY
        );
        console.warn(`[NFT-CACHE] Rate limited (429) for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(delay);
        continue;
      }
      
      // For network errors on last attempt, throw
      if (attempt === maxRetries) {
        throw error;
      }
      
      // For other errors, wait a bit and retry
      const delay = Math.min(
        INITIAL_RETRY_DELAY * Math.pow(2, attempt),
        MAX_RETRY_DELAY
      );
      await sleep(delay);
    }
  }
  
  throw lastError;
}

async function getNFTMetadata(collection, nonce, forceRefresh = false, identifierOverride = null) {
  try {
    // Use provided identifier if available (from database), otherwise construct it
    // This matches the logic used in /show-my-nft command
    const identifier = identifierOverride || `${collection}-${nonce.toString().padStart(4, '0')}`;
    
    // Check cache first (using the actual identifier format)
    if (!forceRefresh) {
      const { data: cached, error: cacheError } = await supabase
        .from('nft_metadata_cache')
        .select('*')
        .eq('identifier', identifier)
        .single();
      
      if (!cacheError && cached) {
        const expiresAt = new Date(cached.expires_at).getTime();
        if (Date.now() < expiresAt) {
          return cached.attributes;
        }
      }
    }
    
    // Fetch from API using the identifier (same format as /show-my-nft) with retry logic
    const nftResponse = await fetchWithRetry(`https://api.multiversx.com/nfts/${identifier}`);
    
    if (!nftResponse.ok) {
      if (nftResponse.status === 404) {
        throw new Error(`NFT not found: ${identifier}`);
      }
      throw new Error(`Failed to fetch NFT: ${nftResponse.status} ${nftResponse.statusText}`);
    }
    
    const nftData = await nftResponse.json();
    
    // Extract attributes (using same logic as /show-my-nft command)
    let attributes = [];
    
    // Helper function to convert IPFS URL to HTTP gateway URL
    const convertIPFSToGateway = (ipfsUrl) => {
      if (!ipfsUrl) return ipfsUrl;
      if (ipfsUrl.startsWith('ipfs://')) {
        const ipfsHash = ipfsUrl.replace('ipfs://', '');
        return `https://ipfs.io/ipfs/${ipfsHash}`;
      }
      return ipfsUrl;
    };
    
    // Decode URIs array to get IPFS URLs (standard MultiversX format)
    let ipfsImageUrl = null;
    let ipfsJsonUrl = null;
    if (nftData.uris && Array.isArray(nftData.uris) && nftData.uris.length > 0) {
      for (const uri of nftData.uris) {
        try {
          const decodedUri = Buffer.from(uri, 'base64').toString('utf-8');
          if (decodedUri.includes('.png') || decodedUri.includes('.jpg') || decodedUri.includes('.jpeg') || decodedUri.includes('.gif') || decodedUri.includes('.webp')) {
            ipfsImageUrl = decodedUri;
          } else if (decodedUri.includes('.json')) {
            ipfsJsonUrl = decodedUri;
          }
        } catch (uriError) {
          // Ignore decode errors
        }
      }
    }
    
    // Try direct attributes array first
    if (nftData.attributes && Array.isArray(nftData.attributes)) {
      attributes = nftData.attributes;
    }
    // Try metadata.attributes
    else if (nftData.metadata && nftData.metadata.attributes) {
      attributes = nftData.metadata.attributes;
    }
    // Try decoding base64 attributes field (MultiversX standard format)
    else if (nftData.attributes && typeof nftData.attributes === 'string') {
      try {
        const decodedAttributes = Buffer.from(nftData.attributes, 'base64').toString('utf-8');
        
        // Parse format: "tags:...;metadata:..."
        const metadataMatch = decodedAttributes.match(/metadata:([^\s;]+)/);
        if (metadataMatch && metadataMatch[1]) {
          let metadataPath = metadataMatch[1];
          // If it's just a path (not starting with http or ipfs://), construct full IPFS URL
          if (!metadataPath.startsWith('http') && !metadataPath.startsWith('ipfs://')) {
            // If we have a JSON URL from uris, prefer that (it's already decoded)
            if (ipfsJsonUrl) {
              metadataPath = ipfsJsonUrl;
            } else if (nftData.hash) {
              try {
                const hashDecoded = Buffer.from(nftData.hash, 'base64').toString('utf-8');
                metadataPath = `ipfs://${hashDecoded}/${metadataPath}`;
              } catch (hashError) {
                // If hash decode fails, just prepend ipfs:// to the path
                metadataPath = `ipfs://${metadataPath}`;
              }
            } else {
              // No hash available, just prepend ipfs://
              metadataPath = `ipfs://${metadataPath}`;
            }
          }
          // If it already starts with ipfs:// or http, use it as-is
          
          // Use the JSON URL from uris if we have it, otherwise use the constructed path
          const jsonUrlToFetch = ipfsJsonUrl || metadataPath;
          
          // Helper function to fetch JSON and extract attributes
          const fetchJsonMetadata = async (url) => {
            if (url.startsWith('ipfs://')) {
              const ipfsPath = url.replace('ipfs://', ''); // Get full path including subpath
              const ipfsGateways = [
                `https://ipfs.io/ipfs/${ipfsPath}`,
                `https://cloudflare-ipfs.com/ipfs/${ipfsPath}`,
                `https://gateway.pinata.cloud/ipfs/${ipfsPath}`,
                `https://dweb.link/ipfs/${ipfsPath}`
              ];
              
              // Try each gateway until one works
              for (const gateway of ipfsGateways) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000);
                  const ipfsResponse = await fetch(gateway, { signal: controller.signal });
                  clearTimeout(timeoutId);
                  
                  if (ipfsResponse.ok) {
                    const ipfsData = await ipfsResponse.json();
                    
                    // Extract attributes from IPFS JSON metadata
                    if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                      attributes = ipfsData.attributes;
                      return true; // Success
                    } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                      attributes = ipfsData.traits;
                      return true; // Success
                    }
                  }
                } catch (ipfsError) {
                  // Try next gateway
                  continue;
                }
              }
            } else if (url.startsWith('http')) {
              // Direct HTTP URL
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const jsonResponse = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (jsonResponse.ok) {
                  const jsonData = await jsonResponse.json();
                  if (jsonData.attributes && Array.isArray(jsonData.attributes)) {
                    attributes = jsonData.attributes;
                    return true; // Success
                  } else if (jsonData.traits && Array.isArray(jsonData.traits)) {
                    attributes = jsonData.traits;
                    return true; // Success
                  }
                }
              } catch (jsonError) {
                // Ignore errors
              }
            }
            return false; // Failed
          };
          
          // Try fetching from the JSON URL
          await fetchJsonMetadata(jsonUrlToFetch);
        }
      } catch (attrError) {
        // Ignore decode errors, try other methods
      }
    }
    
    // If we still don't have attributes and we have a JSON URL from uris, try fetching it directly
    if (attributes.length === 0 && ipfsJsonUrl) {
      const fetchJsonMetadata = async (url) => {
        if (url.startsWith('ipfs://')) {
          const ipfsPath = url.replace('ipfs://', ''); // Get full path including subpath
          const ipfsGateways = [
            `https://ipfs.io/ipfs/${ipfsPath}`,
            `https://cloudflare-ipfs.com/ipfs/${ipfsPath}`,
            `https://gateway.pinata.cloud/ipfs/${ipfsPath}`,
            `https://dweb.link/ipfs/${ipfsPath}`
          ];
          
          for (const gateway of ipfsGateways) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);
              const ipfsResponse = await fetch(gateway, { signal: controller.signal });
              clearTimeout(timeoutId);
              
              if (ipfsResponse.ok) {
                const ipfsData = await ipfsResponse.json();
                if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                  attributes = ipfsData.attributes;
                  return true;
                } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                  attributes = ipfsData.traits;
                  return true;
                }
              }
            } catch (ipfsError) {
              continue;
            }
          }
        } else if (url.startsWith('http')) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const jsonResponse = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (jsonResponse.ok) {
              const jsonData = await jsonResponse.json();
              if (jsonData.attributes && Array.isArray(jsonData.attributes)) {
                attributes = jsonData.attributes;
                return true;
              } else if (jsonData.traits && Array.isArray(jsonData.traits)) {
                attributes = jsonData.traits;
                return true;
              }
            }
          } catch (jsonError) {
            // Ignore errors
          }
        }
        return false;
      };
      
      await fetchJsonMetadata(ipfsJsonUrl);
    }
    
    // Last resort: try metadata.uri if available
    if (attributes.length === 0 && nftData.metadata && nftData.metadata.uri) {
      try {
        const metadataResponse = await fetch(convertIPFSToGateway(nftData.metadata.uri));
        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          attributes = metadata.attributes || metadata.traits || [];
        }
      } catch (uriError) {
        console.warn(`[NFT-CACHE] Failed to fetch metadata URI for ${identifier}:`, uriError.message);
      }
    }
    
    // Cache the result
    const expiresAt = new Date(Date.now() + CACHE_DURATION_MS);
    
    await supabase
      .from('nft_metadata_cache')
      .upsert({
        identifier: identifier,
        collection: collection,
        nonce: nonce,
        attributes: attributes,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'identifier'
      });
    
    return attributes;
  } catch (error) {
    const identifier = identifierOverride || `${collection}-${nonce.toString().padStart(4, '0')}`;
    console.error(`[NFT-CACHE] Error getting NFT metadata for ${identifier} (collection: ${collection}, nonce: ${nonce}):`, error);
    throw error;
  }
}

async function getNFTMetadataBatch(nfts, forceRefresh = false) {
  try {
    // Use identifier from nft if available, otherwise construct it
    const nftsWithIdentifiers = nfts.map(nft => ({
      ...nft,
      identifier: nft.identifier || `${nft.collection}-${nft.nonce.toString().padStart(4, '0')}`
    }));
    
    // Process requests sequentially with delays to avoid rate limiting
    // Rate limit: Max 10 requests per second (100ms delay between requests)
    const REQUEST_DELAY_MS = 150; // 150ms = ~6.7 requests/second (safe margin)
    const metadataMap = {};
    
    for (let i = 0; i < nftsWithIdentifiers.length; i++) {
      const nft = nftsWithIdentifiers[i];
      const identifier = nft.identifier;
      
      try {
        // Add delay between requests (except for the first one)
        if (i > 0) {
          await sleep(REQUEST_DELAY_MS);
        }
        
        // Use the identifier directly (same as /show-my-nft command)
        // This ensures we use the exact format stored in the database (e.g., "d0" hex format)
        const attributes = await getNFTMetadata(nft.collection, nft.nonce, forceRefresh, nft.identifier);
        metadataMap[identifier] = attributes;
      } catch (error) {
        metadataMap[identifier] = null;
        console.warn(`[NFT-CACHE] Failed to fetch metadata for ${identifier}:`, error.message);
        
        // If we hit a rate limit, add extra delay before continuing
        if (error.message && error.message.includes('429')) {
          console.warn(`[NFT-CACHE] Rate limit detected, waiting 2 seconds before continuing batch...`);
          await sleep(2000);
        }
      }
    }
    
    return metadataMap;
  } catch (error) {
    console.error('[NFT-CACHE] Error getting NFT metadata batch:', error);
    throw error;
  }
}

async function clearExpiredCache() {
  try {
    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from('nft_metadata_cache')
      .delete()
      .lt('expires_at', now);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[NFT-CACHE] Error clearing expired cache:', error);
    throw error;
  }
}

module.exports = {
  getNFTMetadata,
  getNFTMetadataBatch,
  clearExpiredCache
};

