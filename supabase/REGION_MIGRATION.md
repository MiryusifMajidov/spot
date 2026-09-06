# Supabase regionu — Sidneydən Avropaya (F-25)

## Problem, ölçü ilə

Layihə **`ap-southeast-2`** (Sidney) regionundadır. İstifadəçilər Bakıdadır.

Bu maşından, 2026-09-03-də ölçülmüş:

| | median |
|---|---|
| SPOT REST sorğusu (gediş-gəliş) | **509 ms** |
| AWS `ap-southeast-2` TCP connect | 371 ms |
| AWS `eu-central-1` (Frankfurt) TCP connect | **89 ms** |
| AWS `eu-west-1` (İrlandiya) TCP connect | 124 ms |

Yəni hər sorğu **~4 dəfə** artıq gözləyir. Bir ekran 3 ardıcıl sorğu edirsə — feed açılışı belədir — istifadəçi heç nə görməmiş **1,5 saniyə** itirir. Bu, kodla düzələn bir şey deyil: məsafə fizikadır.

Frankfurt-a keçid hər sorğuda **~280 ms** qazandırır (soyuq bağlantıda TLS əl-sıxması da olduğuna görə praktikada daha çox).

## Niyə bunu özüm etmədim

Supabase-də mövcud layihənin regionu **dəyişdirilə bilmir**. Yeganə yol yeni layihə yaratmaq və köçməkdir. Bu:

- yeni `SUPABASE_URL` və yeni anon açar deməkdir — köhnə build-lər işləməz;
- sənin Supabase hesabında yeni layihə yaradır (faturalandırmaya təsir edə bilər);
- köhnə layihəni bir müddət paralel saxlamağı tələb edir.

Bunlar sənin infrastrukturuna aid qərarlardır, ona görə addımları hazırladım, düyməni sən basırsan.

## Köçürmə addımları

### 1. Yeni layihə
Supabase panelində yeni layihə yarat, region **`eu-central-1` (Frankfurt)**.
İstanbul/Bakıya ən yaxın Supabase regionu budur.

### 2. Sxemi oynat
Fayllar bu ardıcıllıqla, dəqiq bu sıra ilə (nömrə sırası **vacibdir** — 44 və 47
özlərindən əvvəlkilərin səhvini düzəldir):

```
schema.sql
schema2.sql  schema3.sql  schema4_admin.sql  schema5_app_writes.sql
schema6_trainer_students.sql  schema7_gym_owner.sql  schema8_photos_location.sql
schema9_found_gaps.sql  schema10_certs_and_fiction.sql … schema48_checkin_privacy.sql
```

Yəni: `schema.sql`, sonra `schema2` … `schema48` ədədi sıra ilə.

`cleanup_*.sql` və `merge_*.sql` fayllarını **oynatma** — onlar bu bazada bir
dəfəlik təmizləmə idi, yeni boş bazada mənası yoxdur.

### 3. Datanı köçür
```bash
npx supabase db dump --linked --data-only -f data.sql
```
sonra yeni layihəyə `link` edib eyni faylı oynat.

`auth.users` ayrıca köçürülür — Supabase panelindəki *Database → Backups* və ya
`pg_dump`-ın `auth` sxeması ilə.

### 4. Storage
`videos`, `avatars`, `gym-photos` bucket-lərindəki fayllar SQL ilə köçmür.
Supabase CLI-nin storage komandası və ya panel üzərindən köçürülməlidir.
Bucket qaydaları `schema33_storage_ownership.sql`-dədir.

### 5. Tətbiqi keçir
`.env`-də iki dəyər:
```
EXPO_PUBLIC_SUPABASE_URL=<yeni layihənin URL-i>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<yeni publishable açar>
```
Bu **publishable/anon** açardır — `service_role` açarı heç vaxt tətbiqə qoyulmur.

### 6. Yoxla
Köçdükdən sonra eyni ölçünü təkrarla:
```bash
curl -s -o /dev/null -w "%{time_total}\n" -H "apikey: <anon>" \
  "<yeni-url>/rest/v1/gyms?select=id&limit=1"
```
150 ms-dən aşağı olmalıdır. Olmursa, region səhv seçilib.

### 7. Köhnəni saxla
Yeni layihə bir həftə problemsiz işləyənə qədər köhnə layihəni silmə.
