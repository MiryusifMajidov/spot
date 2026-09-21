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
    r"""\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*(,\s*\{([^}]*)\})?""",
    re.S,
)
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
            vars_ = m.group(4) or ""
            e = keys.setdefault(k, {"key": k, "counted": False, "files": set(), "kind": "ui"})
            e["files"].add(rel)
            if re.search(r"\bcount\b", vars_):
                e["counted"] = True

    for f in DATA_FILES:
        if not os.path.exists(f):
            continue
        body = strip_comments(io.open(f, encoding="utf-8").read())
        for m in LIT.finditer(body):
            raw = m.group(1) if m.group(1) is not None else m.group(2)
            if not raw or not any(c in AZ for c in raw):
                continue
            k = unescape(raw).strip()
            if not k:
                continue
            e = keys.setdefault(k, {"key": k, "counted": False, "files": set(), "kind": "data"})
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
