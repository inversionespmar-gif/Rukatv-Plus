const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Do not crash the whole app when Supabase is not configured.
// Return null so auth features degrade gracefully instead of throwing
// "supabaseUrl is required." at module load time.
const supabase = supabaseUrl && supabaseAnonKey ?
    createClient(supabaseUrl, supabaseAnonKey)
    :
    null;

module.exports = supabase;
