# store/legal — the public legal pages

Three static pages the App Store and Google Play ask for, in Azerbaijani,
Russian and English:

| File | What it is | Where the URL goes |
|---|---|---|
| `privacy.html` | Məxfilik siyasəti / Политика конфиденциальности / Privacy Policy | App Store Connect → App Privacy → Privacy Policy URL; Play Console → App content → Privacy policy |
| `terms.html` | İstifadə şərtləri / Условия использования / Terms of Use | App Store Connect → App Information → EULA / support URL; Play listing |
| `delete-account.html` | Hesabın silinməsi / Удаление аккаунта / Deleting your account | Play Console → App content → **Data deletion → URL to request account deletion** (Play requires this even though SPOT deletes in-app) |

They are plain HTML: no build step to serve them, no external stylesheet, font
or script, nothing fetched at runtime. Each file carries all three languages and
an AZ/RU/EN switch; the choice is remembered in `localStorage`. Without
JavaScript the page shows Azerbaijani, which is the legally binding version.
Adding `?lang=ru` or `?lang=en` opens the page in that language directly, which
is useful if a store asks for one URL per locale.

The look matches `web/landing/index.html` — same dark `#101014`, same lime
`#C6FF3D`, same system font stack — so the pages read as part of the same site.

---

## 1. Before you submit: fill the two blanks — this is blocking

Both pages show, in a loud amber box:

```
[DOLDURULMALI: operator şirkətin/şəxsin adı]
[DOLDURULMALI: əlaqə e-poçtu]
```

These are the legal name of whoever operates SPOT and a contact e-mail address.
Nobody could invent them, so they are left visible on purpose: a privacy policy
that names no operator and gives no contact address is a rejection in both
stores, and a grey inline blank is too easy to scroll past.

They live in **`src/lib/legal.ts`** (`OPERATOR` and `CONTACT`), not in the HTML.
Fill them there, then regenerate (step 2) — that way the app and the website say
the same thing on the same day. The strings also appear in
`src/i18n/{ru,en}/legal.ts`, where they are deliberately left untranslated; when
you fill them in, replace them there too.

`delete-account.html` also uses the contact address as the way to ask for
deletion when someone cannot get into the app. Until it is filled, that page
does not actually give a working route, and Play's reviewer checks it.

---

## 1a. The eight sentences that were wrong — fixed at the source

A fact-check against the code and the live database (23.09.2026) found eight
sentences in `src/lib/legal.ts` that were **no longer true of the build being
submitted**, and every one of them contradicted `store/data-safety.md` — the
answers that go into Play's «Data safety» form and App Store Connect's «App
Privacy». A reviewer reads the policy and the form side by side; a policy that
describes collection the form denies is a rejection, not a typo.

| # | What it said | Why it was wrong |
|---|---|---|
| 1 | «Bədən: qeyd etdiyin çəki və istəsən progress fotoları.» | The weight screen was removed and nothing writes `public.progress`; a progress-photo feature never existed (only a dead AsyncStorage key). |
| 2 | «Check-in anında telefonun yerini zalın koordinatı ilə müqayisə edirik» | Check-in is the reception QR code since schema74. The RPC takes a code and nothing else, and `check_ins` has no coordinate column. |
| 3 | «Telefon nömrəsi (əgər yazmısansa) — yalnız sənə görünür.» | Sign-in by phone was removed, `profiles.phone` carries no SELECT grant for `anon`/`authenticated`, and the live table holds zero numbers. |
| 4 | «ÇƏKİN, PROGRESS FOTOLARIN … görünmür» | Same as 1 — listing them among the things nobody can see still tells the reader the app takes them. |
| 5 | «Lokasiya yalnız iki halda … check-in zamanı zalda olduğunu yoxlamaq» | Check-in does not read location at all. |
| 6 | «…check-in üçün istifadə olunandan sonra saxlanılmır» | Right conclusion, wrong reason: the coordinate is never written anywhere. |
| 7 | «Reklam şəbəkəsi yoxdur…» (nothing else named) | True but incomplete, in a document that promises «Burada yazılmayan heç nə toplanmır». Opening the map shows unpkg.com (Leaflet) and tile.openstreetmap.org an IP address; push goes through Expo's own service (exp.host) before FCM and APNs. |
| 8 | «…çəki təklifləri və **qidalanma nümunələri** tibbi məsləhət deyil» | The meal planner was deleted, so the disclaimer disclaimed a screen that is not there. |

All eight are now corrected in `src/lib/legal.ts` and `i18n/translations.json`,
so **the app screen and these pages say the same thing** and the `CORRECTIONS`
table in `build.mjs` is empty. Keep it that way: if a sentence is wrong it is
wrong in the app too, and patching only the public copy leaves the app lying to
the same reader. The build prints a loud warning for any entry that no longer
matches a sentence in the source.

Two more things the source now says, and the pages with it: the filming
location (GPS) is stripped from uploaded videos and photos on the phone before
the file is sent (`src/lib/videoMeta.ts`), and a deleted account's gym review
stays with the gym but loses the name (`supabase/schema87_review_detach.sql`).

`delete-account.html` carried two of the same claims in its own text (weight
measurements and progress photos among «Nə silinir», and a phone number among
the profile fields). Both are fixed directly in `build.mjs`, and a missing item
was added under «Nə qalır»: a gym-ownership claim, which carries a VÖEN, is
`ON DELETE SET NULL` against `auth.users`, so it outlives the account.

## 2. Regenerating the pages

```bash
node store/legal/build.mjs
```

The Terms and the Privacy Policy are **not** written in HTML by hand. The build
reads the app's own text — `src/lib/legal.ts` for Azerbaijani,
`src/i18n/{ru,en}/legal.ts` for the translations — and emits the pages, so the
screen a user taps in Profil → Parametrlər and the page a reviewer opens cannot
drift apart. If any sentence has no translation the build **fails** instead of
publishing an Azerbaijani paragraph under a Russian heading.

`CORRECTIONS` and `OVERRIDES` in `build.mjs` are the escape hatch for a sentence
the website must say differently (§1a). Both are empty, and the build prints a
warning for any entry that stops matching, so an exception cannot be left behind
and forgotten.

Re-run it after any change to those three files. The text of
`delete-account.html` has no counterpart in the app and lives inside
`build.mjs` itself.

## 3. Deploying next to the landing site

The landing site is `web/landing` (nginx in Docker, Fly app **`spot-az`**,
region `fra`). Its `Dockerfile` copies one file today, so the legal pages need a
copy step and one extra `COPY` line.

**a.** Copy the generated pages into the landing folder (PowerShell, from `D:\spot`):

```powershell
New-Item -ItemType Directory -Force web\landing\legal | Out-Null
Copy-Item store\legal\*.html web\landing\legal\ -Force
```

**b.** Add one line to `web/landing/Dockerfile`, right after the existing
`COPY index.html …`:

```dockerfile
COPY legal/ /usr/share/nginx/html/legal/
```

**c.** Deploy:

```powershell
cd web\landing
fly deploy
```

The URLs are then:

```
https://spot-az.fly.dev/legal/privacy.html
https://spot-az.fly.dev/legal/terms.html
https://spot-az.fly.dev/legal/delete-account.html
```

(If a custom domain is attached to the `spot-az` app, use it instead — the pages
contain no absolute links, so they work under any host. The only site-absolute
link is `/`, the SPOT home page.)

`web/landing/legal/` is a copy of generated output, so re-copy it after every
`node store/legal/build.mjs`. Either commit it or add it to `.gitignore` — just
do not edit it, because the next copy overwrites it.

## 4. After deploying, open the three URLs

Not optional, because of one nginx rule. `web/landing/Dockerfile` ends its
config with:

```nginx
location / { try_files $uri $uri/ /index.html; }
```

A path that does not exist therefore returns **the landing page with HTTP 200**,
not a 404. If the `COPY` line is missing or a filename is misspelled, the store
URL will look like it works while showing a marketing page to a reviewer who
asked for a privacy policy. Open each of the three URLs and check you see the
legal page. Check `?lang=ru` once, too.

## 5. Related, not in this folder

- The landing page footer (`web/landing/index.html`) still links «Məxfilik
  siyasəti», «İstifadə şərtləri» and «İcma qaydaları» to `href="#"`. Point the
  first two at `/legal/privacy.html` and `/legal/terms.html` after deploying.
- **İcma qaydaları** (Community Rules) is the third document in
  `src/lib/legal.ts` and has no page here, because neither store requires it as
  a public URL — it is reachable in the app. If you want one for the footer,
  add `{ file: 'rules.html', key: 'rules' }` to the `PAGES` array in
  `build.mjs`; everything else already works.
- Store listing copy, Data safety and App Privacy answers: see `store/` and
  `RELEASE.md`.

## 6. Four things worth fixing before submission

Found while checking every claim on these pages against the code and the live
database. None of them is fixed here — this folder only contains the pages.

1. **A deleted account's name stays on its gym reviews.** `reviews.author_id` is
   `ON DELETE SET NULL`, but `reviews.name` is a separate column that the
   `reviews_stamp` trigger fills with the profile's name when the review is
   written, and `delete_my_account()` never clears it. `reviews_read` is public,
   so the name stays visible to everyone after the account is gone. The in-app
   confirmation dialog (`src/app/(tabs)/profile/privacy.tsx`) already promises
   the opposite: «Zala yazdığın rəy qalır, amma adın çıxarılır». One line in
   `delete_my_account()` (`update public.reviews set name = null where
   author_id = pid;`) would make the promise true. `delete-account.html`
   currently describes what really happens today; if this is fixed, rewrite the
   first item under «Nə qalır» in all three languages — it is marked
   `REVIEW-NAME` in `build.mjs`.
   **Status on 23.09.2026:** a migration for exactly this now exists in the tree
   — `supabase/schema85_review_name_on_delete.sql` — but it has **not been
   applied**: the live `delete_my_account()` still contains no `update
   public.reviews set name = null`. The page is therefore correct today. After
   applying it, re-read the live function, rewrite that item in all three
   languages and re-run the build.
2. **The same dialog is stale about programs and gyms.** It says «Yaratdığın zal
   və proqramlar da qalır», but since `schema81` programs are deleted, and a gym
   SPOT never listed is deleted too. Only a *listed* gym survives.
3. **An admin account cannot delete itself.**
   `moderation_actions.admin_id` is `ON DELETE RESTRICT` against `auth.users`,
   and `delete_my_account()` ends with `delete from auth.users`. So the moment
   the owner's own account (the one row in `public.admins`) resolves its first
   report, «Hesabı sil» starts failing for it with a foreign-key error, and the
   app correctly says «Hesab silinmədi». Latent today — `moderation_actions`
   has 0 rows — but it becomes real on the first moderation action, and
   `delete-account.html` promises deletion without qualification. The fix is
   `SET NULL` on that column, like `audit_log.admin_id` already has.
4. ~~The Privacy Policy heading «Lokasiya» has no translation~~ — FIXED
   (23.09.2026). It was missing because `scripts/i18n_extract.py` skips any
   literal without an Azerbaijani-specific letter, which is how it tells a
   sentence from an identifier; «Lokasiya» is spelled in plain ASCII and was
   dropped silently. `src/lib/legal.ts` is now in that script's `PROSE_FILES`,
   where every literal is text somebody reads, so the heading (and the «updated»
   date, which used to render in Azerbaijani under a Russian heading) is
   translated like everything else.
