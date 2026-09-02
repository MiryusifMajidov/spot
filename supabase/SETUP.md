# SPOT — Supabase quraşdırma (3 addım)

Layihə: **spot** · URL: `https://oezzgcumwprpoqekmlop.supabase.co`

## 1) Sxemi işlət
Supabase panelində: **SQL Editor → New query** → `supabase/schema.sql` faylının içindəkini yapışdır → **Run**.
Bu, cədvəlləri (gyms, profiles, check_ins, match_requests), PostGIS geo funksiyasını, RLS qaydalarını və real seed datanı (4 zal + zalda olan adamlar) yaradır.

## 2) Anonim girişi aç (test üçün, SMS pulu olmadan)
**Authentication → Sign In / Providers** (və ya **Providers**) → **Anonymous sign-ins** → **Enable**.
Bu, "Apple/Telefon ilə davam et" düyməsinin real istifadəçi yaratmasına imkan verir (sonra əsl Apple/Google girişi əlavə edəcəyik).

## 3) Anon açarı ver
**Project Settings → API → Project API keys** → **`anon` / `public`** açarını kopyala
(uzun mətndir, `eyJ...` və ya `sb_publishable_...` ilə başlaya bilər).
⚠️ **`service_role` / secret açarı YOX** — yalnız public olanı.

Onu `.env` faylına yapışdır:
```
EXPO_PUBLIC_SUPABASE_ANON_KEY=<bura yapışdır>
```
və ya mənə çatda göndər — mən .env-ə yazım.

## Sonra
APK-nı yenidən build et (`.env` dəyişdiyi üçün):
```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```
Açar yoxdursa app mock data ilə işləyir; açar olanda **real** zallar, check-in və yoldaşlar gəlir.
