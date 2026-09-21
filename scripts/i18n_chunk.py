"""
Split the extracted keys into translation chunks that keep related strings
together, so a translator sees a screen's worth of context at once.

    python scripts/i18n_chunk.py keys.json out_dir [--existing ru_en.json]

Legal prose and SPOT's seed data (exercise names, muscles…) get chunks of their
own: the first needs a formal register, the second needs gym vocabulary, and
mixing either into UI chunks dilutes both.
"""
import io
import json
import os
import sys

MAX = 140


def area(e):
    f = e["files"][0] if e["files"] else ""
    if any("legal" in x for x in e["files"]):
        return "legal"
    if e["kind"] == "data":
        return "data"
    for key, marks in [
        ("auth", ["/onboarding/", "/auth", "auth.ts", "authGate", "auth-callback"]),
        ("discover", ["/(tabs)/discover", "GymCard", "TrainerRow", "PartnerRow", "SpotMap"]),
        ("workout", ["/(tabs)/workout", "/(tabs)/checkin", "saveProgram", "exerciseVideo", "duration",
                     "programDraft", "ProgramCard", "removeWorkout", "removeProgram", "format.ts"]),
        ("social", ["/(tabs)/feed", "/chat", "chat.ts", "moderation", "CreatorBadge", "Comments", "comments.ts"]),
        ("profile", ["/(tabs)/profile"]),
        ("panels", ["/trainer", "/gym", "roles.ts", "gymOwner", "accounts.ts", "HoursField"]),
    ]:
        if any(m in f for m in marks):
            return key
    return "system"


def main():
    keys = json.load(io.open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.startswith("chunk-") and old.endswith(".json"):
            os.remove(os.path.join(out, old))

    groups = {}
    for e in keys:
        groups.setdefault(area(e), []).append(e)

    manifest = []
    n = 0
    for name in ["auth", "discover", "workout", "social", "profile", "panels", "system", "data", "legal"]:
        items = groups.get(name, [])
        for i in range(0, len(items), MAX):
            part = items[i:i + MAX]
            n += 1
            fn = "chunk-%02d-%s.json" % (n, name)
            slim = [{"key": e["key"], "counted": e["counted"], "where": e["files"][0]} for e in part]
            io.open(os.path.join(out, fn), "w", encoding="utf-8", newline="\n").write(
                json.dumps(slim, ensure_ascii=False, indent=1))
            manifest.append({"file": fn, "area": name, "count": len(part)})

    io.open(os.path.join(out, "manifest.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(manifest, ensure_ascii=False, indent=1))
    for m in manifest:
        print("  %-26s %-9s %d" % (m["file"], m["area"], m["count"]))
    print("chunks: %d, keys: %d" % (len(manifest), sum(m["count"] for m in manifest)))


if __name__ == "__main__":
    main()
