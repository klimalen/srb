#!/usr/bin/env python3
"""Rebuild js/dictionary.js from data/dictionary.csv.

The Russian transcription is the one already in the CSV. This script only
marks stress: the stressed vowel (or a syllabic р) becomes a capital letter.
Stress positions come from data/stress.json. Clitics, prepositions and
conjunctions inside a phrase stay unstressed. „ne“ before a word stressed on
its first syllable takes that stress.
"""

import csv
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "dictionary.csv"
STRESS_PATH = ROOT / "data" / "stress.json"
JS_PATH = ROOT / "js" / "dictionary.js"

# Longest match first. je/ja/ju/jo are how this dictionary writes those sounds.
RULES = (
    ("dž", "дж"),
    ("lj", "ль"),
    ("nj", "нь"),
    ("dj", "дж"),
    ("ja", "я"),
    ("ju", "ю"),
    ("je", "е"),
    ("jo", "йо"),
    ("j", "й"),
)
SINGLE = {
    "a": "а",
    "b": "б",
    "c": "ц",
    "č": "ч",
    "ć": "ч",
    "d": "д",
    "đ": "дж",
    "e": "е",
    "f": "ф",
    "g": "г",
    "h": "х",
    "i": "и",
    "k": "к",
    "l": "л",
    "m": "м",
    "n": "н",
    "o": "о",
    "p": "п",
    "r": "р",
    "s": "с",
    "š": "ш",
    "t": "т",
    "u": "у",
    "v": "в",
    "z": "з",
    "ž": "ж",
}

CLITICS = {"sam", "si", "je", "smo", "ste", "su", "se", "li"}
SHORT_DATIVE = {"mi", "mu", "joj", "im"}
PREPOSITIONS = {
    "u", "na", "za", "sa", "s", "od", "do", "iz", "kod", "bez",
    "pre", "posle", "po", "k", "ka", "o", "pri", "van",
}
CONJUNCTIONS = {"i", "a", "pa", "da", "ali", "ili"}
CYR_VOWELS = "аеиоуыэюяё"

LATIN_RE = re.compile(r"[A-Za-zČĆĐŠŽčćđšž]+|[^A-Za-zČĆĐŠŽčćđšž]+")
CYR_RE = re.compile(r"[А-Яа-яЁё]+|[^А-Яа-яЁё]+")


def fnv1a(text: str) -> str:
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"w{h:08x}"


def vowel_offsets(token: str):
    offsets = []
    for index, ch in enumerate(token):
        if ch in "aeiou":
            offsets.append(index)
        elif ch == "r":
            prev_v = index > 0 and token[index - 1] in "aeiou"
            next_v = index + 1 < len(token) and token[index + 1] in "aeiou"
            if not prev_v and not next_v:
                offsets.append(index)
    return offsets


def align(serbian: str):
    """Map a lowercase Serbian word onto transcription chunks."""
    chunks = []
    i = 0
    while i < len(serbian):
        matched = False
        for source, target in RULES:
            if serbian.startswith(source, i):
                chunks.append((i, i + len(source), target))
                i += len(source)
                matched = True
                break
        if matched:
            continue
        target = SINGLE.get(serbian[i])
        if target is None:
            return None
        chunks.append((i, i + 1, target))
        i += 1
    return chunks


def capitalize_at(chunk: str, serbian: str, start: int, end: int, offset: int) -> str:
    if not (start <= offset < end):
        return chunk
    slice_ = serbian[start:end]
    local = offset - start
    if slice_[local] == "r":
        place = chunk.find("р")
        if place < 0:
            raise ValueError(f"no р in {chunk!r} for syllabic r")
        return chunk[:place] + "Р" + chunk[place + 1 :]
    latin = [pos for pos, ch in enumerate(slice_) if ch in "aeiou"]
    cyrillic = [pos for pos, ch in enumerate(chunk) if ch in CYR_VOWELS]
    which = latin.index(local)
    place = cyrillic[which]
    return chunk[:place] + chunk[place].upper() + chunk[place + 1 :]


def mark_word(serbian: str, transcription: str, stress_index):
    core = serbian.lower()
    chunks = align(core)
    if chunks is None or "".join(chunk for _, _, chunk in chunks) != transcription.lower():
        raise ValueError(f"cannot align {serbian!r} with {transcription!r}")
    if stress_index is None:
        return transcription
    offsets = vowel_offsets(core)
    if stress_index >= len(offsets):
        raise ValueError(f"stress {stress_index} out of range for {serbian!r}")
    offset = offsets[stress_index]
    parts = []
    for start, end, chunk in chunks:
        parts.append(capitalize_at(chunk, core, start, end, offset))
    return "".join(parts)


def is_word(piece: str, latin: bool) -> bool:
    pattern = LATIN_RE if latin else CYR_RE
    return bool(pattern.fullmatch(piece) and piece[:1].isalpha())


def phrase_stress(words, stress):
    decisions = []
    for word in words:
        if word in CLITICS or word in SHORT_DATIVE:
            decisions.append(None)
        else:
            if word not in stress:
                raise KeyError(word)
            decisions.append(stress[word])
    if len(words) == 1:
        return decisions
    for index, word in enumerate(words):
        if word in PREPOSITIONS or word in CONJUNCTIONS:
            decisions[index] = None
    for index, word in enumerate(words):
        if word != "mi":
            continue
        if index != 0 and words[index - 1] not in {"i", "a", "pa", "ali"}:
            continue
        rest = words[index + 1 :]
        if any(item == "smo" or (item.endswith("mo") and item not in CLITICS) for item in rest):
            decisions[index] = 0
    for index, word in enumerate(words[:-1]):
        nxt = words[index + 1]
        if word != "ne" or decisions[index + 1] != 0:
            continue
        if nxt in CLITICS | SHORT_DATIVE | PREPOSITIONS | CONJUNCTIONS:
            continue
        decisions[index] = 0
        decisions[index + 1] = None
    return decisions


def mark_phrase(serbian: str, transcription: str, stress) -> str:
    src = LATIN_RE.findall(serbian)
    dst = CYR_RE.findall(transcription)
    if len(src) != len(dst):
        raise ValueError(f"token mismatch {serbian!r} / {transcription!r}")
    words = [piece.lower() for piece in src if is_word(piece, True)]
    decisions = phrase_stress(words, stress)
    cursor = 0
    out = []
    for left, right in zip(src, dst):
        if is_word(left, True):
            if not is_word(right, False):
                raise ValueError(f"word aligned to punctuation in {serbian!r}")
            out.append(mark_word(left, right, decisions[cursor]))
            cursor += 1
        else:
            if left != right:
                raise ValueError(f"punctuation {left!r} != {right!r} in {serbian!r}")
            out.append(right)
    if cursor != len(decisions):
        raise ValueError(f"unused stress decisions in {serbian!r}")
    return "".join(out)


def main() -> None:
    stress = {
        unicodedata.normalize("NFC", key): value
        for key, value in json.loads(STRESS_PATH.read_text(encoding="utf-8")).items()
    }
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    entries = []
    seen = {}
    for row in rows:
        serbian = row["Сербский"].strip()
        transcription = mark_phrase(serbian, row["Чтение по-русски"].strip(), stress)
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
