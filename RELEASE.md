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

## Android's `android/` folder is NOT generated — read this before trusting app.json

`android/` is in .gitignore and is maintained BY HAND. Gradle builds from
`android/app/src/main/AndroidManifest.xml` and `android/app/build.gradle` exactly
as they are on disk; nothing re-runs `expo prebuild`. So a config-plugin option
added to `app.json` reaches **iOS only** (EAS prebuilds on its macOS worker) and
changes nothing on Android until the same change is written into the native
files.

That is not theory — it happened on 25.09.2026. `expo-audio` was given
`enableBackgroundPlayback: false`, which removes the media-playback foreground
service and its two permissions; the introspected config agreed, and the built
AAB still declared `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, which makes Play demand a
Foreground Service declaration with a demo video for a use case SPOT does not
have. `android.allowBackup: false` was ignored the same way, leaving
`android:allowBackup="true"` — and an Android backup carries AsyncStorage, which
carries the Supabase session token.

So, after any `app.json` change that affects Android:

```bash
python - <<'EOF'
import zipfile; m = zipfile.ZipFile('apk/SPOT-<ver>.aab').read('base/manifest/AndroidManifest.xml').decode('latin1')
print([p for p in ('FOREGROUND_SERVICE','RECORD_AUDIO','READ_MEDIA_IMAGES') if p in m])
EOF
```

Read the MERGED manifest out of the AAB, not the source file: libraries add
permissions of their own, and Play shows the merged list.

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

What is already in `app.json` for iOS: bundle id `app.spot.az`,
`buildNumber`, `usesAppleSignIn` and the `expo-apple-authentication` plugin (CNG
needs the plugin, not just the flag — it is what puts
`com.apple.developer.applesignin` in the entitlements),
`ITSAppUsesNonExemptEncryption: false` (so the export-compliance question is
answered automatically), and the four permission sentences iOS shows.

Check those four with the config itself, never by reading `ios.infoPlist` —
**a config plugin overrides it**, and two of them were wrong for exactly that
reason (23.09.2026): `expo-camera`'s `cameraPermission` replaced the camera
sentence with one that only mentioned the QR code, and `expo-audio` replaced the
microphone sentence with its English default, «Allow $(PRODUCT_NAME) to access
your microphone», in an Azerbaijani app. Apple compares a purpose string to what
the app actually does, and a generic default is a known rejection reason. The
command that shows what iOS will really see:

```bash
npx expo config --type introspect --json
```

**`aps-environment` is not a problem — this was checked.** The introspected
config shows `"aps-environment": "development"` and that is correct at every
stage before the archive. The SDK 57 documentation says it outright: «The iOS
APNs entitlement is *always* set to "development". Xcode automatically changes
this to "production" in the archive generated by a release build.» So do NOT
hardcode `production` in `app.json` — that breaks the development build's push
without fixing anything. Still send yourself one notification from TestFlight
before submitting: that is the only proof that the whole chain (APNs key →
Expo → the device) works, and it costs two minutes.

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
3a. Send yourself one push from TestFlight before submitting — the only proof
   that the APNs key, Expo and the device agree (see above).
4. Decide what the catalogue looks like on day one: today Kəşf → Zallar is
   empty and says so honestly.
5. Supabase: the free plan's restriction notice (04 Oct 2026) and the Sydney
   region (~0.5 s per request from Baku) both bite at launch.
