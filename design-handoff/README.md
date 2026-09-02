# SPOT — iOS Fitness Community App · Developer Spesifikasiyası

**Versiya:** 1.0 · **Tarix:** 30 avqust 2026 · **Dizayn faylı:** `SPOT iOS App.dc.html`
**Bu sənəd kimin üçündür:** iOS developer, backend developer, QA. Dizayn faylı vizual həqiqətin mənbəyidir (source of truth); bu sənəd davranış, data və biznes məntiqinin mənbəyidir. İkisi ziddiyyət təşkil edərsə, davranış üçün bu sənəd, görünüş üçün dizayn faylı əsas götürülür.

### Sənəd dəsti

| Fayl | Nə var |
|---|---|
| `README.md` (bu fayl) | Məhsul, rollar və icazə matrisi, data modeli, biznes qaydaları, monetizasiya, qəbul kriteriyaları, yol xəritəsi |
| **`INTERACTIONS.md`** | **Button-by-button spesifikasiya:** hər ekranın hər elementi → nə baş verir, hansı ekran açılır, hansı API çağırılır, hansı vəziyyətlər mümkündür. Üstəgəl deep link xəritəsi və haptic xəritəsi |
| `SPOT iOS App.dc.html` | 19 axın, 80+ ekran vizual olaraq + hər ekranın altında dizayn qeydi |
| `SPOT Landing.dc.html` | Təqdimat sayti (marketinq) — 1440px desktop, hero → problem → necə işləyir → funksiyalar → müəllim/zal tərəfi → qiymət → FAQ → CTA |
| `SPOT Admin Panel.dc.html` | Veb admin panel — 10 ekran, 1440×900 |

**İmplementasiya sırası:** ekranı `INTERACTIONS.md`-dən oxu → qaydanı `README.md`-dən yoxla → görünüşü dizayn faylından götür.

---

## 1. Məhsul haqqında

### 1.1 Problem

Azərbaycanda idman zalı və məşqçi axtarışı Instagram üzərində gedir: istifadəçi onlarla səhifəni gəzir, qiymətləri DM-də soruşur, zalın real vəziyyətini görmür, müəllimin həqiqi təcrübəsini yoxlaya bilmir. Zala yazılandan sonra ikinci problem başlayır: müəllim tutmağa pul çatmır və istifadəçi zalda nə edəcəyini bilmir — hərəkətləri səhv icra edir, zədə alır və 2-3 həftədən sonra tərk edir. Üçüncü problem motivasiyadır: tək məşq edən adam ardıcıllığı saxlaya bilmir.

### 1.2 Həll

SPOT üç problemi bir məhsulda həll edir:

1. **Kataloq və şəffaflıq.** Bütün zallar bir yerdə: qiymət, iş saatı, avadanlıq, foto, müəllim siyahısı, üzv siyahısı, doğrulanmış rəylər. İstifadəçi zalın real üzvünə birbaşa sual yaza bilir.
2. **Rəhbərlik.** Hər hərəkətin video formu olan proqramlar. Proqramı hər kəs yarada bilər, amma yaradıcının kimliyi (doğrulanmış müəllim / adi istifadəçi) hər yerdə görünür. Qida planı proqramın hissəsidir.
3. **Community.** Eyni zala, eyni saatlara gedən, səviyyəsi və məqsədi uyğun insanların bir-birini tapması; challenge-lər, zal leaderboard-u, progress paylaşımı və struktur feedback.

### 1.3 Məhsulun sərhədi (çox vacib)

**SPOT tanışlıq (dating) platforması deyil.** Bu qərar məhsulun hər qatına yeridilib və developer da bunu qorumalıdır:

- Uyğunluq faizi **yalnız** məşq parametrlərindən hesablanır: zal, saat aralığı, günlər, səviyyə, məqsəd, məşq tipi. Foto, cins və yaş **heç bir çəki daşımır** (yaş yalnız filtr kimi mövcuddur).
- Profil UI-da foto qalereyası yoxdur; bir avatar + məşq datası var.
- Əsas hərəkət düyməsi «ürək» deyil, «Birlikdə məşq» / «Məşq təklif et»-dir.
- Match ekranı söhbətə deyil, konkret məşq vaxtı təklif etməyə yönləndirir.
- İcma qaydaları ekranının ilk cümləsi bu sərhədi elan edir.

### 1.4 Uğur metrikaları (MVP)

| Metrika | Hədəf | Ölçmə |
|---|---|---|
| D1 retention | ≥ 45% | onboarding bitirən istifadəçinin növbəti gün açması |
| D30 retention | ≥ 22% | — |
| İlk 7 gündə check-in | ≥ 60% | QR və ya manual check-in |
| İlk 14 gündə ≥ 1 match | ≥ 30% | qarşılıqlı qəbul edilmiş yoldaşlıq |
| Yoldaşı olan istifadəçinin həftəlik məşq sayı | tək məşq edəndən ≥ 1.4× çox | — |
| Zal profilindən üzvlüyə keçid | ≥ 8% | day-pass və ya «Üzv ol» tapı |

**Əsas hipotez:** məşq yoldaşı olan istifadəçi 2 dəfə uzun qalır. Bütün prioritetləşdirmə bu hipotezə xidmət edir.

---

## 2. İstifadəçi tipləri və icazə matrisi

Üç rol var. Rol istifadəçi obyektinin sahəsidir, ayrı app yoxdur — müəllim və zal admini eyni app-də «rejim dəyişdirici» ilə keçid edir (Profil → Rejim).

### 2.1 `user` (adi istifadəçi)
Zal axtarır, proqramla məşq edir, yoldaş tapır, feed-də paylaşır, challenge-də iştirak edir. Pulsuz proqram yarada bilər (ödənişli yox).

### 2.2 `trainer` (müəllim)
`user`-in bütün imkanları + müəllim paneli: şagird siyahısı, təqvim, rezervasiya idarəsi, gəlir, şagird proqramının redaktəsi. **Doğrulanma tələb olunur** üç sənədlə:
1. Şəxsiyyət vəsiqəsi (avtomatik + əl ilə yoxlama)
2. Məşqçi sertifikatı (əl ilə yoxlama)
3. **Zal təsdiqi** — zal admini müəllimin orada çalışdığını təsdiqləyir

Doğrulanmamış müəllim profil yarada və pulsuz proqram paylaşa bilər, amma: «Doğrulanmayıb» etiketi daşıyır, rezervasiya/təqvim funksiyası bağlıdır, ödənişli proqram sata bilmir, axtarışda aşağı sıralanır.

### 2.3 `gym_admin` (zal sahibi/admini)
Zal profilini idarə edir, QR kod yaradır, day-pass satır, dərs cədvəli qurur, üzv statistikasını görür, rəylərə rəsmi cavab yazır, müəllimləri təsdiqləyir. Zal profilinə sahiblik **claim** prosesi ilə keçir (VÖEN sənədi + zalın nömrəsinə zəng kodu + zal içindən lokasiyalı selfie).

### 2.4 İcazə matrisi — kim nəyi görür

| Data | user (özü) | başqa user | trainer (şagirdinin) | gym_admin (üzvünün) |
|---|---|---|---|---|
| Ad, avatar, yaş, bio | ✓ | ✓ (görünürlük parametrindən asılı) | ✓ | ✓ |
| Səviyyə, məqsəd, qrafik | ✓ | ✓ | ✓ | ✗ |
| Şəxsi rekordlar (PR) | ✓ | parametrə görə (default açıq) | ✓ | ✗ |
| Məşq qeydləri (set/çəki) | ✓ | ✗ | ✓ (yalnız aktiv paket müddətində) | ✗ |
| Çəki, ölçülər, yağ % | ✓ | ✗ | ✓ (istifadəçi icazə verərsə) | ✗ |
| Progress fotoları | ✓ | ✗ (default) | ✗ (ayrıca icazə) | ✗ |
| Söhbətlər | ✓ | ✗ | ✗ | ✗ |
| Check-in tezliyi | ✓ | «indi zalda» statusu | ✓ | ✓ (yalnız tezlik) |
| Telefon nömrəsi | ✓ | ✗ | ✗ | ✗ |
| Dəqiq lokasiya | — | ✗ | ✗ | ✗ |

**Qırmızı xətt:** zal admini üzvün çəkisini, məşq detallarını və söhbətlərini heç bir halda görmür. Zal sahibi rəyi **silə bilmir** — yalnız cavab yaza bilər.

---

## 3. Texniki tövsiyə

- **iOS:** SwiftUI, iOS 17+ minimum (iOS 18 hədəf). MVVM. Naviqasiya: `NavigationStack` + `TabView`.
- **Backend:** REST + WebSocket (söhbət və «indi zalda» üçün). PostgreSQL + PostGIS (məkan sorğuları), Redis (canlı check-in vəziyyəti, leaderboard cache).
- **Video:** obyekt saxlama (S3-uyğun) + HLS transkodlaşdırma. Hərəkət videoları ≤ 30 san, ≤ 8 MB (720p). Feed videoları ≤ 90 san.
- **Push:** APNs. Bildiriş kateqoriyaları (P1/P2/P3) server tərəfdə saxlanılır.
- **Ödəniş:** yerli PSP (kart) + Apple Pay. **Diqqət:** rezervasiya və day-pass fiziki xidmətdir → Apple IAP tələb etmir. **SPOT+ rəqəmsal abunədir → mütləq StoreKit 2 / IAP ilə olmalıdır**, əks halda App Store rədd edir.
- **Sağlamlıq:** HealthKit (oxu: nəbz, kalori; yazı: məşq sessiyası).
- **Oflayn:** lokal baza (SwiftData/CoreData) + sinxron növbəsi.
- **Analitika:** hadisə əsaslı (bölmə 11).
- **Lokalizasiya:** AZ (əsas), sonra RU, EN. Bütün mətnlər `Localizable.xcstrings`-də, hardcode qadağan.

---

## 4. İnformasiya arxitekturası

### 4.1 Alt naviqasiya — 4 tab (owner qərarı)

1. **Kəşf** — segmentli axtarış: Zallar · Müəllimlər · Yoldaşlar. Xəritə görünüşü, filtrlər, zal profili, rəylər, müəllim profili, rezervasiya.
2. **Məşq** — bugünkü plan, proqram kitabxanası, hərəkət kitabxanası, aktiv məşq, qida planı, evdə məşq, proqram yaratma.
3. **Feed** — iki üz: *Videolar* (şaquli scroll) və *Zalım* (icma postları, challenge-lər).
4. **Profil** — məşq datası, progress, nailiyyətlər, tarixçə, analitika, parametrlər.

**Söhbət tab deyil** — Kəşf, Məşq və Feed başlığındaki ikon ilə açılır (oxunmamış badge ilə). Səbəb: iOS-da 5 tab sıxdır və söhbət əsas iş axını deyil, əlaqə kanalıdır.

Rejimlər üzrə tab bar dəyişir:
- `trainer` rejimi: Panel · Şagirdlər · Proqramlar · Söhbət
- `gym_admin` rejimi: Panel · Üzvlər · Dərslər · Rəylər

### 4.2 Axınların siyahısı (dizayn faylındaki nömrələmə)

1. Onboarding (10 ekran) · 2. Kəşf/zallar (9) · 3. Müəllim və rezervasiya (4) · 4. Məşq yoldaşı (6) · 5. Məşq və proqramlar (8) · 6. Qida (3) · 7. Feed (5) · 8. Challenge (3) · 9. Söhbət və təhlükəsizlik (4) · 10. Profil və parametrlər (5) · 11. Bildirişlər/widget (4) · 12. Sistem vəziyyətləri (5) · 13. Müəllim paneli (5) · 14. Zal paneli (4) · 15. Abunə və ödənişlər (4) · 16. Evdə məşq və hərəkət kitabxanası (3) · 17. Qrup dərsləri (3) · 18. Nailiyyətlər və analitika (3) · 19. Dəstək və moderasiya (4).

---

## 5. Data modeli

Aşağıda əsas obyektlər və kritik sahələr. Bütün id-lər UUID, bütün tarixlər ISO 8601 UTC.

### 5.1 `User`
`id`, `phone` (unikal, heç vaxt publik deyil), `apple_sub`, `name`, `birth_year`, `gender` (`male|female|other|undisclosed`), `avatar_url`, `bio` (≤140), `role` (`user|trainer|gym_admin`), `home_gym_id?`, `level` (`beginner|intermediate|advanced`), `goals[]` (`muscle|fat_loss|strength|conditioning|health|rehab`, maks 2), `training_types[]` (`weights|cardio|crossfit|boxing|yoga|swimming|home`), `schedule_days[]` (0–6), `schedule_slots[]` (`morning|midday|evening|late`), `visibility` (bölmə 5.9), `streak_current`, `streak_best`, `created_at`, `deleted_at?`.

### 5.2 `Gym`
`id`, `name`, `district`, `location` (PostGIS point), `photos[]`, `price_monthly`, `price_daypass`, `price_yearly?`, `hours` (həftə üzrə açılış/bağlanış), `amenities[]` (`free_weights|cardio|shower|pool|sauna|boxing_ring|parking|women_zone`), `women_only` (bool), `is_verified` (claim olunub), `owner_user_id?`, `qr_secret`, `rating_avg`, `rating_count`, `member_count`, `daypass_enabled`, `member_list_visible`.

### 5.3 `GymMembership`
`id`, `gym_id`, `user_id`, `type` (`monthly|yearly|daypass|unknown`), `started_at`, `expires_at?`, `source` (`spot|external`), `share_with_gym` (bool — admin statistikada görsün).

### 5.4 `TrainerProfile`
`user_id`, `gym_ids[]`, `specialties[]`, `experience_years`, `bio_long`, `verification` (`{id_doc, certificate, gym_approval}` hər biri `pending|approved|rejected` + tarix), `response_time_minutes` (hesablanır), `rating_avg`, `rating_count`, `packages[]`, `intro_video_url?`, `payout_method`.

### 5.5 `TrainerPackage`
`id`, `trainer_id`, `type` (`single|bundle|online|duo`), `sessions_count`, `price`, `duration_minutes`, `includes[]`, `active`.

### 5.6 `Booking`
`id`, `trainer_id`, `client_user_id`, `package_id`, `gym_id`, `starts_at`, `duration_minutes`, `status` (`pending|confirmed|completed|cancelled_by_client|cancelled_by_trainer|no_show|refunded`), `price`, `commission_amount`, `client_note?`, `sessions_used`, `sessions_total`, `duo_partner_user_id?`.

### 5.7 `Exercise` (kataloq, mərkəzi idarə olunur)
`id`, `name_az`, `aliases[]`, `muscle_primary`, `muscles_secondary[]`, `equipment[]`, `level`, `video_url`, `video_side_url?`, `steps[]` (3–5 addım), `common_mistake`, `substitutes[]` (exercise_id + səbəb), `is_bodyweight`.

### 5.8 `Program` / `ProgramDay` / `ProgramExercise`
`Program`: `id`, `title`, `author_user_id`, `author_type` (`verified_trainer|user`) — **UI-da hər yerdə göstərilməlidir**, `level`, `goals[]`, `location` (`gym|home|both`), `days_per_week`, `weeks`, `price` (0 = pulsuz; >0 yalnız doğrulanmış müəllim), `nutrition_plan_id?`, `rating_avg`, `active_users_count`, `status` (`draft|published|hidden`).
`ProgramDay`: `program_id`, `index`, `title`, `focus`.
`ProgramExercise`: `day_id`, `order`, `exercise_id`, `sets`, `reps_min`, `reps_max`, `rest_seconds`, `target_weight?`, `note?`.

### 5.9 `UserSettings.visibility`
`discoverable` (yoldaş axtarışında görün), `show_at_gym` (check-in-dən sonra 2 saat), `private_profile` (SPOT+), `who_can_message` (`matches|gym_members|everyone`), `show_prs`, `progress_photos` (`only_me|matches|public`), `leaderboard_name` (`full|initial|hidden`).

### 5.10 `CheckIn`
`id`, `user_id`, `gym_id`, `method` (`qr|manual_gps`), `created_at`, `expires_at` (= created_at + 2 saat, «indi zalda» pəncərəsi), `verified` (bool — QR həmişə true, GPS şərti).

### 5.11 `WorkoutSession`
`id`, `user_id`, `program_day_id?`, `gym_id?`, `started_at`, `ended_at`, `total_volume_kg`, `sets[]` (`exercise_id, set_index, weight, reps, completed_at, is_pr`), `rpe` (`easy|ok|hard`), `partner_user_ids[]`, `source` (`gym|home|class`), `synced` (oflayn üçün).

### 5.12 `MatchRequest` / `Match`
`MatchRequest`: `from_user_id`, `to_user_id`, `type` (`workout_invite|question`), `proposed_slot?`, `message?`, `status` (`pending|accepted|declined|expired`), `created_at`, `expires_at` (7 gün).
`Match`: `user_a`, `user_b`, `created_at`, `compatibility_score`, `reasons[]`, `chat_id`, `status` (`active|unmatched|blocked`).

### 5.13 `Challenge` / `ChallengeParticipant`
`Challenge`: `id`, `scope` (`personal|gym|inter_gym`), `gym_id?`, `title`, `metric` (`workout_count|volume_kg|streak_days|specific_exercise`), `target`, `starts_at`, `ends_at`, `reward_text`, `created_by`.
`ChallengeParticipant`: `challenge_id`, `user_id`, `progress`, `rank`, `updated_at`.

### 5.14 Digərləri
`Review` (gym/trainer/program üçün, `subcategory_ratings{}`, `checkin_months` — doğruluq etiketi), `Post` (progress/video/text, `visibility`), `Comment`, `Chat`, `Message`, `Notification`, `Payment`, `Payout`, `Report`, `Class` (qrup dərsi), `ClassBooking`, `NutritionPlan`/`Meal`, `Achievement`/`UserAchievement`.

---

## 6. Əsas biznes məntiqləri

### 6.1 Uyğunluq (compatibility) alqoritmi

Skor 0–100. Yalnız məşq parametrləri. Cins və foto istifadə edilmir.

```
score = 30 * gym_match          // eyni zal = 1.0; 2 km daxilində fərqli zal = 0.5; uzaq = 0
      + 25 * schedule_overlap   // kəsişən gün×slot sayı / istifadəçinin ümumi slot sayı
      + 15 * level_proximity    // eyni = 1.0; 1 pillə fərq = 0.6; 2 pillə = 0.15
      + 15 * goal_overlap       // kəsişən məqsəd / max(2, ...)
      + 10 * type_overlap       // məşq tipi kəsişməsi
      +  5 * consistency        // son 30 gündə məşq tezliyinin yaxınlığı
```

**Filtrlər (skorlamadan əvvəl tətbiq edilir):** blok edilənlər, `discoverable=false`, yaş aralığı, «yalnız qadınlar» (qadın istifadəçi seçərsə), doğrulanmış profil tələbi.

**UI qaydası:** skorla birlikdə **səbəblər** göstərilməlidir (`reasons[]`): «Eyni zal», «Eyni saat», «Eyni məqsəd» və uyğunsuzluq da («Səviyyə fərqi»). Qara qutu olmamalıdır.

**Üç rejim:**
- `now_at_gym` (default) — `CheckIn.expires_at > now` olan, eyni zalda, `show_at_gym=true` istifadəçilər, skora görə sıralanır. Kartda qalan vaxt göstərilir.
- `cards` — swipe kartları, skor ≥ 60 olanlar, gündə maks 30 kart.
- `weekly` — həftədə bazar ertəsi 3 ən yüksək skorlu təklif, bazar günü sıfırlanır.

### 6.2 Check-in və streak

- QR: zalın `qr_secret`-i əsasında HOTP/TOTP tipli dinamik kod (statik QR-ın şəkli paylaşıla bilər — buna yol verilməməlidir). Zal ekranında/çapında dövri yenilənən kod.
- Manual GPS: zaldan ≤ 150 m və zal iş saatı içində. Gündə maks 1 manual check-in. `verified=false` → challenge-də sayılmır, streak-də sayılır.
- Bir zalda gündə 1 check-in sayılır.
- **Streak:** gündə ən azı 1 check-in **və ya** 1 tamamlanmış `WorkoutSession` (evdə məşq də sayılır). Gün sərhədi: istifadəçinin lokal saatı ilə 04:00.
- **Streak dondurma:** SPOT+ istifadəçisi ayda 2 gün donduraraq seriyanı qoruyur. Pulsuz istifadəçi: yox.
- «İndi zalda» pəncərəsi: check-in + 2 saat, `show_at_gym=true` şərti ilə.

### 6.3 Progressive overload və RPE

Məşq bitəndə istifadəçi 3 seçimdən birini verir: *Yüngül / Düz oldu / Ağır*. Növbəti həftənin hədəf çəkisi:
- `easy` → +2.5 kq (üst bədən) / +5 kq (alt bədən)
- `ok` → +2.5 kq (yalnız bütün setlər hədəf təkrarı tamamlanıbsa), əks halda dəyişməz
- `hard` → dəyişməz; iki ardıcıl `hard` → −5% və deload təklifi

Müəllimi olan istifadəçidə bu təklif müəllimə göndərilir, avtomatik tətbiq olunmur.

### 6.4 Rezervasiya, ödəniş, geri qaytarma

1. İstifadəçi paket + tarix/saat seçir → `Booking(status=pending)` yaranır, slot **15 dəqiqə** saxlanılır.
2. Ödəniş uğurlu → `confirmed`, müəllimə push, hər iki tərəfin təqviminə düşür, söhbət avtomatik açılır.
3. Ödəniş uğursuz → xəta ekranı (səbəb bank kodu ilə insan dilində) + slot 15 dəqiqə hələ də saxlanılır.
4. Müəllim 12 saat içində təsdiqləməzsə → avtomatik ləğv + tam geri qaytarma.
5. **Ləğv qaydası:** məşqdən > 24 saat qalıb → tam geri qaytarma; 24–4 saat → 50%; < 4 saat → geri qaytarma yoxdur. Müəllim ləğv edərsə → həmişə 100%.
6. `no_show` (müəllim gəlməyib) şikayəti → 24 saat içində yoxlanılır, təsdiqlənərsə 100% qaytarılır və müəllimin reytinqinə düşür.
7. **Komissiya:** rezervasiya 15%, proqram satışı 20%, day-pass 20%. Komissiya hər əməliyyatda ayrıca sətir kimi göstərilir — gizlədilməsi qadağandır.
8. **Payout:** ayda 1 dəfə (1-i) avtomatik, minimum 50 ₼; müəllim istədiyi vaxt manual çıxara bilər.

### 6.5 Day-pass

Alındıqdan sonra **həmin günün 24:00-a qədər** aktivdir, QR + 6 simvollu kod ilə. Zal qəbul etməzsə istifadəçi «istifadə edilməyib» bildirir → avtomatik geri qaytarma (zalın hesabına debet). Day-pass alan istifadəçi 7 gün içində aylıq üzvlüyə keçərsə, keçidin qiyməti üzvlükdən çıxılır (zalın öz təşəbbüsü, admin panelində açıla/bağlana bilər).

### 6.6 Challenge skorlaması

- Yalnız `verified=true` check-in-li və ya qeyd edilmiş məşq sessiyaları sayılır.
- `inter_gym` challenge-də nəticə **üzv başına normalizasiya** olunur: `gym_score = Σ(participant_progress) / active_member_count`. Böyük zal avtomatik qazanmır.
- Leaderboard-da istifadəçinin öz sətri həmişə ekranda sabit qalır (sticky), mövqe dəyişməsi göstərilir («+2 yer»).
- Ad göstərilməsi `visibility.leaderboard_name`-ə tabedir.

### 6.7 Söhbət qapıları (anti-spam / təhlükəsizlik)

İki kanal var:
1. **Match söhbəti** — qarşılıqlı qəbuldan sonra tam söhbət.
2. **Sual (question)** — zal üzvünə **bir dəfə bir mesaj**. Cavab gəlsə → tam söhbət açılır. Cavab gəlməsə → göndərən «oxundu» görmür, təkrar yaza bilmir.

Sorğular ayrı «Sorğular» qutusunda toplanır. Boş/şəkilsiz yeni profillər avtomatik «şübhəli» işarəsi alır. `who_can_message` parametri hər şeydən üstündür.

### 6.8 Moderasiya

- Şikayət səbəbləri konkretdir (narahat edici mesajlar, cinsi məzmun, təhqir/hədə, saxta profil, təhlükəsiz olmayan məsləhət, spam). «Digər» yoxdur.
- SLA: təhlükəsizlik (təqib, hədə, cinsi məzmun) **2 saat**, digərləri **24 saat**.
- Cəza pillələri: 1) xəbərdarlıq → 2) 7 gün mesaj qadağası → 3) yoldaş axtarışından çıxarılma → 4) hesabın bağlanması. Təhlükəsizlik pozuntusunda birbaşa 4-cü pillə.
- Şikayət edilən şəxs şikayəti və şikayətçini görmür.
- Blok: qarşılıqlı gizlənmə — nə profil, nə check-in, nə feed postu görünür.

### 6.9 Bildiriş prioritetləri

| Sinif | Nümunə | Söndürülə bilər | Tezlik |
|---|---|---|---|
| P1 kritik | rezervasiya təsdiqi/ləğvi, ödəniş, təhlükəsizlik | ✗ | dərhal |
| P2 məşq | məşq xatırlatması, streak xəbərdarlığı, «yoldaşın zala gəldi» | ✓ | dərhal, gündə maks 3 |
| P3 sosial/marketinq | şərh, bəyənmə, challenge dəvəti | ✓ (şərh/bəyənmə **default söndürülüb**) | gündə 1 toplu / həftədə 1 |

**Sükut saatları:** 22:00–08:00 (istifadəçinin lokal vaxtı) — P1 istisna. Ümumi limit: gündə 3 push.

**Push mətn qaydası:** başlıq ≤ 40 simvol və konkret fakt daşıyır; mətndə həmişə səbəb var («sənin push günündür»); emoji yoxdur; böyük hərflə qışqırmaq yoxdur.

### 6.10 Monetizasiya xülasəsi

| Mənbə | Dərəcə | Qeyd |
|---|---|---|
| SPOT+ abunə | 6 ₼/ay, 50 ₼/il | **IAP məcburi**, 7 gün pulsuz sınaq |
| Rezervasiya | 15% | fiziki xidmət, IAP yox |
| Proqram satışı | 20% | rəqəmsal məzmun — hüquqi baxımdan yoxlanmalı, ehtiyat variant: IAP |
| Day-pass | 20% | fiziki xidmət |

**Heç vaxt ödənişli olmayacaq:** zal/müəllim axtarışı, yoldaş tapma (limitlə), pulsuz proqramlar, hərəkət videoları, məşq qeydi, check-in, challenge-lər.

**SPOT+ açır:** gizli profil, limitsiz filtr (pulsuzda 3), detallı analitika + 1RM proqnozu, oflayn video yükləmə, streak dondurma (ayda 2 gün).

**Paywall qaydası:** yalnız kontekstli — istifadəçi limitə dəydiyi anda. App açılışında paywall qadağandır. Həmişə «limitlə davam et» seçimi olmalıdır.

---

## 7. Sistem vəziyyətləri (məcburi implementasiya)

Hər siyahı və ekran üçün 4 vəziyyət yazılmalıdır. Bunlar «nice to have» deyil, qəbul kriteriyasıdır.

- **Yüklənmə:** skeleton (spinner deyil) — layout dərhal görünür, naviqasiya işlək qalır.
- **Boş:** səbəb + hərəkət. Nümunə: «Iron Bay-də indi 3 nəfər var, amma filtrinə uyğun gəlmir» + «Filtri genişləndir» + «Bu həftənin təkliflərinə bax». Boşluq günahlandırmır, izah edir.
- **Xəta:** səbəb (insan dilində, texniki kod yalnız köməkçi), nəticə, çıxış yolu (təkrar cəhd + dəstək). «Xəta baş verdi» mətni qadağandır.
- **Oflayn:** üst banner + oflayn işləyənlərin siyahısı. **Oflayn işləyir:** məşq qeydi, taymer, yüklənmiş videolar, qida planı, alış-veriş siyahısı. **İşləmir:** söhbət, feed, «indi zalda», QR check-in (növbəyə düşür və internet qayıdanda göndərilir).

**Zero state (ilk gün):** boş qrafik və «0 məşq» göstərmək qadağandır — 3 addımlıq yol xəritəsi göstərilir (proqram seç → QR oxut → yoldaş tap). Bu ekran D1 retention-un əsas leverıdır.

---

## 8. Dizayn sistemi

### 8.1 Rənglər
| Token | Hex | İstifadə |
|---|---|---|
| ink | `#101014` | əsas mətn, primary düymə, seçili vəziyyət |
| volt | `#C6FF3D` | enerji, canlı check-in, uğur, seçim vurğusu |
| bg-grouped | `#F4F4F6` | ekran fonu |
| surface | `#FFFFFF` | kart |
| text-secondary | `#6E6E76` | ikinci mətn |
| text-tertiary | `#8A8A93` | caption |
| streak | `#FF6B35` | streak, xəbərdarlıq |
| link | `#0A84FF` | link, doğrulanma nişanı, iOS mavi |
| danger | `#FF3B30` | destruktiv |
| warning | `#FF9500` | oflayn banner, gözləmə |

**Qayda:** volt yalnız enerji/uğur/canlılıq üçün. Dekorativ istifadə qadağandır. Bir ekranda 1-2 fon rəngi.

### 8.2 Tipoqrafiya (SF Pro)
Large title 30/700 (-1px) · Title 20/700 (-0.4px) · Headline 16/600 · Body 15/400 · Subhead 13/500 · Caption 11/600 caps (letter-spacing .08em).

### 8.3 Ölçülər
Toxunma sahəsi ≥ 44 pt · kənar boşluq 20 pt · kart radiusu 16 · düymə radiusu 14 · çip radiusu 999 · ayırıcı 0.5 pt · tab bar 49 + 34 pt · sheet 3 detent.

### 8.4 Komponentlər
Primary düymə (ink, 46–52 pt), Secondary (ağ + 1 pt kənar), Çip (seçili = ink), Segmented control (iOS native), Grouped list, Sheet, Action sheet (destruktiv qırmızı və sonda), Toggle (açıq = volt), Badge (qırmızı, oxunmamış), Skeleton.

### 8.5 Animasiya spesifikasiyası
- **Push naviqasiya:** 0.35 s spring, damping 0.82.
- **Tab keçidi:** crossfade 0.18 s, ikon simvolu bounce.
- **Sheet:** rubber-band, 3 detent (kiçik/yarım/tam).
- **Kart tapı:** scale 0.97 + arxa fon blur, sonra hero foto genişlənir (shared element).
- **Match:** volt radial flash 0.5 s + success haptic; iki avatar mərkəzə spring ilə yaxınlaşır.
- **Check-in uğuru:** volt flash + success haptic; streak rəqəmi count-up (0.6 s, ease-out).
- **Set tamamlanması:** sətir 0.25 s ilə volt-a keçir, light impact haptic; fasilə taymeri özü açılır.
- **Fasilə taymeri:** halqa 60 fps, son 3 saniyə haptic tick.
- **Swipe kart:** rotasiya ±8°, sağa çəkərkən volt işıq, buraxanda spring.

Bütün animasiyalar `Reduce Motion` açıq olduqda crossfade-ə düşür.

---

## 9. Ekranlar üzrə davranış qeydləri (kritik məqamlar)

- **Onboarding (1.x):** hər addım keçilə bilər; 4 kritik data (məqsəd, səviyyə, qrafik, zal) olmadan matching işləməz — profil tamamlama bildirişi ilə sonradan toplanır. Bildiriş icazəsi **ilk ekranda deyil**, dəyər göstərildikdən sonra (1.10) soruşulur.
- **Zal kartı (2.1):** istifadəçinin öz zalı həmişə birinci və böyük kartla. «12 nəfər burada» badge-i real vaxt datasıdır (WebSocket / 60 s polling).
- **Filtr (2.2):** düymədə nəticə sayı canlı yenilənir («17 zal göstər»). Pulsuz istifadəçidə 3 filtr limiti.
- **Xəritə (2.3):** pin-lərdə şəkil yox, **qiymət** yazılır. MapKit, klasterləmə 14-cü zoom səviyyəsindən aşağıda.
- **Rəylər (2.7):** rəy yazmaq üçün ən azı 3 `verified` check-in tələb olunur. Rəydə «8 aydır bu zalda check-in edir» etiketi avtomatik hesablanır. Alt-kateqoriya ballar (təmizlik, izdiham, avadanlıq) filtrə çevrilir.
- **Aktiv məşq (5.6):** ekran qaranlıq, `isIdleTimerDisabled = true`. Set logging oflayn işləyir. Yoldaşın paralel məşqi göstərilir (o icazə verərsə).
- **Hərəkət videosu (5.5):** 0.5× sürət və «yan bucaq» məcburi funksiyalardır. «Ən çox edilən səhv» bloku hər hərəkət üçün doldurulmalıdır — bu, müəllimi olmayan istifadəçinin zədə qorumasıdır.
- **Proqram yaratma (5.8):** video olmayan hərəkət «Video lazımdır» xəbərdarlığı alır; istifadəçi öz videosunu çəkir və ya SPOT kitabxanasından götürür. Yayımlanma üçün hər hərəkətdə video mütləqdir.
- **Qida (6.x):** kalori sayma məcburi deyil — «Yedim» bir toxunuşdur. Yerli və əlçatan məhsullar. Hər yeməyin eyni makro ilə ≥ 3 alternativi olmalıdır. Alış-veriş siyahısı plandan avtomatik yaranır.
- **Feed (7.1):** hər videonun altında «Proqrama əlavə et» kartı — feed birbaşa məşqə çevrilir. Müəllim şərhləri mavi nişan + «MÜƏLLİM» etiketi ilə fərqlənir.
- **Video paylaşma (7.3):** «Hərəkətə bağla» addımı feed-i strukturlu datayla qidalandırır (sonradan hərəkət üzrə kolleksiya yaranır).
- **Progress fotoları (10.2):** default `only_me`. Paylaşmaq ayrıca şüurlu qərardır.
- **Analitika (18.3):** yalnız rəqəm göstərmir, nəticə çıxarır («çiyin disbalansı», «deload 2 həftə sonra»). «Müəllimə göndər» düyməsi datanı ekosistemə qaytarır.

---

## 10. Qəbul kriteriyaları (nümunələr)

1. **Check-in:** QR oxutduqdan sonra ≤ 1 s içində uğur animasiyası görünür, streak +1 olur, istifadəçi 2 saat ərzində «indi zalda» siyahısında görünür (`show_at_gym=true` olduqda) və 2 saatdan sonra avtomatik çıxır.
2. **Uyğunluq:** iki eyni zal + eyni 3 gün/slot + eyni səviyyə + eyni məqsəd olan istifadəçinin skoru ≥ 90 olmalı və UI-da ən azı 3 səbəb göstərilməlidir.
3. **Oflayn məşq:** təyyarə rejimində tam məşq qeyd edilə bilər; internet qayıdanda 30 s içində sinxron olur; dublikat yaranmır (idempotency key).
4. **Sual limiti:** cavab verilməmiş sorğu göndərən istifadəçi həmin şəxsə ikinci mesaj göndərə bilmir (API 403).
5. **Ödəniş uğursuzluğu:** rezervasiya slotu 15 dəqiqə saxlanılır; taymer UI-da göstərilir; müddət bitəndə slot azad olur və istifadəçiyə bildiriş gedir.
6. **Zal admini məxfiliyi:** admin API-dan üzvün `WorkoutSession`, `weight`, `Message` datasını sorğulasa 403 alır.
7. **Bildiriş limiti:** bir istifadəçiyə gündə 3-dən çox push getmir; 22:00–08:00 arası yalnız P1 gedir.
8. **Hesab silmə:** app içindən 3 tapdan çox olmayan yolla mümkündür; 30 gün geri qaytarma pəncərəsi işləyir; müddət bitəndə profil, məşq datası və fotolar tam silinir, rəylər anonimləşir.
9. **Reduce Motion:** açıq olduqda bütün spring/flash animasiyalar crossfade-ə düşür.
10. **Dinamik tip:** XXL ölçüdə heç bir mətn kəsilmir, düymələr sətirlərə bölünür.

---

## 11. Analitika hadisələri (minimum dəst)

`onboarding_step_completed(step)`, `onboarding_skipped(step)`, `gym_viewed(gym_id, source)`, `gym_filter_applied(filters, results)`, `daypass_purchased(gym_id, price)`, `membership_intent(gym_id)`, `trainer_viewed`, `booking_started`, `booking_paid`, `booking_failed(reason)`, `partner_mode_viewed(mode)`, `partner_invite_sent`, `partner_invite_accepted`, `match_created(score)`, `checkin(method, gym_id)`, `streak_milestone(days)`, `program_started(program_id, author_type)`, `workout_started`, `workout_completed(volume, duration, rpe)`, `pr_achieved(exercise_id)`, `exercise_video_played(exercise_id, speed)`, `feed_video_viewed(duration_pct)`, `feed_add_to_program`, `post_created(type)`, `challenge_joined`, `paywall_shown(context)`, `paywall_converted(plan)`, `report_submitted(reason)`, `notification_opened(class)`.

---

## 12. Yol xəritəsi

**MVP (v1.0)** — Onboarding, zal kataloqu + xəritə + profil + rəylər, QR check-in, «indi zalda» + siyahı rejimi, proqram kitabxanası (pulsuz), hərəkət videoları, aktiv məşq + set logging, söhbət (match + sual), profil/progress, bildirişlər, sistem vəziyyətləri, moderasiya, hesab silmə.

**v1.1** — Müəllim profili + rezervasiya + ödəniş, müəllim paneli, doğrulanma, komissiya və payout, day-pass.

**v1.2** — Feed (videolar + zalım), challenge + leaderboard, nailiyyətlər, qida planı, evdə məşq rejimi.

**v1.3** — Zal paneli və claim, qrup dərsləri, SPOT+ və analitika, Apple Watch, widget-lər.

**v2** — Zallar arası liqa, komanda challenge-ləri, RU/EN lokalizasiya, korporativ fitness paketləri, wearable dərin inteqrasiyası.

---

## 13. Açıq suallar (product owner-in cavabı lazımdır)

1. Proqram satışı üçün Apple IAP tələbi hüquqi olaraq necə həll olunur (rəqəmsal məzmun vs. fərdi xidmət)?
2. Zal QR kodu üçün zal tərəfində fiziki ekran/çap prosesi kim tərəfindən qurulur?
3. Müəllim sertifikatlarının yoxlanması hansı standarta əsaslanır (yerli akkreditasiya yoxdur)?
4. Day-pass geri qaytarması zalın hesabına debet kimi işləyəcək — bu, zal müqaviləsində necə əks olunur?
5. Yeniyetmə istifadəçilər (16–18) üçün ayrı rejim lazımdırmı (yoldaş tapma məhdudiyyəti)?
6. İlk şəhər Bakıdır — kataloqun ilk 100 zalı necə doldurulur (əl ilə, tərəfdaş, istifadəçi töhfəsi)?

---

## 14. Admin panel (veb)

Fayl: `SPOT Admin Panel.dc.html` · 10 ekran · 1440×900 · daxili alət (SEO yox, mobil uyğunluq tələb olunmur, minimum 1280px).

### 14.1 Admin rolları və icazələr

| Əməliyyat | Support | Moderator | Ops | Owner |
|---|---|---|---|---|
| Datanı oxumaq, istifadəçiyə cavab | ✓ | ✓ | ✓ | ✓ |
| Şikayət qərarı, məzmun silmə, cəza pillələri | ✗ | ✓ | ✓ | ✓ |
| Müəllim doğrulanması, zal claim, geri qaytarma | ✗ | ✗ | ✓ | ✓ |
| Telefon nömrəsini açmaq (loglanır) | ✗ | ✗ | ✓ | ✓ |
| Rol idarəsi, qiymət/komissiya, audit ixracı | ✗ | ✗ | ✗ | ✓ |
| **Çəki, progress fotosu, söhbət arşivi** | **✗** | **✗** | **✗** | **✗** |

Son sətir texniki tələbdir: admin API-da bu sahələr üçün endpoint **mövcud olmamalıdır**. Söhbət məzmunu yalnız şikayətə əlavə edilmiş maks 20 mesaj kimi və yalnız həmin şikayətin kartında görünür.

### 14.2 Ekranlar

1. **Dashboard** — 5 KPI, 4 növbə kartı (doğrulanma / şikayət / claim / ödəniş problemi) SLA taymeri ilə, check-in·match qrafiki, canlı hadisə lenti, ən aktiv zallar.
2. **İstifadəçilər** — filtrli cədvəl (rol, zal, status, şikayət), maskalanmış telefon, kütləvi əməliyyat paneli (elan, xəbərdarlıq, mesaj qadağası).
3. **İstifadəçi kartı** — profil, aktivlik siqnalları (sorğu/cavab faizi = spam detektoru), şikayətlər + şikayətə əlavə edilmiş mesajlar, cəza pillələri düymələri.
4. **Müəllim doğrulanması** — SLA üzrə sıralanmış növbə, 3 sənədin yan-yana yoxlanması, profil məzmunu yoxlaması, daxili qeyd, rədd səbəbinin müəllimə göndərilməsi.
5. **Zallar və claim** — kataloq cədvəli (QR statusu ayrı sütun), claim növbəsi (VÖEN + zəng kodu + selfie), sahibsiz zallara dəvət.
6. **Moderasiya** — SLA üzrə növbə, 15 dəqiqəlik sətir kilidi, avtomatik siqnal qaydaları, cəza pillələri.
7. **Məzmun** — proqram moderasiyası (3 avtomatik yoxlama + 6 rədd şablonu), hərəkət kitabxanası, videosuz hərəkətlərin prioritetləşdirilməsi.
8. **Ödənişlər** — əməliyyatlar (komissiya hər sətirdə açıq), mübahisələrdə check-in datası ilə qərar, payout uğursuzluqları, mühasibatlıq ixracı.
9. **Analitika** — əsas hipotezin yoxlanması (yoldaşı olan vs tək), onboarding funnel, matching keyfiyyəti, məzmun və gəlir. Hər blok nəticə cümləsi ilə bitir.
10. **Admin və audit** — komanda, icazə matrisi, dəyişdirilə bilməyən audit log (24 ay, ixrac olunur).

### 14.3 Admin panel qaydaları (developer üçün)

- **Hər destruktiv əməliyyat səbəb tələb edir** — forma səbəbsiz göndərilmir; səbəb audit log-a düşür və (seçimsə) istifadəçiyə/müəllimə göndərilir.
- **Audit log append-only** — UPDATE/DELETE yoxdur, 24 ay saxlanılır, CSV/JSON ixracı yalnız Owner.
- **Növbə kilidi** — moderasiya sətri açılandıqda 15 dəqiqə həmin adminə kilidlənir (iki nəfər eyni işi etməsin).
- **SLA** — təhlükəsizlik şikayəti 2 saat, digər şikayətlər 24 saat, müəllim doğrulanması 2 iş günü, claim 2 iş günü, proqram moderasiyası 24 saat. SLA keçən sətirlər qırmızı və həmişə yuxarıda.
- **Avtomatik siqnallar** — sorğu cavab faizi &lt;15% (≥20 sorğu), 24 saatda 3 şikayət (avtomatik müvəqqəti mesaj qadağası), şərhdə riskli açar sözlər, yeni+avatarsız+10 sorğu.
- **⌘K qlobal axtarış** — ID, telefon, e-poçt, zal adı, əməliyyat ID-si.
- **2FA məcburidir** bütün admin hesabları üçün; sessiya 8 saat sonra bitir.

---

## 15. Təqdimat sayti

Fayl: `SPOT Landing.dc.html` · 1440px desktop dizayn (mobil breakpoint sonra əlavə olunur).

**Struktur:** sticky nav → hero (2 telefon mockup + 3 rəqəm) → problem (3 sütun) → «Necə işləyir» 4 addım (qaranlıq blok) → 2 böyük funksiya bloku (yoldaş tapma + hərəkət videoları) → 4 kiçik funksiya kartı → müəllimlər üçün / zallar üçün yan-yana → qiymət (Pulsuz vs SPOT+) → FAQ → son CTA → footer.

**Mesaj iyerarxiyası:** (1) «Tək məşq etmə» — emosional vəd; (2) «Instagram-da axtarmağı bitir» — konkret problem; (3) «dating deyil» — FAQ-ın birinci sualı, çünki bu ən çox veriləcək sualdır.

**Konversiya nöqtələri:** App Store (hero + final CTA), «Zalını əlavə et» (nav + zallar bloku), «Müəllim kimi qeydiyyat» (müəllim bloku), Android gözləmə siyahısı.

**Developer qeydləri:** statik sayt kimi qurula bilər (Next.js static export və ya sadə HTML). FAQ akkordeon, nav smooth-scroll, hero mockup-larda yüngül float animasiyası. Şəkillər placeholder — real zal/məşq fotoları əvəzlənəcək. Bütün CTA-lar `utm_source` ilə işarələnir.

---

## 16. Fayl strukturu və dizayn faylının oxunması

`SPOT iOS App.dc.html` — bütün ekranların yerləşdiyi lövhə. Faylın yuxarısında cover (problem, owner qərarları, dizayn sistemi, naviqasiya xəritəsi), sonra 19 axın, sonda **Variantlar** bölməsi (V1–V5): naviqasiya strukturu, matching axını, feed düzümü, zal kartı, onboarding uzunluğu. Hazırkı ekranlar `V1a · V2a · V3a · V4a · V5a` seçimləri üzərində qurulub.

Faylın Tweaks panelində iki idarəedici var: `flow` (yalnız bir axını göstər) və `showNotes` (dizayn qeydlərini gizlət/göstər). Hər ekranın altındaki qeyd həmin ekranın **niyə belə olduğunu** izah edir — implementasiya zamanı bu qeydlər davranış tələbi kimi oxunmalıdır.

Fotolar və videolar placeholder-dir; real materiallar əvəzlənəcək. Zal və istifadəçi adları uydurmadır.
