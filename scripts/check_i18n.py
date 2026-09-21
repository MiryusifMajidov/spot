"""
Which strings have no Russian or English translation yet.

The dictionaries are keyed by the Azerbaijani SOURCE STRING (see src/lib/i18n.ts
for why), which means a missing translation is invisible at runtime — `t()`
returns the Azerbaijani and the screen looks fine to anyone who reads it. That
is the right failure mode for a user and the wrong one for whoever has to
finish the job, so this script is the other half: it makes the gap countable.

    python scripts/check_i18n.py            # summary
    python scripts/check_i18n.py --missing  # every untranslated key
    python scripts/check_i18n.py --extra    # keys in a dictionary that no t() call uses

A key in the dictionary that nothing calls is usually a stale one left behind
after somebody edited the Azerbaijani copy — that is the cost of source-string
keys, and --extra is how it gets found.
"""
import io
import os
import re
import sys

SRC = "src"
I18N = os.path.join(SRC, "i18n")

# t('...') / t("...") / t(`...`) with an optional second argument.
CALL = re.compile(
    r"""\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)""",
    re.S,
)

# A dictionary entry: 'key': 'value'  or  'key': { one: …, other: … }
ENTRY = re.compile(
    r"""(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:""",
    re.S,
)


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"').replace("\\`", "`").replace("\\\\", "\\")


def walk(root, skip_i18n=True):
    for dirpath, dirnames, names in os.walk(root):
        if skip_i18n and os.path.normpath(dirpath).startswith(os.path.normpath(I18N)):
            continue
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for n in names:
            if n.endswith((".ts", ".tsx")):
                yield os.path.join(dirpath, n)


def strip_comments(s):
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return re.sub(r"^\s*//.*$", "", s, flags=re.M)


def used_keys():
    keys = {}
    for f in walk(SRC):
        body = strip_comments(io.open(f, encoding="utf-8").read())
        for m in CALL.finditer(body):
            raw = m.group(1) or m.group(2) or m.group(3)
            if raw is None:
                continue
            k = unescape(raw)
            if k:
                keys.setdefault(k, set()).add(f.replace(os.sep, "/"))
    return keys


def dict_keys(lang):
    keys = set()
    d = os.path.join(I18N, lang)
    if not os.path.isdir(d):
        return keys
    for n in sorted(os.listdir(d)):
        if not n.endswith(".ts") or n == "index.ts":
            continue
        body = io.open(os.path.join(d, n), encoding="utf-8").read()
        # only inside the exported object
        brace = body.find("{")
        if brace < 0:
            continue
        for m in ENTRY.finditer(body[brace:]):
            raw = m.group(1) or m.group(2)
            if raw:
                keys.add(unescape(raw))
    return keys


def main():
    show_missing = "--missing" in sys.argv
    show_extra = "--extra" in sys.argv

    used = used_keys()
    print("t() call sites      : %d unique strings" % len(used))

    for lang in ("ru", "en"):
        have = dict_keys(lang)
        missing = sorted(k for k in used if k not in have)
        extra = sorted(k for k in have if k not in used)
        pct = 0 if not used else round(100 * (len(used) - len(missing)) / len(used))
        print(
            "%s: %d translated, %d missing, %d unused  (%d%%)"
            % (lang, len(used) - len(missing), len(missing), len(extra), pct)
        )
        if show_missing and missing:
            print("  -- missing in %s --" % lang)
            for k in missing:
                where = sorted(used[k])[0]
                print("   %-70s %s" % (k[:70], where))
        if show_extra and extra:
            print("  -- unused in %s (stale after an Azerbaijani edit?) --" % lang)
            for k in extra:
                print("   %s" % k[:100])

    # Strings still hard-coded, i.e. never wrapped in t()
    AZ = "əğışçöüƏĞİŞÇÖÜ"
    lit = re.compile(
        r"'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|\"([^\"\\\n]*(?:\\.[^\"\\\n]*)*)\"|`([^`\\]*(?:\\.[^`\\]*)*)`",
        re.S,
    )
    jsx = re.compile(r">\s*([^<>{}\n][^<>{}]*?)\s*<", re.S)
    unwrapped = {}
    for f in walk(SRC):
        body = strip_comments(io.open(f, encoding="utf-8").read())
        wrapped = {unescape(m.group(1) or m.group(2) or m.group(3) or "") for m in CALL.finditer(body)}
        for m in lit.finditer(body):
            raw = (m.group(1) or m.group(2) or m.group(3) or "").strip()
            if raw and any(c in AZ for c in raw) and raw not in wrapped:
                unwrapped.setdefault(f.replace(os.sep, "/"), set()).add(raw)
        for m in jsx.finditer(body):
            txt = " ".join(m.group(1).split())
            if txt and any(c in AZ for c in txt) and txt not in wrapped:
                unwrapped.setdefault(f.replace(os.sep, "/"), set()).add(txt)

    total = sum(len(v) for v in unwrapped.values())
    print("\nstill hard-coded    : %d strings in %d files" % (total, len(unwrapped)))
    if show_missing:
        for f, ss in sorted(unwrapped.items(), key=lambda kv: -len(kv[1]))[:40]:
            print("   %-58s %d" % (f, len(ss)))


if __name__ == "__main__":
    main()
