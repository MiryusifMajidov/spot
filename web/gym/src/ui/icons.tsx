// Icon sprite — the admin panel's a-* symbols (SPOT Admin Panel.dc.html) plus the
// gym panel's own, drawn the same way: 24-unit box, 1.8 stroke, round caps.
export type IconName =
  | 'grid' | 'users' | 'verified' | 'pin' | 'shield' | 'dumbbell' | 'play' | 'card'
  | 'trophy' | 'bell' | 'settings' | 'search' | 'check' | 'x' | 'chev-r' | 'chev-d'
  | 'more' | 'doc' | 'arrow-u' | 'arrow-d' | 'clock' | 'flame' | 'download' | 'eye'
  | 'qr' | 'cal' | 'star' | 'edit' | 'image' | 'logout' | 'plus' | 'trash' | 'print'
  | 'refresh' | 'ticket' | 'expand' | 'megaphone';

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
<symbol id="a-verified" viewBox="0 0 24 24"><path d="M12 2.2l2.5 1.6 3-.2 1 2.8 2.3 1.9-1 2.8 1 2.8-2.3 1.9-1 2.8-3-.2L12 21.8 9.5 20.2l-3 .2-1-2.8L3.2 15.7l1-2.8-1-2.8 2.3-1.9 1-2.8 3 .2z" fill="currentColor"/><path d="M8.4 12.2l2.6 2.6 4.8-5.2" fill="none" stroke="#FAFAFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
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
<symbol id="a-qr" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2M7 12h10"/></g></symbol>
<symbol id="a-cal" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></g></symbol>
<symbol id="a-star" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
<symbol id="a-edit" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></g></symbol>
<symbol id="a-image" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="M20.5 15.5l-5-5-9 9"/></g></symbol>
<symbol id="a-logout" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2"/><path d="M10 12h10m-3-3 3 3-3 3"/></g></symbol>
<symbol id="a-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="a-trash" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></g></symbol>
<symbol id="a-print" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6H7z"/></g></symbol>
<symbol id="a-refresh" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 11A7.5 7.5 0 0 0 6 6.6L4.5 8"/><path d="M4.5 4v4h4"/><path d="M4.5 13A7.5 7.5 0 0 0 18 17.4l1.5-1.4"/><path d="M19.5 20v-4h-4"/></g></symbol>
<symbol id="a-ticket" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 6v12" stroke-dasharray="2 2.2"/></g></symbol>
<symbol id="a-expand" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></g></symbol>
<symbol id="a-megaphone" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 9a4 4 0 0 1 0 6M8 15l1 4.5"/></g></symbol>
</defs>` }} />
  );
}
