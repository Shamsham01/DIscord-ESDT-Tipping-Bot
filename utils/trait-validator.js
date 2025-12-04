const nftMetadataCache = require('../db/nft-metadata-cache');

/**
 * Validate NFT traits against pool filters
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} collection - Collection ticker
 * @param {number} nonce - NFT nonce
 * @param {Array} traitFilters - Array of {trait_type, value} filters
 * @returns {Object} {valid: boolean, reason?: string, traits?: Object}
 */
async function validateNFTTraits(guildId, userId, collection, nonce, traitFilters) {
  // If no filters, accept all
  if (!traitFilters || traitFilters.length === 0) {
    return { valid: true };
  }
  
  try {
    // Get NFT metadata (from cache or API)
    const attributes = await nftMetadataCache.getNFTMetadata(collection, nonce);
    
    // If metadata is missing or empty, reject
    if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
      return {
        valid: false,
        reason: 'NFT metadata is missing or incomplete. Cannot validate traits.'
      };
    }
    
    // Build map of NFT traits: { trait_type: value }
    const nftTraitMap = {};
    for (const attr of attributes) {
      if (attr.trait_type && attr.value !== undefined && attr.value !== null) {
        nftTraitMap[attr.trait_type] = attr.value;
      }
    }
    
    // Validate against all filters (AND logic)
    for (const filter of traitFilters) {
      const { trait_type, value } = filter;
      
      // Check if NFT has this trait_type
      if (!(trait_type in nftTraitMap)) {
        return {
          valid: false,
          reason: `NFT does not have trait type: "${trait_type}"`
        };
      }
      
      // If value is specified (not null), check exact match
      if (value !== null && value !== undefined) {
        if (nftTraitMap[trait_type] !== value) {
          return {
            valid: false,
            reason: `NFT trait "${trait_type}" is "${nftTraitMap[trait_type]}", required: "${value}"`
          };
        }
      }
      // If value is null, any value for this trait_type is acceptable
    }
    
    return { valid: true, traits: nftTraitMap };
    
  } catch (error) {
    console.error(`[TRAIT-VALIDATOR] Error validating NFT traits:`, error);
    
    // On API error, reject to prevent invalid stakes
    return {
      valid: false,
      reason: `Error validating NFT traits: ${error.message}`
    };
  }
}

/**
 * Validate multiple NFTs in batch
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {Array} nfts - Array of {collection, nonce}
 * @param {Array} traitFilters - Array of {trait_type, value} filters
 * @returns {Object} {validNFTs: Array, invalidNFTs: Array}
 */
async function validateMultipleNFTs(guildId, userId, nfts, traitFilters) {
  // If no filters, all are valid
  if (!traitFilters || traitFilters.length === 0) {
    return {
      validNFTs: nfts,
      invalidNFTs: []
    };
  }
  
  try {
    // Fetch metadata for all NFTs in batch
    // Use identifier from nft if available, otherwise construct it
    const nftsWithIdentifiers = nfts.map(nft => ({
      ...nft,
      identifier: nft.identifier || `${nft.collection}-${nft.nonce.toString().padStart(4, '0')}`
    }));
    
    const metadataMap = await nftMetadataCache.getNFTMetadataBatch(nftsWithIdentifiers);
    
    const validNFTs = [];
    const invalidNFTs = [];
    
    for (const nft of nftsWithIdentifiers) {
      const attributes = metadataMap[nft.identifier];
      
      // If metadata fetch failed
      if (!attributes) {
        invalidNFTs.push({
          nft: nft,
          reason: `Failed to fetch NFT metadata for ${nft.identifier}`
        });
        continue;
      }
      
      // Build trait map
      const nftTraitMap = {};
      for (const attr of attributes) {
        if (attr.trait_type && attr.value !== undefined && attr.value !== null) {
          nftTraitMap[attr.trait_type] = attr.value;
        }
      }
      
      // Validate against filters
      let isValid = true;
      let reason = null;
      
      for (const filter of traitFilters) {
        const { trait_type, value } = filter;
        
        if (!(trait_type in nftTraitMap)) {
          isValid = false;
          reason = `NFT does not have trait type: "${trait_type}"`;
          break;
        }
        
        if (value !== null && value !== undefined) {
          if (nftTraitMap[trait_type] !== value) {
            isValid = false;
            reason = `NFT trait "${trait_type}" is "${nftTraitMap[trait_type]}", required: "${value}"`;
            break;
          }
        }
      }
      
      if (isValid) {
        validNFTs.push(nft);
      } else {
        invalidNFTs.push({
          nft: nft,
          reason: reason
        });
      }
    }
    
    return { validNFTs, invalidNFTs };
    
  } catch (error) {
    console.error('[TRAIT-VALIDATOR] Error validating multiple NFTs:', error);
    // On batch error, reject all to be safe
    return {
      validNFTs: [],
      invalidNFTs: nfts.map(nft => ({
        nft: nft,
        reason: `Batch validation error: ${error.message}`
      }))
    };
  }
}

module.exports = {
  validateNFTTraits,
  validateMultipleNFTs
};

