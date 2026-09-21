"""
Every string that needs a Russian and an English translation, with context.

Two sources:

1. LITERAL keys — every `t('…')` in src/. Where a call passes `count`, the key is
   marked counted: Russian needs three plural forms for it, English two.

2. DATA keys — SPOT's own seed content (exercise names, muscles, common
   mistakes, starter programs, notification texts). Screens render these as
   `t(ex.name)`, so the key is the Azerbaijani VALUE, which no scan of `t(`
   calls can see. They are read out of the data files directly.

    python scripts/i18n_extract.py out.json

Output: [{key, counted, placeholders, files, kind}] — `kind` is "ui" or "data".
"""
import io
import json
import os
import re
import sys

AZ = "əğışçöüƏĞİŞÇÖÜ"
SRC = "src"
I18N = os.path.normpath(os.path.join(SRC, "i18n"))

# SPOT's own content, rendered through t(value). NOT user content.
DATA_FILES = ["src/store/db.ts", "src/data/mock.ts", "src/lib/notifications.ts", "src/lib/legal.ts"]

CALL = re.compile(
    r"""\b(?:t|tr)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")""",
    re.S,
)


def call_args(body, start):
    """The text of a call's remaining arguments, up to its closing paren.

    The regex used to swallow the vars object as well, and a NESTED t() inside
    it -- t('... ({records})', { records: bests.map(b => t('{lift} {n} kq', ...)) })
    -- was consumed with it and never became a key. The match now stops after
    the string literal, and this walks the parens to find `count` instead.
    """
    depth, i, n = 1, start, len(body)
    while i < n and depth:
        c = body[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        i += 1
    return body[start:i]


LIT = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"", re.S)


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def strip_comments(s):
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return re.sub(r"^\s*//.*$", "", s, flags=re.M)


def walk():
    for root, dirs, names in os.walk(SRC):
        if os.path.normpath(root).startswith(I18N):
            continue
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for n in names:
            if n.endswith((".ts", ".tsx")):
                yield os.path.join(root, n)


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "i18n-keys.json"
    keys = {}

    for f in walk():
        body = strip_comments(io.open(f, encoding="utf-8").read())
        rel = f.replace(os.sep, "/")
        for m in CALL.finditer(body):
            raw = m.group(1) if m.group(1) is not None else m.group(2)
            if not raw:
                continue
            k = unescape(raw)
            vars_ = call_args(body, m.end())
            e = keys.setdefault(k, {"key": k, "counted": False, "files": set(), "kind": "ui"})
            e["files"].add(rel)
            if re.search(r"\bcount\b", vars_):
                e["counted"] = True

    # Every Azerbaijani literal in EVERY source file, not only the data files.
    # Screens render module constants through t(CONST) — status maps, amenity
    # chips, compatibility reasons, badge labels — and a scan of t('…') calls
    # cannot see those keys. Over-including is harmless (an entry nothing looks
    # up); under-including is an untranslated screen.
    for f in [x.replace(os.sep, "/") for x in walk()]:
        body = strip_comments(io.open(f, encoding="utf-8").read())
        for m in LIT.finditer(body):
            raw = m.group(1) if m.group(1) is not None else m.group(2)
            if not raw or not any(c in AZ for c in raw):
                continue
            k = unescape(raw).strip()
            if not k:
                continue
            kind = "data" if f in DATA_FILES else "ui"
            e = keys.setdefault(k, {"key": k, "counted": False, "files": set(), "kind": kind})
            e["files"].add(f)

    out = []
    for k, e in keys.items():
        e["files"] = sorted(e["files"])
        e["placeholders"] = sorted(set(re.findall(r"\{(\w+)\}", k)))
        out.append(e)
    out.sort(key=lambda e: (e["files"][0], e["key"]))

    io.open(out_path, "w", encoding="utf-8", newline="\n").write(json.dumps(out, ensure_ascii=False, indent=1))
    ui = sum(1 for e in out if e["kind"] == "ui")
    data = len(out) - ui
    counted = sum(1 for e in out if e["counted"])
    print("keys: %d  (ui %d, data %d, counted %d) -> %s" % (len(out), ui, data, counted, out_path))


if __name__ == "__main__":
    main()
