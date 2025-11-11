require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables. Please ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your .env file.');
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
