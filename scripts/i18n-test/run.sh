#!/usr/bin/env bash
# Compile src/lib/i18n.ts on its own and run the cases against it.
#
# There is no test runner in this project and adding one for a single pure
# module is not worth the dependency. `t()` and the plural rules are pure
# functions, so tsc + node is enough — and the Russian rule is exactly the kind
# of thing that is wrong for months without anyone noticing, because «5 тренера»
# looks like a word, not like a bug.
set -e
cd "$(dirname "$0")/../.."
OUT=".i18n-test"
rm -rf "$OUT"
mkdir -p "$OUT/node_modules/expo-localization"
cat > "$OUT/node_modules/expo-localization/package.json" <<'JSON'
{ "name": "expo-localization", "version": "0.0.0", "main": "index.js" }
JSON
cat > "$OUT/node_modules/expo-localization/index.js" <<'JS'
exports.getLocales = () => [{ languageCode: 'ru' }];
JS
npx tsc src/lib/i18n.ts --ignoreConfig --outDir "$OUT" --module commonjs \
  --target es2020 --moduleResolution node --ignoreDeprecations 6.0 \
  --skipLibCheck --esModuleInterop
cp scripts/i18n-test/cases.js "$OUT/run.js"
node "$OUT/run.js"
rm -rf "$OUT"
