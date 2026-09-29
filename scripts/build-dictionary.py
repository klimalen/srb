#!/usr/bin/env python3
"""Rebuild js/dictionary.js from data/dictionary.csv."""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "dictionary.csv"
JS_PATH = ROOT / "js" / "dictionary.js"


def fnv1a(text: str) -> str:
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"w{h:08x}"


def main() -> None:
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    entries = []
    seen = {}
    for row in rows:
        serbian = row["Сербский"].strip()
        transcription = row["Чтение по-русски"].strip()
        russian = row["Перевод на русский"].strip()
        base = fnv1a(serbian + "\n" + russian)
        n = seen.get(base, 0)
        seen[base] = n + 1
        entry_id = base if n == 0 else f"{base}-{n + 1}"
        entries.append(
            {
                "id": entry_id,
                "serbian": serbian,
                "transcription": transcription,
                "russian": russian,
            }
        )

    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise SystemExit("dictionary ids are not unique")

    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    JS_PATH.write_text(f"export const dictionary = {payload}\n", encoding="utf-8")
    print(f"wrote {len(entries)} entries to {JS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
