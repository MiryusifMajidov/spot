# SPOT — «Data safety» (Google Play) və «App Privacy» (Apple)

**Tətbiq:** SPOT · iOS `app.spot.az` · Android `com.spot.app` · versiya 1.3.9 · Android `versionCode` 13 · iOS `buildNumber` 1
**Yoxlanma tarixi:** 23 sentyabr 2026
**Nəyə əsaslanır:** bu fayldakı hər cavab `D:\spot` kodundan və canlı Supabase bazasından (`oezzgcumwprpoqekmlop`, yalnız oxuma) yoxlanılıb. Təxmin edilən heç nə yoxdur — əmin olmadığım hər şey §8 «Açıq suallar»dadır.

> Bu sənəd konsola yazılacaq cavabların özüdür. Google Play və App Store Connect formaları ingiliscədir, ona görə seçiləcək variantların **dəqiq ingilis adları** `belə` yazılıb — konsolda həmin sözü axtar.

---

## 0. Bir abzasda

SPOT **reklam şəbəkəsi, analitika SDK-sı və crash SDK-sı işlətmir** (`package.json`-da Sentry, Firebase Analytics, Amplitude, Mixpanel, `expo-updates` — heç biri yoxdur). **Heç bir ödəniş qəbul etmir.** İzləmə (tracking) yoxdur, ona görə iOS-da ATT paneli də yoxdur. Toplanan hər şey tətbiqin öz işi üçündür və hamısı bir yerdədir: Supabase. Ən həssas üç şey — **çəki, məşq təfərrüatı və yazışma** — ya ümumiyyətlə serverə getmir, ya da yalnız sahibinin oxuya bildiyi cədvəldədir; bu, arzu deyil, bazanın RLS qaydası ilə bağlanıb (§2.4-də sübut).

~~İki bloklayıcı~~ — **hər ikisi 25.09.2026-da bağlandı.** Operator: Miryusif Məcidov, əlaqə: mecidovyusif079@gmail.com. Səhifələr tətbiqin öz Firebase layihəsində yayımlandı və canlı yoxlanıldı; hansı xanaya hansı ünvanın getdiyi `store/URLS.md`-dədir.

Bu sənədin özündən kənar, amma göndərməni kəsən üçüncü bir şey var və onu burada yazmasam, forma doğru, tətbiq isə rədd edilmiş olar: **Supabase layihəsində Apple girişi sönülüdür** (`"apple": false`), yəni iPhone-da «Apple ilə davam et» düyməsi görünmür, halbuki Google girişi var — App Store Guideline 4.8. Təfərrüat §2.3-də, düzəliş addımları `store/listing.md` «Açıq suallar» №2-dədir.

---

## 1. Nə yoxlanıb (metod)

**Kod:**
`app.json` · `package.json` · `src/lib/api.ts` · `src/lib/auth.ts` · `src/lib/push.ts` · `src/lib/images.ts` · `src/lib/wipe.ts` · `src/lib/legal.ts` · `src/lib/trainingSync.ts` · `src/app/(tabs)/checkin.tsx` · `src/app/(tabs)/discover/map.tsx` · `src/app/(tabs)/profile/privacy.tsx` · `src/app/auth/sign-in.tsx` · `src/app/trainer/verify.tsx` · `src/app/gym/claim.tsx` · `src/components/SpotMap.tsx` · `supabase/schema19_checkin_server_side.sql` · `supabase/schema61_push.sql`

**Canlı bazadan (oxuma sorğuları):** bütün `public` cədvəllərinin sütunları · `storage.buckets` · `profiles` üzərindəki sütun qrantları · `profiles`/`workouts`/`progress`/`prs`/`messages`/`check_ins`/`push_tokens` RLS siyasətləri · `delete_my_account()` və `gyms_near()` funksiyalarının mətni · `profiles`-a bağlı bütün xarici açarların silinmə davranışı · `auth.identities` üzrə provayder sayı · sətir sayları.

**Canlı rəqəmlər (23.09.2026):** 13 profil · 13 `auth.users` · **0 siyahıya salınmış zal** · 0 check-in · 1 mesaj · 8 push tokeni · 4 feed videosu · **0 telefon nömrəsi** · `auth.identities`-də yalnız `google` (4 ədəd).

---

## 2. Faktlar: SPOT nəyi hara yazır

### 2.1 Yalnız telefonda qalan (serverə HEÇ VAXT getmir) — formada **bəyan edilmir**

Hər iki mağaza eyni qaydanı qoyur: cihazdan çıxmayan məlumat «toplanmış» sayılmır. Bunlar çıxmır:

| Nə | Harada |
|---|---|
| Məşqin **set-set təfərrüatı** (hansı hərəkət, neçə kq, neçə təkrar) | `spot-db` (AsyncStorage). `src/lib/trainingSync.ts`: «The per-set detail … is NOT sent up, on purpose» |
| Yarımçıq məşq qaralaması | `spot-session:*` açarları |
| Kəşf filtrləri, oxunma nişanları, həftəlik seçimlər | `spot-discover-prefs` |
| Bookmarklar, saxlanmış videolar, izlədiklərin lokal nüsxəsi | `spot-app` |
| Dil seçimi | AsyncStorage |

Bunların hamısı «Çıxış» və «Telefondakı nüsxəni sil» ilə silinir (`src/lib/wipe.ts`).

### 2.2 Serverə gedən hər şey (Supabase, `public` sxeması)

| Data | Cədvəl / sütun | Məcburi? | Kim görür |
|---|---|---|---|
| Ad, @istifadəçi adı | `profiles.name`, `.username` | bəli (onboarding) | qeydiyyatdan keçmiş istifadəçilər |
| Yaş | `profiles.age` | **bəli** (onboardingdə boş buraxıla bilmir) | qeydiyyatdan keçmiş istifadəçilər |
| Cins | `profiles.gender` | seçim | qeydiyyatdan keçmiş istifadəçilər |
| Bio, məqsəd, səviyyə, məşq tipi, məşq saatı | `profiles.bio/goals/level/types/time_slot` | seçim | qeydiyyatdan keçmiş istifadəçilər |
| Avatar | `profiles.avatar_url` → **public** `avatars` bucket | seçim | hamı (açıq URL) |
| Ev zalı | `profiles.home_gym_id` | seçim | qeydiyyatdan keçmiş istifadəçilər + həmin zalın sahibi |
| Görünürlük seçimləri | `profiles.visibility`, `.show_in_gym_list` | — | yalnız sistem |
| Son aktivlik vaxtı | `profiles.last_active_at` | avtomatik | digər istifadəçilər (profil sorğusu ilə) |
| Bildiriş seçimləri | `profiles.notif_prefs` (jsonb) | avtomatik | yalnız sahibi |
| **Məşq xülasəsi** (başlıq, müddət, ümumi tonaj, set sayı, RPE) | `workouts` | avtomatik | **yalnız sahibi** |
| **Şəxsi rekordlar** | `prs` | avtomatik | **yalnız sahibi** |
| **Bədən çəkisi** | `progress` | **bu gün YAZILMIR** — bax §2.5 | **yalnız sahibi** |
| Check-in (zal + vaxt) | `check_ins` (`gym_id`, `created_at`, `expires_at`) — **koordinat sütunu YOXDUR** | istifadəçi skan edir | qüvvədə ikən: digər istifadəçilər; həmişə: zal sahibi (öz zalı üçün) |
| Yazışma | `chat_threads`, `messages.body` | istifadəçi yazır | **yalnız iki tərəf** |
| Şərhlər, postlar, rəylər | `comments`, `community_posts`, `reviews` | istifadəçi yazır | hamı |
| Feed videosu (+ poster) | `feed_videos` → **public** `videos` bucket | istifadəçi yükləyir | hamı (açıq URL) |
| Bəyənmə, saxlama, izləmə, bloklama | `video_likes`, `video_saves`, `post_likes`, `comment_likes`, `follows`, `blocks` | avtomatik | qismən açıq (say kimi) |
| Yoldaş/müəllim sorğuları + qeyd | `match_requests.note`, `trainer_requests.note` | istifadəçi yazır | qarşı tərəf |
| Şikayət + mətni | `reports.note`, `report_messages` | istifadəçi yazır | admin |
| **Push tokeni** + platforma | `push_tokens.token`, `.platform` | icazə verilərsə | **yalnız sahibi** (RLS: `profile_id = my_profile_id()`) |
| E-poçt / Google / Apple kimliyi | `auth.users`, `auth.identities` (Supabase Auth) | seçim — bax §2.3 | yalnız sistem |
| Bir günlük keçid kodu | `day_passes` (`code`, `price`, vaxtlar) | istifadəçi basır | sahibi + zal sahibi |

**Yalnız müəllim/zal sahibi olanlar üçün:**

| Data | Harada | Qeyd |
|---|---|---|
| Sertifikat/diplom faylı (şəkil və ya PDF) | **private** `certs` bucket, `trainer_verifications.doc_cert_url` | açıq deyil, admin yoxlayır |
| Tanışlıq videosu | `trainer_verifications.intro_video_url` | |
| Zal fotoları | **public** `gyms` bucket | |
| **VÖEN** (vergi nömrəsi) | `gym_claims.voen` | zal sahibliyi iddiası üçün; canlı bazada 0 sətir |
| Şəxsiyyət vəsiqəsi | **tətbiqdən YÜKLƏNMİR** | `trainer/verify.tsx:495` ekranda açıq yazır: «Tətbiqdən hələ yüklənmir — lazım olsa SPOT komandası soruşacaq». `doc_id_url` sütunu var, tətbiqdə yazan kod yoxdur. |

### 2.3 Kimlik: anonim → real

Tətbiq **hesabsız başlayır**: `ensureSession()` (`src/lib/api.ts:124`) ilk dəfə `signInAnonymously()` çağırır — bu, heç bir şəxsi məlumat tələb etməyən, yalnız cihazda saxlanan bir identifikatordur. E-poçt yalnız insan özü qoşulanda yaranır:

- **Apple ilə** — `signInWithIdToken`, `FULL_NAME` + `EMAIL` scope-ları (`src/lib/auth.ts:252`). İstifadəçi «Hide My Email» seçərsə, bizə yalnız relay ünvanı gəlir.
  ⚠️ **Bu yol bu gün İŞLƏMİR.** Canlı layihədə Apple provayderi sönülüdür —
  `GET https://oezzgcumwprpoqekmlop.supabase.co/auth/v1/settings` bu gün
  `"apple": false, "google": true, "email": true, "phone": false` qaytarır, və
  `useSocialProviders` serverin «sönülü» dediyi düyməni çəkmir. Yəni iPhone-da yalnız
  Google + e-poçt görünür; `auth.identities`-də də yalnız `google` var (4 ədəd), bir
  dənə də Apple kimliyi yoxdur. Mağaza tərəfi üçün bu, sadəcə forma məsələsi deyil —
  App Store Guideline 4.8 üzrə rədd səbəbidir (`store/listing.md`, «Açıq suallar» №2).
  Forma cavablarına təsiri yoxdur: Apple açılanda da toplanan yeganə şey ad və e-poçtdur,
  ikisi də aşağıda artıq bəyan edilib.
- **Google ilə** — sistem brauzeri vasitəsilə OAuth. Bu gün işləyən yeganə sosial yoldur.
- **E-poçta link** — `signInWithOtp` (magic link). Layihədə açıqdır (`"email": true`).
- **Telefon nömrəsi ilə giriş YOXDUR** — silinib (`src/app/auth/sign-in.tsx:46`: «Sign-in by phone number is gone»). Canlı bazada telefonu olan profil **sıfırdır**, `profiles.phone` sütunu isə `anon`/`authenticated` rollarına **SELECT üçün ümumiyyətlə verilməyib** — yəni tətbiq onu oxuya da bilmir.

### 2.4 «Zal sahibi çəkini görmür» — sübut

Canlı RLS siyasətləri:

```
workouts_read / progress_read / prs_read →
  profile_id in (select id from profiles where user_id = auth.uid())
```

Bu üç cədvəldə **admin siyasəti də yoxdur**. Yəni sahibindən başqa — nə digər istifadəçi, nə zal sahibi, nə SPOT admini — heç kim məşqi, çəkini, rekordu oxuya bilmir. Zal sahibinin gördüyü yeganə şey `check_ins`-in öz zalına aid sətirləri və `profiles`-ın açıq sütunlarıdır (`profiles_gym_owner_read`, üstəlik `show_in_gym_list` şərti ilə).

### 2.5 Bədən çəkisi — bu gün toplanmır

«Çəki» ekranı, qrafiki və çəki yazma forması tətbiqdən çıxarılıb (`src/lib/api.ts:713`). Kodda `progress` cədvəlinə **yazan bir yer qalmayıb**; qalan `getLatestWeight()` funksiyasını da heç kim çağırmır. Canlı bazada 1 köhnə sətir var (bu refaktorun silməyə haqqı olmayan insan datası).

**Formaya nə yazmalı:** bu gün göndərilən buildə bədən çəkisi toplanmır → `Health info` = **No**. Çəki ekranı qayıdanda hər iki formanı yeniləmək lazımdır (§7-yə düşdü).

### 2.6 Lokasiya — dəqiq vəziyyət

Bu sualın cavabı iki hissədir və ikisi də vacibdir.

**(a) Check-in artıq lokasiyadan istifadə ETMİR.** Əvvəl 150 m radius yoxlanışı vardı; `schema74` onu ləğv etdi, check-in indi resepsiyadakı **QR kodu** ilə olur (`src/app/(tabs)/checkin.tsx`). `check_ins` cədvəlində koordinat sütunu heç vaxt olmayıb — `schema19` bunu açıq yazır: «The reported position is an ARGUMENT, never a column … The RPC verifies the coordinates and discards them.»

**(b) Lokasiya iki yerdə qalıb:**

1. **Kəşf → Xəritə** (`src/app/(tabs)/discover/map.tsx:70`) — `getCurrentPositionAsync({ accuracy: Balanced })`, sonra koordinatlar `gyms_near(lat, lng)` RPC-sinə göndərilir. **Funksiyanın mətnini oxudum** — bu, saf SQL-dir: məsafəni hesablayır, sıralayır, qaytarır. **Heç nə yazmır, heç nə loglamır.** Yəni koordinat cihazdan çıxır, lakin saxlanılmır.
2. **Zal yaratmaq / redaktə etmək** (`create-gym.tsx:170`, `gym/edit.tsx:266`) — zal sahibi öz zalının pinini qoyarkən. Bu, **zalın** koordinatıdır, istifadəçinin yox, və `gyms.lat/lng`-ə yazılır (zal məlumatı, açıq).

**İcazə verilməsə nə olur:** xəritə işləməyə davam edir, sadəcə məsafəsiz siyahı göstərir (`status='denied'` → `near ?? fallback`). Yəni **məcburi deyil**.

**Fon rejimi yoxdur:** `app.json`-da yalnız `NSLocationWhenInUseUsageDescription` var, background location icazəsi, `expo-task-manager`, geofencing — heç biri yoxdur.

### 2.7 Şəkil və video metadatası

- **Şəkillər (avatar, zal fotosu, sertifikat):** `expo-image-manipulator` ilə JPEG kimi yenidən kodlaşdırılır (`src/lib/images.ts` → `downscale()`). Bu, EXIF-i — **o cümlədən GPS koordinatını** — silir. Yenidən kodlaşdırma uğursuz olsa, indi ölçü dəyişmədən bir də cəhd edilir; yalnız o da alınmasa orijinal göndərilir.
- **Videolar (23.09.2026-dan):** hər iki yükləmə yolu — `src/lib/api.ts` → `uploadFeedVideo()` və `src/lib/exerciseVideo.ts` → `uploadExerciseClip()` — faylı `stripVideoLocation()`-dan keçirir (`src/lib/videoMeta.ts`): MP4/MOV qutu ağacında çəkiliş yerini daşıyan atomlar (`©xyz`, `loci`, `gps…`) tapılır, tipi `free` edilir və içi sıfırlanır. Fayl uzunluğu və bütün offsetlər dəyişmir, `mdat` oxunmur da; anlaşılmayan fayl olduğu kimi yüklənir. Sübut: `npm run video:test` (30 yoxlama). **Bilinən hədd:** GoPro tipli kameraların `mdat` içindəki fasiləsiz GPS treki qalır — telefon videosuna aid deyil.

---

## 3. Google Play — «Data safety» formu

Konsol: **Play Console → App content → Data safety**.

### 3.1 Bölmə: «Data collection and security»

| Sual | Cavab | Əsas |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | §2.2 |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Supabase REST/Realtime/Storage — HTTPS; `exp.host` — HTTPS; xəritə tayl və Leaflet — HTTPS |
| Do you provide a way for users to request that their data is deleted? | **Yes** | Tətbiqdaxili «Hesabı sil» + veb ünvan (§6) |
| Does your app collect data from children? | **No** | Şərtlər 16+ tələb edir (`src/lib/legal.ts`) |

### 3.2 Bölmə: «Data types»

Aşağıda **yalnız** işarələnəcəklər var. Sadalanmayan hər şey → **No**.
Qısaltmalar: **Ephemeral** = «Data is processed ephemerally»; **Req/Opt** = «Required» / «Users can choose whether this data is collected».

#### Location

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Precise location** | Yes | **No** | **Yes** | **Opt** | `App functionality` |
| Approximate location | No | — | — | — | — |

> **Niyə «Precise»:** `Accuracy.Balanced` ≈ 100 m dəqiqlik. Play «approximate» üçün ≥ 3 km² sahə istəyir — 100 m ona sığmır, ona görə dürüst cavab «Precise»dir.
> **Niyə «Ephemeral»:** koordinat yalnız `gyms_near()` sorğusunun cavabını hazırlamaq üçün işlədilir, heç bir sütuna yazılmır (§2.6).
> **Niyə «Shared = No»:** Supabase bizim adımızdan emal edən xidmət təchizatçısıdır (service provider), Play-in tərifinə görə bu «sharing» deyil.

#### Personal info

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Name** | Yes | No | No | **Req** | `App functionality`, `Account management` |
| **Email address** | Yes | No | No | **Opt** | `Account management` |
| **User IDs** | Yes | No | No | **Req** | `App functionality`, `Account management` |
| **Other info** | Yes | No | No | **Req** | `App functionality` |
| Phone number | **No** | — | — | — | — |
| Address · Race and ethnicity · Political or religious beliefs · Sexual orientation | No | — | — | — | — |

> **«Other info»** = yaş, cins, bio, məqsəd, səviyyə, məşq saatı və zal sahibinin VÖEN-i. Play-də bunlar üçün ayrıca kateqoriya yoxdur.
> **«Other info» — Req**, çünki onboardingdə **yaş** boş buraxıla bilmir (`onboarding/profile.tsx:49`); qalanları (cins, bio, məqsəd) seçimdir, amma Play bütöv kateqoriya üçün bir cavab istəyir və içində bir məcburi sahə varsa cavab «Required» olmalıdır.
> **«Email address» — Opt**, çünki tətbiq hesabsız (anonim sessiya ilə) işləyir; e-poçt yalnız insan Apple/Google/e-poçtla qoşulanda yaranır.
> **«Name» — Req**, çünki onboardingdə ad olmadan profil qurulmur.

#### Financial info

**Hamısı No.** SPOT ödəniş qəbul etmir: tətbiqdaxili satınalma yoxdur, ödəniş rəyi yoxdur, kart məlumatı yoxdur. Qiymətlər yalnız məlumat üçün göstərilir, pul zala ödənilir. `day_passes` cədvəli **pulsuz** bir kod verir (`create_day_pass`; `src/lib/api.ts:817`: «SPOT charges nothing; the price is paid to the gym at the door») — orada saxlanan `price` zalın öz elan etdiyi rəqəmdir, bir əməliyyatın qeydi deyil. Buna görə `Purchase history` = **No**. (Bu, mübahisə oluna biləcək yeganə nöqtədir — §7, açıq sual №5.)

#### Health and fitness

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Fitness info** | Yes | No | No | **Opt** | `App functionality` |
| Health info | **No** | — | — | — | — |

> **«Fitness info»** = məşq xülasəsi (`workouts`), şəxsi rekordlar (`prs`), check-in-lər (`check_ins`), səviyyə/məqsəd/məşq saatı.
> **«Health info» = No**, çünki bədən çəkisi bu gün yazılmır (§2.5) və tətbiqdə heç bir tibbi məlumat sahəsi yoxdur.

#### Messages

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Other in-app messages** | Yes | No | No | **Opt** | `App functionality` |
| Emails · SMS or MMS | No | — | — | — | — |

#### Photos and videos

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Photos** | Yes | No | No | **Opt** | `App functionality` |
| **Videos** | Yes | No | No | **Opt** | `App functionality` |

#### Audio files

**Hamısı No.** Tətbiqdə səs yazan ekran yoxdur. Android-də `RECORD_AUDIO` `app.json`-da açıq şəkildə bloklanıb, `expo-camera` üçün `microphonePermission: false` və `recordAudioAndroid: false` qoyulub. Kameradan çəkilən videonun səsi videonun bir hissəsi kimi `Videos` altında sayılır.

#### Files and docs

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Files and docs** | Yes | No | No | **Opt** | `App functionality` |

> Yalnız müəllim olmaq istəyənlər üçün: sertifikat/diplom şəkli və ya PDF faylı, **private** `certs` bucketinə.

#### App activity

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Other user-generated content** | Yes | No | No | **Opt** | `App functionality` |
| **Other actions** | Yes | No | No | **Opt** | `App functionality` |
| **App interactions** | Yes | No | No | **Req** | `App functionality` |
| In-app search history · Installed apps | No | — | — | — | — |

> **«Other user-generated content»** = bio, video başlığı, şərh, post, rəy, sorğu qeydləri, şikayət mətni.
> **«Other actions»** = bəyənmə, saxlama, izləmə, bloklama, çağırışa qoşulma.
> **«App interactions»** = `profiles.last_active_at` (hər sorğuda serverin yenilədiyi son aktivlik vaxtı, `schema20`). Səhifə-səhifə izləmə yoxdur.

#### Device or other IDs

| Data type | Collected | Shared | Ephemeral | Req/Opt | Purpose |
|---|---|---|---|---|---|
| **Device or other IDs** | Yes | No | No | **Opt** | `App functionality` |

> Expo push tokeni (`ExponentPushToken[...]`) + platforma adı. Yalnız bildiriş icazəsi verildikdə yaranır, çıxışda silinir (`unregisterPush()`), hesabla birlikdə CASCADE ilə gedir.

#### Web browsing · Contacts · Calendar · App info and performance

**Hamısı No.** Crash/diagnostika SDK-sı yoxdur. (Play Console-un öz «Android vitals» məlumatı bu formada bəyan edilmir — o, Google-un öz topladığıdır.)

---

## 4. Apple — «App Privacy»

Konsol: **App Store Connect → App → App Privacy**.

### 4.1 Tracking

**«Do you or your third-party partners use data for tracking purposes?» → No.**

Səbəb: reklam şəbəkəsi yoxdur, data brokerə heç nə verilmir, başqa şirkətlərin tətbiq/saytları ilə birləşdirilən identifikator yoxdur, IDFA oxunmur. `expo-tracking-transparency` paketi layihədə **yoxdur** — yəni ATT paneli göstərmək üçün kod da yoxdur, ehtiyac da.

Nəticə: aşağıdakı hər sətirdə **«Used for Tracking» = No**.

### 4.2 Data types

| Apple kateqoriyası | Data type | Collected | Linked to You | Tracking | Purpose |
|---|---|---|---|---|---|
| Contact Info | **Name** | Yes | **Yes** | No | `App Functionality` |
| Contact Info | **Email Address** | Yes | **Yes** | No | `App Functionality` |
| Contact Info | Phone Number | **No** | — | — | — |
| Health & Fitness | **Fitness** | Yes | **Yes** | No | `App Functionality` |
| Health & Fitness | Health | **No** | — | — | — |
| Location | **Precise Location** | Yes | **No** | No | `App Functionality` |
| Location | Coarse Location | No | — | — | — |
| User Content | **Photos or Videos** | Yes | **Yes** | No | `App Functionality` |
| User Content | **Emails or Text Messages** | Yes | **Yes** | No | `App Functionality` |
| User Content | **Other User Content** | Yes | **Yes** | No | `App Functionality` |
| Identifiers | **User ID** | Yes | **Yes** | No | `App Functionality` |
| Identifiers | **Device ID** | Yes | **Yes** | No | `App Functionality` |
| Usage Data | **Product Interaction** | Yes | **Yes** | No | `App Functionality` |
| Other Data | **Other Data Types** | Yes | **Yes** | No | `App Functionality` |
| Financial Info · Purchases | — | **No** | — | — | — |
| Contacts · Browsing History · Search History | — | **No** | — | — | — |
| Diagnostics (hamısı) | — | **No** | — | — | — |
| Sensitive Info | — | **No** | — | — | — |

**İzahlar:**

- **«Emails or Text Messages»** — Apple tətbiqdaxili yazışmanı bu kateqoriyada istəyir. Bu, SPOT-un öz çatıdır; e-poçt oxumuruq.
- **«Other User Content»** — bio, şərh, post, rəy, sorğu qeydləri, sertifikat faylı, VÖEN.
- **«Product Interaction»** — `last_active_at` + bəyənmə/saxlama/izləmə kimi hərəkətlər.
- **«Device ID»** — Expo push tokeni.
- **«Other Data Types»** — yaş, cins, məşq məqsədi, səviyyə, üstünlük verilən məşq saatı və zal sahibinin VÖEN-i. Apple-ın siyahısında bunlar üçün uyğun kateqoriya yoxdur; boş qoymaqdansa bura yazmaq doğrudur.
- **«Precise Location» → «Linked to You» = No.** Koordinat heç bir sətirə yazılmır, ona görə istifadəçi kimliyinə bağlanmış heç nə qalmır (§2.6).

> **Qeyd (dürüstlük üçün):** Apple-ın öz tərifinə görə «collect» = məlumatı cihazdan çıxarıb **sorğuya real vaxtda xidmət etmək üçün lazım olan müddətdən uzun** saxlamaq. `gyms_near()` koordinatı məhz real vaxtda işlədib atır — yəni bu istisnaya tam uyğun gəlir və lokasiyanı **ümumiyyətlə bəyan etməmək** də müdafiə oluna bilən mövqedir. Yuxarıdakı cədvəldə yenə də **bəyan etməyi** seçmişəm: artıq bəyan etmək heç vaxt rədd səbəbi olmur, az bəyan etmək isə olur. Qərar sənindir.

---

## 5. Üçüncü tərəflər

| Kim | Nə alır | Rolu | Mağaza formasında |
|---|---|---|---|
| **Supabase** (Postgres, Auth, Storage) | §2.2-dəki hər şey | Emal edən (processor / service provider) | «Shared» deyil |
| **Expo push service** (`exp.host`) | Push tokeni + bildirişin **başlığı və mətni** | Emal edən | «Shared» deyil |
| **FCM (Google)** / **APNs (Apple)** | Expo-nun ötürdüyü bildiriş | Emal edən | «Shared» deyil |
| **OpenStreetMap** (`tile.openstreetmap.org`) | Xəritə taylları istənərkən: IP + baxılan sahənin koordinatları | Müstəqil xidmət | bax §7, açıq sual №3 |
| **unpkg.com** | Leaflet JS/CSS yüklənərkən: IP | CDN | bax §7, açıq sual №3 |

**Bildirişin içində nə gedir:** `schema61_push.sql` bunu qəsdən məhdudlaşdırıb — «Carries a name and an event, never content: no message text, no comment, no review body. A lock screen is read by whoever holds the phone.» Yəni Expo/FCM/APNs **mesajın mətnini görmür**, yalnız «X sənə mesaj yazdı» tipli bildirişi görür.

**Hara saxlanılır:** Supabase layihəsi hazırda **`ap-southeast-2` (Sidney)** regionundadır (`supabase/REGION_MIGRATION.md`). İstifadəçilər Azərbaycandadır. Bu, formalarda soruşulmur, amma məxfilik siyasətində yazılmalıdır — və orada artıq yazılıb.

---

## 6. Hesab silmə

### 6.1 Tətbiqin bu gün verdiyi

**Profil → Məxfilik → Hesabı sil** → `deleteMyAccount()` (`src/lib/api.ts:1322`). Ardıcıllıq:

1. `my_storage_objects()` RPC-si ilə həmin istifadəçinin **bütün faylları** tapılır (avatar, zal fotoları, videolar, sertifikatlar) və Storage-dan silinir. Bir fayl silinməsə, proses **dayanır** — yarımçıq silmə baş vermir.
2. `delete_my_account()` RPC-si: videolar, postlar, şərhlər, proqramlar, bloklar, profil sətri silinir; sonra `auth.users` sətri silinir — yəni Google/Apple/e-poçt kimliyi də gedir.
3. CASCADE ilə gedənlər: `workouts`, `prs`, `progress`, `check_ins`, `chat_threads` → `messages`, `push_tokens`, `follows`, `blocks`, `notifications`, bütün bəyənmə/saxlama cədvəlləri, `match_requests`, `trainer_requests`, `student_programs`, `trainers` → `trainer_verifications`.

**Silinməyən, amma kimliksizləşən (dürüstlük naminə yazılır):**

| Nə qalır | Niyə |
|---|---|
| `reviews` — rəyin mətni, `author_id` → NULL | Zalın reytinqi başqa insanların da gördüyü ümumi məlumatdır |
| `reports` — şikayət mətni, `reporter_id` → NULL | Moderasiya qeydi |
| `day_passes` — kod və vaxtlar, `user_id` → NULL | Zal sahibinin ziyarət qeydi |
| `gym_claims` — **VÖEN** daxil, `claimant_id` → NULL | `gym_claims.claimant_id` `auth.users`-a qarşı SET NULL-dur; moderasiya qeydi kimi qalır. Yalnız admin oxuya bilir. Canlı bazada 0 sətir |
| Siyahıya salınmış zal (əgər bu adam zal sahibi idisə) | Başqa insanlar ondan asılıdır; sahibi ayrılır, foto sütunları təmizlənir |

**Düzəlişə ehtiyacı olan bir nöqtə (kod, mən toxunmuram):** `reviews.author_id` SET
NULL-dur, amma `reviews.name` ayrıca sütundur — `reviews_stamp` triggeri onu rəy
yazılanda profildən köçürür və `delete_my_account()` onu təmizləmir. `reviews_read` isə
açıqdır. Yəni **silinmiş hesabın adı zalın rəyində qalır**, halbuki tətbiqin öz təsdiq
dialoqu («Zala yazdığın rəy qalır, amma adın çıxarılır») bunun əksini vəd edir. Bir sətir
həll edir: `update public.reviews set name = null where author_id = pid;`.
`store/legal/delete-account.html` bu gün baş verəni yazır (ad qalır), düzəliş olandan
sonra o da yenilənməlidir. **23.09.2026 vəziyyəti:** ağacda artıq
`supabase/schema85_review_name_on_delete.sql` faylı var, amma **tətbiq olunmayıb** —
canlı funksiyada həmin `update` sətri yoxdur.

**Bir də admin haqqında:** `moderation_actions.admin_id` `auth.users`-a qarşı
**RESTRICT**-dir, `delete_my_account()` isə `delete from auth.users` ilə bitir. Yəni
admin hesabı (canlı bazada 1 sətir) ilk şikayəti həll etdiyi andan etibarən öz hesabını
silə bilmir — tətbiq düzgün olaraq «Hesab silinmədi» deyir. Bu gün `moderation_actions`
boşdur, ona görə problem yatmış vəziyyətdədir; mağaza formasındakı «Users can request
that their data be deleted = Yes» adi istifadəçi üçün doğru qalır.

**Nəticə (hər iki forma üçün):** «Users can request that their data be deleted» = **Yes**, və bu, həm hesabın, həm də datanın silinməsidir.

### 6.2 Play-in tələb etdiyi VEB ÜNVAN — hazır deyil

Google Play qaydası: hesab yaratmağa imkan verən tətbiq **həm tətbiqdaxili silmə yolu**, **həm də tətbiqi yenidən qurmadan çatılan veb ünvan** verməlidir. Tətbiqdaxili hissə var; **veb ünvan yoxdur** — bu, göndərməni bloklayan maddədir.

Səhifədə olmalıdır (üç dildə — az/ru/en):

| az | ru | en |
|---|---|---|
| SPOT hesabını silmək | Удалить аккаунт SPOT | Delete your SPOT account |
| Hesabını tətbiqdən sil: Profil → Məxfilik → Hesabı sil. | Удали аккаунт прямо в приложении: Профиль → Конфиденциальность → Удалить аккаунт. | Delete your account in the app: Profile → Privacy → Delete account. |
| Tətbiqə girə bilmirsənsə, bu ünvana yaz — 30 gün ərzində silirik: {contact} | Если не можешь войти в приложение, напиши нам — удалим в течение 30 дней: {contact} | If you cannot get into the app, write to us and we will delete it within 30 days: {contact} |
| Silinən: profilin, məşqlərin, check-in-lərin, yazışmaların, videoların, şərhlərin, yüklədiyin fayllar və hesab kimliyin. | Удаляются: профиль, тренировки, чек-ины, переписки, видео, комментарии, загруженные файлы и сам аккаунт. | Deleted: your profile, workouts, check-ins, chats, videos, comments, uploaded files and the account identity itself. |
| Silinmir: yazdığın zal rəyləri və şikayətlər — onlar adsızlaşdırılır. | Не удаляются: твои отзывы о залах и жалобы — они обезличиваются. | Not deleted: your gym reviews and reports — they are anonymised. |
| Silinmə geri qaytarılmır. | Удаление необратимо. | Deletion cannot be undone. |

> Qlossariyə uyğunluq yoxlanılıb: `zal` = зал = gym; rus dilində «ты» işlədilib.

---

## 7. Açıq suallar — yalnız sən cavab verə bilərsən

1. **Əlaqə e-poçtu.** Rəsmi gmail hələ yoxdur (özün dedin). Bu ünvan **üç yerdə** lazımdır və heç birində boş qala bilməz: (a) Play «Data safety» → hesab silmə səhifəsi, (b) App Store Connect → Support URL və məxfilik siyasəti, (c) tətbiqin öz sənədlərindəki `CONTACT` sahəsi — `src/lib/legal.ts`-də hazırda hərfi mənada `[DOLDURULMALI: əlaqə e-poçtu]` yazılır və ekranda **belə də görünür**. Eyni fayldakı `OPERATOR` (şirkətin/şəxsin rəsmi adı) da boşdur. Nə qoyulacağını yalnız sən deyə bilərsən.

2. **Məxfilik siyasəti üçün veb ünvan.** Hər iki mağaza **URL** istəyir; tətbiqdaxili ekran (`src/app/legal`) buna əvəz deyil. Səhifələr artıq yaradılıb (`store/legal/privacy.html` və §6.2-dəki `delete-account.html`, üçü də üç dildə) — qalan iş domen seçmək və `web/landing` ilə birlikdə yayımlamaqdır (`store/legal/README.md` §3). Diqqət: landing-in nginx konfiqurasiyası mövcud olmayan yola **200 ilə landing səhifəsini** qaytarır, ona görə yayımdan sonra üç URL-in hər birini açıb yoxlamaq lazımdır, yoxsa yoxlayıcı məxfilik siyasəti əvəzinə reklam səhifəsi görər.

3. **Xəritə üçüncü tərəfləri.** Xəritə `WebView` içində **unpkg.com**-dan Leaflet, **tile.openstreetmap.org**-dan tayl yükləyir (`src/components/SpotMap.tsx:102–111`). Bu o deməkdir ki, insan xəritəni açanda IP-si və baxdığı sahənin koordinatları həmin serverlərə gedir. (a) **Edildi:** hər ikisi (və Expo push xidməti) məxfilik siyasətinə yazıldı — həm tətbiqdə, həm saytda. (b) Play formasında «Shared» kimi bəyan edək, yoxsa yox — bu hələ səndən asılıdır. Mənim oxuduğuma görə bu, tətbiqin **göndərdiyi** data deyil, brauzerin adi resurs sorğusudur və adətən bəyan edilmir — amma bu, hüquqi qərardır, kod qərarı deyil. Əlavə qeyd: unpkg.com sıradan çıxsa, xəritə ümumiyyətlə açılmır.

4. ~~**Video metadatası.**~~ **HƏLL OLUNDU (23.09.2026)** — həm lentdəki, həm proqrama bağlanan videodan çəkiliş yeri telefonda, fayl serverə getməzdən əvvəl silinir (§2.7). Formada `Videos` altında lokasiya bəyan etməyə ehtiyac yoxdur.

5. **`day_passes` və «Purchase history».** Mən **No** yazdım, çünki tətbiqdən bir qəpik də keçmir. Amma cədvəldə `status`, `refunded_at`, `refund_reason` sütunları var — bunlar mövcud olmayan bir ödəniş modelindən qalıb. Əgər hüquqi olaraq ehtiyatlı davranmaq istəyirsənsə, `Purchase history` = Yes yazmaq da olar (bu, rədd riski yaratmır). Mənim tövsiyəm: **No**, çünki doğrusu budur.

6. **SMTP.** E-poçtla giriş (magic link) Supabase Auth-un e-poçt göndəricisi ilə işləyir. Öz SMTP-n qoşulubmu, yoxsa Supabase-in standart (sərt limitli, istehsalat üçün nəzərdə tutulmayan) göndəricisi işləyir — bunu mən bazadan oxuya bilmirəm. Əgər standartdırsa, real istifadəçilərdə e-poçtla giriş **susacaq**.

7. **Çəki ekranı qayıdarsa.** §2.5-ə görə bu gün `Health info` = No / Apple `Health` = No. Çəki yazma geri gələn kimi hər iki forma yenilənməlidir — yoxsa forma yalan olur.

8. **Region.** Data Sidneydədir. Azərbaycan və ya AB istifadəçiləri üçün hüquqi tələb varsa, bu, məxfilik siyasətində artıq yazılıb, amma köçürmə qərarı səndədir (`supabase/REGION_MIGRATION.md`).

---

## 8. Kodla formanın ziddiyyəti — göndərməzdən əvvəl düzəldilməli

Hər biri **mağaza yoxlayıcısının görə biləcəyi** uyğunsuzluqdur. Siyahı ilk yazılanda `src/` bu tapşırığın hüdudundan kənarda idi; 23.09.2026-da 1, 2, 3 və 6 mənbədə düzəldildi və üstündən xətt çəkildi. Qalanları (4, 5, 7) sənin qərarındır.

1. ~~**iOS lokasiya mətni artıq doğru deyil.**~~ **DÜZƏLDİLDİ (23.09.2026).** Mətn check-in-in 150 metr radiusundan danışırdı; check-in schema74-dən bəri QR ilədir və lokasiyadan ümumiyyətlə istifadə etmir. `app.json`-da indi:
   `"NSLocationWhenInUseUsageDescription": "Yaxınlıqdakı zalları məsafəyə görə sıralamaq üçün yerini soruşuruq. Koordinatın heç bir cədvələ yazılmır."`

> **Yenilik (23.09.2026):** aşağıdakı 2-ci, 3-cü və 6-cı maddələr **mənbədə
> düzəldilib** — `src/lib/legal.ts` və `i18n/translations.json` yenilənib,
> `store/legal/*.html` yenidən yaradılıb, `build.mjs`-dəki `CORRECTIONS` cədvəli
> isə boşaldılıb. Yəni tətbiqin ekranı ilə sayt artıq eyni mətni göstərir — bir
> sənədin iki müxtəlif versiyası qalmadı.

2. ~~**Məxfilik siyasətində iki yanlış cümlə**~~ — **DÜZƏLDİLDİ (23.09.2026),** həm tətbiqdə, həm saytda (`src/lib/legal.ts`):
   - «Check-in anında telefonun yerini zalın koordinatı ilə müqayisə edirik» və «check-in zamanı zalda olduğunu yoxlamaq» — **artıq doğru deyil** (QR).
   - «Bədən: qeyd etdiyin çəki və istəsən **progress fotoları**» — progress fotosu funksiyası **yoxdur**. Kodda yalnız `spot-progress-photos` adlı, heç kimin yazmadığı ölü AsyncStorage açarı qalıb (`privacy.tsx:21`). Çəki də bu gün yazılmır (§2.5).
   Tətbiqin öz qaydası — «heç vaxt olmayan şeyi iddia etmə» — məhz burada pozulur, üstəlik pozulan sənəd məxfilik siyasətidir.

3. ~~**Telefon nömrəsi haqqında cümlə.**~~ **ÇIXARILDI (23.09.2026).** Siyasət «Telefon nömrəsi (əgər yazmısansa) — yalnız sənə görünür» deyirdi. Əslində telefonla giriş silinib, canlı bazada 0 nömrə var və `profiles.phone` sütunu heç bir müştəri roluna oxuma üçün verilməyib — yəni **sənin özünə də görünmür**. Cümlə hər üç fayldan tamamilə çıxarıldı.

4. **`OPERATOR` / `CONTACT` boşdur** — ekranda `[DOLDURULMALI: ...]` kimi görünür (§7.1).

5. **iOS mikrofon mətni.** `NSMicrophoneUsageDescription` var, amma `expo-camera` üçün `microphonePermission: false` qoyulub və Android-də `RECORD_AUDIO` bloklanıb. Mətn `ImagePicker.launchCameraAsync` səsli video çəkdiyi üçün texniki olaraq lazımdır — sadəcə bilərək saxlandığını yoxla, yoxsa Apple «istifadə olunmayan icazə» sualı verə bilər.

6. ~~**Şərtlərdə olmayan funksiya.**~~ **DÜZƏLDİLDİ (23.09.2026).** İstifadə şərtləri «Tətbiqdəki proqramlar, çəki təklifləri və **qidalanma nümunələri** tibbi məsləhət deyil» deyirdi. Qidalanma hissəsi silinib — `NutritionToday`, kalori/protein/su hesablamaları `src/store/db.ts`-dən çıxarılıb. Hüquqi risk yaratmır (olmayan şeyi inkar edir), amma tətbiqin öz qaydasını pozur. İndi hər iki yerdə düzgündür.

7. **Android icazələri — 1.3.9 AAB-ının özündən oxundu (25.09.2026).** Play mənbə faylını yox, **birləşmiş** manifesti göstərir, ona görə siyahı `base/manifest/AndroidManifest.xml`-dən çıxarılıb:

   `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_NETWORK_STATE`, `BIND_JOB_SERVICE`, `CAMERA`, `DUMP`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `READ_APP_BADGE`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `WAKE_LOCK`.

   Lokasiya və kamera tətbiqin özünündür (xəritə, QR); qalanları kitabxanalardan gəlir — bildirişlər (`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `BIND_JOB_SERVICE`, `READ_APP_BADGE`), səs (`MODIFY_AUDIO_SETTINGS`) və React Native (`ACCESS_NETWORK_STATE`, `DUMP`).

   **`FOREGROUND_SERVICE` və `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 1.3.9-da çıxarıldı** (expo-audio-nun media servisi ilə birlikdə). Onlar qalsaydı, Play **Foreground Service bəyannaməsi** və istifadəni göstərən video tələb edəcəkdi — SPOT-da isə fon səsi yoxdur, yəni dürüst cavab verə bilməzdik. `android:allowBackup` da `false`-dur: Android yedəyi AsyncStorage-i, o isə Supabase sessiya tokenini aparırdı.

   `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` `app.json`-dakı `blockedPermissions` ilə çıxarılıb və birləşmiş manifestdə **yoxdur**. **`READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` də yoxdur**, ona görə Play-in «Photo and Video Permissions» deklarasiya forması bu build üçün tələb olunmur — `expo-image-picker` foto seçicisini (Photo Picker) işlədir, o isə icazə istəmir. Hər native build-dən sonra bu siyahını AAB-dan yenidən oxu.

---

## 9. Bunu formaya köçürərkən

- Play formasını **hər yeni funksiyadan sonra** yenidən oxu: Play, formanın buildlə üst-üstə düşməsini tələb edir və uyğunsuzluq tətbiqi siyahıdan çıxara bilər.
- Apple-da «App Privacy» **buildə bağlı deyil** — istənilən vaxt dəyişdirilir, amma review zamanı yoxlanılır.
- Hər iki formada boş qoyulan sual «No» demək deyil: Play formanı natamam sayır və göndərməyə qoymur.
