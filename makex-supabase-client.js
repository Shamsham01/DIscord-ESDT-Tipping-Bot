require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const makexSupabaseUrl = process.env.MAKEX_SUPABASE_URL;
const makexSupabaseKey = process.env.MAKEX_SUPABASE_SERVICE_ROLE_KEY;

let client = null;

if (makexSupabaseUrl && makexSupabaseKey) {
  client = createClient(makexSupabaseUrl, makexSupabaseKey, {
    db: {
      schema: 'public'
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
} else {
  console.warn('[MAKEX-SUPABASE] MAKEX_SUPABASE_URL or MAKEX_SUPABASE_SERVICE_ROLE_KEY not set. MakeX whitelist sync will be disabled.');
}

function isMakexSupabaseConfigured() {
  return client !== null;
}

function getMakexSupabase() {
  return client;
}

module.exports = {
  getMakexSupabase,
  isMakexSupabaseConfigured
};
