# SPOT promo videoları

Hər video bir HTML səhifəsidir: tətbiqin ekranları `src/` kodundakı ölçü və rənglərlə
HTML-də qurulub, bütün hərəkət bir GSAP timeline-dadır. `render.mjs` səhifəni headless
Chromium-da kadr-kadr çəkir və ffmpeg ilə MP4 yığır.

| Video | Səhifə |
|---|---|
| Zal və müəllim axtarışı | `v1-zal/index.html` |
| Proqram və müəllimsiz məşq | `v2-proqram/index.html` |

```bash
node promo/render.mjs promo/v1-zal/index.html promo/out/SPOT-zal-ve-muellim.mp4 --fps 60 --music promo/assets/music-v3.m4a
node promo/render.mjs promo/v2-proqram/index.html promo/out/SPOT-proqram-muellimsiz.mp4 --fps 60 --music promo/assets/music-v3.m4a
node promo/render.mjs promo/v1-zal/index.html /tmp/stills --stills 6.5,12,20   # yoxlama üçün PNG kadrlar
```

- Üslub, musiqi və vaxt nöqtələri `SPOT-promo-v3.mp4`-dən götürülüb: 4.0 s-də ritm başlayır,
  28–31 s söz montajı, 32.0 s-də loqo zərbəsi, 36 s.
- `assets/` — demo tətbiqin şəkilləri (zallar, müəllim avatarları, xəritə) və musiqi,
  `SPOT-promo-v3.mp4` kadrlarından kəsilib.
- `lib/kit.css` tətbiqin UI hissələri, `lib/screens.css` ekran hissələri, `lib/stage.css|js` video səhnəsi.
