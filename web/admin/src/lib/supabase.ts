import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** The one Supabase client. Admins get elevated reads/writes via their own
 *  authenticated session + admin-role RLS — never a service key in the browser. */
export const supabase = createClient(url, key, {
  /* PKCE + detectSessionInUrl: «Google ilə daxil ol» comes back to this page with
     `?code=…`, and the client trades it for a session (and removes it from the
     address bar) on load. With detection off the code was simply ignored. */
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
