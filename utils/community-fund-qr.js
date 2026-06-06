const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const dbServerData = require('../db/server-data');

const BUCKET = 'community-fund-qr';

let serviceSupabase = null;

function getServiceSupabase() {
  if (serviceSupabase) {
    return serviceSupabase;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Community Fund QR storage');
  }

  serviceSupabase = createClient(url, key, {
    db: { schema: 'public' },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return serviceSupabase;
}

function getStoragePath(guildId) {
  return `${guildId}/community-fund.png`;
}

async function ensureBucketExists() {
  const supabase = getServiceSupabase();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(`Failed to list storage buckets: ${listError.message}`);
  }

  if ((buckets || []).some((bucket) => bucket.id === BUCKET || bucket.name === BUCKET)) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 1048576,
    allowedMimeTypes: ['image/png']
  });

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(`Failed to create QR storage bucket: ${createError.message}`);
  }
}

async function generateAndStoreCommunityFundQR(guildId, projectName, walletAddress) {
  await ensureBucketExists();
  const pngBuffer = await QRCode.toBuffer(walletAddress, {
    type: 'png',
    width: 300,
    margin: 2,
    errorCorrectionLevel: 'M'
  });

  const supabase = getServiceSupabase();
  const filePath = getStoragePath(guildId);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, pngBuffer, {
      contentType: 'image/png',
      upsert: true
    });

  if (uploadError) {
    throw new Error(`Failed to upload Community Fund QR code: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  const publicUrl = data.publicUrl;

  await dbServerData.setCommunityFundQR(guildId, projectName, publicUrl);
  console.log(`[QR] Generated and stored Community Fund QR for guild ${guildId}: ${publicUrl}`);

  return publicUrl;
}

async function deleteCommunityFundQRAssets(guildId, projectName) {
  try {
    await dbServerData.deleteCommunityFundQR(guildId, projectName);
  } catch (error) {
    console.error(`[QR] Failed to delete community_fund_qr row for guild ${guildId}:`, error.message);
  }

  try {
    const supabase = getServiceSupabase();
    const filePath = getStoragePath(guildId);
    const { error } = await supabase.storage.from(BUCKET).remove([filePath]);

    if (error) {
      console.error(`[QR] Failed to delete storage file for guild ${guildId}:`, error.message);
    }
  } catch (error) {
    console.error(`[QR] Failed to delete Community Fund QR storage for guild ${guildId}:`, error.message);
  }
}

module.exports = {
  BUCKET,
  generateAndStoreCommunityFundQR,
  deleteCommunityFundQRAssets
};
