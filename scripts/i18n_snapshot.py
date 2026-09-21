"""
Every Azerbaijani string in src/, as a set — so a migration can be proved not to
have changed the copy.

Wrapping 2000 strings in `t()` touches a hundred files. The thing that must NOT
happen is a letter quietly changing on the way through: an «ə» that becomes an
«e», a dropped «—», a sentence reflowed. None of that fails a typecheck and none
of it is visible in a diff review of a hundred files.

    python scripts/i18n_snapshot.py write  before.json   # before the migration
    python scripts/i18n_snapshot.py check  before.json   # after it

`check` reports strings that vanished and strings that appeared. A clean run
means every piece of Azerbaijani copy survived byte for byte.
"""
import io
import json
import os
import re
import sys

AZ = "əğışçöüƏĞİŞÇÖÜ"

LIT = re.compile(
    r"'([^'\\\n]*(?:\\.[^'\\\n]*)*)'"
    r"|\"([^\"\\\n]*(?:\\.[^\"\\\n]*)*)\""
    r"|`([^`\\]*(?:\\.[^`\\]*)*)`",
    re.S,
)
JSX = re.compile(r">\s*([^<>{}\n][^<>{}]*?)\s*<", re.S)


def strings():
    found = {}
    for root, dirs, names in os.walk("src"):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        # The dictionaries legitimately hold Azerbaijani as KEYS; they are the
        # destination, not the source, so counting them would mask a loss.
        if os.path.normpath(root).startswith(os.path.normpath(os.path.join("src", "i18n"))):
            continue
        for n in names:
            if not n.endswith((".ts", ".tsx")):
                continue
            f = os.path.join(root, n)
            body = io.open(f, encoding="utf-8").read()
            body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
            body = re.sub(r"^\s*//.*$", "", body, flags=re.M)
            for m in LIT.finditer(body):
                raw = (m.group(1) or m.group(2) or m.group(3) or "").strip()
                if raw and any(c in AZ for c in raw):
                    found.setdefault(raw, []).append(f.replace(os.sep, "/"))
            for m in JSX.finditer(body):
                txt = " ".join(m.group(1).split())
                if txt and any(c in AZ for c in txt):
                    found.setdefault(txt, []).append(f.replace(os.sep, "/"))
    return found


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "write"
    path = sys.argv[2] if len(sys.argv) > 2 else "i18n-before.json"
    now = strings()

    if mode == "write":
        io.open(path, "w", encoding="utf-8", newline="").write(
            json.dumps(sorted(now), ensure_ascii=False, indent=0)
        )
        print("snapshot: %d unique Azerbaijani strings -> %s" % (len(now), path))
        return

    before = set(json.load(io.open(path, encoding="utf-8")))
    after = set(now)
    lost = sorted(before - after)
    gained = sorted(after - before)

    print("before: %d   after: %d" % (len(before), len(after)))
    print("LOST   (copy that disappeared or changed): %d" % len(lost))
    for s in lost[:200]:
        print("   - %s" % s[:110])
    print("NEW    (copy that appeared): %d" % len(gained))
    for s in gained[:200]:
        print("   + %s  %s" % (s[:90], now.get(s, [""])[0]))
    # A migration that only wraps strings should lose nothing. Anything in LOST
    # is either a real edit or a string the wrapper reflowed.
    sys.exit(1 if lost else 0)


if __name__ == "__main__":
    main()
