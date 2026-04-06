const fetch = require('node-fetch');

/** Prefer for Discord embeds: distinct hostname from ipfs.io can avoid some rate-limit/fetch quirks with Discord's proxy. */
const DISCORD_FRIENDLY_IPFS_PREFIX = 'https://dweb.link/ipfs/';

function normalizeNftMediaUrlForDiscord(url) {
  if (!url || typeof url !== 'string') return url || null;
  let u = url.trim();
  if (u.startsWith('ipfs://')) {
    u = `${DISCORD_FRIENDLY_IPFS_PREFIX}${u.replace(/^ipfs:\/\//i, '')}`;
  }
  u = u.replace(/^https:\/\/ipfs\.io\/ipfs\//i, DISCORD_FRIENDLY_IPFS_PREFIX);
  u = u.replace(/^https:\/\/gateway\.ipfs\.io\/ipfs\//i, DISCORD_FRIENDLY_IPFS_PREFIX);
  return u;
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

  const convertIPFSToGateway = (ipfsUrl) => {
    if (!ipfsUrl) return ipfsUrl;
    if (ipfsUrl.startsWith('ipfs://')) {
      const ipfsHash = ipfsUrl.replace('ipfs://', '');
      return `${DISCORD_FRIENDLY_IPFS_PREFIX}${ipfsHash}`;
    }
    return ipfsUrl;
  };

  if (nftImageUrl && nftImageUrl.startsWith('ipfs://')) {
    nftImageUrl = convertIPFSToGateway(nftImageUrl);
  }

  try {
    if (typeof onProgress === 'function') {
      await onProgress('🔄 Fetching NFT details from MultiversX...');
    }

    const nftUrl = `https://api.multiversx.com/nfts/${identifier}`;
    const nftResponse = await fetch(nftUrl);

    if (nftResponse.ok) {
      nftDetails = await nftResponse.json();

      let ipfsImageUrl = null;
      let ipfsJsonUrl = null;
      if (nftDetails.uris && Array.isArray(nftDetails.uris) && nftDetails.uris.length > 0) {
        for (const uri of nftDetails.uris) {
          try {
            const decodedUri = Buffer.from(uri, 'base64').toString('utf-8');
            console.log(`[SHOW-NFT] Decoded URI: ${decodedUri}`);

            if (decodedUri.includes('.png') || decodedUri.includes('.jpg') || decodedUri.includes('.jpeg') || decodedUri.includes('.gif') || decodedUri.includes('.webp')) {
              ipfsImageUrl = decodedUri;
            } else if (decodedUri.includes('.json')) {
              ipfsJsonUrl = decodedUri;
            }
          } catch (uriError) {
            console.log(`[SHOW-NFT] Could not decode URI: ${uriError.message}`);
          }
        }
      }

      // Prefer explicit image URIs from the token (reliable artwork URL). MultiversX `url` often
      // overrides these with a link Discord's embed proxy fails to render.
      if (ipfsImageUrl) {
        nftImageUrl = convertIPFSToGateway(ipfsImageUrl);
        console.log(`[SHOW-NFT] Using image from decoded URIs: ${nftImageUrl}`);
      } else if (nftDetails.url && !nftDetails.url.includes('default.png')) {
        nftImageUrl = convertIPFSToGateway(nftDetails.url);
      } else if (nftDetails.media && nftDetails.media.length > 0) {
        const mediaUrl = nftDetails.media[0].url || nftDetails.media[0].thumbnailUrl;
        if (mediaUrl && !mediaUrl.includes('default.png')) {
          nftImageUrl = convertIPFSToGateway(mediaUrl);
        }
      }

      if (!nftImageUrl && nftDetails.metadata) {
        try {
          if (typeof nftDetails.metadata === 'string') {
            const decoded = Buffer.from(nftDetails.metadata, 'base64').toString('utf-8');
            const parsed = JSON.parse(decoded);
            if (parsed.image) {
              nftImageUrl = convertIPFSToGateway(parsed.image);
            }
          } else if (typeof nftDetails.metadata === 'object' && nftDetails.metadata.image) {
            nftImageUrl = convertIPFSToGateway(nftDetails.metadata.image);
          }
        } catch (metaError) {
          // Ignore metadata parsing errors for image
        }
      }

      if (nftDetails.attributes && typeof nftDetails.attributes === 'string') {
        try {
          const decodedAttributes = Buffer.from(nftDetails.attributes, 'base64').toString('utf-8');
          console.log(`[SHOW-NFT] Decoded attributes field: ${decodedAttributes}`);

          const metadataMatch = decodedAttributes.match(/metadata:([^\s;]+)/);
          if (metadataMatch && metadataMatch[1]) {
            let metadataPath = metadataMatch[1];
            if (!metadataPath.startsWith('http') && !metadataPath.startsWith('ipfs://')) {
              if (ipfsJsonUrl) {
                console.log(`[SHOW-NFT] Using JSON URI from uris array: ${ipfsJsonUrl}`);
              } else if (nftDetails.hash) {
                try {
                  const hashDecoded = Buffer.from(nftDetails.hash, 'base64').toString('utf-8');
                  metadataPath = `ipfs://${hashDecoded}/${metadataPath}`;
                  console.log(`[SHOW-NFT] Constructed metadata path: ${metadataPath}`);
                } catch (hashError) {
                  console.log(`[SHOW-NFT] Could not decode hash: ${hashError.message}`);
                }
              }
            } else {
              metadataPath = metadataMatch[1];
            }

            const jsonUrlToFetch = ipfsJsonUrl || (metadataPath.startsWith('ipfs://') ? metadataPath : `ipfs://${metadataPath}`);
            console.log(`[SHOW-NFT] Will fetch metadata from: ${jsonUrlToFetch}`);

            const fetchJsonMetadata = async (url) => {
              if (url.startsWith('ipfs://')) {
                const ipfsHash = url.replace('ipfs://', '');
                const ipfsGateways = [
                  `https://ipfs.io/ipfs/${ipfsHash}`,
                  `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
                  `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
                  `https://dweb.link/ipfs/${ipfsHash}`
                ];

                for (const gateway of ipfsGateways) {
                  let timeoutId = null;
                  try {
                    console.log(`[SHOW-NFT] Attempting to fetch JSON metadata from ${gateway}`);
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 5000);
                    const ipfsResponse = await fetch(gateway, {
                      signal: controller.signal
                    });
                    if (timeoutId) clearTimeout(timeoutId);

                    if (ipfsResponse.ok) {
                      const ipfsData = await ipfsResponse.json();
                      console.log(`[SHOW-NFT] Successfully fetched JSON metadata from ${gateway}`);

                      if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                        attributes = ipfsData.attributes;
                        console.log(`[SHOW-NFT] Found ${attributes.length} attributes from IPFS JSON metadata`);

                        if (ipfsData.image && !nftImageUrl) {
                          nftImageUrl = convertIPFSToGateway(ipfsData.image);
                          console.log(`[SHOW-NFT] Updated image URL from IPFS JSON metadata: ${nftImageUrl}`);
                        }
                        return true;
                      } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                        attributes = ipfsData.traits;
                        console.log(`[SHOW-NFT] Found ${attributes.length} traits from IPFS JSON metadata`);

                        if (ipfsData.image && !nftImageUrl) {
                          nftImageUrl = convertIPFSToGateway(ipfsData.image);
                          console.log(`[SHOW-NFT] Updated image URL from IPFS JSON metadata: ${nftImageUrl}`);
                        }
                        return true;
                      }
                    }
                  } catch (ipfsError) {
                    if (timeoutId) clearTimeout(timeoutId);
                    console.log(`[SHOW-NFT] Failed to fetch JSON from ${gateway}:`, ipfsError.message);
                    continue;
                  }
                }
              } else if (url.startsWith('http')) {
                try {
                  console.log(`[SHOW-NFT] Fetching JSON metadata from direct URL: ${url}`);
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000);
                  const jsonResponse = await fetch(url, {
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);

                  if (jsonResponse.ok) {
                    const jsonData = await jsonResponse.json();
                    if (jsonData.attributes && Array.isArray(jsonData.attributes)) {
                      attributes = jsonData.attributes;
                      console.log(`[SHOW-NFT] Found ${attributes.length} attributes from direct JSON URL`);

                      if (jsonData.image && !nftImageUrl) {
                        nftImageUrl = convertIPFSToGateway(jsonData.image);
                        console.log(`[SHOW-NFT] Updated image URL from JSON metadata: ${nftImageUrl}`);
                      }
                      return true;
                    } else if (jsonData.traits && Array.isArray(jsonData.traits)) {
                      attributes = jsonData.traits;
                      console.log(`[SHOW-NFT] Found ${attributes.length} traits from direct JSON URL`);

                      if (jsonData.image && !nftImageUrl) {
                        nftImageUrl = convertIPFSToGateway(jsonData.image);
                        console.log(`[SHOW-NFT] Updated image URL from JSON metadata: ${nftImageUrl}`);
                      }
                      return true;
                    }
                  }
                } catch (jsonError) {
                  console.log(`[SHOW-NFT] Failed to fetch from direct URL: ${jsonError.message}`);
                }
              }
              return false;
            };

            await fetchJsonMetadata(jsonUrlToFetch);
          }
        } catch (attrError) {
          console.log(`[SHOW-NFT] Could not decode attributes field: ${attrError.message}`);
        }
      }

      if (attributes.length === 0 && ipfsJsonUrl) {
        console.log(`[SHOW-NFT] Attempting to fetch attributes from uris JSON URL: ${ipfsJsonUrl}`);
        const fetchJsonMetadata = async (url) => {
          if (url.startsWith('ipfs://')) {
            const ipfsHash = url.replace('ipfs://', '');
            const ipfsGateways = [
              `https://ipfs.io/ipfs/${ipfsHash}`,
              `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
              `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
              `https://dweb.link/ipfs/${ipfsHash}`
            ];

            for (const gateway of ipfsGateways) {
              let timeoutId = null;
              try {
                console.log(`[SHOW-NFT] Attempting to fetch JSON metadata from ${gateway}`);
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), 5000);
                const ipfsResponse = await fetch(gateway, {
                  signal: controller.signal
                });
                if (timeoutId) clearTimeout(timeoutId);

                if (ipfsResponse.ok) {
                  const ipfsData = await ipfsResponse.json();
                  if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                    attributes = ipfsData.attributes;
                    console.log(`[SHOW-NFT] Found ${attributes.length} attributes from uris JSON URL`);
                    if (ipfsData.image && !nftImageUrl) {
                      nftImageUrl = convertIPFSToGateway(ipfsData.image);
                    }
                    return true;
                  } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                    attributes = ipfsData.traits;
                    console.log(`[SHOW-NFT] Found ${attributes.length} traits from uris JSON URL`);
                    if (ipfsData.image && !nftImageUrl) {
                      nftImageUrl = convertIPFSToGateway(ipfsData.image);
                    }
                    return true;
                  }
                }
              } catch (ipfsError) {
                if (timeoutId) clearTimeout(timeoutId);
                continue;
              }
            }
          } else if (url.startsWith('http')) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);
              const jsonResponse = await fetch(url, {
                signal: controller.signal
              });
              clearTimeout(timeoutId);

              if (jsonResponse.ok) {
                const jsonData = await jsonResponse.json();
                if (jsonData.attributes && Array.isArray(jsonData.attributes)) {
                  attributes = jsonData.attributes;
                  console.log(`[SHOW-NFT] Found ${attributes.length} attributes from uris JSON URL`);
                  if (jsonData.image && !nftImageUrl) {
                    nftImageUrl = convertIPFSToGateway(jsonData.image);
                  }
                  return true;
                } else if (jsonData.traits && Array.isArray(jsonData.traits)) {
                  attributes = jsonData.traits;
                  console.log(`[SHOW-NFT] Found ${attributes.length} traits from uris JSON URL`);
                  if (jsonData.image && !nftImageUrl) {
                    nftImageUrl = convertIPFSToGateway(jsonData.image);
                  }
                  return true;
                }
              }
            } catch (jsonError) {
              console.log(`[SHOW-NFT] Failed to fetch from uris JSON URL: ${jsonError.message}`);
            }
          }
          return false;
        };
        await fetchJsonMetadata(ipfsJsonUrl);
      }

      if (nftDetails.attributes && Array.isArray(nftDetails.attributes) && nftDetails.attributes.length > 0) {
        attributes = nftDetails.attributes;
        console.log(`[SHOW-NFT] Found ${attributes.length} attributes from nftDetails.attributes for ${identifier}`);
      } else if (nftDetails.metadata) {
        if (typeof nftDetails.metadata === 'object' && !Array.isArray(nftDetails.metadata)) {
          if (nftDetails.metadata.attributes && Array.isArray(nftDetails.metadata.attributes)) {
            attributes = nftDetails.metadata.attributes;
            console.log(`[SHOW-NFT] Found ${attributes.length} attributes from metadata.attributes for ${identifier}`);
          }
        } else if (typeof nftDetails.metadata === 'string') {
          try {
            const decoded = Buffer.from(nftDetails.metadata, 'base64').toString('utf-8');
            const parsed = JSON.parse(decoded);

            if (parsed.metadataUri || parsed.metadata_url || parsed.uri) {
              const ipfsUrl = parsed.metadataUri || parsed.metadata_url || parsed.uri;
              console.log(`[SHOW-NFT] Found IPFS metadata URL in decoded metadata: ${ipfsUrl}`);

              if (ipfsUrl.startsWith('ipfs://')) {
                const ipfsHash = ipfsUrl.replace('ipfs://', '');
                const ipfsGateways = [
                  `https://ipfs.io/ipfs/${ipfsHash}`,
                  `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
                  `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
                  `https://dweb.link/ipfs/${ipfsHash}`
                ];

                for (const gateway of ipfsGateways) {
                  let timeoutId = null;
                  try {
                    console.log(`[SHOW-NFT] Attempting to fetch metadata from ${gateway}`);
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 5000);
                    const ipfsResponse = await fetch(gateway, {
                      signal: controller.signal
                    });
                    if (timeoutId) clearTimeout(timeoutId);

                    if (ipfsResponse.ok) {
                      const ipfsData = await ipfsResponse.json();
                      console.log(`[SHOW-NFT] Successfully fetched IPFS metadata from ${gateway}`);

                      if (ipfsData.attributes && Array.isArray(ipfsData.attributes)) {
                        attributes = ipfsData.attributes;
                        console.log(`[SHOW-NFT] Found ${attributes.length} attributes from IPFS metadata`);
                        break;
                      } else if (ipfsData.traits && Array.isArray(ipfsData.traits)) {
                        attributes = ipfsData.traits;
                        console.log(`[SHOW-NFT] Found ${attributes.length} traits from IPFS metadata`);
                        break;
                      }

                      if (ipfsData.image) {
                        nftImageUrl = convertIPFSToGateway(ipfsData.image);
                        console.log(`[SHOW-NFT] Updated image URL from IPFS metadata: ${nftImageUrl}`);
                      }
                    }
                  } catch (ipfsError) {
                    if (timeoutId) clearTimeout(timeoutId);
                    console.log(`[SHOW-NFT] Failed to fetch from ${gateway}:`, ipfsError.message);
                    continue;
                  }
                }
              }
            }

            if (attributes.length === 0 && parsed.attributes && Array.isArray(parsed.attributes)) {
              attributes = parsed.attributes;
              console.log(`[SHOW-NFT] Found ${attributes.length} attributes from decoded base64 metadata for ${identifier}`);
            } else if (attributes.length === 0 && parsed.traits && Array.isArray(parsed.traits)) {
              attributes = parsed.traits;
              console.log(`[SHOW-NFT] Found ${attributes.length} traits from decoded base64 metadata for ${identifier}`);
            }
          } catch (decodeError) {
            console.log(`[SHOW-NFT] Could not decode base64 metadata for ${identifier}:`, decodeError.message);
          }
        }
      }

      if (attributes.length === 0 && metadata.attributes && Array.isArray(metadata.attributes) && metadata.attributes.length > 0) {
        attributes = metadata.attributes;
        console.log(`[SHOW-NFT] Found ${attributes.length} attributes from stored metadata for ${identifier}`);
      }

      if (attributes.length === 0) {
        console.log(`[SHOW-NFT] No attributes found for ${identifier}. API response keys:`, Object.keys(nftDetails));
        if (nftDetails.metadata) {
          console.log(`[SHOW-NFT] Metadata type:`, typeof nftDetails.metadata, 'Is array:', Array.isArray(nftDetails.metadata));
          if (typeof nftDetails.metadata === 'object') {
            console.log(`[SHOW-NFT] Metadata keys:`, Object.keys(nftDetails.metadata));
          }
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

module.exports = { fetchMultiversXNftDisplayState, normalizeNftMediaUrlForDiscord };
