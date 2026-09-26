# Buraxılışa hazırlıq auditi — 23.09.2026

Beş müstəqil auditor (mağaza tələbləri · mətnlərin doğruluğu · canlı baza · ilk
istifadəçi təcrübəsi · build/konfiqurasiya), hər birinin ardınca onu **təkzib
etməyə çalışan** skeptik. 64 tapıntıdan 62-si yoxlamadan sağ çıxdı. Aşağıdakı
siyahıda **[canlı yoxlandı]** işarəsi olanları bu sənədi yazan bilavasitə
təkrar yoxlayıb — qalanları auditorun sübutuna əsaslanır.

**Verdikt: bu gün nə Play-ə, nə App Store-a göndərilə bilməz.**

Dörd fərqli səviyyə, qarışdırmaq olmaz:

| Səviyyə | Nə |
|---|---|
| **Göndərmək mümkün deyil** | İctimai məxfilik siyasəti URL-i yoxdur — `spot-az.fly.dev` domeni mövcud deyil. Play-in «Privacy policy URL» + «Data deletion URL», App Store Connect-in «Privacy Policy URL» + «Support URL» xanaları doldurula bilmir. |
| **Əlimizdəki fayl yararsız** | `apk/SPOT-1.3.8.aab` içində məxfilik siyasəti hərfi mətnlə `[DOLDURULMALI: operator şirkətin/şəxsin adı]` yazır. |
| **Rədd ediləcək** | iOS-da Sign in with Apple Supabase-də sönülüdür (`/auth/v1/settings` → `"apple":false`) — Guideline 4.8. Feed video kartında «Şikayət et / Blokla» yoxdur — Guideline 1.2, üstəlik `store/listing.md` Apple-a əksini yazır. |
| **Bizi utandıracaq** | Yoxlayıcı 0 zal, «Test» / «Test1» / «Funksional guc test» adlı 3 müəllim və «Xjixjdj», «İgugu» başlıqlı feed videoları görür — Apple 2.1 «placeholder content». |

Ən yaxşı halda real tarix: hüquqi ad + domen bu gün həll olunarsa **iOS üçün
3–5 gün**; Play hesabın fərdi hesabdırsa **+14 gün** qapalı test (divar saatı ilə
gedir, heç nə onu qısaltmır).

---

## 1. Sənin sıralı siyahın

Sıra elə qurulub ki, heç biri özündən sonrakını gözləmir.

1. **Keystore-u yedəklə — 10 dəq.** `android/app/spot-upload.keystore` +
   `android/gradle.properties`-dəki `SPOT_UPLOAD_*` yalnız bu diskdədir
   (`/android` gitignore-dadır). İtsə, SPOT-u quraşdıran heç kim bir daha
   yeniləmə ala bilməz. Repodan kənara, şifrələnmiş yerə.
2. **Play hesabının tipi — 5 dəq.** Settings → Developer account. **Fərdi**
   hesab + 13.11.2023-dən sonra açılıbsa: production üçün 12 test istifadəçisi
   ilə **14 gün fasiləsiz** qapalı test lazımdır. Təşkilat hesabı azaddır.
   «Sabah çıxa bilərəmmi» sualının cavabı budur.
3. **Apple Developer üzvlüyü + bundle id — 30 dəq (qeydiyyat
   1–2 gün çəkə bilər).** Ən uzun gözləməli maddədir, ona görə erkəndir.
4. **Hüquqi kimlik — 10 dəq, amma hər şey bundan asılıdır.** İki sətir:
   operatorun hüquqi adı (şəxs və ya şirkət) və real əlaqə e-poçtu. Mənə verən
   kimi `src/lib/legal.ts` doldurulur və səhifələr yenidən qurulur.
5. **Domen / fly.io app-ı — 30 dəq + DNS.** Adı de, deploy-u mən edirəm.
   Diqqət: nginx-in `try_files … /index.html` qaydası səhv yolu da HTTP 200 ilə
   marketinq səhifəsinə yönəldir — deploy-dan sonra hər üç URL-i açıb *məhz
   hüquqi mətni* gördüyünü təsdiqlə.
6. **Apple: Services ID + Sign in with Apple .p8 açarı → Supabase →
   Authentication → Providers → Apple — 45 dəq.** Kod tərəfi tamdır
   (entitlements-də `com.apple.developer.applesignin` var).
7. **Supabase-də iki qutu — 20 dəq.** (a) Redirect URLs-də `spot://auth-callback`
   varmı — yoxsa Google ilə girən tətbiqə qayıda bilmir. (b) SMTP: standart
   göndərici sürət-limitlidir, e-poçtla giriş real yüklə susur. Hər ikisi yalnız
   dashboard-dan görünür.
8. **Supabase pulsuz planın 04.10.2026 bildirişi — 15 dəq.** 11 gün qalıb.
9. **Real məzmun — əsl darboğaz, günlərlə ölçülür.** Ən azı bir real zal
   `listed=true` + check-in kodu, bir real müəllim, bir neçə real klip. Bunsuz
   Kəşf, xəritə, check-in, day-pass və rəylər boş ekrandır və 5 skrinşotdan 4-ü
   çəkilə bilmir.
10. **İki «doğrulanmış» nişanı barədə qərar — 10 dəq.** `trainer_verifications`-in
    4 sətrinin hamısında sənəd sahələri NULL-dur, amma ikisi `approved` və
    `trainers.verified=true` daşıyır.
11. **Bazaya yazmaq üçün icazə — 5 dəq.** Aşağıdakı 4 baza işi hazırdır,
    yalnız «başla» lazımdır.
12. **Skrinşotlar + feature graphic + demo hesab + yaş reytinqi — 3–4 saat,**
    9-cu maddədən asılıdır. Review Notes mətni hazırdır (`store/listing.md §11`),
    yalnız demo hesab bloku qalır — parol repoya yox, App Store Connect-ə.
13. **Play qapalı testini başlat** — 4 və 5 bitəndən sonra, mümkün olan ən erkən
    an. 14 gün sən başqa işlə məşğul olarkən də axır.

---

## 2. Mühəndis siyahısı

1. **Hüquqi mətnlərin tam keçidi** (4-cü maddə gələndən sonra, ~2 saat).
   OPERATOR/CONTACT; silmə yolu iki sənəddə ziddiyyətlidir — `legal.ts` «Profil →
   Məxfilik → Hesabı sil» deyir, `delete-account.html` isə düzgün yolu yazır;
   «şifrələr» sözü (tətbiqdə parol yoxdur — `signInWithPassword` mövcud deyil);
   üçüncü tərəflərə Google/Apple Sign-In; «hətta admin də görə bilmir» iddiası
   (RLS operatoru dayandırmır); ilk açılışda anonim hesab yaradılması.
2. **Feed-də Şikayət / Blok — Apple 1.2 [canlı yoxlandı: yoxdur].** Video
   kartının düymələri share ilə bitir, «...» yoxdur; `feed/creator.tsx` moderasiya
   helper-i import etmir; feed blok siyahısını ümumiyyətlə oxumur, yəni
   blokladığın adamın videoları qarşına çıxmağa davam edir. `store/listing.md`
   isə Apple-a «Report and Block are available on every profile, post, comment
   and video» yazır. `showModerationSheet` artıq 5 ekranda var — yalnız əsas
   UGC səthində yoxdur.
3. **Baza işləri** (11-ci maddədən sonra, ~2 saat):
   - `schema88` — `moderation_actions.admin_id` hələ `NOT NULL` + FK `RESTRICT`.
     İlk şikayəti həll etdiyin an admin hesabın silinə bilməyəcək.
   - **`student_programs.sp_write` [canlı yoxlandı].** Siyasət yalnız
     `owns_trainer(trainer_id)` tələb edir, `student_id` üçün heç bir şərt
     yoxdur. Müəllim olmaq isə özü-özünə xidmətdir (`trainers_insert`:
     `owner_id = my_profile_id()`). Nəticə: **istənilən hesab özünə müəllim
     elanı yaradıb istənilən istifadəçinin «Məşq» tabına proqram və sərbəst mətn
     göndərə bilər** — sorğu/qəbul axınını da, mesaj qapısını da tamamilə keçir.
   - **`trainers.gym_id` [canlı yoxlandı].** anon və authenticated üçün UPDATE
     qrantı var, `trainers_update` siyasəti yalnız `owner_id`-ni yoxlayır, zalı
     yox; zal tərəfində təsdiq axını heç yerdə mövcud deyil. Yəni hər kəs real
     zalın səhifəsində onun məşqçisi kimi görünə və `gyms.trainers` sayğacını
     şişirdə bilər. İlk real zal siyahıya düşən kimi işlək hücuma çevrilir.
   - **`spatial_ref_sys` [canlı yoxlandı].** RLS **söndürülüb**, 0 siyasət, anon
     və authenticated-də SELECT/INSERT/UPDATE/DELETE/**TRUNCATE**. Cədvəl
     `supabase_admin`-ə məxsusdur, ona görə `schema62`-nin revoke-u səssizcə
     uğursuz olub. APK-nın içindəki açarı olan hər kəs zalların məsafə
     hesabının dayandığı SRID cədvəlini silə bilər. Sahiblik bizdə olmadığı
     üçün bunu ya Supabase dashboard-dan, ya da PostGIS-i `extensions` sxeminə
     köçürməklə bağlamaq lazımdır — qərar tələb edir.
   - Təmizlik: test feed videoları, zibil şərhlər, köhnə support biletləri,
     `meals`/`shop_items` qrantları (oxuyan kod silinib, cədvəllər hələ anonim
     SELECT-ə açıqdır), sahibsiz storage faylları — o cümlədən **silinmiş
     istifadəçinin avatarı hələ ictimai URL-də xidmət olunur**, halbuki
     `delete-account.html` əksini vəd edir.
   - `admin_decide_verification`: bütün sənəd sütunları NULL ikən `approved`
     qəbul etməsin.
4. **Landing səhifəsi** (~2 saat, domen gələndən sonra). `web/landing/index.html`
   tətbiqdə olmayan dörd şeyi satır: qida planı, «hər hərəkətin videosu var»,
   çəki/ölçü/foto müqayisəsi, tətbiqdaxili rezervasiya. «Yalnız match olanlar
   yaza bilər» də doğru deyil (siyahıdakı müəllimə hər kəs yaza bilər —
   `schema73`). 36 linkdən 20-si boş `#`. Dockerfile `legal/` qovluğunu
   kopyalamır.
5. **Sənədlərin düzəlişi** (~1 saat): `data-safety.md`-nin lokasiya və icazə
   iddiaları, silmə yolu, `listing.md`-dəki «ziddiyyət qalmayıb» sətri.
6. **i18n boşluğu** (~1 saat). `src/store/db.ts` progressive-overload məsləhətini
   xam şablon kimi qurur, `session.tsx` onu tərcümə olunmuş örtüyün içinə qoyur —
   rus və ingilis istifadəçisi məşq ekranında azərbaycanca mətn görür.
   `check_i18n.py` bunu görmür, çünki açar dinamikdir.
7. **Şəkillərdə GPS** (~2 saat). Videolar sübut olunub; şəkillər isə yalnız
   `downscale()`-in JPEG-ə yenidən kodlamasının yan təsirinə güvənir və hər iki
   kodlama uğursuz olarsa orijinal fayl ictimai bucket-ə gedir. Test yaz,
   uğursuzluq yolunda yükləməni rədd et.
8. **AAB-ı versionCode 13 ilə yenidən yığ** — 1-ci maddə bitəndən sonra, yoxsa
   iki dəfə yığmaq lazım gələcək.

---

## 3. Həqiqətən hazır olan

- **İmza və build sağlamlığı:** AAB release açarı ilə imzalanıb (CN=SPOT,
  2048-bit RSA), debug açarı deyil; versionCode/versionName dörd yerdə də
  uyğundur; targetSdk 36 / minSdk 24; **16 KB page size — 56 ədəd 64-bit .so-nun
  hamısı keçir.**
- **İcazələr:** RECORD_AUDIO, SYSTEM_ALERT_WINDOW, xarici yaddaş, READ_MEDIA_*,
  QUERY_ALL_PACKAGES, AD_ID — birləşmiş manifestdə heç biri yoxdur.
- **İkon:** 1024×1024, tam qeyri-şəffaf (Apple alfa kanallı ikonu rədd edir).
- **Mağaza mətnləri:** hər üç dildə hər limitin içində, simvollar bir-bir sayılıb.
- **Baza təhlükəsizliyi:** `verify_schema.sql` → **536/536 OK**. 102 siyasət
  bir-bir oxundu; şəxsi məlumatda cross-user sızma yoxdur (workouts, prs,
  progress, messages, notifications — hamısı öz profilinə bağlı, admin siyasəti
  yoxdur); `profiles.phone` heç bir qranta daxil deyil; 13 admin funksiyasının
  hamısı `require_admin()` ilə başlayır; 4 bucket-in hamısında ölçü limiti və
  MIME allowlist var, `certs` privatdır.
- **Hesab silmə** işləyir, schema87 canlıdır (rəy anonimləşir, silinmir).
- **Video GPS:** hər iki yükləmə yolu `stripVideoLocation` çağırır,
  `npm run video:test` 30/30. Bu vəd doğrudur.
- **Kod:** `tsc --noEmit` təmiz, `expo lint` 0 xəta, `i18n:test` 28/28,
  `sim:dry` OK, canlı sim 273 PASS.
- **Sirr sızması yoxdur:** `.env`-də yalnız publishable açar, keystore
  gitignore-da.
- **16+ yaş həddi** onboarding-də real tətbiq olunur.
- Tətbiq **məzmun uydurmur**: saxta bəyənmə sayları və uydurma videolar silinib.

---

## 4. Heç kimin yoxlamadığı

- **Tətbiq bu auditdə heç bir cihazda işə salınmadı** — bütün UI iddiaları
  koddan və bazadan oxunub.
- **Bütün iOS davranışı** (Mac yoxdur): Apple sheet, guest tabları, arxivdə
  `aps-environment`. Yeganə yol: ilk `eas build` logu + TestFlight-dan bir push.
- **EAS layihəsinin slug-ı** `app.json`-da hələ **"miri"**, owner
  `miri2005s-team` — layihə ID ilə uyğun gəlmirsə `eas build` başlamır.
- ~~**`com.spot.app` bundle id-nin Apple-da boş olması**~~ — **HƏR İKİ MAĞAZADA
  TUTULUB (26.09.2026).** Apple: «An App ID with Identifier 'com.spot.app' is not
  available». Play: «This package name is already in use». Diqqət: Play listinq
  URL-i həmin ad üçün 404 qaytarırdı, yəni **mağaza ünvanını yoxlamaq boşluq
  yoxlaması deyil** — başqasının dərc olunmamış tətbiqi adı rezerv edə bilər.
  Hər iki platforma indi `app.spot.az`-dır.
  Köhnə qeyd: tutulubsa, id hər yerdə
  dəyişməlidir.
- **Keystore-un bu diskdən kənarda nüsxəsi** — görə bilmirəm.
- **Şəkillərdən EXIF-in cihazda həqiqətən silinməsi** — nə təsdiq, nə təkzib.
- **Apple-ın ITMS-91053 privacy manifest skanı.**
- **88 migrasiyadan yalnız ikisinin canlı ilə üst-üstə düşdüyü yoxlanıldı.**
- **Postgres platforma loglarının `gyms_near(lat,lng)` koordinatını saxlayıb-
  saxlamaması** — yəni «koordinat serverdə saxlanmır» yalnız tətbiq cədvəlləri
  üçün sübut olunub.
