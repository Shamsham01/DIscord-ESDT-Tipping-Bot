require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;

if (supabaseUrl && supabaseServiceRoleKey) {
  client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: 'public' },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function isSupabaseServiceRoleConfigured() {
  return client !== null;
}

function getSupabaseServiceClient() {
  if (!client) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Community Fund QR uploads require the Supabase service role key on the bot host.'
    );
  }
  return client;
}

module.exports = {
  getSupabaseServiceClient,
  isSupabaseServiceRoleConfigured
};
