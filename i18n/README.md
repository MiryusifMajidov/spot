# i18n source

`translations.json` is the source of truth for the Russian and English
dictionaries in `src/i18n/{ru,en}/*.ts` — those files are GENERATED from it.

    python scripts/i18n_extract.py i18n/keys.json          # every key the app uses
    python scripts/i18n_write.py i18n/keys.json i18n/translations.json
    python scripts/check_i18n.py --missing                 # what is left untranslated
    npm run i18n:test                                      # plural rules etc.

To change a translation, edit `translations.json` and regenerate. To add a
language string, write `t('Azərbaycanca mətn')` in the code (the Azerbaijani IS
the key), extract, add its `ru`/`en` here, regenerate. Terminology and tone:
`scripts/i18n-glossary.md`.

The legal documents' translations (the `legal` chunk) are machine translations.
The app tells a Russian or English reader that the Azerbaijani text is binding,
but a lawyer should review them before relying on them.
