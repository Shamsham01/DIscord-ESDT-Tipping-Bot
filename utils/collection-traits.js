const fetch = require('node-fetch');

/**
 * Fetch collection traits from MultiversX API
 * @param {string} collectionTicker - Collection ticker (e.g., "EMP-897b49")
 * @returns {Object} {collectionName, collectionImageUrl, traits: {trait_type: [values]}}
 */
async function fetchCollectionTraits(collectionTicker) {
  try {
    const response = await fetch(`https://api.multiversx.com/collections/${collectionTicker}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Collection not found: ${collectionTicker}`);
      }
      throw new Error(`Failed to fetch collection: ${response.status} ${response.statusText}`);
    }
    
    const collectionData = await response.json();
    
    // Parse traits JSON string
    let traits = {};
    if (collectionData.traits) {
      try {
        const traitsStr = typeof collectionData.traits === 'string' 
          ? collectionData.traits 
          : JSON.stringify(collectionData.traits);
        traits = JSON.parse(traitsStr);
      } catch (parseError) {
        console.error(`[COLLECTION-TRAITS] Error parsing traits for ${collectionTicker}:`, parseError);
        throw new Error('Failed to parse collection traits');
      }
    }
    
    // Transform to structure: { trait_type: [value1, value2, ...] }
    const traitOptions = {};
    for (const [traitType, valuesObj] of Object.entries(traits)) {
      if (typeof valuesObj === 'object' && valuesObj !== null) {
        traitOptions[traitType] = Object.keys(valuesObj);
      }
    }
    
    return {
      collectionName: collectionData.name || collectionTicker,
      collectionImageUrl: collectionData.assets?.pngUrl || collectionData.assets?.svgUrl || null,
      traits: traitOptions
    };
  } catch (error) {
    console.error(`[COLLECTION-TRAITS] Error fetching collection traits for ${collectionTicker}:`, error);
    throw error;
  }
}

module.exports = {
  fetchCollectionTraits
};

