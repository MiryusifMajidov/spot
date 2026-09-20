# scripts

## Icons

`make_icons.py` draws SPOT's app icon from the mark the design specifies, and
`make_native_icons.py` writes the same mark into `android/`'s generated
resources.

```bash
python scripts/make_icons.py         # assets/images/*
python scripts/make_native_icons.py  # android/app/src/main/res/*
```

Needs Pillow (`pip install Pillow`).

### Why these exist

The mark is defined in `design-handoff/SPOT iOS App.dc.html` as markup, not as
artwork: a 78×78 tile with `border-radius: 20px` on `#101014`, holding a 34px
circle with a 5px `#C6FF3D` border and, inset 8px, an 18px filled `#C6FF3D`
circle. There was no PNG of it anywhere, so the app shipped with the Expo
template's logo — a white chevron on blue — as its launcher icon. Every ratio in
`make_icons.py` is taken from those numbers, so the icon cannot drift from the
mark the app draws on its own screens.

### Why the second script

`android/` is gitignored and its icons are generated ONCE, by `expo prebuild`.
Changing `app.json` does not touch them, which is why the icon looked corrected
in some places and not others. Re-running `expo prebuild` would fix them and
**wipe the release keystore** (`android/app/spot-upload.keystore`) and the
`SPOT_UPLOAD_*` block in `android/gradle.properties` along with the rest of
`android/`. So the native resources are rewritten in place instead.

Same reason `versionCode`/`versionName` have to be bumped in BOTH `app.json` and
`android/app/build.gradle`: prebuild normally copies one into the other, and it
is not being run.
