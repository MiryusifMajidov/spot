# SPOT — mağaza mətnləri / тексты для магазинов / store listing copy

Hazırlandı: 2026-09-23 · tətbiq versiyası **1.3.8** (`app.json`), Android `versionCode 12`,
bundle / package **com.spot.app**.

**Bu faylın qaydası:** burada yazılan hər cümlə tətbiqin BUGÜNKÜ kodundan yoxlanılıb.
Say, reytinq, istifadəçi sayı və zal kataloqu vəd edilmir — çünki onlar yoxdur.
Hər blok birbaşa kopyalanmaq üçündür; simvol sayları başlıqlarda göstərilib və yoxlanılıb.

> **ƏN VACİBİ — mətn hazırdır, tətbiq hazır deyil.** İki şey review-u kəsir və ikisi də
> mətnlə həll olunmur: (1) kataloqda **siyahıya salınmış bir dənə də zal yoxdur**, ona görə
> Yoldaşlar, check-in və day-pass axınlarına çatmaq mümkün deyil (§0.1); (2) **Sign in with
> Apple iPhone-da görünmür**, çünki Supabase layihəsində Apple provayderi sönülüdür — bu,
> Guideline 4.8 üzrə birbaşa rədd səbəbidir (§7.2, «Açıq suallar» №2).

> **Diqqət — App Store-da Azərbaycan dili yoxdur.** App Store Connect-in dil siyahısında
> `az` yoxdur; Google Play-də isə `az-AZ` var. Ona görə Play üçün üç dil, App Store üçün
> praktikada **English (primary) + Русский** işləyir. Aşağıdakı App Store «az» bloku
> hazırdır, amma onu hara qoyacağına sahib özü qərar verməlidir (bax: «Açıq suallar»).

---

## 0. Nə doğrudur, nə yox — mətn yazarkən sərhəd

Koddan təsdiqlənib (iddia edilə bilər):

- **Məşq yoldaşı**: uyğunluq zal (30) / cədvəl (25) / səviyyə (15) / məqsəd (15) /
  məşq tipi (10) / ardıcıllıq (5) üzrə hesablanır (`src/store/db.ts` →
  `computeCompatibility`; UI tərəfi `src/components/PartnerRow.tsx` → `compatOf`),
  sorğu real tarix və saatla göndərilir (`src/app/(tabs)/discover/match.tsx`).
- **Müəllimlər**: Kəşfdə siyahı, profil, sorğu göndərmə (`rezerv` deyil — sorğu),
  qəbul/rədd (`src/lib/roles.ts` → `requestTrainer`, `decideTrainerRequest`).
- **Proqram təyini**: müəllim şagirdə proqram təyin edir, şagirdin Məşq tabında görünür
  (`assignStudentProgram`, `getMyAssignedProgram`). Bütün proqramlar pulsuzdur.
- **Check-in**: zalın QR kodu və ya əl ilə yazılan kod; qərarı server verir — gündə bir
  dəfə, iş saatlarında (`check_in_with_code`, `src/app/(tabs)/checkin.tsx`).
- **Day-pass**: tətbiqdə qeydə alınır, server 6 simvollu kod verir, həmin gün bitir;
  resepsiya «Yoxla» + «Təsdiqlə» ilə keçirir (`supabase/schema79…`, `src/app/gym/pass.tsx`).
  **Pul zalda ödənilir.**
- **Məşq dəftəri**: set / kq / təkrar, keçən dəfə, növbəti addım təklifi, şəxsi rekordlar,
  həftəlik göstəricilər, seriya, tarixçə (`src/app/(tabs)/workout/session.tsx`).
- **Hərəkət kitabxanası**: **34 hərəkət** (`src/store/db.ts` → `exerciseLibrary`) — əzələ
  qrupu, avadanlıq, tipik səhv, əvəzedicilər.
- **İcma**: texnika videoları (≤60 san, ≤100 MB) və mətn postları; bəyənmə, şərh, saxlama,
  izləmə, şikayət, blok.
- **Mesajlaşma**: söhbət qəbul edilmiş sorğudan sonra açılır — **VƏ** elanı açıq olan
  müəllimə sorğusuz da yazmaq olar (`open_thread` → `has_relationship_with` **or**
  `is_listed_trainer`, `supabase/schema73_message_any_trainer.sql`). İlk mesajdan sonra
  cavab gələnə qədər ikincisi göndərilmir (`schema83`); bloklanmışla söhbət açılmır.
  (`src/lib/chat.ts`-in başlıq şərhi köhnəlib — orada hələ «yalnız qəbul edilmiş
  sorğudan sonra» yazılır; qərar verən bazadır.)
- **Üç dil**: az / ru / en, ilk ekrandan dəyişilir (`src/lib/i18n.ts`, `LanguagePicker`).
- **Qonaq rejimi**: hesabsız yalnız Kəşf (Zallar + Müəllimlər) açıqdır; digər tablar gizlidir
  (`src/app/(tabs)/_layout.tsx`, `src/lib/memberOnly.tsx`).
- **Zal paneli**: zal qeydiyyatı, sahiblik təsdiqi, saatlar, qiymətlər (məlumat üçün),
  dərslər, QR, üzv siyahısı, doluluq, day-pass yoxlaması, rəylərə cavab.
- **Məxfilik**: zal sahibi üzvün çəkisini, məşq detallarını, şəkillərini və söhbətlərini
  GÖRMÜR — yalnız öz zalındakı check-in-ləri (`src/app/gym/members.tsx`); üzv siyahısından
  gizlənmək, məlumat ixracı, hesab silmə (`src/app/(tabs)/profile/privacy.tsx`).
- **Ödəniş yoxdur**: `src/lib/legal.ts` → «SPOT ödəniş qəbul etmir»; qiymətlər hər yerdə
  «yalnız məlumat üçün» işarələnib.

### 0.1 Bu gün nə İŞLƏMİR — göndərməzdən əvvəl oxunmalı

Yuxarıdakı funksiyalar koda salınıb və işləyir, amma **bu gün açılan boş tətbiqdə bir
neçəsinə çatmaq mümkün deyil**. Səbəb birdir: kataloqda zal yoxdur.

Canlı bazadan (23.09.2026): `public.gyms`-də 2 sətir var, **ikisi də `listed = false`** —
yəni heç bir istifadəçi onları görmür (`schema41`: yalnız `listed` zal açıqdır). Deməli
**açıq kataloq 0 zaldır**. Bundan çıxan zəncir:

| Nə | Niyə çatmır |
|---|---|
| **Yoldaşlar** seqmenti | `home_gym_id` olmadan siyahı açılmır — «Zalını seç — yoldaşlar zala görə tapılır» göstərilir (`discover/index.tsx`), `computeCompatibility` isə zalsız `score: 0` qaytarır |
| **Əsas zalın seçilməsi** | seçim siyahısı kataloqdan gəlir (`profile/edit.tsx` → `gyms.slice(0, 12)`); kataloq boşdursa yeganə variant «Zalım yoxdur»dur |
| **Check-in** | zalın QR kodu lazımdır; canlı bazada cəmi 1 `gym_checkin_codes` sətri var və o, siyahıda olmayan zala aiddir |
| **Day-pass** | zal səhifəsindən verilir — zal yoxdursa səhifə də yoxdur |

**Bu, mətn məsələsi deyil, məzmun məsələsidir.** Apple (2.1) və Google yoxlayıcısı tətbiqi
açıb boş ekran görürsə, listinqin nə yazdığının əhəmiyyəti yoxdur. Ən azı **bir real zal**
siyahıya salınmalı (`listed = true`) və onun QR kodu olmalıdır — yoxsa nə ekran şəkli
çəkilir, nə review keçir. Bax: «Açıq suallar» №1.

**Kəşf → Müəllimlər boş deyil, amma daha pisdir:** bazada 3 açıq (`listed`) müəllim elanı
var və hər üçü test hesabıdır — ixtisas sahəsində hərfi mənada «Test», «Test1»,
«Funksional guc test» yazılır. Yoxlayıcının qonaq rejimində görəcəyi yeganə məzmun budur.
Ekran şəkli çəkilməzdən və göndərmədən əvvəl ya təmizlənməli, ya da real elanla
əvəzlənməlidir (bax: «Açıq suallar» №3).

İddia EDİLMƏMƏLİ:

- Zal kataloqu. Bazadakı 2 sətrin ikisi də `listed = false`-dur — yəni istifadəçinin
  gördüyü kataloq **sıfır zaldır**. «Zallar», «şəhərdəki zallar», «zal tap» kimi vəd
  verilə bilməz.
- «Hər hərəkətin videosu». Kitabxanadakı 34 hərəkətin `videoUrl`-u boşdur; video yalnız
  istifadəçilər yükləyəndə görünür.
- İstifadəçi sayı, reytinq, «minlərlə zal», «ən böyük icma» — heç biri yoxdur.
- «Rezervasiya» / «bron». Müəllimə gedən şey sorğudur, təsdiq müəllimdədir.
- Tablet dəstəyi (iOS-da `supportsTablet: false`).

---

# GOOGLE PLAY

## 1. Google Play — Azərbaycan dili (az-AZ)

### Tətbiqin adı (26/30)

```
SPOT — məşq yoldaşı və zal
```

### Qısa təsvir (71/80)

```
Zalını seç, məşq yoldaşını tap, hər məşqini qeyd et. SPOT ödəniş almır.
```

### Tam təsvir (2 692/4 000)

```
SPOT zala gedən adam üçündür: yoldaş tapmaq, müəllim tapmaq və hər məşqi qeyd etmək üçün.

SPOT ÖDƏNİŞ QƏBUL ETMİR
Tətbiqdə abunə, tətbiqdaxili satınalma və kilidli funksiya yoxdur. Zalın aylıq haqqı, bir günlük keçid və müəllim dərsinin qiyməti burada yalnız məlumat üçün göstərilir — pulu zala və ya müəllimə birbaşa, tətbiqdən kənarda ödəyirsən. SPOT bu ödənişlərin tərəfi deyil və komissiya götürmür.

MƏŞQ YOLDAŞI
Uyğunluq sənin zalın, məqsədin, səviyyən və məşq saatların üzrə hesablanır — nə üstündən götürülmüş bir rəqəm, nə də təsadüfi siyahı. Bəyəndiyin adama real tarix və saat təklif edib sorğu göndərirsən. O qəbul edənə qədər heç nə açılmır.

MÜƏLLİM VƏ PROQRAM
Kəşfdə müəllim profillərinə baxırsan: ixtisas, bio, iş günləri. Gün, saat və qeyd yazıb sorğu göndərirsən. Bu, rezervasiya deyil — müəllimə sorğudur; qəbul və ya rədd qərarı onundur. Müəllim sənə proqram təyin edəndə proqramın özü — günləri, hərəkətləri, set və təkrar sayı ilə — sənin Məşq bölmənə düşür. Bütün proqramlar pulsuzdur.

CHECK-IN VƏ DAY-PASS
Zalın resepsiyasındakı QR-ı oxudursan, ya da kodu əl ilə yazırsan. Qərarı server verir: gündə bir dəfə, yalnız iş saatlarında. Üzv deyilsənsə, day-pass tətbiqdə qeydə alınır və sənə altı simvollu kod verilir; resepsiya həmin kodu yoxlayıb təsdiqləyir. Pulu zalda ödəyirsən — SPOT ona toxunmur.

MƏŞQ DƏFTƏRİ
Sessiya ekranında hər seti kq və təkrarla yazırsan, keçən dəfə nə etdiyini görürsən və növbəti addım üçün təklif alırsan. Həftəlik göstəricilər, şəxsi rekordlar, seriya və tarixçə — hamısı yalnız sənin gözün üçün. Kitabxanada 34 hərəkət var: əzələ qrupu, avadanlıq, tipik səhv və əvəzedici variantlar.

İCMA
Texnika videoları və qısa postlar. Bəyən, şərh yaz, saxla, izlə. Şikayət və blok düymələri hər yerdədir.

MESAJLAŞMA
Başqa bir istifadəçi ilə söhbət yalnız qəbul edilmiş sorğudan sonra açılır. Bir istisna var: elanı açıq olan müəllimə sual vermək üçün gözləmək lazım deyil — ona birbaşa yaza bilərsən. İlk mesajdan sonra cavab gələnə qədər ikincisini göndərmək olmur, bloklanmış adamla isə söhbət ümumiyyətlə açılmır.

ÜÇ DİL
Azərbaycanca, rusca və ingiliscə. Dili ilk ekrandan, hesab açmadan dəyişə bilirsən.

QONAQ REJİMİ
Hesabsız da Kəşfə girib zallara və müəllimlərə baxa bilirsən. Qeydiyyat yalnız insanlarla əlaqə, check-in və qeyd üçün lazımdır.

MƏXFİLİK
Zal sahibi və admin sənin çəkini, məşq detallarını, şəkillərini və söhbətlərini görmür — yalnız öz zalındakı check-in-lərini görür. İstəsən, zalın üzv siyahısında ümumiyyətlə görünmürsən. Məlumatlarını ixrac edə, hesabını tətbiqin içindən silə bilərsən.

SPOT Azərbaycanda yeni qurulur. Zal siyahısı sıfırdan başlayır: zalını özün əlavə edə və sahibliyini təsdiqə göndərə bilərsən.
```

### «Yeniliklər» — ilk buraxılış (260/500)

```
SPOT-un ilk buraxılışı.

Məşq yoldaşı tapmaq, müəllimə sorğu göndərmək, QR ilə check-in, day-pass kodu, set-set məşq dəftəri və icma lenti. Üç dil: azərbaycanca, rusca, ingiliscə.

SPOT ödəniş qəbul etmir — qiymətlər yalnız məlumat üçündür, pul zalda ödənilir.
```

---

## 2. Google Play — Русский (ru-RU)

### Название приложения (21/30)

```
SPOT — напарник и зал
```

### Краткое описание (72/80)

```
Выбери зал, найди напарника, записывай тренировки. SPOT не берёт оплату.
```

### Полное описание (2 817/4 000)

```
SPOT — для того, кто ходит в зал: найти напарника, найти тренера и записывать каждую тренировку.

SPOT НЕ ПРИНИМАЕТ ОПЛАТУ
В приложении нет подписок, встроенных покупок и закрытых функций. Абонемент зала, разовое посещение и цена занятия с тренером показаны здесь только как информация — платишь ты напрямую залу или тренеру, вне приложения. SPOT не участвует в этих платежах и не берёт комиссию.

НАПАРНИК ПО ТРЕНИРОВКАМ
Совместимость считается по твоему залу, целям, уровню и времени тренировок — это не выдуманное число и не случайный список. Ты предлагаешь человеку настоящую дату и время и отправляешь запрос. Пока он не примет, не открывается ничего.

ТРЕНЕР И ПРОГРАММА
В «Обзоре» смотришь профили тренеров: специализация, описание, рабочие дни. Выбираешь день, время, пишешь заметку и отправляешь запрос. Это не бронирование — это запрос тренеру, решение принимает он. Когда тренер назначит тебе программу, она придёт целиком — дни, упражнения, подходы и повторения — в твой раздел «Тренировки». Все программы бесплатные.

CHECK-IN И РАЗОВОЕ ПОСЕЩЕНИЕ
Сканируешь QR на ресепшене зала или вводишь код вручную. Решение принимает сервер: один раз в день и только в рабочие часы. Если ты не член зала, разовое посещение оформляется в приложении и тебе выдаётся код из шести символов; на ресепшене его проверяют и подтверждают. Деньги ты платишь в зале — SPOT к ним не прикасается.

ДНЕВНИК ТРЕНИРОВОК
На экране тренировки записываешь каждый подход в кг и повторениях, видишь, что было в прошлый раз, и получаешь подсказку на следующий шаг. Итоги недели, личные рекорды, серия и история — всё это видишь только ты. В библиотеке 34 упражнения: мышечная группа, оборудование, типичная ошибка и чем заменить.

СООБЩЕСТВО
Видео техники и короткие посты. Лайк, комментарий, сохранение, подписка. Кнопки жалобы и блокировки есть везде.

СООБЩЕНИЯ
Переписка с другим пользователем открывается только после принятого запроса. Есть одно исключение: чтобы задать вопрос тренеру с открытым объявлением, ждать не нужно — ему можно написать напрямую. После первого сообщения второе не отправится, пока не придёт ответ, а с заблокированным человеком чат не открывается вообще.

ТРИ ЯЗЫКА
Азербайджанский, русский и английский. Язык переключается с первого экрана, ещё до регистрации.

ГОСТЕВОЙ РЕЖИМ
Без аккаунта можно зайти в «Обзор» и посмотреть залы и тренеров. Регистрация нужна только для связи с людьми, check-in и записей.

ПРИВАТНОСТЬ
Владелец зала и админ не видят твой вес, детали тренировок, фотографии и переписку — только твои check-in в его зале. При желании ты вообще не показываешься в списке членов зала. Свои данные можно выгрузить, а аккаунт — удалить прямо в приложении.

SPOT только начинается в Азербайджане. Список залов стартует с нуля: свой зал ты можешь добавить сам и отправить подтверждение владения.
```

### «Что нового» — первый релиз (284/500)

```
Первый релиз SPOT.

Поиск напарника по тренировкам, запрос тренеру, check-in по QR, код разового посещения, дневник по подходам и лента сообщества. Три языка: азербайджанский, русский, английский.

SPOT не принимает оплату — цены показаны только как информация, деньги платишь в зале.
```

---

## 3. Google Play — English (en-US)

### App name (25/30)

```
SPOT — gym partner finder
```

### Short description (71/80)

```
Pick your gym, find a training partner, log every workout. No payments.
```

### Full description (2 882/4 000)

```
SPOT is for the person who actually goes to the gym: find a partner, find a trainer, and keep a record of every workout.

SPOT TAKES NO PAYMENTS
There are no subscriptions, no in-app purchases and no locked features. A gym's monthly fee, a day pass and a trainer's rate are shown here as information only — you pay the gym or the trainer directly, outside the app. SPOT is not a party to those payments and takes no commission.

A TRAINING PARTNER
Compatibility is worked out from your gym, your goals, your level and the hours you train — not a made-up number and not a random list. You offer a real date and time and send a request. Nothing opens until the other person accepts.

TRAINERS AND PROGRAMS
In Discover you read trainer profiles: speciality, bio, working days. You pick a day and an hour, write a note and send a request. This is not a booking — it is a request, and the trainer decides. When a trainer assigns you a program, the program itself arrives — its days, exercises, sets and reps — in your Workouts tab. Every program is free.

CHECK-IN AND DAY PASS
You scan the QR at the gym's reception, or type the code by hand. The server decides: once a day, and only during opening hours. If you are not a member, a day pass is registered in the app and you get a six-character code; reception checks that code and confirms it. You pay at the gym — SPOT never touches the money.

WORKOUT LOG
On the session screen you write every set in kg and reps, you see what you did last time, and you get a suggestion for the next step. Weekly totals, personal records, your streak and your history are yours alone to see. The library holds 34 movements with muscle group, equipment, the common mistake and what to swap it for.

COMMUNITY
Technique clips and short posts. Like, comment, save, follow. Report and block are everywhere.

MESSAGES
A chat with another user opens only after a request has been accepted. There is one exception: to ask a question of a trainer whose listing is up you do not have to wait — you can write to them directly. After your first message the second one will not send until they reply, and a chat never opens with someone you have blocked.

THREE LANGUAGES
Azerbaijani, Russian and English. You can switch the language on the very first screen, before you make an account.

GUEST MODE
Without an account you can still open Discover and look at gyms and trainers. Signing up is only needed to reach people, to check in and to keep records.

PRIVACY
A gym owner or admin cannot see your weight, your workout details, your photos or your chats — only your check-ins at their gym. If you prefer, you do not appear in the gym's member list at all. You can export your data and delete your account from inside the app.

SPOT is just starting in Azerbaijan. The gym list starts from zero: you can add your own gym and send it for ownership verification.
```

### What's new — first release (312/500)

```
The first release of SPOT.

Find a training partner, send a request to a trainer, check in with a QR code, get a day-pass code, log your workout set by set, and read the community feed. Three languages: Azerbaijani, Russian, English.

SPOT takes no payments — prices are information only, and you pay at the gym.
```

---

# APP STORE

> App Store Connect-də Azərbaycan dili yoxdur — aşağıdakı «az» bloku hazırdır, amma onu
> hansı lokalizasiyaya qoyacağın (və ya heç qoymayacağın) sənin qərarındır.
> Apple-da işləyən praktik quraşdırma: **primary = English (U.S.)**, əlavə = **Русский**.

## 4. App Store — Azərbaycan dili (az) — lokalizasiya yeri seçilməlidir

### Name (26/30)

```
SPOT — məşq yoldaşı və zal
```

### Subtitle (27/30)

```
Yoldaş tap, məşqini qeyd et
```

### Promotional text (153/170)

```
Zalın QR-ı ilə check-in, müəllimə sorğu, məşq yoldaşı və hər set üçün qeyd dəftəri. Ödəniş yoxdur — qiymətlər yalnız məlumat üçündür, pul zalda ödənilir.
```

### Keywords (91/100 — vergüllə, boşluqsuz)

```
zal,fitnes,məşq,yoldaş,müəllim,proqram,check-in,qr,day-pass,idman,bodybuilding,ştanq,seriya
```

### Description (2 692/4 000)

Google Play az tam təsviri ilə eynidir — yuxarıdakı **1-ci bölmədəki «Tam təsvir»** blokunu
olduğu kimi kopyala. (Apple format etiketlərini dəstəkləmir; mətn onsuz da düz mətndir.)

### Support URL / Marketing URL

```
Support URL   : https://[DOLDURULMALI: spot-az domeni]/destek
Marketing URL : https://[DOLDURULMALI: spot-az domeni]/
```

---

## 5. App Store — Русский (ru)

### Name (21/30)

```
SPOT — напарник и зал
```

### Subtitle (26/30)

```
Найди напарника, веди учёт
```

### Promotional text (128/170)

```
Check-in по QR зала, запрос тренеру, поиск напарника и дневник каждого подхода. Оплаты в приложении нет — деньги платишь в зале.
```

### Keywords (91/100 — через запятую, без пробелов)

```
зал,фитнес,тренировка,напарник,тренер,программа,чекин,qr,разовое,спорт,штанга,дневник,серия
```

### Description (2 817/4 000)

Совпадает с полным описанием для Google Play ru — скопируй блок **«Полное описание»** из
раздела 2 целиком.

### Support URL / Marketing URL

```
Support URL   : https://[ЗАПОЛНИТЬ: домен spot-az]/support
Marketing URL : https://[ЗАПОЛНИТЬ: домен spot-az]/
```

---

## 6. App Store — English (en-US) — primary

### Name (25/30)

```
SPOT — gym partner finder
```

### Subtitle (28/30)

```
Find a partner, log workouts
```

### Promotional text (133/170)

```
QR check-in at your gym, requests to trainers, a partner search and a log for every set. No payments in the app — you pay at the gym.
```

### Keywords (90/100 — comma-separated, no spaces)

```
gym,fitness,workout,partner,trainer,program,checkin,qr,daypass,strength,log,barbell,streak
```

### Description (2 882/4 000)

Same as the Google Play en full description — copy the **Full description** block from
section 3 as it stands.

### Support URL / Marketing URL

```
Support URL   : https://[TO FILL: spot-az domain]/support
Marketing URL : https://[TO FILL: spot-az domain]/
```

---

# 7. Hələ lazım olan mağaza materialları

## 7.1 Google Play

| Material | Ölçü / format | Vəziyyət |
|---|---|---|
| Tətbiq ikonu | **512 × 512 px**, 32-bit PNG, ≤1 MB | `assets/images/icon.png` var — 512-yə export lazımdır |
| Feature graphic | **1024 × 500 px**, PNG/JPEG, şəffaflıqsız | **YOXDUR** — yaradılmalıdır |
| Telefon ekran şəkilləri | ən az **2**, ən çox 8; 16:9 və ya 9:16; hər tərəf 320–3840 px. Tövsiyə: **1080 × 1920** | **YOXDUR** |
| 7″ planşet şəkilləri | 1024 × 600+ | isteğe bağlı — tətbiq telefon üçündür, keç |
| 10″ planşet şəkilləri | 1920 × 1200+ | isteğe bağlı — keç |
| Promo video (YouTube) | isteğe bağlı | yoxdur, lazım deyil |
| Məxfilik siyasəti URL-i | **məcburi** | səhifə **hazırdır** — `store/legal/privacy.html`; yayımlanmayıb (domen + `fly deploy`, bax `store/legal/README.md` §3) |
| Hesab silmə URL-i | Play hesab açan tətbiqlərdən **tələb edir** (veb üzərindən sorğu) | səhifə **hazırdır** — `store/legal/delete-account.html`; yayımlanmayıb, üstəlik əlaqə e-poçtu boşdur |
| İstifadə şərtləri URL-i | isteğe bağlı (Play), Apple üçün faydalı | səhifə **hazırdır** — `store/legal/terms.html` |
| Data safety forması | Play Console-da doldurulur | cavablar hazırdır — `store/data-safety.md` §3; konsola köçürülməyib |
| Məzmun reytinqi anketi (IARC) | Play Console → App content | doldurulmayıb. Şərtlər **16+** deyir (`src/lib/legal.ts`); anket sosial/UGC, istifadəçi ünsiyyəti və istifadəçi yerləşdirdiyi məzmun suallarına «bəli» tələb edir |
| Target audience and content | Play Console → App content | doldurulmayıb. Yaş qrupu **uşaqları əhatə etməməlidir** — onboarding 16-dan aşağı yaşı qəbul etmir (`onboarding/profile.tsx`) |
| Ads deklarasiyası | Play Console → App content | «Bu tətbiqdə reklam yoxdur» — doğrudur (`package.json`-da reklam SDK-sı yoxdur) |

## 7.2 App Store

| Material | Ölçü / format | Vəziyyət |
|---|---|---|
| App icon | **1024 × 1024 px**, PNG, alfa kanalı YOX, künclər yuvarlaqlaşdırılmamış | 1024-ə export lazımdır |
| iPhone 6.9″ ekran şəkilləri | **1290 × 2796** və ya 1320 × 2868 — **məcburi**, 3–10 ədəd | **YOXDUR** |
| iPhone 6.5″ ekran şəkilləri | 1242 × 2688 və ya 1284 × 2778 — tövsiyə | **YOXDUR** |
| iPad şəkilləri | — | **lazım deyil**: `app.json`-da `ios.supportsTablet: false` |
| App preview video | 15–30 san, cihaz ölçüsündə | isteğe bağlı |
| Privacy Policy URL | **məcburi** | səhifə hazırdır (`store/legal/privacy.html`), yayımlanmayıb |
| Support URL | **məcburi** | **YOXDUR** (domen + səhifə + e-poçt lazımdır) |
| App Privacy («Nutrition label») | App Store Connect-də doldurulur | cavablar hazırdır — `store/data-safety.md` §4 |
| **Sign in with Apple** | Google girişi olduğu üçün Apple girişi MƏCBURİDİR (Guideline 4.8) | **İŞLƏMİR — BLOKLAYICI.** Kod hazırdır (`usesAppleSignIn: true`, `expo-apple-authentication`, `signInWithApple`), amma **Supabase layihəsində Apple provayderi sönülüdür**: `GET /auth/v1/settings` → `"apple": false`. `useSocialProviders` serverin «sönülü» dediyi düyməni çəkmir (`src/lib/auth.ts`), ona görə bu gün iPhone-da yalnız «Google ilə davam et» + e-poçt görünür. Canlı `auth.identities`-də yalnız `google` var. Bax: «Açıq suallar» №2 |
| Yaş reytinqi (Age Rating) | App Store Connect → App Information | doldurulmayıb. UGC + istifadəçi ünsiyyəti + «tənzimlənməmiş istifadəçi məzmunu» sualları «bəli»dir; nəticə 17+/18+ ola bilər |
| App Review Information | ad, telefon, e-poçt + Notes | **YOXDUR** — rəsmi e-poçt olmadan doldurula bilmir |
| Demo hesab (Review üçün) | Apple tələb edir — istifadəçi adı + şifrə, və ya izahat | **YOXDUR** — bax «Açıq suallar» |

## 7.3 İkonu hazırlamaq üçün mənbə fayllar

`D:\spot\assets\images\` içində: `icon.png`, `android-icon-foreground.png`,
`android-icon-background.png`, `android-icon-monochrome.png`, `splash-icon.png`.
Play üçün 512 × 512, Apple üçün 1024 × 1024 (alfasız) export edilməlidir.

---

# 8. Ən yaxşı 5 ekran şəkli və onların yazıları

Ardıcıllıq bilərəkdən belədir: əvvəl tətbiqin niyə açıldığı (yoldaş), sonra zalda nə
etdiyi (check-in, day-pass), sonra necə yadda saxladığı (dəftər, müəllim).

### 1 — Kəşf → «Yoldaşlar» (`src/app/(tabs)/discover/index.tsx`, 3-cü seqment)

Uyğunluq faizi, səbəb etiketləri və zal adı ilə yoldaş siyahısı. Tətbiqin əsas vədi budur.

| dil | yazı |
|---|---|
| az | Sənə uyğun məşq yoldaşını tap |
| ru | Найди подходящего напарника |
| en | Find a partner who fits your training |

### 2 — Check-in (`src/app/(tabs)/checkin.tsx`)

Kamera ekranı, çərçivə və «Kodu əl ilə yaz» düyməsi görünməlidir.

| dil | yazı |
|---|---|
| az | Resepsiyadakı QR ilə check-in |
| ru | Check-in по QR на ресепшене |
| en | Check in with the QR at reception |

### 3 — Məşq sessiyası (`src/app/(tabs)/workout/session.tsx`)

Set sətirləri, kq/təkrar sahələri, «keçən dəfə» və növbəti addım təklifi.

| dil | yazı |
|---|---|
| az | Hər seti yaz — keçən dəfəni görərək |
| ru | Записывай каждый подход, видя прошлый раз |
| en | Log every set, with last time in front of you |

### 4 — Müəllim profili + sorğu (`src/app/(tabs)/discover/trainer/[id].tsx` → `reserve/[id].tsx`)

İxtisas, iş günləri, gün/saat seçimi. Kadrda «Qiymət yalnız məlumat üçündür» sətri qalsın.

| dil | yazı |
|---|---|
| az | Müəllimə sorğu göndər, proqramını al |
| ru | Отправь запрос тренеру и получи программу |
| en | Ask a trainer, get the program they assign |

### 5 — Zal səhifəsi, day-pass kodu ilə (`src/app/(tabs)/discover/gym/[id].tsx`)

Altı simvollu kod və onun altındakı «pul zalda ödənilir» izahı. «Ödəniş yoxdur» mesajını
bir ekran şəklində göstərməyin ən düz yolu budur.

| dil | yazı |
|---|---|
| az | Day-pass tətbiqdə, ödəniş zalda |
| ru | Разовое посещение в приложении, оплата в зале |
| en | Day pass in the app, paid at the gym |

**Ekran şəkli çəkərkən — əvvəlcə oxunmalı:**

1. **Beş şəkildən dördü bu gün çəkilə bilmir.** Kataloqda siyahıya salınmış zal yoxdur
   (§0.1), ona görə 1-ci (Yoldaşlar — əsas zal tələb edir), 2-ci (check-in — zalın QR
   kodu tələb edir) və 5-ci (day-pass — zal səhifəsi tələb edir) kadrlar boş və ya
   bağlı ekran verəcək. 4-cü kadr (müəllim profili) yalnız test elanları göstərir.
   Ardıcıllıq doğrudur — sadəcə əvvəlcə **bir real zal siyahıya salınmalıdır**.
2. Kadrda görünən hər rəqəm real olmalıdır: uyğunluq faizi, doluluq, seriya — heç biri
   «gözəl görünsün deyə» düzəldilməməlidir.
3. Bazadakı iki zal sətri (`Ksjns`, `SPOT Test Zal`) `listed = false`-dur, yəni onlar
   onsuz da kadra düşmür. Təhlükə onlarda deyil — **test müəllim elanlarındadır**
   («Test», «Test1», «Funksional guc test»), çünki onlar açıqdır və 4-cü kadr məhz
   oradan çəkilir.
4. Yalnız telefon kadrı lazımdır: iOS-da `supportsTablet: false`.

---

# 9. Mətni yerləşdirərkən yadda saxla

- Play-də dil kodları: `az-AZ`, `ru-RU`, `en-US`. Default dil **az-AZ** olmalıdır —
  tətbiqin özü də azərbaycancadır.
- App Store-da `az` yoxdur (bax yuxarı). Primary dili **English (U.S.)** qoy, **Русский**
  əlavə et.
- Play qısa təsviri 80, tam təsviri 4000, «yeniliklər» 500 simvoldur — yuxarıdakı bütün
  mətnlər bu hədlərin altındadır.
- Apple `keywords` sahəsində boşluq YOX, yalnız vergül. Ad və subtitle-dakı sözləri
  təkrarlamağa ehtiyac yoxdur — onlar onsuz da indekslənir.
- `₼` işarəsi mağaza mətnlərində işlədilmir, çünki tətbiqdə qiymət yalnız məlumatdır və
  mağaza mətnində qiymət vermək «tətbiqdaxili ödəniş var» təəssüratı yaradır.

---

# 10. Açıq suallar — yalnız sahib həll edə bilər

Bu mətnlər hazırdır, amma aşağıdakılar olmadan listinq mağazaya yüklənə bilməz.
Heç birini mən uydurmadım və uydurmayacağam — hamısı sənin qərarın və ya sənin hesabındır.
Sıra təsadüfi deyil: 1–3 **review-u kəsən** maddələrdir, qalanları isə tamamlayıcıdır.

1. **Kataloqda bir dənə də siyahıya salınmış zal yoxdur — bu, ən böyük bloklayıcıdır.**
   `public.gyms`-dəki iki sətrin ikisi də `listed = false`. Nəticə (§0.1): əsas zal
   seçilə bilmir → **Yoldaşlar** siyahısı açılmır; QR kodu olan zal yoxdur → **check-in**
   işləmir; zal səhifəsi yoxdur → **day-pass** işləmir. Yəni tətbiqin listinqdə vəd
   edilən üç əsas axınından heç birinə bu gün çatmaq olmur, üstəlik ekran şəkilləri də
   çəkilə bilmir. Lazım olan: **ən azı bir real zal** (öz zalın, tanışının zalı, razılıq
   verən bir zal) tətbiqdən yaradılsın, `listed = true` edilsin və onun QR kodu olsun.
   Mən bazaya yaza bilmirəm (yalnız oxuma icazəm var) — bu, sənin əlindədir.
2. **Sign in with Apple iPhone-da GÖRÜNMÜR — Guideline 4.8 üzrə rədd səbəbi.**
   Kod tam hazırdır (`expo-apple-authentication`, `usesAppleSignIn: true`,
   `signInWithApple`), amma **Supabase layihəsində Apple provayderi sönülüdür**:
   `GET https://oezzgcumwprpoqekmlop.supabase.co/auth/v1/settings` bu gün
   `"apple": false, "google": true` qaytarır. `src/lib/auth.ts` serverin «sönülü» dediyi
   düyməni bilərəkdən çəkmir (əks halda düymə ölü olardı), ona görə iPhone-da yalnız
   «Google ilə davam et» + e-poçt görünür. Canlı `auth.identities`-də də yalnız `google`
   var — yəni Apple girişi heç vaxt işlənməyib. Apple qaydası: üçüncü tərəf girişi
   (Google) təklif edən tətbiq Apple girişini də təklif etməlidir.
   **Nə etməli (Apple Developer hesabın var, ona görə hamısı sənlikdir):**
   (a) Apple Developer → Certificates, Identifiers & Profiles → **Services ID** yarat və
   `com.spot.app` App ID-si üçün «Sign in with Apple»ı aç;
   (b) **Sign in with Apple key** (.p8) yarat, Key ID və Team ID-ni götür;
   (c) Supabase Dashboard → Authentication → Providers → **Apple** → aç, Services ID +
   Team ID + Key ID + .p8 açarını yaz, redirect URL-i Services ID-yə əlavə et;
   (d) yenidən `curl .../auth/v1/settings` — `"apple": true` görünməlidir;
   (e) iPhone-da sign-in ekranını aç: «Apple ilə davam et» ən üstdə olmalıdır.
3. **Kəşfdə görünən yeganə məzmun test elanlarıdır.** Üç açıq müəllim elanının ixtisas
   sahəsində «Test», «Test1», «Funksional guc test» yazılır. Qonaq rejimində
   yoxlayıcının görəcəyi budur. Bunlar ya real mətnlə əvəzlənməli, ya da elan
   bağlanmalıdır (`trainers.listed = false`). Bazadakı `Ksjns` və `SPOT Test Zal`
   sətirləri isə onsuz da gizlidir — narahat olmağa dəyməz, sadəcə `listed = true`
   ETMƏ.
4. **Domen və rəsmi e-poçt.** Hər iki mağaza **Privacy Policy URL** və **Support URL**
   tələb edir; Play əlavə olaraq **hesab silmə** üçün veb səhifə istəyir. Üç səhifənin
   hamısı artıq yazılıb — `store/legal/privacy.html`, `terms.html`,
   `delete-account.html` — amma nə yayımlanıb, nə də domen seçilib
   (`web/landing`, fly app `spot-az`; yayım addımları `store/legal/README.md` §3).
   Rəsmi poçt hələ yoxdur: `src/lib/legal.ts`-dəki `OPERATOR` və `CONTACT` ekranda
   hərfi mənada `[DOLDURULMALI: …]` kimi görünür və silmə səhifəsindəki «bizə yaz»
   yolu da onunla işləyir.
5. **App Store-da Azərbaycan dili.** Apple-ın lokalizasiya siyahısında `az` yoxdur.
   Variantlar: (a) primary English + Русский, azərbaycanca yalnız tətbiqin içində qalır;
   (b) azərbaycanca mətni Türkçə lokalizasiyasına qoymaq — Azərbaycanda yayılmış üsuldur,
   amma Apple-ın dil uyğunluğu qaydasına görə risklidir. Qərar sənindir.
6. **Tətbiq adı.** Mağazada «SPOT» tək başına çox ümumi sözdür və axtarışda itir.
   Yuxarıda ad «SPOT — məşq yoldaşı və zal» kimi verilib. Başqa ad istəyirsənsə, de.
   Qeyd: qısa təsvirlər «Zalını seç…» ilə başlayır — bu cümlə yalnız №1 həll olunandan
   sonra doğru olur.
7. **Apple Review üçün demo hesab.** Apple qeydiyyat tələb edən tətbiqə test hesabı
   istəyir. Tətbiqdə qonaq rejimi var, amma yoldaş, check-in və müəllim axını hesab
   tələb edir — ona görə Review Notes-a ya demo hesab, ya da «qonaq rejimi ilə bax»
   izahı yazılmalıdır. Demo hesab №1 həll olunmadan mənasızdır: hesabla girən
   yoxlayıcı da boş kataloq görəcək.
8. **Ekran şəkilləri və feature graphic.** Hələ heç biri yoxdur (bax 7-ci bölmə).
   Cihazda çəkiləcək — sənin telefonun və sənin hesabın lazımdır. №1-dən sonra.
9. **Landing saytın linkləri.** `web/landing/index.html`-in `<title>` və `description`
   mətni bu gün artıq düzəldilib («Yoldaşını tap. Tək məşq etmə.» — «bütün zallar» və
   «hər hərəkəti video ilə öyrən» iddiaları çıxarılıb), yəni mağaza mətni ilə ziddiyyət
   qalmayıb. Qalan iş: altbilgidəki «Məxfilik siyasəti» və «İstifadə şərtləri» linkləri
   hələ `href="#"`-dir — səhifələr yayımlanandan sonra `/legal/privacy.html` və
   `/legal/terms.html`-ə yönəldilməlidir (`store/legal/README.md` §3 və §5).
10. **Tətbiqin öz hüquqi mətni köhnəlib.** `src/lib/legal.ts`-dəki məxfilik siyasəti hələ
    «progress fotoları», «check-in anında lokasiya müqayisəsi» və «telefon nömrəsi»
    deyir — üçü də bu gün yanlışdır və hər üçü `store/data-safety.md`-dəki mağaza
    cavabları ilə ziddiyyət təşkil edir. Veb səhifələr düzəldilib; tətbiqin içindəki
    mətn düzəldilməlidir (dəqiq az/ru/en əvəzləri: `store/legal/README.md` §1a).
    `src/`-ə toxunmaq bu tapşırığın hüdudundan kənardır.

---

# 11. App Review Notes (Apple) — kopyalanmaq üçün, ingiliscə

App Store Connect → **App Review Information → Notes**. İngiliscə yazılıb, çünki
yoxlayıcı ingiliscə oxuyur. Kvadrat mötərizədəki yerlər doldurulmalıdır; doldurulmamış
mötərizə ilə göndərmə.

```
SPOT is a gym-community app for Azerbaijan (Azerbaijani first, with Russian and English).

NO PAYMENTS OF ANY KIND
SPOT processes no payments. There is no in-app purchase, no subscription and no locked
feature: every function is free. Gym monthly fees, day-pass prices and trainer rates are
displayed as information only and are paid in person at the gym, outside the app — SPOT is
not a party to those payments and takes no commission. The day-pass screen issues a code
the gym's reception verifies; no money moves through the app at any point.

SIGN-IN
Sign in with Apple, Google, or an e-mail magic link. Account deletion is inside the app:
Profile -> Privacy -> Delete account (two confirmations, files first, then the server rows,
then the account itself).

GUEST MODE
The app opens without an account. A guest can browse Discover (Gyms and Trainers). Everything
that involves another person — the partner search, messaging, check-in, the workout log —
needs an account, because it writes data attributed to a real profile.

DEMO ACCOUNT
[DOLDURULMALI: e-mail + password for a review account, or delete this whole block if you
choose to rely on guest mode only]

LANGUAGE
The app starts in Azerbaijani. To review it in English: first screen -> language picker
(top right) -> EN. The language can also be changed later in Profile -> Settings.

USER-GENERATED CONTENT
Users can post technique clips (max 60 seconds) and short text posts. Report and Block are
available on every profile, post, comment and video; reported content can be hidden before a
moderator sees it, and a blocked person disappears in both directions.

LOCATION
Location is requested only on Discover -> Map, to sort nearby gyms by distance. It is never
stored: the coordinate is an argument to a read-only query and is discarded. Denying the
permission leaves the map working, just without distances. There is no background location.

PRIVACY
A gym owner sees only check-ins at their own gym. Workout details, personal records and
private messages are readable by their owner alone — enforced by row-level security in the
database, not by the client.
```

**Notes-a nə yazılmamalıdır:** demo hesabın şifrəsini bu fayla yazma — onu birbaşa
App Store Connect-ə yaz. Play tərəfdə eyni məzmun **App content → App access** bölməsinə
gedir (qonaq rejimi varsa «All functionality is available without special access» SEÇMƏ —
yoldaş, check-in və məşq axınları hesab tələb edir).
