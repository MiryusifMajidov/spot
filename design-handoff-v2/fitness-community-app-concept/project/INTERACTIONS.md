# SPOT — İnteraksiya Spesifikasiyası (button-by-button)

**Bu fayl nə üçündür:** dizayn faylındaki HƏR toxunula bilən element üçün: nə baş verir, hansı ekran açılır, hansı API çağırılır, hansı vəziyyətlər mümkündür.
**Oxu qaydası:** `README.md` = biznes qaydaları və data. Bu fayl = davranış. Dizayn faylı = görünüş.

## Ümumi konvensiyalar (bütün ekranlara aiddir)

| Element | Davranış |
|---|---|
| `‹` geri (sol üst) | `navigationStack.pop()`. Swipe-back həmişə aktiv. Formda dəyişiklik varsa → action sheet: «Dəyişiklikləri ləğv et / Davam et». |
| `✕` bağla | Modal/sheet-i `dismiss()`. Sheet-də swipe-down eyni işi görür. |
| «Ləğv et» (sol üst, modal) | Dəyişiklikləri **saxlamadan** bağla. |
| «Saxla» / «Dərc et» (sağ üst) | Validasiya → `PATCH`/`POST` → uğur haptic → bağla. Xəta olarsa sheet açıq qalır, sahə qırmızı işarələnir. |
| Primary düymə (ink) | Ekranın əsas hərəkəti. Basılanda: scale 0.97 (0.1 s) + light haptic. Şəbəkə gözləyərkən: mətn yerinə spinner, düymə disabled. |
| Deaktiv düymə | Opacity 0.4, tap → heç nə (səssiz), amma altında səbəb mətni görünür. |
| Kart / siyahı sətri | Tam sahə tap hədəfidir (checkbox/ikon deyil). Tap → detal ekranı push. |
| Çip | Toggle. Tap → seçim dəyişir + selection haptic + siyahı **dərhal** yenilənir (debounce 250 ms). |
| Segmented control | Tab dəyişir, scroll mövqeyi hər segment üçün ayrı yadda saxlanılır. |
| Toggle (switch) | Dərhal `PATCH` (optimistic). Xəta → geri qaytarılır + toast: «Dəyişiklik saxlanılmadı, yenidən cəhd et». |
| Avatar (istənilən yerdə) | Tap → həmin istifadəçinin profili push. Öz avatarın → öz profil. |
| Zal adı (istənilən yerdə) | Tap → zal profili push. |
| Bəyənmə (ürək) | Optimistic toggle + light haptic. `POST /posts/{id}/like` · `DELETE` |
| Paylaş ikonu | Native `UIActivityViewController`, universal link (`spot.az/gym/iron-bay`). |
| `⋯` (more) | Action sheet. Destruktiv seçimlər qırmızı və sonda. |
| Pull-to-refresh | Bütün siyahılarda var. `GET` təkrar + haptic. |
| Boş nəticə | README §7 «Boş vəziyyət» qaydası — səbəb + 2 hərəkət düyməsi. |
| Şəbəkə xətası | Inline banner + «Yenidən cəhd et». Tam ekran xəta yalnız ilk yüklənmədə. |

---

## AXIN 1 — Onboarding

### 1.1 Xoş gəlmisən
| Element | Davranış |
|---|---|
| «Apple ilə davam et» | `ASAuthorizationAppleIDProvider` → `POST /auth/apple` → yeni istifadəçi: **1.4**-ə keç; mövcud: ana ekran (Kəşf). |
| «Telefon nömrəsi ilə» | **1.2** push. |
| «İstifadə şərtləri» / «Məxfilik» | In-app Safari (`SFSafariViewController`). |

### 1.2 Telefon nömrəsi
| Element | Davranış |
|---|---|
| Ölkə kodu `+994 ⌄` | Sheet: ölkə siyahısı, axtarışlı. |
| Nömrə sahəsi | Yalnız rəqəm, avtomatik format `50 234 18 90`. 9 rəqəm tamamlananda «Kodu göndər» aktivləşir. |
| «Kodu göndər» | `POST /auth/otp/request {phone}` → **1.3**. Rate limit: 3 sorğu / 15 dəq; aşarsa toast «5 dəqiqə sonra yenidən cəhd et». |
| «Keç» | Onboarding-i tərk et → qonaq rejimi (yalnız zal kataloqu, oxu-only). |
| Klaviatura `⌫` | Bir rəqəm sil. |

### 1.3 SMS kodu
| Element | Davranış |
|---|---|
| 4 xanalı sahə | `oneTimeCode` autofill. 4-cü rəqəm daxil olunanda **avtomatik** doğrulama (düymə basmadan). |
| «Təsdiqlə» | `POST /auth/otp/verify` → uğur: token saxla → yeni istifadəçi **1.4**; mövcud: ana ekran. Səhv kod: xanalar qırmızı + shake + error haptic, sayğac «3 cəhd qaldı». |
| «Yeni kod: 0:24» | 0:00 olanda aktivləşir → yenidən `POST /auth/otp/request`. |

### 1.4 Məqsəd (1/5)
| Element | Davranış |
|---|---|
| 6 məqsəd kartı | Toggle, **maks 2**. 3-cüyə basanda: warning haptic + ən köhnə seçim avtomatik açılır (LRU). |
| «Davam et · N seçildi» | Lokal saxla → **1.5**. 0 seçimlə deaktiv. |
| «Keç» | Boş saxla → **1.5**. Sonra matching «məqsəd» meyarını 0 çəki ilə hesablayır. |
| Progress zolağı | Toxunula bilməz (yalnız göstərici). |

### 1.5 Səviyyə + məşq tipi (2/5)
| Element | Davranış |
|---|---|
| 3 səviyyə sətri | Radio — tək seçim, əvvəlki avtomatik açılır. |
| Məşq tipi çipləri | Çox seçim, limit yox. «Evdə məşq» seçilibsə **1.7**-də «Zalım yoxdur» önə çıxır. |
| «Davam et» | → **1.6**. Səviyyə seçilməyibsə deaktiv («Keç» ilə keçmək olar). |

### 1.6 Məşq qrafiki (3/5)
| Element | Davranış |
|---|---|
| 7 gün dairəsi | Toggle. Ən azı 1 gün tələb olunur. |
| 4 saat aralığı | Çox seçim. |
| «48 nəfər var» sətri | Hər dəyişiklikdə `GET /match/preview-count?days=&slots=&gym=` (debounce 400 ms), count-up animasiya. Toxunula bilməz. |
| «Davam et» | → **1.7**. |

### 1.7 Zal seçimi (4/5)
| Element | Davranış |
|---|---|
| Axtarış sahəsi | `GET /gyms/search?q=` (debounce 300 ms). Fokus alanda klaviatura + «Ləğv et». |
| Zal kartı | Radio seçim. Kart üzərində uzun basma → zal profili preview (peek). |
| «Hələ zalım yoxdur» | Seçim → `home_gym_id = null`, `training_types += home`. Məşq tab-ı «Evdə məşq» rejimində açılacaq (Axın 16). |
| «Davam et» | → **1.8**. |
| Lokasiya icazəsi | Ekran ilk açılanda `requestWhenInUseAuthorization`. Rədd edilərsə: məsafə göstərilmir, rayon üzrə axtarış işləyir. |

### 1.8 Profil (5/5)
| Element | Davranış |
|---|---|
| Avatar + kamera nişanı | Action sheet: «Şəkil çək / Qalereyadan seç / Sil». Seçimdən sonra crop (kvadrat) → `POST /users/me/avatar`. |
| Ad sahəsi | Məcburi, 2–30 simvol. |
| Yaş | Wheel picker (16–80). 16-dan aşağı → qeydiyyat bloklanır: «SPOT 16 yaşdan istifadə olunur». |
| Cins sətri | Sheet: Kişi / Qadın / Digər / Bildirmək istəmirəm. Qadın seçilərsə **1.9**-da «Yalnız qadınları göstər» toggle-ı görünür. |
| Bio | 0–140 simvol, sayğac. |
| «Davam et» | `PATCH /users/me` → **1.9**. |

### 1.9 Məxfilik və görünürlük
| Element | Davranış |
|---|---|
| «Yoldaş axtarışında görün» | `visibility.discoverable`. Söndürsə: aşağıdaki iki sətir solğunlaşır və deaktiv olur. |
| «Zalda olduğumu göstər» | `visibility.show_at_gym`. |
| «Gizli profil» | SPOT+ funksiyası. Pulsuz istifadəçi basanda → kontekstli paywall (**15.4**). |
| «Mənə kim yaza bilər» 3 radio | `who_can_message`. Default: «Yalnız qarşılıqlı match». |
| «Davam et» | `PATCH /users/me/settings` → **1.10**. |

### 1.10 Hazır + bildiriş icazəsi
| Element | Davranış |
|---|---|
| Proqram kartı | Tap → proqram detalı (**5.3**), «Proqrama başla» ön seçilmiş. |
| «48 uyğun yoldaş» kartı | Tap → Kəşf → Yoldaşlar (**4.1**). |
| «3 aktiv challenge» kartı | Tap → Challenge siyahısı (**8.1**). |
| QR kartı | Tap → QR skaner (**2.8**), kamera icazəsi soruşulur. |
| «SPOT-a başla» | `UNUserNotificationCenter.requestAuthorization` → nəticədən asılı olmayaraq ana ekran (Kəşf). Rədd edilərsə: 7 gün sonra Məşq tab-ında bir dəfə yumşaq banner. |

---

## AXIN 2 — Kəşf / zallar

### 2.1 Kəşf · Zallar
| Element | Davranış |
|---|---|
| Axtarış sahəsi | Fokus → tam ekran axtarış rejimi (son axtarışlar + təkliflər). `GET /search?q=&type=gym|trainer|user`. |
| Segment (Zallar/Müəllimlər/Yoldaşlar) | Tab dəyişir. Hər tabın öz filtri və scroll mövqeyi var. |
| 💬 söhbət ikonu + badge | **9.1** modal olaraq açılır. Badge = oxunmamış söhbət sayı (WebSocket ilə canlı). |
| 📍 xəritə ikonu | **2.3**-ə keçid (crossfade 0.2 s). |
| «Filtr · 2» | **2.2** sheet. Rəqəm aktiv filtr sayıdır. |
| Sürətli filtr çipləri | Toggle → siyahı dərhal yenilənir. Uzun basma → çipi filtrdən sil. |
| «İndi zalda 12 nəfər» sətri | Tap → **2.6** (öz zalının üzvləri, «indi zalda» filtri seçili). |
| Zal kartı | Tap → **2.4**. Hero foto shared-element keçidi ilə genişlənir. |
| Kartdaki 🔖 | Optimistic toggle. `POST /gyms/{id}/save`. Toast: «Saxlanıldı · Profil → Saxlanmışlar». |
| Kart uzun basma | Context menu: «Saxla / Paylaş / Yol göstər / Gizlət». |
| Tab bar | Kəşf (aktiv, təkrar tap → yuxarıya scroll) · Məşq (**5.1**) · Feed (**7.1**) · Profil (**10.1**). |

### 2.2 Filtr sheet
| Element | Davranış |
|---|---|
| «Sıfırla» | Bütün filtrlər default-a qayıdır, nəticə sayı yenilənir. |
| Məsafə slayderi | Sürükləmə → `preview_count` canlı yenilənir (debounce 200 ms). Lokasiya icazəsi yoxsa deaktiv + izah. |
| Qiymət ikili slayderi | Min/max ayrı sürüklənir, min > max ola bilməz. |
| Avadanlıq çipləri | Toggle. Pulsuz istifadəçi 3-dən çox seçəndə → **15.4** paywall sheet (mövcud sheet üzərində). |
| «Yalnız qadınlar üçün» | Toggle. Yalnız `gender=female` istifadəçidə görünür. |
| «İndi açıqdır» | Toggle → zalın `hours`-una görə filtr. |
| «17 zal göstər» | Filtri tətbiq et + sheet bağlanır + siyahı yuxarıdan yenilənir. Nəticə 0 olarsa düymə mətni «Nəticə yoxdur» olur və deaktiv qalır. |

### 2.3 Xəritə
| Element | Davranış |
|---|---|
| Xəritə pan/zoom | Hərəkət bitəndə (0.5 s sonra) `GET /gyms/nearby?bbox=` — avtomatik yenilənmə. |
| «Bu ərazidə axtar» | Cari bbox üzrə açıq sorğu. |
| Qiymət pin-i | Tap → pin ink rəngə keçir + aşağıda zal kartı görünür (spring, 0.3 s). |
| Alt zal kartı | Tap → **2.4**. Swipe sağa/sola → növbəti/əvvəlki pin. |
| Grid ikonu | Siyahı görünüşünə qayıt (**2.1**). |
| Mavi nöqtə (istifadəçi) | Tap → xəritə istifadəçiyə mərkəzləşir. |
| Pin klaster | Tap → zoom-in (0.4 s animasiya). |

### 2.4 Zal profili · Haqqında
| Element | Davranış |
|---|---|
| Foto karuseli | Yatay swipe. Tap → tam ekran qalereya (pinch-zoom, swipe-down bağlayır). |
| 🔖 saxla / ↗ paylaş | Ümumi konvensiya. |
| «Üzv ol» | Sheet: qiymət planları (aylıq/illik) + «Zalın nömrəsi ilə əlaqə» + «Zala yol göstər». **Diqqət:** aylıq üzvlük app-də ödənilmir (zala birbaşa) — sheet bunu açıq yazır. `POST /gyms/{id}/membership-intent` (analitika + zal panelində «yeni üzv» kimi görünür). |
| «1 günlük · 8 ₼» | Ödəniş axını: Apple Pay sheet → uğur → **15.3** (aktiv keçid). Uğursuz → **12.4**. |
| «12 nəfər indi zalda» volt sətri | Tap → **2.6**, «İndi zalda» filtri seçili. |
| Segment (Haqqında/Müəllimlər/Üzvlər/Rəylər) | Sırası ilə bu ekran / **2.5** / **2.6** / **2.7**. |
| «Daha çox» | Təsvir mətni genişlənir (0.25 s). |
| «6:00–24:00» kartı | Tap → sheet: həftə üzrə tam cədvəl. |
| «214 üzv» kartı | Tap → **2.6**. |
| «Nərimanov · Yol göstər» | Action sheet: Apple Maps / Google Maps / Ünvanı kopyala. |

### 2.5 Zalın müəllimləri
| Element | Davranış |
|---|---|
| Filtr çipləri (Hamısı/Boş yeri var/Qadın) | Server filtri. «Boş yeri var» = növbəti 7 gündə boş slotu olan müəllimlər. |
| Müəllim sətri / «Bax» | → **3.1**. |
| «Doğrulanmayıb» etiketi | Tap → info sheet: «Bu müəllim sənədlərini təsdiqləməmişdir. Rezervasiya app-də mümkün deyil.» |

### 2.6 Zalın üzvləri
| Element | Davranış |
|---|---|
| «İndi zalda 12» çipi | Filtr: `CheckIn.expires_at > now`. |
| «Mənə uyğun 4» çipi | Filtr: `compatibility_score ≥ 70`. |
| Üzv sətri | Tap → yoldaş profili (**4.3**). |
| 💬 düyməsi | **«Sual» axını**: sheet açılır, 1 mesaj yazılır → `POST /match-requests {type:question}`. Göndərdikdən sonra düymə deaktiv olur: «Cavab gözlənilir». `who_can_message` icazə verməzsə düymə əvvəldən deaktiv + izah. |
| «Gizli profil» sətri | Toxunula bilməz (opacity 0.6). |

### 2.7 Rəylər
| Element | Davranış |
|---|---|
| Ulduz histoqramı | Sətrə tap → həmin balı olan rəylərə filtr. |
| Sıralama/mövzu çipləri | `GET /gyms/{id}/reviews?sort=&tag=`. |
| Rəy kartı | Tap → tam mətn (uzunsa) + cavablar. |
| ❤️ | Faydalı işarəsi (`POST /reviews/{id}/helpful`). |
| «Cavab yaz» | Söhbətdə deyil, rəyin altında threaded cavab. Zal admini üçün «Rəsmi cavab» etiketi ilə. |
| «Rəy yaz» FAB | Şərt: ≥3 `verified` check-in. Şərt yoxdursa sheet: «Rəy yazmaq üçün bu zalda ən azı 3 check-in lazımdır (səndə 1 var)». Şərt varsa → rəy formu: 1–5 ulduz + 3 alt-kateqoriya (təmizlik/izdiham/avadanlıq) + mətn (≥30 simvol) → `POST /reviews`. |

### 2.8 QR check-in
| Element | Davranış |
|---|---|
| Kamera görünüşü | `AVCaptureSession`. İcazə yoxsa → izah + «Parametrlərə keç». |
| QR tanınması | Avtomatik (düymə yox) → `POST /checkins {qr_token}`. Uğur: volt flash + success haptic + streak count-up + 1.5 s sonra avtomatik bağlanır. |
| Səhv/köhnə QR | Error haptic + banner: «Bu kod bu zala aid deyil» / «Kodun vaxtı bitib, ekranı yeniləyin». |
| «QR yoxdur — əl ilə check-in» | GPS yoxlaması: ≤150 m və iş saatı → `POST /checkins {method:manual_gps}`. Uzaqdır → «Zaldan 340 m aralısan, yaxınlaş». Gündə 1 dəfə limiti. |
| ✕ | Bağla. |

---

## AXIN 3 — Müəllim və rezervasiya

### 3.1 Müəllim profili
| Element | Davranış |
|---|---|
| ↗ paylaş / ⋯ | ⋯ → «Şikayət et / Blok et / Linki kopyala». |
| İxtisas çipləri | Tap → o ixtisas üzrə müəllim axtarışı. |
| «64 aktiv şagird / 12 proqram / 2 saat» | Toxunula bilməz (statistika). |
| Video thumbnail | Tap → tam ekran video pleyer (**5.5** tipli). |
| «Hamısı 28» | Müəllimin bütün videoları (grid). |
| «12 proqramı var» kartı | Tap → müəllimin proqram siyahısı. |
| «Rezervasiya et» | → **3.2** (paketlər). Doğrulanmamış müəllimdə düymə yoxdur, yerinə «Əlaqə» (yalnız mesaj). |
| 💬 | Söhbət açılır. Müəllimə mesaj limiti yoxdur (o xidmət göstərir). |

### 3.2 Paketlər
| Element | Davranış |
|---|---|
| Paket kartı | Radio seçim, alt düymənin mətni və qiyməti dəyişir. |
| «Cütlük məşqi» kartı | Yoldaşı yoxdursa: «Əvvəlcə məşq yoldaşı tap» + **4.1**-ə keçid. Yoldaşı varsa: yoldaş seçimi sheet-i. |
| «Tural səni dəvət etdi» volt sətri | Tap → dəvətin detalı, «Qəbul et» ilə ikisi bir paketə yazılır. |
| «8 məşq paketini seç · 180 ₼» | → **3.3**. |

### 3.3 Rezervasiya · vaxt
| Element | Davranış |
|---|---|
| Ay naviqasiyası ‹ › | `GET /trainers/{id}/availability?month=`. |
| Gün | Boş slotu olmayan gün deaktiv (boz). Tap → aşağıda saat siyahısı yenilənir. |
| Saat düyməsi | Radio. Dolu saatlar üstüxətli + deaktiv. |
| «18:00 sənin adi məşq saatındır» | İstifadəçinin `schedule_slots`-una görə avtomatik. Toxunula bilməz. |
| «Müəllimə qeyd» | Klaviatura, 0–200 simvol. Müəllim panelində şagird kartında görünür (zədə qeydi kimi). |
| «Davam et · 25 avq, 18:00» | `POST /bookings {status:pending}` → slot 15 dəq bloklanır → **3.4**. |

### 3.4 Təsdiq + Apple Pay
| Element | Davranış |
|---|---|
| Apple Pay sheet | `PKPaymentAuthorizationController`. Uğur → `POST /payments/confirm` → `Booking.status=confirmed` → uğur ekranı (konfeti yox, sadə volt check) → söhbət avtomatik açılır + təqvimə yazılır (`EKEventStore` icazəsi ilə). |
| Uğursuz ödəniş | → **12.4**, slot hələ 15 dəq saxlanılır. |
| Kart sətri | Tap → kart seçimi/əlavəsi. |
| ✕ | Ödənişi ləğv et, `Booking` 15 dəq sonra avtomatik silinir. |

---

## AXIN 4 — Məşq yoldaşı

### 4.1 İndi zalda (default rejim)
| Element | Davranış |
|---|---|
| Rejim çipləri (İndi zalda / Kartlar / Bu həftə) | **4.1** / **4.2** / **4.6**. Seçim yadda saxlanılır. |
| «Zalı dəyiş» | Sheet: istifadəçinin zalları + yaxınlıqdaki zallar. |
| Uyğunluq faizi badge-i | Tap → sheet: skorun tam izahı (README §6.1 səbəbləri). |
| «Birlikdə məşq» | Sheet: təklif olunan vaxt (indi / +30 dəq / +1 saat) + qısa mesaj → `POST /match-requests {type:workout_invite, proposed_slot}`. Göndərdikdən sonra kart «Təklif göndərildi» vəziyyətinə keçir. |
| ✕ (kartda) | Bu istifadəçini 30 gün gizlə (`POST /match/hide`). Undo toast 4 s. |
| Kart özü | Tap → **4.3**. |
| «Daha 6 nəfər gizli profil» | Toxunula bilməz. |
| Boş siyahı | → **12.1** vəziyyəti. |

### 4.2 Kartlar (swipe)
| Element | Davranış |
|---|---|
| Sağa swipe / dumbbell düyməsi | «Birlikdə məşq» təklifi (4.1-dəki sheet). Volt işıq + success haptic. |
| Sola swipe / ✕ | Keç (30 gün gizlə). |
| 🔖 | Sonraya saxla — «Bu həftə» siyahısına düşür. |
| Kart tap | **4.3**. |
| Kart bitəndə | «Bugün üçün kart bitdi» + «Filtri genişləndir» / «İndi zalda rejimi». Gündə limit 30. |
| ⚙️ sliders | **4.4** filtr sheet. |

### 4.3 Yoldaş profili
| Element | Davranış |
|---|---|
| «Niyə uyğundur» sətirləri | Toxunula bilməz (izah). |
| PR kartları (skvat/bench/ölü q.) | Tap → o hərəkət üzrə müqayisə: sən vs o (SPOT+ deyil, pulsuz). |
| «Məşq təklif et» | 4.1-dəki sheet. |
| ✕ | Keç + geri. |
| ⋯ (üstdə) | «Şikayət et / Blok et». Blok → təsdiq alert → `POST /blocks` → geri qaytarır + siyahıdan silinir. |

### 4.4 Yoldaş filtri
| Element | Davranış |
|---|---|
| Zal / saat / səviyyə / məqsəd çipləri | Toggle, `preview_count` canlı. |
| Yaş ikili slayderi | 16–80. |
| «Yalnız qadınları göstər» | Yalnız qadın istifadəçidə. Açıq olduqda kişi profillər tam gizlənir (qarşılıqlı deyil — o hələ də səni görür, əgər `discoverable=true`). |
| «Doğrulanmış profillər» | `phone_verified && avatar != null`. |
| «31 nəfər göstər» | Tətbiq + bağla. |

### 4.5 Match ekranı
| Element | Davranış |
|---|---|
| Vaxt çipləri (Bugün/Çərş./Cümə) | Radio — ortaq qrafikdən avtomatik hesablanır. |
| «Təklif göndər» | `POST /workout-invites` → söhbətdə «Məşq təklifi» kartı yaranır (**9.2**) → söhbətə keç. |
| «Sadəcə yaz» | Söhbətə keç, təklif kartı olmadan. |
| Ekran açılışı | Volt radial flash + success haptic + iki avatar spring. Bir dəfə göstərilir; təkrar açılmır. |

### 4.6 Bu həftə (həftəlik təkliflər)
| Element | Davranış |
|---|---|
| «Məşq təklif et» | 4.1 sheet. |
| ✕ | Keç → kart solğunlaşır «Keçildi · gələn həftə yenidən görünə bilər». |
| Bazar günü | Siyahı avtomatik sıfırlanır, bazar ertəsi 3 yeni təklif + P2 push. |

---

## AXIN 5 — Məşq və proqramlar

### 5.1 Məşq · bugün
| Element | Davranış |
|---|---|
| Streak badge-i (🔥13) | Tap → **18.1** nailiyyətlər. |
| 💬 | **9.1**. |
| «Məşqə başla» | Proqram günü yüklənir → **5.6** (aktiv məşq). Zalda check-in edilməmişsə sheet: «Əvvəlcə check-in edirsən?» → **2.8** və ya «Keç». |
| Progress zolağı (6 seqment) | Toxunula bilməz. |
| «Check-in» kartı | → **2.8**. |
| «Qida» kartı | → **6.1**. |
| «Çəki» kartı | Sheet: sürətli çəki daxil etmə (wheel) → `POST /measurements`. |
| Həftəlik qrafik | Sütuna tap → o günün məşq detalı (**18.2** sətri). |
| «Detallar» | → **18.2** tarixçə. |
| «PPL — orta səviyyə» sətri | → **5.3**. |
| «Kitabxana» | → **5.2**. |
| Bugün məşq yoxdursa | Kart: «Bugün istirahət günüdür» + «Yenə də məşq et» (istənilən proqram günü seçimi). |

### 5.2 Proqram kitabxanası
| Element | Davranış |
|---|---|
| Axtarış | Proqram + hərəkət adı üzrə. Hərəkət tapılarsa nəticədə «Hərəkət» bölməsi ayrı görünür → **16.2**. |
| Filtr çipləri (Hamısı/Müəllimlər/İcma/Evdə/Pulsuz) | Server filtri. |
| Proqram kartı | → **5.3**. |
| Yaradıcı etiketi (mavi/boz) | Tap → info sheet: doğrulanma nə deməkdir. |
| «15 ₼» qiymət badge-i | Tap → alış sheet-i (IAP və ya kart — README §6.10). |
| FAB `+` | → **5.8** proqram yaratma. Doğrulanmamış istifadəçi də yarada bilər (yalnız pulsuz). |

### 5.3 Proqram detalı
| Element | Davranış |
|---|---|
| Hero video ▶ | Proqramın təqdimat videosu (varsa). |
| Yaradıcı kartı → «Profil» | → **3.1** (müəllim) və ya **4.3** (istifadəçi). |
| Segment (Günlər/Qida/Rəylər) | Bu ekran / **6.1** (proqramın qida planı) / rəylər siyahısı. |
| Gün sətri | → **5.4**. |
| «Proqrama başla» | `POST /users/me/active-program` → təsdiq sheet: başlama tarixi + həftədəki günlərin təqvimə yazılması → Məşq tab-ına qayıt, **5.1** yenilənir. Aktiv proqram varsa xəbərdarlıq: «PPL proqramın dayandırılacaq, irəliləyişin saxlanılır». |
| 👥 (sağda) | «Yoldaşımla birlikdə başla» — yoldaş seçimi → hər ikisinin qrafikinə sinxron yazılır, məşq günləri uyğunlaşdırılır. |
| 🔖 / ↗ | Saxla / paylaş. |

### 5.4 Gün detalı
| Element | Davranış |
|---|---|
| Hərəkət sətri | → **5.5** (video + izah). |
| «Keçən dəfə: 4×9 · 70 kq» | Tap → o hərəkət üzrə tarixçə qrafiki. |
| ⋯ (üst sağ) | «Günü dəyiş / Hərəkət əlavə et / Proqramdan çıx». |
| «Məşqə başla» | → **5.6**. |

### 5.5 Hərəkət videosu
| Element | Davranış |
|---|---|
| ▶ / video | Tap → oynat/dayandır. Loop avtomatik. |
| «0.5x» | Sürət toggle: 1x → 0.5x → 0.25x. |
| «Yan» | Yan bucaqdan çəkilmiş videoya keçid (varsa; yoxsa düymə deaktiv). |
| Timeline | Sürükləmə ilə frame-by-frame. |
| Müəllim adı | → **3.1**. |
| Əvəzedici kartlar | Tap → o hərəkətin video ekranı; «Bu məşqdə əvəz et» düyməsi ilə aktiv məşqdə dəyişdirilir. |
| ↗ | Videoyu paylaş (universal link). |
| ✕ | Bağla. |

### 5.6 Aktiv məşq
| Element | Davranış |
|---|---|
| «Fasilə» (sol üst) | Məşqi pauza et — taymer dayanır, ekran solğunlaşır, «Davam et» düyməsi. |
| «Bitir» (sağ üst) | Alert: «Məşqi bitirmək? 2 hərəkət qalıb». Təsdiq → **5.7**. |
| Set sətri | Tap → redaktə rejimi (çəki/təkrar). |
| `−` / `+` | Çəki addımı: 2.5 kq (ştanq), 2 kq (dumbbell), 5 kq (maşın). Uzun basma → sürətli dəyişmə. |
| Təkrar rəqəmi | Tap → numeric pad. |
| ○ dairə (set tamamla) | Tap → set volt-a keçir + light haptic + **fasilə taymeri avtomatik açılır**. `POST /workouts/{id}/sets` (oflayn: lokal + növbə). |
| PR halında | Volt flash + «Yeni rekord!» toast + `is_pr=true`. |
| Fasilə paneli: «+30s» | Taymeri artır. |
| «Keç» | Taymeri bağla, növbəti setə keç. |
| Taymer bitəndə | Haptic tick (son 3 san) + səs (parametrdən söndürülə bilər) + panel avtomatik yığılır. |
| Hərəkət videosu thumbnail | → **5.5** (məşq pauza olunmur, PiP kimi qayıdır). |
| «Tural da indi məşqdədir» → «Yaz» | Söhbətə keç, məşq konteksti ilə hazır mesaj: «Mən də indi zaldayam». |
| Ekran | `isIdleTimerDisabled = true`, dark rejim məcburi. |

### 5.7 Məşq xülasəsi
| Element | Davranış |
|---|---|
| RPE seçimi (Yüngül/Düz oldu/Ağır) | Radio, məcburi deyil. Seçim → README §6.3 məntiqi ilə növbəti həftə tənzimlənir. |
| «Turalla birlikdə etdim» | Toggle. Açıqsa hər ikisinin streak-i və challenge progress-i sayılır; Tural-a təsdiq bildirişi gedir (o rədd edə bilər). |
| «Feed-də paylaş» | → **7.3** (video/foto əlavə etmə), məşq statistikası avtomatik əlavə olunur. |
| «Yalnız özüm üçün saxla» | `POST /workouts/{id}/finalize` → Məşq tab-ına qayıt. |
| ✕ | Xülasəni bağla (məşq artıq saxlanılıb). |

### 5.8 Proqram yarat + video
| Element | Davranış |
|---|---|
| Ad sahəsi | Məcburi, 3–60 simvol. |
| «Kimlər üçün» çipləri | Səviyyə + yer, çox seçim. |
| «Həftədə gün sayı» | Sheet: 1–7. Dəyişəndə gün tabları avtomatik yaranır/silinir (silinmə təsdiqlə). |
| «Qida planı əlavə et» | Toggle → açıqsa yeni bölmə: qida planı qurucusu. |
| «Ödənişli» | Doğrulanmamış istifadəçidə deaktiv + izah: «Ödənişli proqram üçün müəllim doğrulanması lazımdır» → **13.4**-ə link. |
| «Kitabxanadan seç» | → hərəkət seçici (**16.2** tipli, çox seçim). |
| Hərəkət sətri ⋯ | «Set/təkrar dəyiş / Video əlavə et / Sil / Yerini dəyiş». |
| «Video lazımdır» xəbərdarlığı | Tap → video mənbəyi sheet-i (aşağıdaki). |
| Sheet: «İndi çək» | Kamera, maks 30 san. |
| Sheet: «Qalereyadan seç» | `PHPicker`, avtomatik 30 san-a trim. |
| Sheet: «SPOT kitabxanasından götür» | Hazır hərəkət videosu — pulsuz, atribusiya avtomatik. |
| «Hərəkət əlavə et» (dashed) | Hərəkət seçici. |
| «Yayımla» | Validasiya: ad + ≥1 gün + hər hərəkətdə video. Uğursuz → ilk problemli sətrə scroll + qırmızı işarə. Uğurlu → `POST /programs {status:published}` → moderasiya növbəsi (24 saat, bu müddətdə «Yoxlanılır» etiketi ilə yalnız müəllif görür). |

---

## AXIN 6 — Qida

### 6.1 Günün qidası
| Element | Davranış |
|---|---|
| Gün seçici | Tap → o günün planı. Keçmiş günlər oxu-only. |
| ⚙️ sliders | Sheet: kalori hədəfi, allergiya/istisna (məs. laktoza), yemək sayı (3/4/5), büdcə səviyyəsi. Dəyişiklik → plan yenidən yaranır (təsdiqlə). |
| Makro halqası | Tap → detallı makro paylanması (SPOT+ deyil, pulsuz). |
| Yemək kartı | Tap → **6.2**. |
| ○ dairə (Yedim) | Tap → yemək solğunlaşır, makro halqası count-up ilə yenilənir, `POST /nutrition/logs`. Təkrar tap → geri alır. |
| Su `+` düyməsi | +250 ml, light haptic. Uzun basma → miqdar seçimi. |
| Alış-veriş ikonu (⚙️ içində) | → **6.3**. |

### 6.2 Yemək detalı
| Element | Davranış |
|---|---|
| «Bəyənmirsən?» sətri | → alternativ siyahısı (eyni makro ±10%). Seçim → plan dəyişir. |
| «Yedim» | 6.1 ilə eyni. |
| `+` (sağda) | «Alış-veriş siyahısına əlavə et» / «Sevimlilərə əlavə et». |
| 🔖 | Resepti saxla. |
| Məhsul sətri | Tap → miqdar redaktəsi (porsiya çarpanı 0.5×–3×), makro avtomatik yenilənir. |

### 6.3 Alış-veriş siyahısı
| Element | Davranış |
|---|---|
| Checkbox | Toggle → üstüxətli + siyahının sonuna keçir. Lokal saxlanılır. |
| Məhsul sətri (uzun basma) | «Sil / Miqdarı dəyiş». |
| ↗ (üst sağ) | Siyahını mətn kimi paylaş (WhatsApp/Notes). |
| «Siyahını paylaş» | Eyni. |
| Həftə dəyişəndə | Yeni siyahı yaranır, işarələnmişlər arxivə düşür. |

---

## AXIN 7 — Feed

### 7.1 Video feed
| Element | Davranış |
|---|---|
| Şaquli swipe | Növbəti/əvvəlki video. Avtoplay + loop, səs default **açıq** (ilk dəfə sistem həcmi ilə). |
| Video tap | Pauza/davam. |
| İki dəfə tap | Bəyənmə + ürək animasiyası. |
| Uzun basma | Sürət 2× (buraxanda normal). |
| «İzlə» | `POST /users/{id}/follow` → düymə «İzlənilir» olur. |
| ❤️ / 💬 / 🔖 / ↗ | Bəyən / **7.2** şərhlər / saxla / paylaş. |
| Hashtag | Tap → hashtag feed-i. |
| **«Proqrama əlavə et» volt kartı** | Tap → sheet: hansı proqramın hansı gününə əlavə edilsin → `POST /programs/{id}/exercises`. Aktiv proqramı yoxdursa: «Yeni proqram yarat» təklifi. |
| Segment: «Zalım» | → **7.4**. |
| 🔍 | Feed axtarışı (hashtag, hərəkət, istifadəçi). |
| Uzun basma (video üzərində) | «Şikayət et / Maraqlı deyil / Linki kopyala». «Maraqlı deyil» → alqoritm siqnalı. |

### 7.2 Şərhlər
| Element | Davranış |
|---|---|
| Sheet | Yarım detent-də açılır, video arxada oynamağa davam edir. |
| «Cavab» | Threaded cavab, @mention avtomatik. |
| ❤️ (şərhdə) | Bəyən. |
| Şərh uzun basma | «Şikayət et / Sil (öz şərhin) / Kopyala». |
| Göndər ↑ | `POST /comments`. Boş mətn → deaktiv. |
| Müəllim şərhi | Mavi nişan + «MÜƏLLİM» etiketi, siyahının yuxarısına sancılır. |

### 7.3 Video paylaş
| Element | Davranış |
|---|---|
| Video thumbnail «Kəs/redaktə et» | Trim redaktoru (maks 90 san), örtük kadrı seçimi. |
| Təsvir sahəsi | 0–300 simvol, hashtag avtomatik tanınır. |
| Mövzu çipləri | Tək seçim, məcburi. |
| «Hərəkətə bağla» | Hərəkət seçici → video həmin hərəkətin kolleksiyasına düşür. |
| «Zalı qeyd et» | Zal seçici → zalın feed-ində («Zalım») görünür. |
| «Şərhlərə icazə ver» | Toggle. |
| «Kim görsün» radio | `visibility`: hər kəs / zal üzvləri / yoldaşlar. |
| «Paylaş» | `POST /posts` → yüklənmə progress-i (arxa planda davam edir, app bağlansa da bitir) → uğur toast. |
| «Ləğv» | Alert: «Video silinəcək?». |

### 7.4 Zalım (icma)
| Element | Davranış |
|---|---|
| Challenge kartı | → **8.2**. |
| 🔔 (üst sağ) | → **11.1** bildirişlər. |
| Post kartı | → **7.5**. |
| «yoldaşın» etiketi | Tap → **4.3**. |
| ⋯ | «Şikayət et / Gizlət / Paylaş». |
| ❤️ / 💬 | Bəyən / şərhlər. |
| **«Feedback ver»** | Struktur feedback sheet-i: 3 sahə — «Nə yaxşıdır», «Nə dəyişdirilməli», «Növbəti addım». Adi şərhdən fərqli olaraq postda ayrı bölmədə görünür. Yalnız `intermediate+` səviyyə və ya müəllim verə bilər. |
| FAB / paylaş | → **7.3** (video) və ya progress postu qurucusu. |

### 7.5 Post detalı
| Element | Davranış |
|---|---|
| Progress fotoları | Tap → tam ekran müqayisə (yan-yana / slider). |
| Statistika kartları | Toxunula bilməz. |
| «İzlə» | Follow toggle. |
| Şərh sahəsi | `POST /comments`. |
| Müəllim şərhi | Yuxarıda sancılır. |

---

## AXIN 8 — Challenge

### 8.1 Challenge siyahısı
| Element | Davranış |
|---|---|
| Segment (Aktiv/Zalım/Hamısı) | Filtr. |
| Aktiv challenge kartı | → **8.2**. |
| «Qoşul» | `POST /challenges/{id}/join` → düymə «Qoşuldun» + kart aktiv bölməsinə keçir + P3 push icazəsi soruşulur (bir dəfə). |
| Zallar arası kart | → **8.3**. |

### 8.2 Challenge detalı
| Element | Davranış |
|---|---|
| «Qaydalar» | Sheet: metrika, sayılma şərti (yalnız `verified` check-in), mükafat, ləğv şərtləri. |
| Leaderboard sətri | Tap → **4.3** profil. |
| Öz sətrin (sticky ink) | Tap → öz progress detalın. |
| «Yoldaşını dəvət et» | Yoldaş seçici → `POST /challenges/{id}/invite` → onlara P3 push. |
| ↗ | Challenge linkini paylaş. |
| Challenge bitəndə | Nəticə ekranı: yer, mükafat kodu (varsa), «Nəticəni paylaş» → **7.3**. |

### 8.3 Zallar arası reytinq
| Element | Davranış |
|---|---|
| Segment (Zallar arası/Zal daxili) | Filtr. |
| Podium | Zal ikonuna tap → **2.4**. |
| Zal sətri | → **2.4**. |
| «Zal söhbətinə yaz» | Zalın qrup söhbəti (**9.1**-dəki qrup çatı) açılır. |

---

## AXIN 9 — Söhbət və təhlükəsizlik

### 9.1 Söhbətlər
| Element | Davranış |
|---|---|
| ✏️ (yeni) | Yoldaş/müəllim seçici → yeni söhbət. |
| Axtarış | Ad və mesaj mətni üzrə lokal + server axtarışı. |
| «Sorğular · 3» kartı | → **9.3**. |
| Söhbət sətri | → **9.2**. |
| Sətir swipe (sola) | «Sussun (mute) / Sil». Silmə təsdiqlə. |
| Sətir swipe (sağa) | «Oxunmuş kimi işarələ». |
| Yaşıl nöqtə (avatar) | «İndi zalda» statusu — canlı (WebSocket). |

### 9.2 Söhbət
| Element | Davranış |
|---|---|
| Başlıq (ad/avatar) | Tap → **4.3** profil. |
| «indi Iron Bay-də» | Tap → **2.4** zal profili. |
| ⋯ | → **9.4** action sheet. |
| **«Məşq təklifi» kartı → «Qəbul et»** | `PATCH /workout-invites/{id} {accepted}` → hər ikisinin təqviminə yazılır (`EKEventStore`), söhbətdə sistem mesajı, P1 push qarşı tərəfə. |
| «Vaxt dəyiş» | Vaxt seçici → yeni təklif göndərilir (rollar dəyişir). |
| Sürətli cavab çipləri | Tap → mətn sahəsinə yazılır (göndərmir — istifadəçi redaktə edə bilər). |
| `+` (sol alt) | «Foto / Video / Məşq nəticəsi paylaş / Proqram paylaş / Lokasiya». |
| Mesaj sahəsi | Yazarkən «yazır…» indikatoru qarşı tərəfə. |
| Göndər ↑ | `POST /messages`. Oflayn → «göndərilir» vəziyyəti, internet qayıdanda göndərilir. |
| Mesaj uzun basma | «Cavab ver / Kopyala / Sil (özündə) / Şikayət et». |
| ✓✓ | Çatdırıldı/oxundu. Oxundu göstəricisi parametrdən söndürülə bilər. |

### 9.3 Sorğular
| Element | Davranış |
|---|---|
| «Cavab yaz» | Söhbət açılır (`Match` yaranır) → **9.2**. Göndərənə P2 push. |
| ✕ | Sorğunu sil — göndərən heç nə görmür, təkrar yaza bilməz. |
| 🛡 (qırmızı) | → **19.1** şikayət formu. |
| «Şübhəli profil» etiketi | Tap → izah: profil boşdur, avatarsızdır və ya yeni yaradılıb. |

### 9.4 Şikayət və blok (action sheet)
| Element | Davranış |
|---|---|
| «Profilə bax» | **4.3**. |
| «Bildirişləri söndür» | Bu söhbət üçün mute. |
| «Şikayət et» | → **19.1**. |
| «Blok et» | Alert: «Nicat H. blok edilsin? Bir-birinizi görməyəcəksiniz». Təsdiq → `POST /blocks` → söhbət arxivə, profil qarşılıqlı gizlənir, match ləğv olunur. |

---

## AXIN 10 — Profil və parametrlər

### 10.1 Mənim profilim
| Element | Davranış |
|---|---|
| ↗ | Profil linkini paylaş (`spot.az/u/nihad`). |
| ⚙️ sliders | → **10.4** parametrlər. |
| Streak / yoldaş badge-ləri | → **18.1** / yoldaş siyahısı. |
| «Profili redaktə et» | → **10.3**. |
| 🔖 | Saxlanmışlar: zallar, proqramlar, videolar, reseptlər (tab-lı ekran). |
| «38 məşq / 142 t / 3 ay» | Tap → **18.2** tarixçə. |
| PR kartı | Tap → o hərəkətin tarixçə qrafiki. «Hamısı» → bütün PR siyahısı. |
| Segment (Postlar/Progress/Challenge) | Grid / **10.2** / challenge siyahısı. |
| Post grid elementi | → **7.5**. |
| **Başqasının profilində** | «Profili redaktə et» yerinə «Məşq təklif et» + 💬; ⚙️ yerinə ⋯ (şikayət/blok). |

### 10.2 Progress
| Element | Davranış |
|---|---|
| `+` (üst sağ) | Sheet: «Çəki əlavə et / Ölçü əlavə et / Foto çək». |
| Segment (Çəki/Ölçülər/Fotolar) | Filtr. |
| Qrafik nöqtəsi | Tap → o tarixin dəyəri + «Redaktə et / Sil». |
| «3 ay / 1 il» | Dövr dəyişir. |
| Foto kartı | Tap → tam ekran; iki foto seçib «Müqayisə et» → slider müqayisəsi. |
| «Yeni foto» | Kamera + poza şablonu (əvvəlki fotonun kölgəsi overlay kimi — eyni bucaq üçün). |
| Məxfilik sətri | Tap → **10.5** görünürlük. |

### 10.3 Profili redaktə et
| Element | Davranış |
|---|---|
| Avatar | 1.8-dəki action sheet. |
| Sahələr | Inline redaktə. |
| «Zal» | Zal seçici. Zal dəyişəndə xəbərdarlıq: «Yoldaş təklifləri və zal challenge-ləri yenilənəcək». |
| Məqsəd/səviyyə çipləri | Toggle (maks 2 məqsəd). |
| Qrafik günləri | Toggle. Dəyişiklikdən sonra toast: «Uyğunluq yenidən hesablandı». |
| «Saxla» | `PATCH /users/me` → geri. |
| «Ləğv et» | Dəyişiklik varsa təsdiq alert. |

### 10.4 Parametrlər
| Element | Davranış |
|---|---|
| SPOT+ kartı | Abunə yoxsa → **15.1** paywall; varsa → **15.2** ödənişlər. |
| «Profil məlumatları» | → **10.3**. |
| «Zalım» | Zal seçici. |
| «Müəllim kimi doğrulanma» | → **13.4**. Artıq müəllimdirsə → «Müəllim rejiminə keç». |
| «Görünürlük» | → **10.5**. |
| «Blok edilənlər · 2» | Siyahı, hər sətirdə «Blokdan çıxar». |
| «Bildirişlər» | → **11.3**. |
| «Apple Health» | Toggle → HealthKit icazə dialoqu. |
| «Dəstək və şikayət» | → **19.2**. |
| «Hesabdan çıx» | Alox: «Çıxış? Oflayn məşq datası göndərilməyib» (varsa) → token silinir → **1.1**. |

### 10.5 Görünürlük
| Element | Davranış |
|---|---|
| «Yoldaş axtarışında görün» | Söndürsə: alt iki sətir deaktiv + izah «Profilin heç kimə təklif edilmir». |
| «Gizli profil» | SPOT+ yoxsa → **15.4** paywall. |
| «Mənə kim yaza bilər» 3 sətir | Çox seçimli deyil — kumulyativ: «hər kəs» seçilsə digərləri avtomatik daxil olur. |
| «Progress fotolarım» | Sheet: Yalnız mən / Yoldaşlarım / Hər kəs. |
| «Leaderboard-da adım» | Sheet: Tam ad / Ad + hərf / Anonim. |
| «Datamı yüklə» | `POST /users/me/export` → «48 saat içində e-poçtla göndəriləcək» toast. |
| «Hesabı sil» | → **19.3**-dəki silmə axını (2 addımlı təsdiq + səbəb sorğusu). |

---

## AXIN 11 — Bildirişlər

### 11.1 Bildiriş mərkəzi
| Element | Davranış |
|---|---|
| «Hamısını oxu» | `PATCH /notifications/read-all` → badge sıfırlanır. |
| **Actionable bildiriş** («Qəbul et») | Ekran dəyişmədən inline: `PATCH /workout-invites/{id}` → sətir «Qəbul edildi» olur. |
| «Sonra» | Bildiriş qalır, 24 saat sonra təkrar xatırlatma yoxdur. |
| Adi bildiriş sətri | Deep link: rezervasiya → **3.x**, şərh → **7.5**, challenge → **8.2**, streak → **2.8**. |
| Sətir swipe | «Sil». |

### 11.2 Push (kilid ekranı)
| Element | Davranış |
|---|---|
| Push tap | Deep link ilə müvafiq ekran (app bağlı olsa da). |
| Push uzun basma | iOS action düymələri: yoldaş təklifi → «Qəbul et / Sonra»; məşq xatırlatması → «Başla / 1 saat sonra». |
| Push swipe | iOS standart (sil/idarə et). |

### 11.3 Bildiriş parametrləri
| Element | Davranış |
|---|---|
| Kritik kateqoriya toggle-ları | Deaktiv (opacity 0.6). Tap → toast: «Ödəniş və təhlükəsizlik bildirişləri söndürülə bilməz». |
| P2/P3 toggle-ları | `PATCH /users/me/notification-prefs`. |
| «Sükut saatları» | Sheet: başlama/bitmə vaxtı (default 22:00–08:00) + «Söndür». |
| Sistem icazəsi söndürülübsə | Ekranın yuxarısında banner: «iOS bildirişləri söndürülüb» + «Parametrləri aç». |

### 11.4 Widget-lər / Watch
| Element | Davranış |
|---|---|
| «Bugün» widget → «Başla» | App-i açır və birbaşa **5.6** aktiv məşq. |
| «Iron Bay 12 nəfər» widget | Tap → **2.6** (indi zalda). Yenilənmə: 15 dəq (WidgetKit timeline). |
| «Check-in et» widget | Tap → **2.8** QR skaner. |
| Watch «Set bitdi» | Set qeyd olunur, telefonla sinxron, fasilə taymeri Watch-da başlayır. |
| Watch Digital Crown | Çəki/təkrar dəyişmə. |

---

## AXIN 12 — Sistem vəziyyətləri

| Ekran | Element | Davranış |
|---|---|---|
| 12.1 Boş | «Filtri genişləndir» | Filtr sheet-i açılır, ən məhdudlaşdırıcı filtr işarələnmiş halda. |
| 12.1 | «Bu həftənin təkliflərinə bax» | → **4.6**. |
| 12.2 Skeleton | — | Toxunula bilməz, lakin naviqasiya və filtrlər işlək qalır. 10 s-dan çox çəkərsə → xəta vəziyyəti. |
| 12.3 Oflayn | Üst banner | Tap → sheet: nə işləyir/işləmir + «Yenidən cəhd et». |
| 12.3 | «Məşqə başla» | Tam işləyir (lokal). |
| 12.3 | Solğun tab-lar | Tap → toast: «Bu bölmə internet tələb edir». |
| 12.3 | «2 məşq sinxron gözləyir» | Tap → növbə siyahısı + «İndi göndər». |
| 12.4 Xəta | «Başqa kartla cəhd et» | Ödəniş üsulu seçici → təkrar ödəniş. |
| 12.4 | «Rezervasiyanı ləğv et» | `DELETE /bookings/{id}` → slot azad olur → geri. |
| 12.4 | «dəstəyə yaz» | → **19.2**, müraciətə ödəniş id-si avtomatik əlavə olunur. |
| 12.5 İlk gün | 3 addım siyahısı | Hər addım tap → müvafiq ekran. Tamamlanan addım volt check alır. |
| 12.5 | Proqram kartları | → **5.3**. |

---

## AXIN 13 — Müəllim paneli

### 13.1 Panel
| Element | Davranış |
|---|---|
| «Rejimi dəyiş» | Sheet: «İstifadəçi rejimi / Müəllim rejimi». Seçim → tab bar tam dəyişir (0.3 s crossfade). |
| Gəlir kartı | → **13.3**. |
| Şagird sayı kartı | → **13.2**. |
| Qrafik sətri | Tap → şagirdin məşq detalı (**13.5**). |
| «Təqvim» | Aylıq təqvim görünüşü, boş slotların idarəsi (blok/açıq). |
| «Boş saat» sətri | Tap → «Bu saatı bağla» / «Bu saat üçün endirim təklif et». |
| «3 cavabsız mesaj» | → söhbətlər (müəllim rejimi). |
| «2 yeni rezervasiya sorğusu» | Sheet: hər sorğu üçün «Təsdiqlə / Rədd et (səbəb ilə)». 12 saat gözləmə taymeri görünür. |
| «Yeni rəy» | Rəy ekranı + «Cavab yaz». |

### 13.2 Şagirdlər
| Element | Davranış |
|---|---|
| Filtr çipləri (Aktiv/Risk/Bitmiş) | Server filtri. |
| Risk banneri | Tap → yalnız risk şagirdləri. |
| Şagird kartı | → **13.5**. |
| «Proqramı redaktə et» | → **13.5**. |
| 💬 | Şagirdlə söhbət. |
| «Yaz və geri qaytar» | Sheet: hazır mesaj şablonu + «Qismən geri qaytar (qalan seanslar)» düyməsi → `POST /bookings/{id}/refund`. |
| ⋯ | «Paketi dayandır / Şagirdi arxivləşdir / Şikayət et». |

### 13.3 Gəlir
| Element | Davranış |
|---|---|
| «İndi çıxart» | Sheet: məbləğ (min 50 ₼) + kart seçimi → `POST /payouts` → «1–3 iş günü» toast. |
| «Ay / İl» | Dövr dəyişir. |
| Qrafik sütunu | Tap → o günün əməliyyatları. |
| Əməliyyat sətri | Tap → detal: müştəri, paket, komissiya hesablanması, qəbz. |
| «Detallar» | CSV ixracı (e-poçtla). |

### 13.4 Doğrulanma
| Element | Davranış |
|---|---|
| Sənəd sətri (təsdiqlənməmiş) | Tap → yükləmə axını: «Şəkil çək / Fayl seç» → `POST /verification/documents`. |
| «Yoxlanılır» sətri | Tap → status detalı + təxmini vaxt. |
| Rədd edilmiş sənəd | Qırmızı, tap → səbəb + «Yenidən yüklə». |
| «Zala xatırlatma göndər» | `POST /verification/gym-reminder` → zal adminə P1 push. Gündə 1 dəfə. |
| «Təqdimat videosu» | Kamera, maks 30 san. |

### 13.5 Şagird proqramı
| Element | Davranış |
|---|---|
| Zədə qeydi banneri | Tap → şagirdin tam qeydləri. |
| Nəticə sətirləri | Tap → hərəkət tarixçəsi qrafiki. |
| **«SPOT təklifi» volt kartı** | «Tətbiq et» → çəkilər avtomatik yenilənir; «Rədd et» → təklif itir. |
| Hərəkət sətri | Tap → set/təkrar/çəki redaktəsi. |
| Sürükləmə (⋯ tutacağı) | Sıranı dəyiş. |
| Sola swipe | «Sil / Əvəz et». |
| Üstüxətli hərəkət | Tap → «Geri qaytar». |
| «Hərəkət əlavə et» | Hərəkət seçici. |
| «Saxla» | `PATCH /programs/{id}` → şagirdə P2 push: «Elvin proqramını yeniləyib» + mesaj mətni. |

---

## AXIN 14 — Zal paneli

### 14.1 Panel
| Element | Davranış |
|---|---|
| «İndi zalda 12» kartı | → üzv siyahısı (yalnız icazə verənlər). |
| «Yeni üzv 18» kartı | → **14.3**, «Yeni» filtri. |
| Doluluq qrafiki | Sütuna tap → o saatın detalı (check-in sayı, üzv/day-pass nisbəti). |
| «Səhər endirimi» təklifi | Tap → elan qurucusu, mətn ön doldurulmuş. |
| Gəlir «Detallar» | Day-pass əməliyyatları siyahısı + CSV. |
| «QR kodu» | Ekran: böyük dinamik QR + «Çap et» (AirPrint) + «Ekranda göstər» (kilidlənmiş tam ekran rejimi, dövri yenilənən kod). |
| «Elan» | Elan qurucusu: mətn + hədəf (bütün üzvlər / aktiv / risk) + planlaşdırma. Göndərmə: təsdiq alert «214 nəfərə göndərilsin?». Limit: həftədə 2. |
| «Profil» | → **14.2**. |
| Tab bar (müəllim rejimi kimi) | Panel · Üzvlər (**14.3**) · Dərslər (**17.1** admin görünüşü) · Rəylər. |

### 14.2 Zal profilini redaktə
| Element | Davranış |
|---|---|
| Foto slotu | Tap → «Şəkil çək / Qalereyadan seç»; uzun basma → «Əsas et / Sil». Maks 10 foto. |
| Qiymət sahələri | Numeric. Qiymət dəyişəndə xəbərdarlıq: «Yeni qiymət dərhal görünəcək». |
| İş saatları sətri | Tap → hər gün üçün vaxt seçici + «Bağlıdır» seçimi. |
| Avadanlıq çipləri | Toggle → istifadəçi filtrinə birbaşa təsir edir. |
| «Day-pass satışına icazə» | Toggle. Söndürsə: mövcud aktiv keçidlər qüvvədə qalır. |
| «Üzv siyahısı görünsün» | Toggle. Söndürsə: zal profilində «Üzvlər» tab-ı gizlənir. |
| «Saxla» | `PATCH /gyms/{id}`. |

### 14.3 Üzvlər
| Element | Davranış |
|---|---|
| Filtr çipləri | Hamısı / Yeni (30 gün) / Risk (14 gün gəlməyən). |
| Davamiyyət kartı | Tap → detallı statistika ekranı. |
| Üzv sətri | Tap → **məhdud** profil: ad, avatar, üzvlük tarixi, check-in tezliyi. **Məşq datası, çəki, söhbət YOX.** |
| «Geri qaytarma təklifi göndər» | Sheet: hazır təkliflər (1 həftə pulsuz / 20% endirim / şəxsi zəng) → P3 push. Üzvə ayda 1 dəfə. |
| «Anonim üzv» | Toxunula bilməz. |

### 14.4 Sahiblik iddiası (claim)
| Element | Davranış |
|---|---|
| Addım 1 (VÖEN) | «Şəkil çək / PDF seç» → yüklənir. |
| Addım 2 (zəng) | «Zəng et» → `POST /gyms/{id}/claim/call` → profildəki nömrəyə avtomatik zəng, 4 rəqəmli kod daxil edilir. Nömrə səhvdirsə: «Nömrə mənim deyil» → əl ilə yoxlamaya keçir. |
| Addım 3 (selfie) | Kamera + lokasiya (zaldan ≤100 m məcburi). |
| «Sahibliyi təsdiqlə» | Bütün 3 addım tamamlanmasa deaktiv + hansı addımın qaldığı yazılır. Göndərildikdən sonra: «2 iş günü içində cavab» + status ekranı. |
| «Rəyi silə bilmir» xəbərdarlığı | Toxunula bilməz (hüquqi bildiriş). |

---

## AXIN 15 — Abunə və ödənişlər

### 15.1 SPOT+ paywall
| Element | Davranış |
|---|---|
| Plan kartları (Aylıq/İllik) | Radio, illik default. |
| «7 gün pulsuz sına» | StoreKit 2 alış axını → uğur: `POST /subscriptions/verify` (receipt) → funksiyalar dərhal açılır + uğur ekranı. Uğursuz/ləğv: sheet açıq qalır. |
| «Bərpa et» | `AppStore.sync()` → mövcud abunəni bərpa edir. |
| «Şərtlər / Məxfilik» | In-app Safari. |
| ✕ | Bağla — istifadəçi bloklanmır. |

### 15.2 Ödənişlər
| Element | Davranış |
|---|---|
| «Planı dəyiş» | App Store abunə idarəsi (`showManageSubscriptions`). |
| «Ləğv et» | Eyni — Apple ekranına yönləndirir (App Store qaydası). |
| Kart sətri | Tap → kart detalı, «Əsas et / Sil». |
| «Yeni kart əlavə et» | PSP kart formu (3-D Secure). |
| Əməliyyat sətri | Tap → qəbz detalı + «Geri qaytarma tələb et» (şərtlərə uyğunsa) + «Qəbzi e-poçtla göndər». |
| «Bütün qəbzləri e-poçtla göndər» | `POST /payments/export`. |

### 15.3 Day-pass (aktiv keçid)
| Element | Davranış |
|---|---|
| QR | Statik (zal skaneri oxuyur) + 6 simvollu ehtiyat kod. Ekran parlaqlığı avtomatik maksimuma qalxır. |
| «Aylıq üzvlüyə keç · 50 ₼» | Membership-intent axını (**2.4**) + endirim tətbiq olunur. |
| «Nə daxildir» siyahısı | Toxunula bilməz. |
| Zal qəbul etməzsə | Ekranın altında «Keçid qəbul edilmədi?» → şikayət → avtomatik geri qaytarma axını. |
| 24:00-dan sonra | Keçid «İstifadə edilmiş / Vaxtı bitmiş» vəziyyətinə keçir, QR deaktiv olur. |

### 15.4 Kontekstli paywall
| Element | Davranış |
|---|---|
| Tetikləyici | 4-cü filtr seçimi, gizli profil toggle-ı, analitika ekranı, oflayn yükləmə düyməsi. |
| «7 gün pulsuz sına» | 15.1-dəki alış axını (bu sheet üzərində). |
| «3 filtrlə davam et» | Sheet bağlanır, son seçilən filtr geri alınır. İstifadəçi heç vaxt bloklanmır. |

---

## AXIN 16 — Evdə məşq və hərəkət kitabxanası

### 16.1 Evdə məşq
| Element | Davranış |
|---|---|
| Avadanlıq çipləri | Çox seçim → proqram dərhal yenidən yaranır (0.3 s crossfade). Yadda saxlanılır. |
| Vaxt düymələri | Tək seçim → hərəkət sayı və dövrə sayı yenilənir. |
| «Başla» | → **16.3** (evdə məşq rejimi). |
| «Zala keçməyə hazırsan?» volt kartı | → **2.1** Kəşf/zallar, «2 km» filtri ilə. |
| Proqram kartı | → **5.3**. |

### 16.2 Hərəkət kitabxanası
| Element | Davranış |
|---|---|
| Axtarış | Ad + alias («sinə pressi», «bench») + əzələ qrupu. |
| Əzələ çipləri | Filtr. |
| Hərəkət sətri | Tap → **5.5** video ekranı. |
| «Zalında var» etiketi | Zalın `amenities`-i ilə uyğunlaşdırma. Tap → izah. |
| «Zalında yoxdur» (solğun) | Tap → «Əvəzedici hərəkətlər» siyahısı. |
| `+` düyməsi | «Proqrama əlavə et» sheet-i (hansı proqram/gün). |
| **«Hərəkəti tanımırsan?»** | Kamera → dəzgahın şəkli → `POST /exercises/identify` (görüntü tanıma) → ehtimal olunan 3 hərəkət. Tanınmazsa: «Tapa bilmədik» + əl ilə axtarış. |

### 16.3 Evdə məşq rejimi
| Element | Davranış |
|---|---|
| Video | Avtoplay + loop, səssiz (evdə məşq üçün), tap → səs. |
| «0.5x» | Sürət. |
| Taymer halqası | Avtomatik geri sayır. Tap → pauza. |
| «Bitdi · növbəti» | Növbəti hərəkət (taymer sıfırlanır) + light haptic. |
| ‹ › | Əvvəlki/növbəti hərəkət (əl ilə). |
| Alt lent | Tap → o hərəkətə keç. Tamamlananlar volt check alır. |
| ✕ | Alert: «Məşqi dayandır? İrləyişin saxlanılacaq» → **5.7** xülasə (qısaldılmış: müddət + tamamlanan hərəkət sayı). |
| Video ikonu (üst sağ) | «Özünü çək» — formanı yoxlamaq üçün ön kamera pəncərəsi (lokal, heç yerə göndərilmir). |

---

## AXIN 17 — Qrup dərsləri

### 17.1 Dərs cədvəli
| Element | Davranış |
|---|---|
| Gün seçici | Tap → o günün cədvəli. |
| Bitmiş dərs (solğun) | Tap → dərs detalı (oxu-only) + «Rəy yaz» (iştirak edibsə). |
| «Yaz» | `POST /class-bookings` → düymə «Yazıldın» + təqvimə əlavə təklifi + P2 push xatırlatması (1 saat əvvəl). |
| «Növbə» (dolu dərs) | `POST /class-bookings {waitlist}` → yer boşalanda P1 push + 30 dəq təsdiq pəncərəsi. |
| «Ləğv et» | ≥2 saat əvvəl: pulsuz. <2 saat: xəbərdarlıq «Bu ay 2-ci gecikmiş ləğvdir; 3-cüdən sonra 7 gün rezervasiya bloku» (no-show idarəsi). |
| «Təqvimə əlavə et» | `EKEventStore`. |
| Dərs kartı | → **17.2**. |
| «Tural və 2 yoldaşın gəlir» | Tap → gələnlər siyahısı. |

### 17.2 Dərs detalı
| Element | Davranış |
|---|---|
| Müəllim kartı «Profil» | → **3.1**. |
| Gələnlər sətri «Yaz» | «Sual» axını (**2.6** ilə eyni məntiq). |
| «Yer tut» | 17.1-dəki `POST`. Day-pass sahibi üçün: «5 ₼ ödə» → Apple Pay. |
| 🔖 / ↗ | Saxla / paylaş. |

### 17.3 Dərs yarat (admin/müəllim)
| Element | Davranış |
|---|---|
| Ad / müəllim / yer sətirləri | Redaktə / seçici. |
| Gün dairələri | Toggle → təkrarlanan dərs. |
| Başlama / müddət / yer sayı | Wheel picker. |
| «Üzvlərə pulsuz» | Toggle → açıqsa day-pass qiyməti sahəsi görünür. |
| «Növbə siyahısı» | Toggle. |
| «Dərc et» | Validasiya → `POST /classes` → təsdiq alert: «214 üzvə bildiriş göndərilsin?» → «Bildirişsiz dərc et» seçimi də var. |
| Mövcud dərsi redaktə | Dəyişiklikdə: «Yazılmış 15 nəfərə dəyişiklik bildirişi göndərilsin?» |

---

## AXIN 18 — Nailiyyətlər və analitika

### 18.1 Nailiyyətlər
| Element | Davranış |
|---|---|
| Streak kartı | Tap → streak tarixçəsi (təqvim). SPOT+ istifadəçidə «Günü dondur» düyməsi (ayda 2). |
| Qazanılmış nişan | Tap → detal sheet: nə vaxt, hansı şərtlə + «Paylaş» → **7.3**. |
| «Yaxındır» kartı | Tap → nişanın şərti + qalan miqdar + müvafiq ekrana keçid («5 yoldaşla məşq» → **4.1**). |
| Kilidli nişan | Görünür, amma boz; şərti açıqdır. |

### 18.2 Tarixçə və təqvim
| Element | Davranış |
|---|---|
| Segment (Siyahı/Təqvim) | Görünüş dəyişir. |
| Təqvim kvadratı | Tap → o günün məşqi (məşq yoxdursa heç nə). Rəng tonu həcmə görə. |
| Ay naviqasiyası ‹ › | Dövr dəyişir. |
| Məşq sətri | Tap → tam məşq detalı: hər hərəkət, hər set, PR-lar, yoldaş, RPE. |
| Məşq detalında ⋯ | «Redaktə et (7 gün içində) / Sil / Feed-də paylaş». |
| «PR · sinə 72.5 kq» etiketi | Tap → o hərəkətin qrafiki. |

### 18.3 Analitika (SPOT+)
| Element | Davranış |
|---|---|
| Ekran açılışı | SPOT+ yoxsa → **15.4** paywall (arxa fon blur ilə preview görünür). |
| Əzələ qrupu sətri | Tap → o qrupun hərəkət parçalanması. |
| Disbalans xəbərdarlığı | Tap → «Düzəldici hərəkətlər» siyahısı + «Proqrama əlavə et». |
| 1RM qrafiki | Nöqtəyə tap → tarix + hesablanma metodu (Epley). |
| «Orta RPE / Ardıcıllıq / Yorğunluq» | Tap → metrikanın izahı. |
| «Müəllimə göndər» | Müəllim seçici → `POST /reports/share` → müəllimə P2 push + söhbətdə hesabat kartı. Müəllimi yoxsa: «Müəllim tap» → **2.5**. |

---

## AXIN 19 — Dəstək və moderasiya

### 19.1 Şikayət formu
| Element | Davranış |
|---|---|
| Səbəb radio | Tək seçim, məcburi. |
| «Əlavə məlumat» | 0–500 simvol, istəyə görə. |
| «Həmçinin blok et» | Default **açıq**. |
| «Son 20 mesajı əlavə et» | Default açıq. Söndürsə: xəbərdarlıq «Sübut olmadan yoxlama uzun çəkə bilər». |
| «Şikayəti göndər» | `POST /reports` → təsdiq ekranı: «Şikayət qeydə alındı · ID #4821 · 2 saat içində baxılacaq» + «Müraciətlərim»ə link. Şikayət edilən şəxs heç nə görmür. |
| «Ləğv et» | Bağla. |

### 19.2 Dəstək mərkəzi
| Element | Davranış |
|---|---|
| Axtarış | FAQ üzrə lokal axtarış → uyğun nəticə yoxsa «Dəstəyə yaz» təklifi. |
| «Canlı dəstək» | İş saatı içində: söhbət ekranı. Xaricində: forma + «12 saat içində cavab». |
| FAQ sətri | Tap → cavab ekranı + «Faydalı oldu? ✓/✗» + «Hələ də köməyə ehtiyacım var» → dəstək söhbəti (FAQ konteksti avtomatik əlavə olunur). |
| Müraciət sətri | Tap → müraciətin söhbəti/statusu. |
| «İcma qaydaları» | → **19.4**. |
| «Məxfilik / Şərtlər» | In-app Safari. |

### 19.3 Hesab, dil, data
| Element | Davranış |
|---|---|
| «Dil» | Sheet: Azərbaycan / Русский / English → app yenidən yüklənir (0.5 s crossfade). |
| «Çəki vahidi» | Segmented kq/lb → bütün ekranlarda dərhal konvertasiya (data kq-da saxlanılır). |
| «Görünüş» | Sheet: Sistem / İşıqlı / Qaranlıq. |
| «Datamı yüklə» | `POST /users/me/export` → toast. |
| «Apple Health» | Toggle → HealthKit dialoqu. |
| «Yüklənmiş videolar · 1.2 GB» | Tap → siyahı + «Hamısını təmizlə» + fərdi silmə. |
| «Hesabı müvəqqəti dayandır» | Sheet: müddət seçimi (1 həftə / 1 ay / müddətsiz) → profil gizlənir, söhbətlər arxivlənir, abunə davam edir (xəbərdarlıq göstərilir). Girişdə avtomatik bərpa. |
| «Hesabı sil» | **2 addım:** 1) səbəb sorğusu (radio + mətn), 2) təsdiq — nəticələr siyahısı + «SİL» yazma sahəsi → `DELETE /users/me` → 30 gün geri qaytarma pəncərəsi + e-poçt təsdiqi → çıxış. |

### 19.4 İcma qaydaları
| Element | Davranış |
|---|---|
| Qayda kartları | Toxunula bilməz (statik məzmun). |
| «Cəza pillələri» | Toxunula bilməz. |
| Ekranın açılış nöqtələri | Onboarding (link), dəstək mərkəzi, şikayət formu, moderasiya bildirişi (cəza alanda məcburi göstərilir). |

---

## Deep link xəritəsi

| URL | Ekran |
|---|---|
| `spot.az/gym/{slug}` | 2.4 zal profili |
| `spot.az/trainer/{slug}` | 3.1 müəllim profili |
| `spot.az/u/{username}` | 4.3 / 10.1 profil |
| `spot.az/program/{id}` | 5.3 proqram detalı |
| `spot.az/exercise/{id}` | 5.5 hərəkət videosu |
| `spot.az/post/{id}` | 7.5 post detalı |
| `spot.az/challenge/{id}` | 8.2 challenge detalı |
| `spot.az/class/{id}` | 17.2 dərs detalı |
| `spot.az/checkin/{gym_qr}` | 2.8 check-in (QR birbaşa) |
| `spot.az/invite/{code}` | Dəvət qəbulu → onboarding və ya match |

Autentifikasiya olunmamış istifadəçi deep link açarsa: məzmun oxu-only göstərilir + «Davam etmək üçün daxil ol» banner.

---

## Haptic xəritəsi

| Hadisə | Haptic |
|---|---|
| Primary düymə | `.light` impact |
| Çip / segment seçimi | `.selection` |
| Set tamamlanması | `.light` impact |
| PR / match / check-in uğuru | `.success` notification |
| Xəta (səhv kod, ödəniş) | `.error` notification |
| Limit aşımı (3-cü məqsəd) | `.warning` notification |
| Fasilə taymerinin son 3 saniyəsi | `.light` tick ×3 |
| Swipe kart threshold | `.medium` impact |
