import { useRef, useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { addPhoto, getMyClaim, PHOTO_MAX_BYTES, removePhoto, setCover, submitClaim, updateGym, type Gym } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { LocationPicker } from '../ui/LocationPicker';
import { toast } from '../ui/toast';

/** The app's amenity set (src/app/gym/edit.tsx) — the same words members filter by. */
const AMENITIES = ['Sərbəst ağırlıq', 'Kardio', 'Duş', 'Parkinq', 'Hovuz', 'Sauna', 'Qadın zonası', 'Kafe'];

function photoError(e: unknown): string {
  if (e instanceof Error && e.message === 'too-large') return `Şəkil ${Math.round(PHOTO_MAX_BYTES / 1048576)} MB-dan böyükdür — kiçildib yenidən yüklə.`;
  if (e instanceof Error && e.message === 'not-saved') return 'Şəkil zalın məlumatına yazılmadı — bu zalı dəyişməyə icazən yoxdur.';
  return 'Şəkil yüklənmədi — yenidən cəhd et.';
}

function Details({ gym }: { gym: Gym }) {
  const { reloadGym } = useAuth();
  const [f, setF] = useState({
    name: gym.name, district: gym.district, hours: gym.hours, about: gym.about,
    price_month: String(gym.priceMonth || ''), day_pass: String(gym.dayPass || ''),
    amenities: gym.amenities, allow_day_pass: gym.allowDayPass, show_members: gym.showMembers,
  });
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggle = (a: string) => set('amenities', f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a]);

  const save = async () => {
    if (!f.name.trim()) return toast('Zalın adı boş ola bilməz');
    const pm = Number(f.price_month.replace(',', '.')) || 0;
    const dp = Number(f.day_pass.replace(',', '.')) || 0;
    if (pm < 0 || dp < 0) return toast('Qiymət mənfi ola bilməz');
    setSaving(true);
    try {
      await updateGym(gym.id, {
        name: f.name.trim(), district: f.district.trim(), hours: f.hours.trim(), about: f.about.trim(),
        price_month: pm, day_pass: dp, amenities: f.amenities, allow_day_pass: f.allow_day_pass, show_members: f.show_members,
      });
      await reloadGym();
      toast('Zal profili yeniləndi');
    } catch {
      toast('Yadda saxlanmadı — yenidən cəhd et');
    }
    setSaving(false);
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 className="h-card">Zal haqqında</h2>
      <p className="p-card">Bu məlumat SPOT-da zalın səhifəsində və Kəşfdə görünür.</p>
      <div className="form-grid" style={{ marginTop: 18 }}>
        <div className="field wide">
          <label htmlFor="g-name">Zalın adı</label>
          <input id="g-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="g-district">Rayon / ünvan</label>
          <input id="g-district" className="input" value={f.district} onChange={(e) => set('district', e.target.value)} placeholder="Məs.: Nəsimi, 28 May" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="g-hours">İş saatları</label>
          <input id="g-hours" className="input" value={f.hours} onChange={(e) => set('hours', e.target.value)} placeholder="Məs.: 07:00–23:00 və ya 24 saat" maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="g-pm">Aylıq abunə, ₼</label>
          <input id="g-pm" className="input" inputMode="decimal" value={f.price_month} onChange={(e) => set('price_month', e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />
        </div>
        <div className="field">
          <label htmlFor="g-dp">Day-pass, ₼</label>
          <input id="g-dp" className="input" inputMode="decimal" value={f.day_pass} onChange={(e) => set('day_pass', e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />
        </div>
        <div className="field wide">
          <label htmlFor="g-about">Haqqında</label>
          <textarea id="g-about" className="textarea" value={f.about} onChange={(e) => set('about', e.target.value)} maxLength={800} placeholder="Zalın üstünlükləri, avadanlıq, məşqçilər…" />
        </div>
        <div className="field wide">
          <label>Avadanlıq və imkanlar</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {[...new Set([...AMENITIES, ...f.amenities])].map((a) => (
              <button type="button" key={a} className={'chip' + (f.amenities.includes(a) ? ' active' : '')} onClick={() => toggle(a)}>{a}</button>
            ))}
            <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const v = custom.trim(); if (v && !f.amenities.includes(v)) set('amenities', [...f.amenities, v]); setCustom(''); }}>
              <input className="input" style={{ width: 150, padding: '7px 10px', fontSize: 12.5 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Başqa…" maxLength={30} />
              <button className="btn small" disabled={!custom.trim()}><Icon name="plus" size={12} /></button>
            </form>
          </div>
        </div>
        <label className="check wide">
          <input type="checkbox" checked={f.allow_day_pass} onChange={(e) => set('allow_day_pass', e.target.checked)} />
          <span>Day-pass satışı açıqdır<small>Qonaqlar SPOT-da bir günlük giriş kodu ala bilir.</small></span>
        </label>
        <label className="check wide">
          <input type="checkbox" checked={f.show_members} onChange={(e) => set('show_members', e.target.checked)} />
          <span>Üzvlər siyahısı zalın səhifəsində görünsün<small>Gizli profil seçən üzvlər onsuz da göstərilmir.</small></span>
        </label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn primary lg" onClick={() => void save()} disabled={saving}>{saving ? 'Saxlanılır…' : 'Yadda saxla'}</button>
      </div>
    </div>
  );
}

function Photos({ gym }: { gym: Gym }) {
  const { reloadGym } = useAuth();
  const [cover, setCoverUrl] = useState(gym.imageUrl);
  const [photos, setPhotos] = useState(gym.photos);
  const [busy, setBusy] = useState<'cover' | 'photo' | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const onCover = async (file?: File) => {
    if (!file) return;
    setBusy('cover');
    try {
      setCoverUrl(await setCover({ ...gym, imageUrl: cover, photos }, file));
      void reloadGym();
      toast('Əsas şəkil yeniləndi');
    } catch (e) {
      toast(photoError(e));
    }
    setBusy(null);
  };
  const onPhoto = async (file?: File) => {
    if (!file) return;
    setBusy('photo');
    try {
      setPhotos(await addPhoto(gym.id, file));
      void reloadGym();
      toast('Şəkil əlavə olundu');
    } catch (e) {
      toast(photoError(e));
    }
    setBusy(null);
  };
  const onRemove = async (url: string) => {
    if (!confirm('Bu şəkil silinsin? O, SPOT-da da görünməyəcək.')) return;
    try {
      setPhotos(await removePhoto(gym.id, url));
      void reloadGym();
    } catch {
      toast('Şəkil silinmədi — yenidən cəhd et');
    }
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 className="h-card">Şəkillər</h2>
      <p className="p-card">Əsas şəkil Kəşfdəki kartda və zalın səhifəsinin başında görünür. JPG və ya PNG, ən çox 10 MB.</p>
      <div className="cover" style={{ marginTop: 16 }}>
        {cover ? <img src={cover} alt="Zalın əsas şəkli" /> : <Icon name="image" size={34} />}
        <button className="btn" style={{ position: 'absolute', right: 12, bottom: 12 }} disabled={busy === 'cover'} onClick={() => coverInput.current?.click()}>
          <Icon name="image" size={14} /> {busy === 'cover' ? 'Yüklənir…' : cover ? 'Əsas şəkli dəyiş' : 'Əsas şəkil yüklə'}
        </button>
      </div>
      <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void onCover(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="photo-grid" style={{ marginTop: 14 }}>
        {photos.map((u) => (
          <div className="photo" key={u}>
            <img src={u} alt="" loading="lazy" />
            <button className="x" onClick={() => void onRemove(u)} aria-label="Şəkli sil"><Icon name="x" size={12} /></button>
          </div>
        ))}
        <button className="photo add" disabled={busy === 'photo'} onClick={() => photoInput.current?.click()}>
          <span><Icon name="plus" size={20} /><br />{busy === 'photo' ? 'Yüklənir…' : 'Şəkil əlavə et'}</span>
        </button>
      </div>
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

function Ownership({ gym }: { gym: Gym }) {
  const claim = useLoad(() => getMyClaim(gym.id), [gym.id]);
  const [voen, setVoen] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const v = voen.trim();
    if (!v) return toast('VÖEN və ya qeydiyyat nömrəsini yaz');
    setBusy(true);
    try {
      await submitClaim(gym.id, v);
      await claim.reload();
      toast('Müraciət göndərildi — admin komandası yoxlayacaq');
    } catch {
      toast('Müraciət göndərilmədi — yenidən cəhd et');
    }
    setBusy(false);
  };

  const c = claim.data;
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="row">
        <h2 className="h-card" style={{ margin: 0, flex: 1 }}>Sahiblik təsdiqi</h2>
        {gym.claimStatus === 'claimed' ? <span className="pill live"><span className="d" />Təsdiqlənib</span>
          : c?.status === 'pending' || gym.claimStatus === 'pending' ? <span className="pill warn"><span className="d" />Yoxlanılır</span>
          : <span className="pill">Təsdiqlənməyib</span>}
      </div>
      {gym.claimStatus === 'claimed' ? (
        <p className="p-card" style={{ marginTop: 8 }}>Zalın sahibi kimi təsdiqlənmisən.</p>
      ) : claim.error ? (
        <p className="p-card" style={{ marginTop: 8 }}>Müraciətin vəziyyəti yüklənmədi. <button className="link" onClick={() => void claim.reload()}>Yenidən cəhd et</button></p>
      ) : c?.status === 'pending' && c.voen ? (
        <p className="p-card" style={{ marginTop: 8 }}>Müraciətin admin komandasındadır — 2 iş günü ərzində yoxlanılır · VÖEN: {c.voen}</p>
      ) : (
        <>
          <p className="p-card" style={{ marginTop: 8 }}>
            {c?.status === 'rejected' ? `Əvvəlki müraciət rədd edilib${c.reject_reason ? `: ${c.reject_reason}` : ''}. Düzgün VÖEN ilə yenidən göndər.` : 'Sahibliyi rəsmi təsdiqləmək üçün admin komandası VÖEN-i yoxlayır. Təsdiqdən sonra zal Kəşfdə görünür.'}
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <input className="input" style={{ maxWidth: 260 }} value={voen} onChange={(e) => setVoen(e.target.value)} placeholder="VÖEN və ya qeydiyyat nömrəsi" maxLength={40} />
            <button className="btn primary" disabled={busy || !voen.trim()} onClick={() => void send()}>{busy ? 'Göndərilir…' : 'Göndər'}</button>
          </div>
        </>
      )}
    </div>
  );
}

export function Profile(_: ScreenProps) {
  const { gym } = useAuth();
  return (
    <div className="cols-2" key={gym!.id}>
      <div className="page-grid">
        <Details gym={gym!} />
        <LocationPicker gym={gym!} />
      </div>
      <div className="page-grid">
        <Photos gym={gym!} />
        <Ownership gym={gym!} />
      </div>
    </div>
  );
}
