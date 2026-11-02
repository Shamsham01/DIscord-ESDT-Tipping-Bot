'use strict';

// The Discord bot is a trusted server-side application. It is the sole reader
// and writer for the Supabase public schema, which is intentionally locked
// down to service_role. Reuse the same privileged client as the ESDT payment
// reservation modules; never fall back to SUPABASE_ANON_KEY here.
const { getSupabaseServiceClient } = require('./supabase-service-client');

module.exports = getSupabaseServiceClient();
