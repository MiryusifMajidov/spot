import { useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { updateGym, type ScheduleItem } from '../lib/gym';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';

type Editing = { index: number | null; time: string; name: string; trainer: string };

/** gyms.schedule — the classes members see on the gym's page in SPOT. Saved as a
 *  whole list, ordered by time, exactly as the app's «Cədvəl» does. */
export function Schedule(_: ScreenProps) {
  const { gym, reloadGym } = useAuth();
  const [items, setItems] = useState<ScheduleItem[]>(gym!.schedule);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (next: ScheduleItem[], msg: string) => {
    setSaving(true);
    const sorted = [...next].sort((a, b) => a.time.localeCompare(b.time));
    try {
      await updateGym(gym!.id, { schedule: sorted });
      setItems(sorted);
      setEditing(null);
      toast(msg);
      void reloadGym();
    } catch {
      toast('Cədvəl yadda saxlanmadı — yenidən cəhd et');
    }
    setSaving(false);
  };

  const submit = () => {
    if (!editing) return;
    const row = { time: editing.time.trim(), name: editing.name.trim(), trainer: editing.trainer.trim() };
    if (!row.name) return toast('Dərsin adını yaz');
    const next = editing.index == null ? [...items, row] : items.map((it, i) => (i === editing.index ? row : it));
    void save(next, editing.index == null ? 'Dərs əlavə olundu' : 'Dərs yeniləndi');
  };

  const remove = (i: number) => {
    if (!confirm(`«${items[i].name}» cədvəldən silinsin?`)) return;
    void save(items.filter((_, j) => j !== i), 'Dərs silindi');
  };

  return (
    <div className="page-grid" style={{ maxWidth: 900 }}>
      <div className="row">
        <p className="p-card" style={{ flex: 1 }}>Bu cədvəl SPOT-da zalın səhifəsində görünür. Dəyişiklik dərhal yadda saxlanır.</p>
        <button className="btn primary" onClick={() => setEditing({ index: null, time: '', name: '', trainer: '' })}>
          <Icon name="plus" size={14} /> Dərs əlavə et
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card empty">
          <div style={{ font: '600 15px/1.3 var(--font)', color: 'var(--ink)' }}>Cədvəl boşdur</div>
          <div style={{ marginTop: 6, font: '400 13px/1.5 var(--font)' }}>Qrup dərslərini (yoqa, kross-fit, boks…) əlavə et ki, üzvlər görsün.</div>
        </div>
      ) : (
        <table className="tbl">
          <thead><tr><th style={{ width: 120 }}>Vaxt</th><th>Dərs</th><th>Müəllim</th><th style={{ width: 120 }} /></tr></thead>
          <tbody>
            {items.map((c, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{c.time || '—'}</td>
                <td>{c.name}</td>
                <td className="muted2">{c.trainer || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn small" onClick={() => setEditing({ index: i, ...c })}>Düzəlt</button>{' '}
                  <button className="btn small danger" onClick={() => remove(i)} disabled={saving} aria-label="Sil"><Icon name="trash" size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing ? (
        <div className="scrim" onClick={() => !saving && setEditing(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div style={{ font: '700 18px/1.2 var(--font)' }}>{editing.index == null ? 'Yeni dərs' : 'Dərsi düzəlt'}</div>
            <div className="page-grid" style={{ marginTop: 18, gap: 14 }}>
              <div className="field">
                <label htmlFor="s-time">Vaxt</label>
                <input id="s-time" className="input" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} placeholder="Məs.: B.e., Ç. 19:00" autoFocus />
                <span className="hint">Gün və saat — necə yazsan, elə görünəcək.</span>
              </div>
              <div className="field">
                <label htmlFor="s-name">Dərs</label>
                <input id="s-name" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Məs.: Funksional məşq" maxLength={60} />
              </div>
              <div className="field">
                <label htmlFor="s-trainer">Müəllim</label>
                <input id="s-trainer" className="input" value={editing.trainer} onChange={(e) => setEditing({ ...editing, trainer: e.target.value })} placeholder="İstəyə bağlı" maxLength={60} />
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 22 }}>
              <button type="button" className="btn" onClick={() => setEditing(null)} disabled={saving}>Ləğv et</button>
              <button className="btn primary" disabled={saving || !editing.name.trim()}>{saving ? 'Saxlanılır…' : 'Saxla'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
