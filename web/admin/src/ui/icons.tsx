// Icon sprite — the exact a-* symbols from SPOT Admin Panel.dc.html.
export type IconName =
  | 'grid' | 'users' | 'verified' | 'pin' | 'shield' | 'dumbbell' | 'play' | 'card'
  | 'trophy' | 'bell' | 'settings' | 'search' | 'check' | 'x' | 'chev-r' | 'chev-d'
  | 'more' | 'doc' | 'arrow-u' | 'arrow-d' | 'clock' | 'flame' | 'download' | 'eye';

export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ color, flex: 'none' }} aria-hidden>
      <use href={`#a-${name}`} />
    </svg>
  );
}

export function IconSprite() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute', overflow: 'hidden' }} aria-hidden dangerouslySetInnerHTML={{ __html: `<defs>
<symbol id="a-grid" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></g></symbol>
<symbol id="a-users" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8.5" r="3.4"/><path d="M3 19.5c.7-3.2 3-4.8 6-4.8s5.3 1.6 6 4.8"/><path d="M16 5.6a3.4 3.4 0 0 1 0 5.8M17.5 15.2c2 .6 3.2 2.1 3.5 4.3"/></g></symbol>
<symbol id="a-verified" viewBox="0 0 24 24"><path d="M12 2.2l2.5 1.6 3-.2 1 2.8 2.3 1.9-1 2.8 1 2.8-2.3 1.9-1 2.8-3-.2L12 21.8 9.5 20.2l-3 .2-1-2.8L3.2 15.7l1-2.8-1-2.8 2.3-1.9 1-2.8 3 .2z" fill="currentColor"/><path d="M8.4 12.2l2.6 2.6 4.8-5.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="a-pin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></g></symbol>
<symbol id="a-shield" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l7 2.6v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9v-6z"/><path d="M9 12l2.2 2.2L15.2 10"/></g></symbol>
<symbol id="a-dumbbell" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 9.5v5M6 7v10M18 7v10M21 9.5v5M6 12h12"/></g></symbol>
<symbol id="a-play" viewBox="0 0 24 24"><path d="M7 4.5l13 7.5L7 19.5z" fill="currentColor"/></symbol>
<symbol id="a-card" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="5.5" width="19" height="13" rx="3"/><path d="M2.5 10h19"/></g></symbol>
<symbol id="a-trophy" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4h9v4.5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.5H5a2.5 2.5 0 0 0 2.5 4.5M16.5 5.5H19a2.5 2.5 0 0 1-2.5 4.5M12 13v3.5M8.5 20h7l-.8-3.5h-5.4z"/></g></symbol>
<symbol id="a-bell" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z"/><path d="M10 18.5a2.2 2.2 0 0 0 4 0"/></g></symbol>
<symbol id="a-settings" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></g></symbol>
<symbol id="a-search" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></g></symbol>
<symbol id="a-check" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="a-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></symbol>
<symbol id="a-chev-r" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="a-chev-d" viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="a-more" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></g></symbol>
<symbol id="a-doc" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/></g></symbol>
<symbol id="a-arrow-u" viewBox="0 0 24 24"><path d="M12 20V5m-5.5 5.5L12 4.5l5.5 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="a-arrow-d" viewBox="0 0 24 24"><path d="M12 4v15m5.5-5.5L12 19.5 6.5 13.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="a-clock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3.2 2"/></g></symbol>
<symbol id="a-flame" viewBox="0 0 24 24"><path d="M13 2.5c.6 3.4-1.4 4.6-2.8 6.2C8.4 10.7 8 12 8 13.4A6 6 0 0 0 20 14c0-4.4-3.5-6.4-7-11.5z" fill="currentColor"/></symbol>
<symbol id="a-download" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/></g></symbol>
<symbol id="a-eye" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></g></symbol>
</defs>` }} />
  );
}
