/**
 * store/legal/build.mjs — regenerates the three public legal pages.
 *
 * WHY A GENERATOR AND NOT THREE HAND-WRITTEN FILES
 * The Terms and the Privacy Policy already exist in the app, in three
 * languages: the Azerbaijani source is `src/lib/legal.ts`, the Russian and
 * English are `src/i18n/{ru,en}/legal.ts`. A hand-typed web copy would start
 * identical and drift the first time a clause changes. This script reads those
 * same files and emits the HTML, so the page a store reviewer opens and the
 * screen a user taps in Profil → Parametrlər say the same words by
 * construction. If a translation is missing the build FAILS rather than
 * shipping an Azerbaijani sentence under a Russian heading.
 *
 * The one page with no counterpart in the app is delete-account.html — Google
 * Play wants a public URL that explains how to request account deletion. Its
 * text is written here, in all three languages, and every factual claim in it
 * was checked against `delete_my_account()` (supabase/schema81_live_sim_fixes.sql),
 * the foreign keys on `public.profiles` in the live database, and
 * `deleteMyAccount()` in src/lib/api.ts.
 *
 * Run:  node store/legal/build.mjs
 * Reads nothing but source files; writes only *.html next to itself.
 */

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/* ------------------------------------------------------------------ input -- */

/** Import a TypeScript data module by stripping the few type-only constructs.
 *  These files are plain data — no logic — so this is a transform, not a
 *  compiler, and anything it cannot handle will throw here rather than produce
 *  a half-translated page. */
async function importData(relPath, transform) {
  const src = await readFile(join(ROOT, relPath), 'utf8');
  const js = transform(src);
  const dir = await mkdtemp(join(tmpdir(), 'spot-legal-'));
  const file = join(dir, 'data.mjs');
  await writeFile(file, js, 'utf8');
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const az = await importData('src/lib/legal.ts', (s) =>
  s
    .replace(/export type LegalDoc[^\n]*\n/, '')
    .replace(/export interface \w+ \{[\s\S]*?\n\}\n/g, '')
    .replace(': Record<LegalDoc, LegalContent>', '')
);

const dict = {
  az: null,
  ru: (await importData('src/i18n/ru/legal.ts', stripDict)).legal,
  en: (await importData('src/i18n/en/legal.ts', stripDict)).legal,
};

function stripDict(s) {
  return s.replace(/^import[^\n]*\n/m, '').replace('export const legal: Dict =', 'export const legal =');
}

const { LEGAL, OPERATOR, CONTACT } = az;

/**
 * OVERRIDES and CORRECTIONS — both empty, and that is the point.
 *
 * They existed because the published policy had to describe the build being
 * submitted while `src/lib/legal.ts` still carried sentences that were no
 * longer true (body weight, check-in by location, phone numbers, meal plans,
 * the third parties the app talks to). Every one of those sentences has since
 * been fixed at the source, so the website and the in-app screen now say the
 * same thing — which is the only state in which a privacy policy can be
 * trusted.
 *
 * Keep them empty. If a sentence is wrong, it is wrong in the app too: fix
 * `src/lib/legal.ts` and `i18n/translations.json` (then regenerate), rather
 * than patching the public copy and leaving the app lying to the same reader.
 *
 * OVERRIDES fills a translation the dictionaries do not have; CORRECTIONS
 * replaces a sentence (`null` drops it). The build prints a loud warning for
 * any entry here that no longer matches a sentence in the source.
 */
const OVERRIDES = {};

const CORRECTIONS = {};
const usedCorrections = new Set();

/** The sentence as it must appear on the website: the correction if there is
 *  one, otherwise the translated source. `null` means the sentence is dropped. */
function corrected(lang, s) {
  if (Object.prototype.hasOwnProperty.call(CORRECTIONS, s)) {
    usedCorrections.add(s);
    const c = CORRECTIONS[s];
    return c === null ? null : c[lang];
  }
  return t(lang, s);
}

/** Translate an Azerbaijani source string. A missing key is a build failure:
 *  a page that silently falls back to Azerbaijani under a Russian heading is
 *  exactly the kind of half-truth the app's own rules forbid. */
const missing = [];
const usedOverrides = new Set();
function t(lang, s) {
  if (lang === 'az') return s;
  const v = dict[lang][s];
  if (v !== undefined) return v;
  const o = OVERRIDES[s]?.[lang];
  if (o !== undefined) {
    usedOverrides.add(s);
    return o;
  }
  missing.push(`${lang}: ${s}`);
  return s;
}

/* --------------------------------------------------------------- content -- */

const LANGS = ['az', 'ru', 'en'];
const LANG_LABEL = { az: 'AZ', ru: 'RU', en: 'EN' };

/** The update date, formatted in each language. The app interpolates the
 *  Azerbaijani date into every language; on a public page a Russian reader
 *  gets a Russian date. Same day, three spellings — no clause changes. */
const UPDATED = { az: '23 sentyabr 2026', ru: '23 сентября 2026', en: '23 September 2026' };

/** Exact in-app labels, copied from src/i18n/{ru,en}/system.ts so the
 *  instructions on the delete page name the buttons the user actually sees. */
const UI = {
  profile: { az: 'Profil', ru: 'Профиль', en: 'Profile' },
  settings: { az: 'Parametrlər', ru: 'Настройки', en: 'Settings' },
  privacy: { az: 'Məxfilik', ru: 'Конфиденциальность', en: 'Privacy' },
  yourData: { az: 'Sənin datan', ru: 'Твои данные', en: 'Your data' },
  exportData: { az: 'Datanı yüklə', ru: 'Выгрузить данные', en: 'Export your data' },
  wipeDevice: {
    az: 'Bu cihazdakı nüsxəni sil',
    ru: 'Удалить копию на этом устройстве',
    en: 'Delete the copy on this device',
  },
  deleteAccount: {
    az: 'Hesabı tamamilə sil',
    ru: 'Удалить аккаунт полностью',
    en: 'Delete account completely',
  },
};

const UI_PATH = (l) => `${UI.profile[l]} → ${UI.settings[l]} → ${UI.privacy[l]}`;

/** Strings this site needs that the app has no counterpart for. */
const SITE = {
  home: { az: 'Ana səhifə', ru: 'Главная', en: 'Home' },
  otherDocs: { az: 'Digər sənədlər', ru: 'Другие документы', en: 'Other documents' },
  langLabel: { az: 'Dil', ru: 'Язык', en: 'Language' },
  deleteTitle: { az: 'Hesabın silinməsi', ru: 'Удаление аккаунта', en: 'Deleting your account' },
};

/* --------------------------------------------------- delete-account page -- */
/* Every line below is checked against delete_my_account() in
   supabase/schema81_live_sim_fixes.sql, the ON DELETE rules of every foreign
   key that points at public.profiles in the live database, and the client-side
   order in deleteMyAccount() (src/lib/api.ts). */

const DEL = {
  intro: {
    az: 'Bu səhifə SPOT hesabının necə silindiyini, silinəndə hansı məlumatın getdiyini və nəyin qaldığını izah edir. Hesabı özün, tətbiqin içindən silirsən — sorğu göndərib cavab gözləməyə ehtiyac yoxdur.',
    ru: 'На этой странице объясняется, как удалить аккаунт SPOT, какие данные при этом удаляются и что остаётся. Аккаунт ты удаляешь сам, прямо в приложении — отправлять запрос и ждать ответа не нужно.',
    en: 'This page explains how a SPOT account is deleted, what data is removed and what stays. You delete the account yourself, inside the app — there is no request to send and no reply to wait for.',
  },
  sections: [
    {
      heading: {
        az: 'Tətbiqin içindən necə silinir',
        ru: 'Как удалить аккаунт в приложении',
        en: 'How to delete it in the app',
      },
      steps: [
        {
          az: `${UI_PATH('az')} ekranını aç.`,
          ru: `Открой экран ${UI_PATH('ru')}.`,
          en: `Open ${UI_PATH('en')}.`,
        },
        {
          az: `«${UI.yourData.az}» bölməsində sonuncu sətir: «${UI.deleteAccount.az}».`,
          ru: `В разделе «${UI.yourData.ru}» последняя строка: «${UI.deleteAccount.ru}».`,
          en: `In the "${UI.yourData.en}" section, the last row: "${UI.deleteAccount.en}".`,
        },
        {
          az: 'Təsdiq iki dəfə soruşulur. İkinci təsdiqdən sonra silinmə dərhal başlayır və geri qaytarılmır.',
          ru: 'Подтверждение спрашивается дважды. После второго подтверждения удаление начинается сразу и отменить его нельзя.',
          en: 'You are asked to confirm twice. After the second confirmation the deletion starts immediately and cannot be undone.',
        },
        {
          az: 'Əvvəlcə yüklədiyin fayllar silinir, sonra serverdəki sətirlər, sonra bu telefondakı nüsxə. Addımlardan biri alınmasa, tətbiq «Hesab silinmədi» deyir və hesab yerində qalır — yarımçıq silinmə heç vaxt «oldu» kimi göstərilmir.',
          ru: 'Сначала удаляются загруженные тобой файлы, затем строки на сервере, затем копия на этом телефоне. Если какой-то шаг не проходит, приложение говорит «Аккаунт не удалён», и аккаунт остаётся на месте — незавершённое удаление никогда не показывается как выполненное.',
          en: 'First the files you uploaded are deleted, then the rows on the server, then the copy on this phone. If any step fails, the app says the account was not deleted and the account stays — a half-finished deletion is never reported as done.',
        },
      ],
    },
    {
      heading: {
        az: 'Silməzdən əvvəl: datanı özünə götür',
        ru: 'Перед удалением: забери свои данные',
        en: 'Before you delete: take your data with you',
      },
      body: [
        {
          az: `Eyni ekranda «${UI.exportData.az}» sətri var: bu telefondakı profil, məşq, check-in və qeydlərini JSON mətni kimi özünə göndərir. Silinmədən sonra bu məlumatı geri qaytarmaq mümkün deyil.`,
          ru: `На том же экране есть строка «${UI.exportData.ru}»: она отправляет тебе профиль, тренировки, check-in и записи с этого телефона в виде текста JSON. После удаления вернуть эти данные невозможно.`,
          en: `On the same screen there is an "${UI.exportData.en}" row: it sends you the profile, workouts, check-ins and notes held on this phone as JSON text. After deletion this data cannot be recovered.`,
        },
      ],
    },
    {
      heading: { az: 'Nə silinir', ru: 'Что удаляется', en: 'What is deleted' },
      body: [
        {
          az: 'Silinmə serverdə bir əməliyyatla gedir və aşağıdakıların hamısını aparır:',
          ru: 'Удаление выполняется на сервере одной операцией и забирает всё перечисленное:',
          en: 'The deletion runs on the server as a single operation and takes all of the following:',
        },
      ],
      list: [
        {
          /* No phone number: sign-in by phone was removed, `profiles.phone` has
             no SELECT grant for any client role, and the live table holds zero
             numbers. Both store forms answer «Phone number: No». */
          az: 'Profilin: ad, istifadəçi adı, yaş, cins, məşq məqsədi, səviyyə, zal, məşq saatları, bio və avatar. İstifadəçi adın boşalır.',
          ru: 'Твой профиль: имя, имя пользователя, возраст, пол, цель тренировок, уровень, зал, время тренировок, био и аватар. Имя пользователя освобождается.',
          en: 'Your profile: name, username, age, gender, training goal, level, gym, training hours, bio and avatar. Your username is freed up.',
        },
        {
          az: 'Məşq tarixçən: məşqlər, setlər, çəkilər, RPE və şəxsi rekordların.',
          ru: 'История тренировок: тренировки, подходы, веса, RPE и личные рекорды.',
          en: 'Your training history: workouts, sets, weights, RPE and personal records.',
        },
        {
          /* The weight screen is gone and nothing writes `public.progress` any
             more; a progress-photo feature never existed. An old row from an
             earlier build can still be on an account, and it goes with the
             profile (progress.profile_id is ON DELETE CASCADE) — so the row is
             named, without claiming a screen that is not there. */
          az: 'Bədən qeydlərin: köhnə buraxılışdan qalan çəki ölçmələrin (tətbiqdə bu gün çəki yazan ekran yoxdur).',
          ru: 'Записи о теле: измерения веса, оставшиеся от прежней версии (экрана для записи веса в приложении сегодня нет).',
          en: 'Your body log: any weight entries left over from an earlier release (the app has no weight screen today).',
        },
        {
          az: 'Bütün check-inlərin.',
          ru: 'Все твои check-in.',
          en: 'All of your check-ins.',
        },
        {
          az: 'Videoların, postların, şərhlərin, bəyənmələrin və saxladığın videolar.',
          ru: 'Твои видео, посты, комментарии, лайки и сохранённые видео.',
          en: 'Your videos, posts, comments, likes and saved videos.',
        },
        {
          az: 'Yazdığın proqramlar — və onlara qoşulmuş şagird bağlantıları.',
          ru: 'Написанные тобой программы — и связанные с ними подключения учеников.',
          en: 'The programs you wrote — and the student links attached to them.',
        },
        {
          az: 'Yazışmaların: söhbətlər və mesajlar hər iki tərəfdə silinir, yəni yazışdığın adamda da qalmır.',
          ru: 'Твоя переписка: чаты и сообщения удаляются у обеих сторон, то есть не остаются и у того, с кем ты переписывался.',
          en: 'Your conversations: threads and messages are deleted on both sides, so they do not stay with the person you were writing to either.',
        },
        {
          az: 'İzləmələrin, məşq yoldaşı sorğuların və müəllim sorğuların.',
          ru: 'Твои подписки, заявки к напарникам по тренировкам и заявки к тренерам.',
          en: 'Your follows, workout-partner requests and trainer requests.',
        },
        {
          az: 'Müəllim elanın, müəllim kimi qeydiyyatdan keçmisənsə.',
          ru: 'Твоё объявление тренера, если ты регистрировался как тренер.',
          en: 'Your trainer listing, if you signed up as a trainer.',
        },
        {
          az: 'Bildirişlərin — həm sənə gələnlər, həm də sənin səbəb olduqların.',
          ru: 'Твои уведомления — и те, что пришли тебе, и те, причиной которых был ты.',
          en: 'Your notifications — both the ones you received and the ones you caused.',
        },
        {
          az: 'Blok qeydləri: həm sənin blok etdiklərin, həm də səni blok edənlərin qeydi.',
          ru: 'Записи о блокировках: и те, кого заблокировал ты, и те, кто заблокировал тебя.',
          en: 'Block records: both the people you blocked and the people who blocked you.',
        },
        {
          az: 'Çağırış (challenge) üzvlüklərin və bu telefonun bildiriş ünvanı.',
          ru: 'Твоё участие в челленджах и адрес для уведомлений этого телефона.',
          en: 'Your challenge memberships and this phone’s notification address.',
        },
        {
          az: 'Yüklədiyin bütün fayllar: avatar, videolar, şəkillər və doğrulama üçün göndərdiyin sənədlər.',
          ru: 'Все загруженные тобой файлы: аватар, видео, фотографии и документы, отправленные для проверки.',
          en: 'Every file you uploaded: avatar, videos, photos and any documents you sent for verification.',
        },
        {
          az: 'Giriş hesabın: bundan sonra həmin hesabla daxil olmaq mümkün deyil.',
          ru: 'Твой аккаунт для входа: после этого войти под ним невозможно.',
          en: 'Your sign-in account: after this you cannot sign in with it.',
        },
      ],
    },
    {
      heading: { az: 'Nə qalır', ru: 'Что остаётся', en: 'What stays' },
      body: [
        {
          az: 'Bunlar qəsdən qalır, çünki başqa insanlar onlara baxıb qərar verib və ya onlardan istifadə edir:',
          ru: 'Перечисленное остаётся намеренно, потому что другие люди уже смотрели на это, принимали по нему решение или пользуются им:',
          en: 'These stay on purpose, because other people have already read them, decided on them or depend on them:',
        },
      ],
      list: [
        /* REVIEW-NAME — reviews.author_id is ON DELETE SET NULL, but
           delete_my_account() does not clear reviews.name, which the
           reviews_stamp trigger copies from the profile at insert time. So the
           display name stays on the review after the account is gone. This
           paragraph says exactly that. If reviews.name is ever cleared on
           deletion, rewrite this item in all three languages. */
        {
          az: 'Zala yazdığın rəy. Rəyin mətni, ulduz sayı və rəyi yazdığın anda profilində olan ad zalın səhifəsində qalır; rəy artıq heç bir hesabla bağlı olmur. Tətbiqdə rəyi silmək düyməsi yoxdur — rəyin tamamilə götürülməsini istəyirsənsə, hesabı silməzdən əvvəl bizə yaz.',
          ru: 'Отзыв, который ты написал о зале. Текст отзыва, оценка и имя, которое было в твоём профиле в момент написания, остаются на странице зала; при этом отзыв больше не связан ни с одним аккаунтом. Кнопки удаления отзыва в приложении нет — если хочешь, чтобы отзыв убрали полностью, напиши нам до удаления аккаунта.',
          en: 'A review you wrote about a gym. The text, the rating and the name that was on your profile when you wrote it stay on the gym’s page; the review is no longer tied to any account. The app has no button for deleting a review — if you want it taken down entirely, write to us before you delete the account.',
        },
        {
          az: 'SPOT-un kataloqa saldığı zal, əgər zalı sən yaratmısansa. Zal kataloqda qalır — başqa istifadəçilər ona bağlıdır — amma sahibi kimi sən çıxarılırsan və zalın şəkilləri silinir, çünki o fayllar sənindir. Kataloqa heç vaxt düşməmiş zal isə hesabla birlikdə silinir (ona başqa üzv və ya müəllim bağlanmayıbsa).',
          ru: 'Зал, который SPOT внёс в каталог, если этот зал создал ты. Зал остаётся в каталоге — на него завязаны другие пользователи, — но тебя убирают из владельцев, а фотографии зала удаляются, потому что эти файлы твои. Зал, который так и не попал в каталог, удаляется вместе с аккаунтом (если к нему не привязаны другой участник или тренер).',
          en: 'A gym that SPOT listed in the catalogue, if you were the one who created it. The gym stays in the catalogue — other users depend on it — but you are removed as its owner and the gym’s photos are deleted, because those files are yours. A gym that was never listed is deleted together with the account (unless another member or trainer is attached to it).',
        },
        {
          /* gym_claims.claimant_id is ON DELETE SET NULL against auth.users, so
             an ownership claim — which carries a VÖEN — outlives the account
             without its claimant. Only an admin can read `gym_claims`. */
          az: 'Zal sahibliyi üçün göndərdiyin iddia (VÖEN daxil) moderasiya qeydi kimi qalır — onu yalnız SPOT moderatoru görür — amma səninlə bağlılığı kəsilir.',
          ru: 'Заявка на подтверждение владения залом (включая VÖEN) остаётся как запись модерации — её видит только модератор SPOT, — но связь с тобой обрывается.',
          en: 'A gym-ownership claim you sent (including the VÖEN tax number) stays as a moderation record — only a SPOT moderator can see it — but its link to you is cut.',
        },
        {
          az: 'Yerində qalan zalda bir günlük keçidin (day-pass) qeydi zalın öz qeydi kimi qalır, amma səninlə bağlılığı kəsilir.',
          ru: 'Запись о разовом посещении в зале, который остаётся, сохраняется как собственная запись зала, но связь с тобой обрывается.',
          en: 'A day pass record at a gym that stays remains as the gym’s own record, but its link to you is cut.',
        },
        /* reports.reporter_id is ON DELETE SET NULL against auth.users, which
           delete_my_account() removes last — so the report text survives
           without its author. `reports` has no name column, and its only read
           policy is is_admin(auth.uid()). */
        {
          az: 'Etdiyin şikayətin mətni moderasiya qeydi kimi qalır — onu yalnız SPOT moderatoru görür — amma səninlə bağlılığı kəsilir.',
          ru: 'Текст поданной тобой жалобы остаётся как запись модерации — её видит только модератор SPOT, — но связь с тобой обрывается.',
          en: 'The text of a report you filed stays as a moderation record — only a SPOT moderator can see it — but its link to you is cut.',
        },
        {
          az: 'Provayderin (Supabase) avtomatik ehtiyat nüsxələri. Silinmiş sətirlərin köhnə surəti orada müvəqqəti qala bilər: o nüsxələr yalnız fəlakət bərpası üçündür, tətbiqdə heç kimə göstərilmir və öz müddəti bitəndə üzərinə yazılır.',
          ru: 'Автоматические резервные копии провайдера (Supabase). Старая копия удалённых строк может временно оставаться в них: эти копии нужны только для аварийного восстановления, никому в приложении не показываются и перезаписываются по истечении срока.',
          en: 'The provider’s automatic backups (Supabase). An older copy of the deleted rows may remain there for a while: those backups exist only for disaster recovery, are shown to no one in the app, and are overwritten when their retention period ends.',
        },
      ],
    },
    {
      heading: {
        az: 'Tətbiqi silmək hesabı silmir',
        ru: 'Удаление приложения не удаляет аккаунт',
        en: 'Uninstalling the app does not delete the account',
      },
      body: [
        {
          az: `Tətbiqi telefondan silsən, serverdəki profilin, videoların və şərhlərin yerində qalır. Məxfilik ekranındakı «${UI.wipeDevice.az}» də yalnız telefondakı nüsxəni təmizləyir — hesab silinmir. Hesabı silən yeganə düymə «${UI.deleteAccount.az}»dir.`,
          ru: `Если ты удалишь приложение с телефона, твой профиль, видео и комментарии на сервере останутся на месте. Строка «${UI.wipeDevice.ru}» на экране конфиденциальности тоже очищает только копию на телефоне — аккаунт при этом не удаляется. Единственная кнопка, которая удаляет аккаунт, — «${UI.deleteAccount.ru}».`,
          en: `If you uninstall the app, your profile, videos and comments on the server stay where they are. The "${UI.wipeDevice.en}" row on the privacy screen also clears only the copy on the phone — the account is not deleted. The only button that deletes the account is "${UI.deleteAccount.en}".`,
        },
      ],
    },
    {
      heading: {
        az: 'Tətbiqə girə bilmirsənsə',
        ru: 'Если ты не можешь войти в приложение',
        en: 'If you cannot get into the app',
      },
      body: [
        {
          az: 'Telefon əlində deyilsə və ya hesaba daxil ola bilmirsənsə, silinmə sorğusunu {contact} ünvanına göndər. Hesabın sənin olduğunu təsdiqlədikdən sonra hesabı yuxarıda yazılan qaydada silirik və nəticəni sənə yazırıq.',
          ru: 'Если телефона нет под рукой или ты не можешь войти в аккаунт, отправь запрос на удаление на адрес {contact}. После того как мы убедимся, что аккаунт твой, мы удалим его так, как описано выше, и сообщим тебе результат.',
          en: 'If you do not have the phone at hand, or you cannot sign in, send a deletion request to {contact}. Once we have confirmed the account is yours, we delete it exactly as described above and write back to tell you it is done.',
        },
        {
          az: 'Sorğuda hesabın istifadəçi adını yaz. Parol, kart nömrəsi və ya şəxsiyyət sənədi göndərmə — bunları heç vaxt istəmirik.',
          ru: 'В запросе укажи имя пользователя аккаунта. Не присылай пароль, номер карты или документ, удостоверяющий личность, — мы их никогда не запрашиваем.',
          en: 'Put the account’s username in the request. Do not send a password, a card number or an identity document — we never ask for those.',
        },
      ],
    },
    {
      heading: {
        az: t('az', 'Dəyişikliklər və əlaqə'),
        ru: t('ru', 'Dəyişikliklər və əlaqə'),
        en: t('en', 'Dəyişikliklər və əlaqə'),
      },
      body: [
        {
          az: t('az', 'Operator: {operator}. Əlaqə: {contact}.'),
          ru: t('ru', 'Operator: {operator}. Əlaqə: {contact}.'),
          en: t('en', 'Operator: {operator}. Əlaqə: {contact}.'),
        },
      ],
    },
  ],
};

/* ----------------------------------------------------------------- render -- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The two blanks the owner has not filled yet. They are rendered as a loud
 *  amber chip, on purpose: a store submission must not go out while either of
 *  them is still on the page, and a grey inline string is easy to scroll past. */
const blank = (text) => `<b class="blank">${esc(text)}</b>`;

/** Substitute the placeholders the legal texts carry. */
function fill(s) {
  return esc(s)
    .replace('{operator}', blank(OPERATOR))
    .replace('{contact}', blank(CONTACT))
    .split('{date}')
    .join('');
}

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#101014;color:#F4F4F7;
  font:400 16.5px/1.68 -apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased;overflow-wrap:break-word}
.wrap{max-width:740px;margin:0 auto;padding:0 20px}
a{color:#C6FF3D;text-decoration:none}
a:hover{text-decoration:underline}

/* ---- header ---- */
.site{position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(255,255,255,.12);
  background:rgba(16,16,20,.92);-webkit-backdrop-filter:saturate(150%) blur(12px);
  backdrop-filter:saturate(150%) blur(12px)}
.site .row{display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:11px;color:#F4F4F7}
.brand:hover{text-decoration:none}
.mark{width:30px;height:30px;border-radius:9px;background:#1E1E26;flex:none;
  display:flex;align-items:center;justify-content:center}
.ring{box-sizing:content-box;width:13px;height:13px;border-radius:50%;
  border:3px solid #C6FF3D;position:relative}
.ring i{position:absolute;inset:2px;border-radius:50%;background:#C6FF3D}
.word{font:700 17px/1 -apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif;
  letter-spacing:-.4px}
.langs{display:inline-flex;gap:2px;padding:3px;border-radius:12px;
  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05)}
.langbtn{font:600 13px/1 -apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif;
  -webkit-appearance:none;appearance:none;border:0;background:transparent;color:#9A9AA6;
  min-height:34px;padding:0 12px;border-radius:9px;cursor:pointer;
  -webkit-tap-highlight-color:transparent}
.langbtn[aria-selected="true"]{background:#C6FF3D;color:#101014}
.langbtn:focus-visible{outline:2px solid #C6FF3D;outline-offset:2px}

/* ---- document ---- */
main{padding:38px 0 8px}
h1{margin:0 0 10px;letter-spacing:-.9px;
  font:700 clamp(27px,6.4vw,35px)/1.14 -apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif}
.updated{margin:0 0 20px;color:#9A9AA6;font-size:14px}
.intro{margin:0 0 4px;font-size:17.5px;color:#E7E7EC}
.note{margin:22px 0 0;padding:13px 15px;border:1px solid rgba(255,255,255,.14);
  border-radius:14px;background:rgba(255,255,255,.04);color:#9A9AA6;font-size:14.5px;line-height:1.55}
section{margin-top:30px;padding-top:26px;border-top:1px solid rgba(255,255,255,.12)}
h2{margin:0 0 13px;letter-spacing:-.35px;
  font:600 20.5px/1.3 -apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif}
p{margin:0 0 13px}
ul,ol{margin:0 0 13px;padding-left:22px}
li{margin-bottom:10px}
li::marker{color:#C6FF3D}
strong{font-weight:600}

/* ---- the unfilled blanks: impossible to miss ---- */
.blank{display:inline-block;margin:1px 0;padding:2px 8px;border-radius:7px;
  border:1px dashed #101014;background:#FFD24A;color:#101014;
  font:700 13.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* ---- footer ---- */
footer{margin-top:44px;padding:26px 0 46px;border-top:1px solid rgba(255,255,255,.12);
  color:#9A9AA6;font-size:14.5px}
.flabel{font:600 12px/1 -apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif;
  letter-spacing:.1em;text-transform:uppercase;color:#7C7C87;margin-bottom:14px}
.flinks{display:flex;flex-direction:column;gap:11px;margin-bottom:24px}
.flinks a[aria-current="page"]{color:#9A9AA6;pointer-events:none}
.copy{color:#7C7C87;font-size:13px}

@media (max-width:420px){
  .site .row{gap:10px}
  .word{font-size:16px}
  .langbtn{padding:0 10px}
}
`;

const SCRIPT = `
(function () {
  var KEY = 'spot-legal-lang', OK = ['az','ru','en'], TITLES = __TITLES__;
  var root = document.documentElement;
  function set(l, persist) {
    if (OK.indexOf(l) < 0) l = 'az';
    root.setAttribute('data-lang', l);
    root.setAttribute('lang', l);
    if (TITLES[l]) document.title = TITLES[l];
    var b = document.getElementsByClassName('langbtn');
    for (var i = 0; i < b.length; i++) {
      b[i].setAttribute('aria-selected', b[i].getAttribute('data-set') === l ? 'true' : 'false');
    }
    if (persist) { try { localStorage.setItem(KEY, l); } catch (e) {} }
  }
  var pick = null;
  try {
    var m = /[?&]lang=(az|ru|en)\\b/i.exec(location.search);
    if (m) pick = m[1].toLowerCase();
  } catch (e) {}
  if (!pick) { try { pick = localStorage.getItem(KEY); } catch (e) {} }
  if (!pick) {
    var n = (navigator.language || '').slice(0, 2).toLowerCase();
    pick = n === 'ru' ? 'ru' : n === 'en' ? 'en' : 'az';
  }
  set(pick, false);
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && el.className !== undefined) {
      if (String(el.className).indexOf('langbtn') >= 0) {
        e.preventDefault();
        set(el.getAttribute('data-set'), true);
        return;
      }
      el = el.parentNode;
    }
  });
})();
`;

/** One node, rendered once per language. Only the active language is shown;
 *  the other two are display:none, so the page needs no network round trip and
 *  works from a file:// copy. */
function langBlocks(render) {
  return LANGS.map((l) => `<div class="L ${l}">${render(l)}</div>`).join('\n');
}

const PAGES = [
  { file: 'privacy.html', key: 'privacy' },
  { file: 'terms.html', key: 'terms' },
  { file: 'delete-account.html', key: 'delete' },
];

function titleFor(key, lang) {
  if (key === 'delete') return SITE.deleteTitle[lang];
  return t(lang, LEGAL[key].title);
}

function pageNav(current) {
  return langBlocks(
    (l) => `
      <div class="flabel">${esc(SITE.otherDocs[l])}</div>
      <div class="flinks">
        ${PAGES.map(
          (p) =>
            `<a href="${p.file}"${p.key === current ? ' aria-current="page"' : ''}>${esc(
              titleFor(p.key, l)
            )}</a>`
        ).join('\n        ')}
        <a href="/">${esc(SITE.home[l])}</a>
      </div>`
  );
}

/** The app's own disclaimer for the translated versions, shown only on ru/en. */
const TRANSLATION_NOTE =
  'Bu, tərcümədir. Hüquqi qüvvəsi olan mətn Azərbaycan dilindəki versiyadır; fərq olarsa, o əsas götürülür.';

function docBody(key, lang) {
  const parts = [];
  parts.push(`<h1>${esc(titleFor(key, lang))}</h1>`);
  parts.push(
    `<p class="updated">${esc(t(lang, 'Son yenilənmə: {date}').replace('{date}', UPDATED[lang]))}</p>`
  );

  if (key === 'delete') {
    parts.push(`<p class="intro">${fill(DEL.intro[lang])}</p>`);
  } else {
    parts.push(`<p class="intro">${fill(t(lang, LEGAL[key].intro))}</p>`);
  }
  if (lang !== 'az') parts.push(`<p class="note">${esc(t(lang, TRANSLATION_NOTE))}</p>`);

  if (key === 'delete') {
    for (const s of DEL.sections) {
      const inner = [`<h2>${esc(s.heading[lang])}</h2>`];
      for (const p of s.body ?? []) inner.push(`<p>${fill(p[lang])}</p>`);
      if (s.steps) {
        inner.push(
          `<ol>\n${s.steps.map((x) => `  <li>${fill(x[lang])}</li>`).join('\n')}\n</ol>`
        );
      }
      if (s.list) {
        inner.push(`<ul>\n${s.list.map((x) => `  <li>${fill(x[lang])}</li>`).join('\n')}\n</ul>`);
      }
      parts.push(`<section>\n${inner.join('\n')}\n</section>`);
    }
  } else {
    for (const s of LEGAL[key].sections) {
      const inner = [];
      if (s.heading) inner.push(`<h2>${esc(t(lang, s.heading))}</h2>`);
      for (const b of s.body) {
        const line = corrected(lang, b);
        if (line === null) continue; // CORRECTIONS dropped it — see the table above
        inner.push(`<p>${fill(line)}</p>`);
      }
      parts.push(`<section>\n${inner.join('\n')}\n</section>`);
    }
  }
  return parts.join('\n');
}

function page(key) {
  const titles = Object.fromEntries(LANGS.map((l) => [l, `SPOT — ${titleFor(key, l)}`]));
  const desc =
    {
      privacy: 'SPOT — məxfilik siyasəti / политика конфиденциальности / privacy policy.',
      terms: 'SPOT — istifadə şərtləri / условия использования / terms of use.',
      rules: 'SPOT — icma qaydaları / правила сообщества / community rules.',
      delete: 'SPOT — hesabın silinməsi / удаление аккаунта / deleting your account.',
    }[key] ?? titles.az;

  return `<!doctype html>
<html lang="az" data-lang="az">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(Object.values(titles).join(' · '))}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#101014">
<meta name="color-scheme" content="dark">
<link rel="alternate" hreflang="az" href="?lang=az">
<link rel="alternate" hreflang="ru" href="?lang=ru">
<link rel="alternate" hreflang="en" href="?lang=en">
<style>${CSS}
/* Only the active language is rendered. Without JavaScript the page shows
   Azerbaijani, which is the legally binding version. */
html[data-lang="az"] .L:not(.az){display:none}
html[data-lang="ru"] .L:not(.ru){display:none}
html[data-lang="en"] .L:not(.en){display:none}
</style>
</head>
<body>

<header class="site">
  <div class="wrap row">
    <a class="brand" href="/">
      <span class="mark"><span class="ring"><i></i></span></span>
      <span class="word">SPOT</span>
    </a>
    <div class="langs" role="group" aria-label="${esc(
      LANGS.map((l) => SITE.langLabel[l]).join(' / ')
    )}">
${LANGS.map(
  (l) =>
    `      <button type="button" class="langbtn" data-set="${l}" aria-selected="${
      l === 'az' ? 'true' : 'false'
    }" lang="${l}">${LANG_LABEL[l]}</button>`
).join('\n')}
    </div>
  </div>
</header>

<main class="wrap">
${LANGS.map((l) => `<div class="L ${l}" lang="${l}">\n${docBody(key, l)}\n</div>`).join('\n')}
</main>

<footer class="wrap">
${pageNav(key)}
  <div class="copy">© 2026 SPOT</div>
</footer>

<script>${SCRIPT.replace('__TITLES__', JSON.stringify(titles))}</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ write -- */

for (const { file, key } of PAGES) {
  const html = page(key);
  await writeFile(join(HERE, file), html, 'utf8');
  console.log(`wrote ${file}  (${html.length} bytes)`);
}

if (missing.length) {
  console.error('\nMISSING TRANSLATIONS — pages are not publishable:');
  for (const m of missing) console.error('  ' + m);
  process.exit(1);
}

if (usedOverrides.size) {
  console.log('\nFilled from OVERRIDES (missing in src/i18n/{ru,en}/legal.ts):');
  for (const s of usedOverrides) console.log(`  «${s}»`);
}

if (usedCorrections.size) {
  console.log(
    '\nCORRECTED on the website only — src/lib/legal.ts still says the old thing (README.md §1a):'
  );
  for (const s of usedCorrections) {
    console.log(`  ${CORRECTIONS[s] === null ? 'dropped ' : 'rewrote '}«${s}»`);
  }
}

const unusedCorrections = Object.keys(CORRECTIONS).filter((s) => !usedCorrections.has(s));
if (unusedCorrections.length) {
  // A correction that matches nothing means src/lib/legal.ts changed under it:
  // either the sentence was fixed in the app (delete the entry) or it was
  // reworded (update the key). Silently keeping it would publish the old text.
  console.error('\nSTALE CORRECTIONS — these keys match no sentence in src/lib/legal.ts:');
  for (const s of unusedCorrections) console.error(`  «${s}»`);
  process.exit(1);
}

console.log(`\nBlanks still to fill (both are deliberate, see README.md):\n  ${OPERATOR}\n  ${CONTACT}`);
