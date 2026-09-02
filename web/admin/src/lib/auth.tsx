import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';
import type { Admin, AdminRole } from './types';

interface AuthState {
  session: Session | null;
  admin: Admin | null; // the admins-table row for this user (null = signed in but NOT an admin)
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>; // returns error msg or null
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  session: null,
  admin: null,
  loading: true,
  signIn: async () => 'not ready',
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
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await loadAdmin(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setAdmin(null);
  };

  return <Ctx.Provider value={{ session, admin, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** support < moderator < ops < owner */
const ORDER: AdminRole[] = ['support', 'moderator', 'ops', 'owner'];
export function atLeast(role: AdminRole | undefined, min: AdminRole): boolean {
  if (!role) return false;
  return ORDER.indexOf(role) >= ORDER.indexOf(min);
}
