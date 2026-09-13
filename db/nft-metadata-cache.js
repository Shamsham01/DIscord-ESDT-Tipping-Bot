const supabase = require('../supabase-client');
const fetch = require('node-fetch');
const { buildNftIdentifier, resolveNftJsonMetadata } = require('../utils/ipfs-json');

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMPTY_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes — do not poison cache when IPFS is down
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        if (attempt < maxRetries) {
          const delay = Math.min(
            INITIAL_RETRY_DELAY * Math.pow(2, attempt),
            MAX_RETRY_DELAY
          );
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;
          console.warn(`[NFT-CACHE] Rate limited (429) for ${url}, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await sleep(waitTime);
          continue;
        }
        throw new Error(`Failed to fetch NFT: ${response.status} ${response.statusText} (rate limited after ${maxRetries + 1} attempts)`);
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`NFT not found: ${url}`);
        }
        throw new Error(`Failed to fetch NFT: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (error.message && error.message.includes('429') && attempt < maxRetries) {
        const delay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, attempt),
          MAX_RETRY_DELAY
        );
        console.warn(`[NFT-CACHE] Rate limited (429) for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(delay);
        continue;
      }

      if (attempt === maxRetries) {
        throw error;
      }

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
  const identifier = buildNftIdentifier(collection, nonce, identifierOverride);

  try {
    if (!forceRefresh) {
      const { data: cached, error: cacheError } = await supabase
        .from('nft_metadata_cache')
        .select('attributes,expires_at')
        .eq('identifier', identifier)
        .single();

      if (!cacheError && cached) {
        const expiresAt = new Date(cached.expires_at).getTime();
        const cachedAttributes = Array.isArray(cached.attributes) ? cached.attributes : [];
        // Ignore empty cache entries so a previous IPFS miss can be retried
        if (Date.now() < expiresAt && cachedAttributes.length > 0) {
          return cachedAttributes;
        }
      }
    }

    const nftResponse = await fetchWithRetry(`https://api.multiversx.com/nfts/${identifier}`);
    const nftData = await nftResponse.json();
    const resolved = await resolveNftJsonMetadata(nftData);
    const attributes = resolved.attributes || [];

    const ttl = attributes.length > 0 ? CACHE_DURATION_MS : EMPTY_CACHE_DURATION_MS;
    const expiresAt = new Date(Date.now() + ttl);

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
    console.error(`[NFT-CACHE] Error getting NFT metadata for ${identifier} (collection: ${collection}, nonce: ${nonce}):`, error);
    throw error;
  }
}

async function getNFTMetadataBatch(nfts, forceRefresh = false) {
  try {
    const nftsWithIdentifiers = nfts.map(nft => ({
      ...nft,
      identifier: buildNftIdentifier(nft.collection, nft.nonce, nft.identifier)
    }));

    const REQUEST_DELAY_MS = 150;
    const metadataMap = {};

    for (let i = 0; i < nftsWithIdentifiers.length; i++) {
      const nft = nftsWithIdentifiers[i];
      const identifier = nft.identifier;

      try {
        if (i > 0) {
          await sleep(REQUEST_DELAY_MS);
        }

        const attributes = await getNFTMetadata(nft.collection, nft.nonce, forceRefresh, nft.identifier);
        metadataMap[identifier] = attributes;
      } catch (error) {
        metadataMap[identifier] = null;
        console.warn(`[NFT-CACHE] Failed to fetch metadata for ${identifier}:`, error.message);

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
