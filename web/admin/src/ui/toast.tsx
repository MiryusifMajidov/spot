import { useEffect, useState } from 'react';

let push: ((msg: string) => void) | null = null;

/** Fire a toast from anywhere (including outside React). */
export function toast(msg: string) {
  push?.(msg);
}

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(() => {
    let n = 0;
    push = (msg: string) => {
      const id = ++n;
      setItems((s) => [...s, { id, msg }]);
      setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 2600);
    };
    return () => { push = null; };
  }, []);
  if (!items.length) return null;
  return (
    <div className="toast-wrap">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {items.map((i) => <div key={i.id} className="toast">{i.msg}</div>)}
      </div>
    </div>
  );
}
