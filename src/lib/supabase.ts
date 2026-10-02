import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!url || !anonKey) {
  // Surfaced in Metro logs — reminder to fill .env with the project keys.
  console.warn('[supabase] EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are not set. Add them to .env.');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const hasSupabaseConfig = Boolean(url && anonKey);

/** `cacheControl` for every Storage upload: one year. Each upload gets a unique
 *  name and nothing is ever overwritten in place, so the CDN and the phones may
 *  keep a file for as long as they like. Supabase's default is one hour, which
 *  sent a repeat view back to the origin (and onto the egress bill) every hour. */
export const IMMUTABLE_CACHE = '31536000';
