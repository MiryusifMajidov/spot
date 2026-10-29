import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker } from 'maplibre-gl';

import { useAuth } from '../lib/auth';
import { updateGym, type Gym } from '../lib/gym';
import { Icon } from './icons';
import { toast } from './toast';

/** Baku centre — where the map opens for a gym that has no pin yet. */
const BAKU: [number, number] = [49.8671, 40.4093];
/** The app's basemap (src/components/spotMapHtml.ts): OpenFreeMap «positron». */
const STYLE = 'https://tiles.openfreemap.org/styles/positron';

/**
 * The gym's pin on the members' map. Click the map or drag the pin, then save.
 * MapLibre is loaded only when this card mounts — it is the heaviest thing in
 * the panel and no other screen needs it.
 */
export function LocationPicker({ gym }: { gym: Gym }) {
  const { reloadGym } = useAuth();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(gym.lat != null && gym.lng != null ? { lat: gym.lat, lng: gym.lng } : null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (!alive || !box.current) return;
        const start: [number, number] = gym.lat != null && gym.lng != null ? [gym.lng, gym.lat] : BAKU;
        const m = new ml.Map({ container: box.current, style: STYLE, center: start, zoom: gym.lat != null ? 15 : 11, attributionControl: { compact: true } });
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        const el = document.createElement('div');
        el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#C5FE01;box-shadow:0 0 0 4px #1A1A1A, 0 0 0 7px rgba(197,254,1,.35);cursor:grab';
        const mk = new ml.Marker({ element: el, draggable: true });
        if (gym.lat != null && gym.lng != null) mk.setLngLat([gym.lng, gym.lat]).addTo(m);
        mk.on('dragend', () => {
          const p = mk.getLngLat();
          setPicked({ lat: p.lat, lng: p.lng });
        });
        m.on('click', (e) => {
          mk.setLngLat(e.lngLat).addTo(m);
          setPicked({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
        map.current = m;
        pin.current = mk;
      } catch (e) {
        console.warn('[gym-panel] map', e);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
    // The map is built once per gym; later pin moves are local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gym.id]);

  const changed = picked && (picked.lat !== gym.lat || picked.lng !== gym.lng);

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      await updateGym(gym.id, { lat: Number(picked.lat.toFixed(6)), lng: Number(picked.lng.toFixed(6)) });
      await reloadGym();
      toast('Zalın yeri yadda saxlandı');
    } catch {
      toast('Yer yadda saxlanmadı — yenidən cəhd et');
    }
    setSaving(false);
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2 className="h-card">Zalın yeri</h2>
          <p className="p-card">Üzvlər zalı xəritədə məhz bu nöqtədə görür. Xəritəyə klik et və ya işarəni sürüşdür.</p>
        </div>
        <button className="btn primary" disabled={!changed || saving} onClick={() => void save()}>{saving ? 'Saxlanılır…' : 'Yeri saxla'}</button>
      </div>
      <div style={{ position: 'relative', marginTop: 16, height: 300, borderRadius: 14, overflow: 'hidden', background: 'var(--fill)' }}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        {failed ? (
          <div className="muted" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', font: '400 13.5px/1.4 var(--font)' }}>Xəritə yüklənmədi — bağlantını yoxla.</div>
        ) : null}
      </div>
      <div className="row muted" style={{ marginTop: 10, font: '400 12.5px/1.4 var(--font)' }}>
        <Icon name="pin" size={14} />
        {picked ? `${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}` : 'Zalın yeri hələ qeyd olunmayıb — xəritədə zalın üstünə klik et.'}
      </div>
    </div>
  );
}
