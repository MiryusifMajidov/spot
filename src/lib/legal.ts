/**
 * İstifadə şərtləri, Məxfilik siyasəti və İcma qaydaları.
 *
 * The onboarding screen has always said «Davam etməklə İstifadə şərtləri və
 * Məxfilik siyasəti ilə razılaşırsan» while neither document existed and neither
 * word was a link. So people were agreeing to nothing, and both app stores
 * require a reachable privacy policy before review.
 *
 * WHAT IS AND IS NOT WRITTEN HERE. Every claim below is checked against what the
 * code and the database actually do — the column grants, the RLS policies, the
 * absence of any payment rail. Nothing is promised that is not enforced.
 *
 * The one thing that CANNOT be written from the codebase is who the operator is:
 * the legal name, address and contact address of whoever runs SPOT. Inventing a
 * company would be a lie in the one document that must not contain one, so it is
 * left as an explicit blank, marked `[DOLDURULMALI]`, and the app shows that text
 * as it is rather than hiding it.
 */

export type LegalDoc = 'terms' | 'privacy' | 'rules';

export interface LegalSection {
  heading?: string;
  body: string[];
}

export interface LegalContent {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

/** Filled in by whoever operates SPOT. Until then the documents say so out loud. */
export const OPERATOR = '[DOLDURULMALI: operator şirkətin/şəxsin adı]';
export const CONTACT = '[DOLDURULMALI: əlaqə e-poçtu]';

const UPDATED = '23 sentyabr 2026';

export const LEGAL: Record<LegalDoc, LegalContent> = {
  terms: {
    title: 'İstifadə şərtləri',
    updated: UPDATED,
    intro:
      'SPOT — zal tapmaq, məşq yoldaşı tapmaq və məşqini qeyd etmək üçün tətbiqdir. Tətbiqi işlədərək aşağıdakı şərtlərlə razılaşırsan.',
    sections: [
      {
        heading: 'Kim istifadə edə bilər',
        body: [
          'SPOT 16 yaşdan yuxarı şəxslər üçündür. 16 yaşın tamam olmayıbsa, tətbiqdən istifadə etmə.',
          'Bir şəxs bir hesab açır. Başqasının adından hesab açmaq, başqasını təqlid etmək qadağandır.',
        ],
      },
      {
        heading: 'SPOT ödəniş qəbul etmir',
        body: [
          'Tətbiqin bütün funksiyaları pulsuzdur. Abunə, tətbiqdaxili satınalma və kilidli funksiya yoxdur.',
          'Zal aylıq haqqı, bir günlük keçid və müəllim dərsinin qiyməti tətbiqdə yalnız məlumat üçün göstərilir. Ödənişi zala və ya müəllimə birbaşa, tətbiqdən kənarda edirsən.',
          'SPOT bu ödənişlərin tərəfi deyil, onlardan komissiya götürmür və onlara zəmanət vermir. Qiymət səhvdirsə və ya razılaşma pozulubsa, bu, səninlə zal/müəllim arasındakı məsələdir.',
        ],
      },
      {
        heading: 'Sağlamlıq və məsuliyyət',
        body: [
          'SPOT həkim deyil. Tətbiqdəki proqramlar və çəki təklifləri tibbi məsləhət deyil.',
          'Məşqə başlamazdan əvvəl, xüsusən xroniki xəstəliyin, zədən, hamiləliyin varsa və ya uzun fasilədən sonra qayıdırsansa, həkimlə məsləhətləş.',
          'Ağrı hiss edirsənsə dayan. Tətbiqin təklif etdiyi çəki əvvəlki setlərindən hesablanır — sənin o gün necə olduğunu bilmir.',
          'Məşq zamanı baş verən zədəyə görə məsuliyyəti sən daşıyırsan.',
        ],
      },
      {
        heading: 'Görüşlər real insanlarladır',
        body: [
          'Məşq yoldaşı funksiyası səni real insanlarla tanış edir. SPOT istifadəçilərin şəxsiyyətini yoxlamır.',
          'İlk dəfə yalnız zalda, insanların olduğu vaxtda görüş. Şəxsi ünvanını, iş yerini və maliyyə məlumatını paylaşma.',
          'Özünü narahat hiss edirsənsə — blok et və şikayət et. Hər ikisi tətbiqin içindədir və dərhal işləyir.',
        ],
      },
      {
        heading: 'Sənin yerləşdirdiyin məzmun',
        body: [
          'Video, şərh, post və rəylərin sənə aiddir. Onları tətbiqdə göstərməyimiz üçün bizə icazə verirsən; istədiyin vaxt silə bilərsən.',
          'Yalnız özünə aid, çəkməyə haqqın olan məzmunu yerləşdir. Başqasının videosunu, musiqisini və ya fotosunu icazəsiz yükləmə.',
          'İcma qaydalarını pozan məzmun xəbərdarlıq olmadan gizlədilə bilər.',
        ],
      },
      {
        heading: 'Rəylər',
        body: [
          'Zala rəy yazmaq üçün həmin zalda ən azı üç dəfə check-in etmiş olmalısan. Bu qayda serverdə tətbiq olunur.',
          'Rəyi yalnız müəllifi redaktə edə bilər. Zal sahibi rəyi silə bilməz — yalnız cavab yaza bilər.',
        ],
      },
      {
        heading: 'Hesabın bağlanması',
        body: [
          'Hesabını istənilən vaxt tətbiqin içindən silə bilərsən: Profil → Parametrlər → Məxfilik → «Hesabı tamamilə sil». Silinmə geri qaytarılmır.',
          'İcma qaydalarını ciddi pozan hesablar dayandırıla bilər.',
        ],
      },
      {
        heading: 'Dəyişikliklər və əlaqə',
        body: [
          'Bu şərtlər dəyişə bilər. Əhəmiyyətli dəyişiklikdə tətbiqdə bildiriş göstərilir.',
          // Placeholders, filled at render: interpolating OPERATOR here would make
          // the translation key change the day the owner fills the blank in.
          'Operator: {operator}. Əlaqə: {contact}.',
        ],
      },
    ],
  },

  privacy: {
    title: 'Məxfilik siyasəti',
    updated: UPDATED,
    intro:
      'Bu sənəd SPOT-un hansı məlumatı topladığını, niyə topladığını və kimin görə bildiyini yazır. Burada yazılmayan heç nə toplanmır.',
    sections: [
      {
        heading: 'Nə toplayırıq',
        body: [
          'Profil: ad, istifadəçi adı, yaş, cins, məşq məqsədi, səviyyə, zal, məşq saatları, qısa bio, avatar.',
          'Məşq: etdiyin məşqlər, setlər, çəkilər, RPE, şəxsi rekordlar.',
          'Check-in: hansı zalda, nə vaxt. Check-in zalın kodu və ya QR-ı ilə olur — telefonun yeri oxunmur.',
          'Ünsiyyət: mesajlar, şərhlər, postlar, videolar.',
          'Tətbiqi ilk açdığın anda serverdə adsız (anonim) hesab yaradılır — məşqini dərhal qeyd edə bilməyin üçün. Onun içində nə ad, nə e-poçt, nə telefon olur. E-poçt, Apple və ya Google ilə girdiyin anda həmin hesab sənin olur; ikinci hesab yaradılmır və qeydlərin yerində qalır.',
        ],
      },
      {
        heading: 'Kim nəyi görür',
        body: [
          'Digər istifadəçilər: adın, istifadəçi adın, yaşın, cinsin, zalın, məqsədin, səviyyən, bion, avatarın, paylaşdığın video və postlar.',
          '«İndi zalda» siyahısı: yalnız check-in-in qüvvədə olduğu müddətdə görünürsən. Vaxtı bitəndən sonra həmin qeyd başqalarına bağlanır. Profil → Parametrlər → Məxfilik-dən tamamilə söndürə bilərsən.',
          'MƏŞQ TƏFƏRRÜATLARIN, ŞƏXSİ QEYDLƏRİN VƏ YAZIŞMALARIN nə digər istifadəçilərə, nə zal sahibinə, nə admin panelinə görünür. Bu, tətbiqin arzusu deyil, bazanın icazə qaydası ilə bağlanıb.',
          'Tam dürüst olmaq üçün bir istisna: bazanı idarə edən operatorun texniki imkanı bu qaydaları keçməyə çatır — bu, istənilən bulud xidmətində belədir. Ondan yalnız təhlükəsizlik şikayətini araşdırmaq və ya qanunun tələb etdiyi hallarda istifadə olunur.',
          'Zal sahibi: yalnız öz zalının check-in qeydlərini və üzv sayını görür. Üzvün məşqini, yazışmasını və ya yerini görmür.',
          'Müəllim: yalnız onu qəbul etmiş şagirdin ona açdığı məşq datasını görür.',
          'Admin: şikayətlərə baxır. Məşq, foto və yazışma sorğusu admin panelində ümumiyyətlə yoxdur.',
        ],
      },
      {
        heading: 'Lokasiya',
        body: [
          'Lokasiya yalnız iki halda istifadə olunur: xəritədə yaxınlıqdakı zalları sıralamaq və zal sahibi öz zalının yerini xəritədə qeyd edəndə.',
          'Fon rejimində izləmə yoxdur. Tətbiq bağlıdırsa yerin oxunmur.',
          'Dəqiq koordinatın heç kimə göstərilmir və serverdə saxlanılmır — yalnız zalın öz koordinatı saxlanılır, onu isə zal sahibi özü qoyur.',
          'Yüklədiyin video və şəkillərdən çəkiliş yeri (GPS) telefonda, fayl serverə getməzdən əvvəl silinir — kamera onu faylın içinə yazsa da.',
        ],
      },
      {
        heading: 'Haradadır',
        body: [
          'Məlumat Supabase üzərində saxlanılır. Server hazırda Avstraliya (Sidney) regionundadır; Avropa regionuna köçürülməsi planlaşdırılır.',
          'Hesab identifikatorları və giriş nişanları Supabase Auth tərəfindən idarə olunur. SPOT-da parol yoxdur: giriş e-poçta gələn kodla, iOS-da Apple hesabı ilə, Android-də Google hesabı ilə olur.',
        ],
      },
      {
        heading: 'Reklam və üçüncü tərəflər',
        body: [
          'Reklam şəbəkəsi yoxdur. Analitika SDK-sı yoxdur. Məlumatın satılmır və reklam məqsədilə heç kimə verilmir.',
          'Tətbiqin danışdığı xidmətlər bunlardır: Supabase (baza, giriş və fayllar); bildirişlər Expo push xidməti (exp.host) üzərindən Google FCM və Apple APNs-ə gedir — bildirişin içində mesajın, şərhin və ya rəyin mətni getmir, yalnız ad və hadisə; xəritə açılanda isə OpenStreetMap kafel serverləri və Leaflet kitabxanasını verən unpkg.com — onlar IP ünvanını və baxdığın ərazinin koordinatlarını görür; giriş düyməsini basdıqda isə Apple (iOS) və ya Google (Android), yalnız o an və yalnız kimliyini təsdiqləmək üçün.',
        ],
      },
      {
        heading: 'Sənin hüquqların',
        body: [
          'Profilini istənilən vaxt redaktə edə bilərsən.',
          'Hesabını tətbiqin içindən silə bilərsən: Profil → Parametrlər → Məxfilik → «Hesabı tamamilə sil». Bu, profilini, məşqlərini, proqramlarını, videolarını, şərhlərini və yüklədiyin faylları silir; yazdığın zal rəyi qalır, amma adın onun üstündən götürülür.',
          'Görünürlüyünü söndürə bilərsən — bu halda kəşf siyahılarında və «indi zalda» siyahısında görünmürsən.',
          'Sualın varsa: {contact}.',
        ],
      },
      {
        heading: 'Uşaqlar',
        body: ['SPOT 16 yaşdan kiçiklər üçün nəzərdə tutulmayıb və onlardan bilərəkdən məlumat toplamır.'],
      },
    ],
  },

  rules: {
    title: 'İcma qaydaları',
    updated: UPDATED,
    intro:
      'SPOT məşq üçündür. Qaydalar qısadır və hamıya eyni tətbiq olunur.',
    sections: [
      {
        heading: 'Bu tanışlıq tətbiqi deyil',
        body: [
          'Məşq yoldaşı uyğunluğu yalnız məşq parametrlərindən hesablanır: zal, saat, günlər, səviyyə, məqsəd. Foto və cins uyğunluq balına təsir etmir.',
          'Romantik və ya cinsi məzmunlu mesaj göndərmək, görünüş haqqında şərh yazmaq, təkrar-təkrar yazmaq qadağandır.',
          'Bu qaydanı pozan hesablar dayandırılır.',
        ],
      },
      {
        heading: 'Hörmət',
        body: [
          'Təhqir, hədə, nifrət nitqi, irqi/dini/cinsi ayrı-seçkilik yolverilməzdir.',
          'Başqasının bədəni, çəkisi və ya səviyyəsi haqqında istehzalı şərh yazma. Burada hamı nədənsə başlayır.',
          'Zalda kiminsə videosunu icazəsiz çəkib paylaşma.',
        ],
      },
      {
        heading: 'Dürüstlük',
        body: [
          'Real ad və real fotoyla ol. Başqasının fotosunu istifadə etmə.',
          'Saxta zal, saxta müəllim profili və ya saxta rəy yerləşdirmə.',
          'Məşq nəticələrini şişirtmə — çağırış və reytinqlər check-in ilə yoxlanılır.',
        ],
      },
      {
        heading: 'Təhlükəsizlik',
        body: [
          'İlk görüş zalda, gündüz və ya zalın işlək saatında olsun.',
          'Kimsə səni narahat edirsə: profilində «Blok et» — həmin an qarşılıqlı gizlənirsiniz — və «Şikayət et».',
          'Təhlükəsizlik şikayətlərinə növbədə birinci baxılır.',
        ],
      },
      {
        heading: 'Nə baş verir',
        body: [
          'Şikayət edilən məzmun moderator baxana qədər gizlədilə bilər.',
          'Ciddi pozuntuda hesab birbaşa dayandırılır.',
          'Səhv olduğunu düşünürsənsə, Profil → Parametrlər → Kömək və dəstək bölməsindən yaz.',
        ],
      },
    ],
  },
};
