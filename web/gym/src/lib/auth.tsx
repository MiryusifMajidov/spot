import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { fetchMyGyms, fetchOwner, type Gym, type Owner } from './gym';
import { supabase } from './supabase';

type Phase = 'loading' | 'signed-out' | 'no-profile' | 'no-gym' | 'failed' | 'ready';

interface AuthState {
  phase: Phase;
  session: Session | null;
  owner: Owner | null;
  gyms: Gym[];
  gym: Gym | null;
  selectGym: (id: string) => void;
  /** Read the gym row again after an edit, so every screen shows what was saved. */
  reloadGym: () => Promise<void>;
  retry: () => void;
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
const PICK_KEY = 'spot-gym-selected';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PICK_KEY);
    } catch {
      return null;
    }
  });

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setOwner(null);
      setGyms([]);
      setPhase('signed-out');
      return;
    }
    try {
      const o = await fetchOwner();
      setOwner(o);
      if (!o) return setPhase('no-profile');
      const list = await fetchMyGyms(o.profileId);
      setGyms(list);
      setPhase(list.length ? 'ready' : 'no-gym');
    } catch (e) {
      console.warn('[gym-panel] load', e);
      // A failed read is not «you own no gym» — say the read failed.
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => load(data.session));
    /* Deferred: auth-js holds its lock while this callback runs, and the reads in
       `load` need the same lock for their token — awaiting here would deadlock a
       sign-in that lands from Google's redirect. */
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return setSession(s);
      setTimeout(() => void load(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0] ?? null;

  const selectGym = (id: string) => {
    setGymId(id);
    try {
      localStorage.setItem(PICK_KEY, id);
    } catch {
      /* a remembered choice is a convenience */
    }
  };

  const reloadGym = useCallback(async () => {
    if (!owner) return;
    const list = await fetchMyGyms(owner.profileId);
    setGyms(list);
  }, [owner]);

  /* E-mail code, never a password: gym accounts are SPOT accounts, created in the
     app. `shouldCreateUser: false` — this page signs owners in, it does not open
     new accounts for whoever types an address. */
  const sendCode = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    return error ? error.message : null;
  };
  const verifyCode = async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    return error ? error.message : null;
  };
  /* Supabase must list this site under Authentication → URL Configuration →
     Redirect URLs, or Google sends the owner back to the app's own site URL. */
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    return error ? error.message : null;
  };
  // 'local': the default 'global' would also sign the owner out on their phone.
  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
  };

  return (
    <Ctx.Provider
      value={{
        phase, session, owner, gyms, gym, selectGym, reloadGym,
        retry: () => void supabase.auth.getSession().then(({ data }) => load(data.session)),
        sendCode, verifyCode, signInWithGoogle, signOut,
      }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
