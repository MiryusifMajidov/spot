# SPOT — releasing to the App Store and Google Play

Written 2026-09-23. Two parts: **what the project already does** and **what only
the owner's accounts can do**. Every command is run from `D:\spot` on Windows.

## The signing key — read this first

`android/app/spot-upload.keystore` (and the `SPOT_UPLOAD_*` block in
`android/gradle.properties`) exist **only on this machine**: `android/` is in
`.gitignore`, so git does not hold them. Android ties an installed app to
(package name + signing key). Lose that file and nobody who installed SPOT can
ever update it — a new listing under a new package would be the only way out.

Back it up today, somewhere that is not this disk (password manager, encrypted
archive). Not in the repository.

Google Play App Signing (offered on the first upload, and enabled by default for
new apps) is the safety net: Google keeps the *app* signing key and this file
becomes the *upload* key, which Google can reset if it is lost. Enable it.

## Android — Google Play

Play no longer accepts APKs for new apps; it takes an `.aab`.

```bash
cd android && ./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`, signed with
the key above. `apk/SPOT-<version>.apk` stays useful for installing on a phone
directly (`adb install -r`), which is how this project has been tested.

Version numbers live in two files that must stay in step —
`app.json` (`expo.version`, `expo.android.versionCode`) and
`android/app/build.gradle` (`versionName`, `versionCode`). Play refuses a
`versionCode` it has already seen.

## iOS — App Store, built in the cloud from Windows

There is no `ios/` folder in the repo and there does not need to be: EAS Build
runs `prebuild` on its own macOS workers from `app.json`. `eas.json` in the repo
root defines the profiles.

```bash
npx eas login                      # the owner's Expo account
npx eas build -p ios --profile production
npx eas submit -p ios --latest     # uploads the build to App Store Connect
```

The first `eas build` asks for the Apple Developer account and creates the
bundle id, the distribution certificate and the provisioning profile. That step
needs the owner: Apple credentials are never entered by anyone else.

What is already in `app.json` for iOS: bundle id `com.spot.app`,
`buildNumber`, `usesAppleSignIn`, `ITSAppUsesNonExemptEncryption: false` (so the
export-compliance question is answered automatically), and the four permission
sentences iOS shows (camera, photos, microphone, location-when-in-use).

### Sign in with Apple

App Store Review rejects an app that offers Google sign-in without Sign in with
Apple (guideline 4.8). The app now shows Apple's native sheet on iOS
(`expo-apple-authentication`, `src/lib/auth.ts`), and falls back to the browser
flow where the sheet is unavailable. It only appears once **Apple is enabled as
a provider in Supabase** (Dashboard → Authentication → Providers → Apple), which
needs the Services ID, Team ID and the key from the Apple developer account.
Until then `useSocialProviders` correctly hides the button — and iOS review
would fail.

## What the stores will ask for

| Item | State |
|---|---|
| Privacy policy URL | pages written (`store/legal/`), **not deployed** — they still carry the operator name / contact placeholders |
| Account deletion | in-app (Profil → Məxfilik → «Hesabı sil» → `delete_my_account`); Play also wants a public URL → `store/legal/delete-account.html` |
| Data safety (Play) / App Privacy (Apple) | answers prepared in `store/data-safety.md` |
| Listing copy az/ru/en | `store/listing.md` |
| Screenshots | not taken yet — the gym catalogue is empty, so the screens worth showing are the trainer panel, a program, check-in, the feed and chat |
| Demo account for App Review | the owner must create one and put it in App Store Connect; guest mode covers browsing but the reviewer will want a signed-in account |
| Push notifications | Android is live (FCM). iOS needs an APNs key from the Apple account |

## Before the first submission

1. Back up the keystore (above).
2. Fill the two legal placeholders (`src/lib/legal.ts`), regenerate the public
   pages, deploy them, and put the URL in both stores.
3. Enable Apple as a Supabase provider and rebuild for iOS.
4. Decide what the catalogue looks like on day one: today Kəşf → Zallar is
   empty and says so honestly.
5. Supabase: the free plan's restriction notice (04 Oct 2026) and the Sydney
   region (~0.5 s per request from Baku) both bite at launch.
