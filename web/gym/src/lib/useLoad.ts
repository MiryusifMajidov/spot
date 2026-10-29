import { useCallback, useEffect, useRef, useState } from 'react';

/** One async read with its three honest states. `error` is kept apart from an
 *  empty result: «no members» may only be said about a read that succeeded. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const v = await fn();
      if (mine !== seq.current) return;
      setData(v);
      setError(false);
    } catch (e) {
      if (mine !== seq.current) return;
      console.warn('[gym-panel]', e);
      setError(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, error, loading, reload: run, setData };
}
