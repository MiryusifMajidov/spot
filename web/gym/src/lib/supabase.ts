import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** The one Supabase client. The public key only: a gym owner reaches their own
 *  gym through their authenticated session and the same RLS the app relies on. */
export const supabase = createClient(url, key, {
  /* PKCE + detectSessionInUrl: «Google ilə daxil ol» returns to this page with
     `?code=…`, and the client trades it for a session on load. */
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
