const QRCode = require('qrcode');
const {
  getSupabaseServiceClient,
  isSupabaseServiceRoleConfigured
} = require('../supabase-service-client');

const BUCKET = 'community-fund-qr';

function getStoragePath(guildId) {
  return `${guildId}/community-fund.png`;
}

async function ensureBucketExists(supabase) {
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

async function uploadQrImage(supabase, filePath, pngBuffer) {
  const uploadOptions = {
    contentType: 'image/png',
    upsert: true,
    cacheControl: '3600'
  };

  let { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, pngBuffer, uploadOptions);

  if (uploadError && /already exists|duplicate/i.test(uploadError.message)) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([filePath]);
    if (removeError) {
      throw new Error(`Failed to replace existing QR image: ${removeError.message}`);
    }

    ({ error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, pngBuffer, { contentType: 'image/png', cacheControl: '3600' }));
  }

  if (uploadError) {
    throw new Error(`Failed to upload Community Fund QR code: ${uploadError.message}`);
  }
}

async function saveCommunityFundQrUrl(supabase, guildId, projectName, publicUrl) {
  const { error } = await supabase
    .from('community_fund_qr')
    .upsert(
      {
        guild_id: guildId,
        project_name: projectName,
        qr_url: publicUrl
      },
      { onConflict: 'guild_id,project_name' }
    );

  if (error) {
    throw new Error(`Failed to save Community Fund QR URL: ${error.message}`);
  }
}

async function generateAndStoreCommunityFundQR(guildId, projectName, walletAddress) {
  const supabase = getSupabaseServiceClient();

  await ensureBucketExists(supabase);

  const pngBuffer = await QRCode.toBuffer(walletAddress, {
    type: 'png',
    width: 300,
    margin: 2,
    errorCorrectionLevel: 'M'
  });

  const filePath = getStoragePath(guildId);
  await uploadQrImage(supabase, filePath, pngBuffer);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  const publicUrl = data.publicUrl;

  await saveCommunityFundQrUrl(supabase, guildId, projectName, publicUrl);
  console.log(`[QR] Generated and stored Community Fund QR for guild ${guildId}: ${publicUrl}`);

  return publicUrl;
}

async function deleteCommunityFundQRAssets(guildId, projectName) {
  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from('community_fund_qr')
      .delete()
      .eq('guild_id', guildId)
      .eq('project_name', projectName);

    if (error) {
      console.error(`[QR] Failed to delete community_fund_qr row for guild ${guildId}:`, error.message);
    }

    const filePath = getStoragePath(guildId);
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([filePath]);

    if (storageError) {
      console.error(`[QR] Failed to delete storage file for guild ${guildId}:`, storageError.message);
    }
  } catch (error) {
    console.error(`[QR] Failed to delete Community Fund QR assets for guild ${guildId}:`, error.message);
  }
}

module.exports = {
  BUCKET,
  isSupabaseServiceRoleConfigured,
  generateAndStoreCommunityFundQR,
  deleteCommunityFundQRAssets
};
