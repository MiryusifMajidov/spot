# SPOT — APK

Buradakı `.apk` faylı **tam müstəqil** buraxılışdır: JavaScript kodu faylın
içindədir, ona görə kompüterə, Metro-ya və ya USB kabelinə ehtiyacı yoxdur.
İstədiyin adama göndər, istədiyi vaxt açsın.

(Əvvəlki APK *development build* idi — kodu kabel üzərindən kompüterdən
oxuyurdu, ona görə kompüter söndürüləndə tətbiq açılmırdı. Server heç vaxt
söndürülmür: Supabase buludda 24/7 işləyir.)

## Dostlarına necə göndərməli

1. `.apk` faylını WhatsApp / Telegram / Google Drive ilə göndər.
2. Telefonda açanda Android «bilinməyən mənbə» xəbərdarlığı verəcək —
   **Ayarlar → İcazə ver** deyib davam etsinlər. Bu normaldır: APK Google Play-dən
   gəlmir.
3. Quraşdırıb açsınlar. Qeydiyyat tətbiqin içindədir.

## Vacib: imza açarı

Bu APK `android/app/spot-upload.keystore` faylı ilə imzalanıb. Android tətbiqi
**paket adı + imza açarı** cütü ilə tanıyır:

- Növbəti versiyalar **eyni açarla** imzalanmalıdır, yoxsa dostlarının telefonu
  yeniləməni qəbul etmir (əvvəlcə silmək lazım gəlir).
- Google Play-ə çıxanda da eyni qayda — həmişəlik.

**Açarı və `android/gradle.properties` faylını hardasa yedəklə.** İtsə, geri
qaytarmaq mümkün deyil; tətbiqi yalnız yeni paket adı ilə yenidən yayımlamaq olar.
Hər ikisi `git`-ə düşmür (`/android` gitignore-dadır) — yəni yedək sənin
üzərindədir.

## Yeni APK necə yığılır

```bash
cd android && ./gradlew assembleRelease
```

Nəticə: `android/app/build/outputs/apk/release/app-release.apk`

Hər yeni buraxılışda `android/app/build.gradle` içindəki `versionCode`-u bir
artır (1 → 2 → 3…), yoxsa Android yeniləməni köhnə sayır.
