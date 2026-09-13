const fetch = require('node-fetch');

const USER_AGENT = 'ESDT-Tipping-Bot/1.0 (NFT metadata resolver)';
const DELEGATED_ROUTING_URL = 'https://delegated-ipfs.dev/routing/v1/providers';
const MAX_CAR_BYTES = 2 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 12000;
const CAR_TIMEOUT_MS = 15000;

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/i;

let ipfsLibsPromise = null;

function looksLikeCid(value) {
  return typeof value === 'string' && CID_RE.test(value);
}

function decodeBase64Utf8(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    if (!decoded || decoded.includes('\0')) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Parse ipfs://, gateway URLs, subdomain gateways, or bare cid/path into { cid, path }.
 */
function parseIpfsPath(input) {
  if (!input || typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;

  if (value.startsWith('ipfs://')) {
    value = value.slice('ipfs://'.length);
  }

  const subdomain = value.match(/^https?:\/\/(b[a-z2-7]{50,}|Qm[1-9A-HJ-NP-Za-km-z]{44})\.ipfs\.[^/]+\/?(.*)$/i);
  if (subdomain) {
    return { cid: subdomain[1], path: (subdomain[2] || '').replace(/^\//, '') };
  }

  const gateway = value.match(/\/(?:ipfs|nfts\/asset)\/(b[a-z2-7]{50,}|Qm[1-9A-HJ-NP-Za-km-z]{44})(?:\/(.*))?$/i);
  if (gateway) {
    return { cid: gateway[1], path: (gateway[2] || '').replace(/^\//, '') };
  }

  const parts = value.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length > 0 && looksLikeCid(parts[0])) {
    return { cid: parts[0], path: parts.slice(1).join('/') };
  }

  return null;
}

function buildNftIdentifier(collection, nonce, identifierOverride = null) {
  if (identifierOverride) return identifierOverride;
  const n = Number(nonce);
  if (!Number.isFinite(n) || n < 0) {
    return `${collection}-${nonce}`;
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return `${collection}-${hex}`;
}

function extractAttributesFromMetadata(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json.attributes) && json.attributes.length > 0) {
    return json.attributes;
  }
  if (Array.isArray(json.traits) && json.traits.length > 0) {
    return json.traits;
  }
  return [];
}

function isHtmlContentType(contentType) {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
}

function isUsableJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isImageUri(uri) {
  if (typeof uri !== 'string') return false;
  const lower = uri.toLowerCase();
  return lower.includes('.png') || lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.gif') || lower.includes('.webp');
}

function rewriteRelativeIpfsAsset(assetUrl, sourceResource) {
  if (!assetUrl || typeof assetUrl !== 'string') return null;
  const parsedAsset = parseIpfsPath(assetUrl);
  if (parsedAsset?.cid) {
    return `ipfs://${parsedAsset.cid}${parsedAsset.path ? `/${parsedAsset.path}` : ''}`;
  }
  const fileName = assetUrl.split('/').filter(Boolean).pop();
  const parsedSource = parseIpfsPath(sourceResource);
  if (parsedSource?.cid && fileName && /\.(png|jpe?g|gif|webp)$/i.test(fileName)) {
    return `ipfs://${parsedSource.cid}/${fileName}`;
  }
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return assetUrl;
  }
  return null;
}

function pickNftImageUrl(nftData, storedImageUrl = null) {
  let ipfsImageUrl = null;
  if (Array.isArray(nftData?.uris)) {
    for (const uri of nftData.uris) {
      const decoded = decodeBase64Utf8(uri) || uri;
      if (isImageUri(decoded)) {
        ipfsImageUrl = decoded;
        break;
      }
    }
  }

  if (nftData?.url && !String(nftData.url).includes('default.png')) {
    return nftData.url;
  }
  if (ipfsImageUrl) return ipfsImageUrl;
  if (Array.isArray(nftData?.media) && nftData.media.length > 0) {
    const mediaUrl = nftData.media[0].url || nftData.media[0].thumbnailUrl;
    if (mediaUrl && !String(mediaUrl).includes('default.png')) {
      return mediaUrl;
    }
  }
  if (typeof nftData?.metadata === 'object' && nftData.metadata?.image) {
    return nftData.metadata.image;
  }
  return storedImageUrl || null;
}

async function loadIpfsLibs() {
  if (!ipfsLibsPromise) {
    ipfsLibsPromise = Promise.all([
      import('@ipld/car'),
      import('blockstore-core/memory'),
      import('ipfs-unixfs-exporter')
    ]).then(([car, memory, exporterMod]) => ({
      CarReader: car.CarReader,
      MemoryBlockstore: memory.MemoryBlockstore,
      exporter: exporterMod.exporter
    }));
  }
  return ipfsLibsPromise;
}

async function decodeJsonFromCar(carBytes, parsed) {
  const { CarReader, MemoryBlockstore, exporter } = await loadIpfsLibs();
  const reader = await CarReader.fromBytes(carBytes);
  const store = new MemoryBlockstore();
  for await (const block of reader.blocks()) {
    await store.put(block.cid, block.bytes);
  }

  const roots = await reader.getRoots();
  const candidates = [];
  if (parsed?.cid && parsed?.path) candidates.push(`${parsed.cid}/${parsed.path}`);
  if (parsed?.path) candidates.push(parsed.path);
  if (roots[0] && parsed?.path) candidates.push(`${roots[0]}/${parsed.path}`);
  if (roots[0]) candidates.push(roots[0]);

  for (const candidate of candidates) {
    try {
      const entry = await exporter(candidate, store);
      if (entry.type === 'file' || entry.type === 'raw' || entry.type === 'identity') {
        const chunks = [];
        for await (const chunk of entry.content()) {
          chunks.push(chunk);
        }
        const buf = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
        return JSON.parse(buf.toString('utf8'));
      }
      if (entry.type === 'object' && entry.object) {
        return entry.object;
      }
    } catch {
      // Try the next CAR path candidate
    }
  }
  return null;
}

function httpGatewayBaseFromMultiaddr(addr) {
  if (typeof addr !== 'string') return null;
  const dns = addr.match(/^\/dns[46]?\/([^/]+)\/tcp\/(\d+)\/https$/);
  if (dns) {
    const [, host, port] = dns;
    return port === '443' ? `https://${host}` : `https://${host}:${port}`;
  }
  const ip = addr.match(/^\/ip4\/([^/]+)\/tcp\/(\d+)\/https$/);
  if (ip) {
    const [, host, port] = ip;
    return port === '443' ? `https://${host}` : `https://${host}:${port}`;
  }
  return null;
}

async function fetchBuffer(url, { headers, timeout } = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      ...(headers || {})
    },
    timeout: timeout || HTTP_TIMEOUT_MS
  });
  return response;
}

async function fetchHttpJson(url) {
  try {
    const response = await fetchBuffer(url, {
      headers: { Accept: 'application/json, application/ld+json, text/plain;q=0.8, */*;q=0.5' },
      timeout: HTTP_TIMEOUT_MS
    });
    if (!response.ok) return null;
    if (isHtmlContentType(response.headers.get('content-type'))) return null;
    const json = await response.json();
    return isUsableJsonObject(json) ? json : null;
  } catch (error) {
    console.log(`[NFT-IPFS] HTTP JSON fetch failed for ${url}: ${error.message}`);
    return null;
  }
}

async function fetchCarJson(url, parsed) {
  try {
    const response = await fetchBuffer(url, {
      headers: { Accept: 'application/vnd.ipld.car' },
      timeout: CAR_TIMEOUT_MS
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (isHtmlContentType(contentType)) return null;

    const buf = await response.buffer();
    if (!buf || buf.length === 0 || buf.length > MAX_CAR_BYTES) {
      if (buf && buf.length > MAX_CAR_BYTES) {
        console.warn(`[NFT-IPFS] Skipping oversized CAR from ${url} (${buf.length} bytes)`);
      }
      return null;
    }

    if (contentType.includes('application/json') || buf[0] === 0x7b) {
      try {
        const json = JSON.parse(buf.toString('utf8'));
        if (isUsableJsonObject(json)) return json;
      } catch {
        // Fall through to CAR decode
      }
    }

    if (!contentType.includes('application/vnd.ipld.car') && buf[0] !== 0x3a) {
      return null;
    }
    return await decodeJsonFromCar(buf, parsed);
  } catch (error) {
    console.log(`[NFT-IPFS] CAR fetch failed for ${url}: ${error.message}`);
    return null;
  }
}

async function listHttpGatewayProviders(cid) {
  try {
    const response = await fetchBuffer(`${DELEGATED_ROUTING_URL}/${cid}`, {
      headers: { Accept: 'application/json' },
      timeout: HTTP_TIMEOUT_MS
    });
    if (!response.ok) return [];
    const data = await response.json();
    const providers = Array.isArray(data?.Providers) ? data.Providers : [];
    const bases = [];
    for (const provider of providers) {
      const protocols = provider.Protocols || [];
      if (!protocols.includes('transport-ipfs-gateway-http')) continue;
      for (const addr of provider.Addrs || []) {
        const base = httpGatewayBaseFromMultiaddr(addr);
        if (base && !bases.includes(base)) bases.push(base);
      }
    }
    return bases;
  } catch (error) {
    console.log(`[NFT-IPFS] Delegated routing failed for ${cid}: ${error.message}`);
    return [];
  }
}

function deserializedGatewayUrls(parsed) {
  const rest = parsed.path ? `/${parsed.path}` : '';
  return [
    `https://media.multiversx.com/nfts/asset/${parsed.cid}${rest}`,
    `https://gateway.pinata.cloud/ipfs/${parsed.cid}${rest}`,
    `https://ipfs.io/ipfs/${parsed.cid}${rest}`
  ];
}

async function firstNonNull(factories) {
  for (const factory of factories) {
    try {
      const value = await factory();
      if (value) return value;
    } catch (error) {
      console.log(`[NFT-IPFS] Candidate failed: ${error.message}`);
    }
  }
  return null;
}

/**
 * Fetch NFT metadata JSON from IPFS, including trustless HTTP providers.
 */
async function fetchIpfsJson(resource) {
  if (!resource) return null;
  const parsed = parseIpfsPath(resource);

  if (parsed?.cid) {
    const json = await firstNonNull([
      async () => {
        const providers = await listHttpGatewayProviders(parsed.cid);
        for (const base of providers) {
          const carUrl = `${base}/ipfs/${parsed.cid}${parsed.path ? `/${parsed.path}` : ''}`;
          console.log(`[NFT-IPFS] Fetching CAR from provider ${carUrl}`);
          const fromCar = await fetchCarJson(carUrl, parsed);
          if (fromCar) return fromCar;
        }
        return null;
      },
      async () => {
        for (const url of deserializedGatewayUrls(parsed)) {
          const fromHttp = await fetchHttpJson(url);
          if (fromHttp) return fromHttp;
        }
        return null;
      }
    ]);
    if (json) return json;
  }

  if (typeof resource === 'string' && resource.startsWith('http')) {
    return fetchHttpJson(resource);
  }
  return null;
}

function collectJsonResources(nftData) {
  const resources = [];
  const push = (value) => {
    if (value && typeof value === 'string' && !resources.includes(value)) {
      resources.push(value);
    }
  };

  if (Array.isArray(nftData?.uris)) {
    for (const uri of nftData.uris) {
      const decoded = decodeBase64Utf8(uri) || uri;
      if (typeof decoded === 'string' && decoded.toLowerCase().includes('.json')) {
        push(decoded);
      }
    }
  }

  if (typeof nftData?.attributes === 'string') {
    const decoded = decodeBase64Utf8(nftData.attributes) || nftData.attributes;
    const match = decoded.match(/metadata:([^\s;]+)/);
    if (match && match[1]) {
      push(match[1]);
      const hashDecoded = decodeBase64Utf8(nftData.hash);
      const metadataPath = match[1];
      if (hashDecoded && looksLikeCid(hashDecoded) && !metadataPath.includes('/')) {
        push(`${hashDecoded}/${metadataPath}`);
      }
    }
  }

  if (nftData?.metadata && typeof nftData.metadata === 'object') {
    push(nftData.metadata.uri || nftData.metadata.metadataUri || nftData.metadata.metadata_url);
  }

  return resources;
}

function inlineAttributes(nftData) {
  if (Array.isArray(nftData?.attributes) && nftData.attributes.length > 0) {
    return nftData.attributes;
  }
  if (Array.isArray(nftData?.metadata?.attributes) && nftData.metadata.attributes.length > 0) {
    return nftData.metadata.attributes;
  }
  return [];
}

/**
 * Resolve attributes (and optional image/name) from a MultiversX NFT API payload.
 * Falls back to the on-chain IPFS JSON URI when the indexer metadata timed out.
 */
async function resolveNftJsonMetadata(nftData) {
  const inline = inlineAttributes(nftData);
  if (inline.length > 0) {
    return {
      attributes: inline,
      image: nftData.metadata?.image || null,
      name: nftData.metadata?.name || nftData.name || null,
      json: nftData.metadata && !nftData.metadata.error ? nftData.metadata : null
    };
  }

  const resources = collectJsonResources(nftData);
  for (const resource of resources) {
    console.log(`[NFT-IPFS] Resolving metadata from ${resource}`);
    const json = await fetchIpfsJson(resource);
    const attributes = extractAttributesFromMetadata(json);
    if (attributes.length > 0) {
      return {
        attributes,
        image: rewriteRelativeIpfsAsset(json.image, resource) || json.image || null,
        name: json.name || nftData.name || null,
        json
      };
    }
  }

  return { attributes: [], image: null, name: nftData?.name || null, json: null };
}

function toMultiversxMediaUrl(resource) {
  const parsed = parseIpfsPath(resource);
  if (!parsed?.cid) return null;
  const rest = parsed.path ? `/${parsed.path}` : '';
  return `https://media.multiversx.com/nfts/asset/${parsed.cid}${rest}`;
}

module.exports = {
  parseIpfsPath,
  buildNftIdentifier,
  extractAttributesFromMetadata,
  fetchIpfsJson,
  resolveNftJsonMetadata,
  toMultiversxMediaUrl,
  pickNftImageUrl,
  rewriteRelativeIpfsAsset,
  isImageUri
};
