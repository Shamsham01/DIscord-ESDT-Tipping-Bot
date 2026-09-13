const fetch = require('node-fetch');
const {
  parseIpfsPath,
  resolveNftJsonMetadata,
  toMultiversxMediaUrl,
  pickNftImageUrl
} = require('./ipfs-json');

/** Prefer MultiversX media CDN: ipfs.io / dweb.link now serve a browser service-worker page Discord cannot embed. */
const DISCORD_FRIENDLY_IPFS_PREFIX = 'https://media.multiversx.com/nfts/asset/';

function normalizeNftMediaUrlForDiscord(url) {
  if (!url || typeof url !== 'string') return url || null;
  const mediaUrl = toMultiversxMediaUrl(url);
  if (mediaUrl) return mediaUrl;

  let u = url.trim();
  if (u.startsWith('ipfs://')) {
    const parsed = parseIpfsPath(u);
    if (parsed) {
      return `${DISCORD_FRIENDLY_IPFS_PREFIX}${parsed.cid}${parsed.path ? `/${parsed.path}` : ''}`;
    }
  }
  return u;
}

/**
 * Resolve a Discord-safe NFT image from a MultiversX API payload.
 * Uses on-chain URIs first, then IPFS JSON when the indexer timed out.
 */
async function resolveNftImageFromApiPayload(nftDetails, storedImageUrl = null) {
  let imageUrl = pickNftImageUrl(nftDetails, storedImageUrl);
  if (!imageUrl || String(imageUrl).includes('default.png')) {
    try {
      const resolved = await resolveNftJsonMetadata(nftDetails || {});
      if (resolved.image) imageUrl = resolved.image;
    } catch (error) {
      console.log(`[NFT-DISPLAY] IPFS image fallback failed: ${error.message}`);
    }
  }
  return normalizeNftMediaUrlForDiscord(imageUrl);
}

/**
 * Resolve a Discord-safe image for any NFT-like record (tips, listings, auctions, withdrawals).
 */
async function resolveNftEmbedImage(nftLike, collection) {
  const fallback = nftLike?.nft_image_url || nftLike?.nftImageUrl || null;
  try {
    if (nftLike?.identifier) {
      const state = await fetchMultiversXNftDisplayState(nftLike, collection);
      if (state.imageUrl) return state.imageUrl;
    }
  } catch (error) {
    console.error(`[NFT-DISPLAY] Failed to resolve image for ${nftLike?.identifier}:`, error.message);
  }
  return normalizeNftMediaUrlForDiscord(fallback);
}

/**
 * Shared MultiversX NFT metadata + image resolution (same pipeline as /show-my-nft).
 * @param {object} nftLike - { identifier, nft_image_url?, metadata? }
 * @param {string} collection - collection ticker/id for merges and logs
 * @param {object} [options]
 * @param {function(string): Promise<void>} [options.onProgress] - e.g. interaction.editReply with loading text
 */
async function fetchMultiversXNftDisplayState(nftLike, collection, options = {}) {
  const identifier = nftLike?.identifier;
  const onProgress = options.onProgress;

  let metadata = nftLike?.metadata && typeof nftLike.metadata === 'object' ? { ...nftLike.metadata } : {};

  if (!identifier) {
    return {
      nftDetails: null,
      imageUrl: normalizeNftMediaUrlForDiscord(nftLike?.nft_image_url),
      attributes: [],
      metadata
    };
  }

  let nftDetails = null;
  let nftImageUrl = nftLike.nft_image_url || null;
  let attributes = [];

  if (nftImageUrl) {
    nftImageUrl = normalizeNftMediaUrlForDiscord(nftImageUrl);
  }

  try {
    if (typeof onProgress === 'function') {
      await onProgress('🔄 Fetching NFT details from MultiversX...');
    }

    const nftUrl = `https://api.multiversx.com/nfts/${identifier}`;
    const nftResponse = await fetch(nftUrl);

    if (nftResponse.ok) {
      nftDetails = await nftResponse.json();
      nftImageUrl = pickNftImageUrl(nftDetails, nftImageUrl);
      nftImageUrl = normalizeNftMediaUrlForDiscord(nftImageUrl);

      if (typeof onProgress === 'function') {
        await onProgress('🔄 Resolving NFT metadata from IPFS...');
      }

      const resolved = await resolveNftJsonMetadata(nftDetails);
      if (resolved.attributes.length > 0) {
        attributes = resolved.attributes;
        console.log(`[SHOW-NFT] Found ${attributes.length} attributes for ${identifier}`);
      }

      if (resolved.image && (!nftImageUrl || String(nftImageUrl).includes('default.png'))) {
        nftImageUrl = normalizeNftMediaUrlForDiscord(resolved.image);
      }

      if (attributes.length === 0 && metadata.attributes && Array.isArray(metadata.attributes) && metadata.attributes.length > 0) {
        attributes = metadata.attributes;
        console.log(`[SHOW-NFT] Found ${attributes.length} attributes from stored metadata for ${identifier}`);
      }

      if (attributes.length === 0) {
        console.log(`[SHOW-NFT] No attributes found for ${identifier}. API response keys:`, Object.keys(nftDetails));
        if (nftDetails.metadata) {
          console.log(`[SHOW-NFT] Metadata:`, JSON.stringify(nftDetails.metadata).slice(0, 300));
        }
      }

      metadata = {
        ...metadata,
        collection: nftDetails.collection || collection,
        ticker: nftDetails.ticker || null,
        owner: nftDetails.owner || null,
        supply: nftDetails.supply || null,
        decimals: nftDetails.decimals || null
      };
    }
  } catch (fetchError) {
    console.error(`[SHOW-NFT] Error fetching NFT details for ${identifier}:`, fetchError.message);
    if (metadata.attributes && Array.isArray(metadata.attributes)) {
      attributes = metadata.attributes;
    }
  }

  return {
    nftDetails,
    imageUrl: normalizeNftMediaUrlForDiscord(nftImageUrl),
    attributes,
    metadata
  };
}

module.exports = {
  fetchMultiversXNftDisplayState,
  normalizeNftMediaUrlForDiscord,
  resolveNftEmbedImage,
  resolveNftImageFromApiPayload
};
