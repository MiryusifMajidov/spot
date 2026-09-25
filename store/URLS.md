# Mağaza formalarına köçürüləcək ünvanlar

Yayımlandı 25.09.2026, hər biri canlı yoxlanıldı (HTTP 200). Sayt tətbiqin öz
Firebase layihəsindədir (`spot-d7566`, `google-services.json` ilə eyni), ona görə
nə ayrıca domen, nə hostinq abunəliyi lazımdır.

| Nə | Ünvan |
|---|---|
| **Məxfilik siyasəti** | `https://spot-d7566.web.app/legal/privacy.html` |
| **İstifadə şərtləri** | `https://spot-d7566.web.app/legal/terms.html` |
| **İcma qaydaları** | `https://spot-d7566.web.app/legal/rules.html` |
| **Hesabın silinməsi** | `https://spot-d7566.web.app/legal/delete-account.html` |
| **Sayt / dəstək səhifəsi** | `https://spot-d7566.web.app/` |
| **Dəstək e-poçtu** | `mecidovyusif079@gmail.com` |

Hər səhifə üç dildədir (AZ/RU/EN), seçim `localStorage`-da yadda qalır.
JavaScript sönülüdürsə azərbaycanca açılır — hüquqi baxımdan bağlayıcı olan
versiya odur. Bir dil üçün ayrıca ünvan istəyən forma olsa: `?lang=ru`, `?lang=en`.

## Hansı xana hansı ünvanı istəyir

**Google Play Console**
- App content → Privacy policy → *Məxfilik siyasəti*
- App content → Data deletion → «URL to request account deletion» → *Hesabın silinməsi*
  (Play bunu tətbiqdaxili silmə olsa da tələb edir)
- Store listing → Website → *Sayt*; Email → *Dəstək e-poçtu*

**App Store Connect**
- App Privacy → Privacy Policy URL → *Məxfilik siyasəti*
- App Information → Support URL → *Sayt* (və ya dəstək e-poçtu)
- App Information → License Agreement: standart Apple EULA qalsın; öz şərtlərimiz
  *İstifadə şərtləri* ünvanındadır və tətbiqin içində də var.
- App Review Information → əlaqə: *Dəstək e-poçtu*

## Dəyişdikdə

Səhifələr əl ilə yazılmır. Mətn `src/lib/legal.ts` və
`src/i18n/{ru,en}/legal.ts` faylındadır — yəni tətbiqin içində oxunan mətnlə
eynidir. Bir cümlə dəyişəndə:

```bash
node store/legal/build.mjs && node web/build-site.mjs && npx firebase-tools deploy --only hosting
```

Yayımdan sonra hər dörd ünvanı bir dəfə açıb bax: köhnə hostinqin
`try_files … /index.html` qaydası olmayan yola da HTTP 200 və marketinq səhifəsi
qaytarırdı, yəni səhv yol uğur kimi görünürdü. Firebase-də belə deyil — olmayan
yol 404 verir (yoxlanıldı) — amma vərdiş yaxşıdır.

## Tətbiq mağazalarda çıxandan sonra

`web/landing/index.html`-də beş «yüklə» düyməsi hazırda **mətndir**, link deyil:
tətbiq hələ mağazalarda yoxdur və 404 verən düymə reviewer ekranında
görünməməlidir. Yayım olan kimi onları geri linkə çevir:

- Google Play: `https://play.google.com/store/apps/details?id=com.spot.app`
- App Store: listinq yarananda App Store Connect verir.
