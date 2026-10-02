import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';
import type { Admin, AdminRole } from './types';

interface AuthState {
  session: Session | null;
  admin: Admin | null; // the admins-table row for this user (null = signed in but NOT an admin)
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>; // returns error msg or null
  /** Redirects to Google; resolves only with an error message if it could not start. */
  signInWithGoogle: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  session: null,
  admin: null,
  loading: true,
  signIn: async () => 'not ready',
  signInWithGoogle: async () => 'not ready',
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAdmin(s: Session | null) {
    if (!s) {
      setAdmin(null);
      return;
    }
    // RLS: an admin can read their own admins row (is_admin()).
    const { data } = await supabase.from('admins').select('*').eq('user_id', s.user.id).maybeSingle();
    setAdmin((data as Admin) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadAdmin(data.session);
      setLoading(false);
    });
    /* Not awaited inside the callback: auth-js holds its lock while it runs, and
       loadAdmin's query needs the same lock for its token — a sign-in that lands
       here from Google's redirect (inside the code exchange) would wait forever. */
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setTimeout(() => void loadAdmin(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };
  /* The owner signs in to the app with Google and has no password of their own.
     The same Google account is the admin here: no second credential to keep, and
     Google's own 2-step verification protects the panel. Supabase must list this
     site under Authentication → URL Configuration → Redirect URLs. */
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return error ? error.message : null;
  };
  const signOut = async () => {
    // 'local': the default 'global' also signed the admin out of SPOT on their phone.
    await supabase.auth.signOut({ scope: 'local' });
    setAdmin(null);
  };

  return <Ctx.Provider value={{ session, admin, loading, signIn, signInWithGoogle, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** support < moderator < ops < owner */
const ORDER: AdminRole[] = ['support', 'moderator', 'ops', 'owner'];
export function atLeast(role: AdminRole | undefined, min: AdminRole): boolean {
  if (!role) return false;
  return ORDER.indexOf(role) >= ORDER.indexOf(min);
}
