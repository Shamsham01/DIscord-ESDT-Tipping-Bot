require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('[FATAL] Missing Supabase environment variables!');
    console.error('[FATAL] SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
    console.error('[FATAL] SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'Missing');
    console.error('[FATAL] Please ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your .env file or environment variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    db: {
        schema: 'public'
    },
    auth: {
        persistSession: false
    }
});

module.exports = supabase;
