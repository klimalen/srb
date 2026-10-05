#!/usr/bin/env python3
"""Build data/stress.json from a Wiktionary cache at /tmp/wiki-sh.json.

The cache is a one-off download of Serbo-Croatian entries. Vowel index 0 is
the first a/e/i/o/u (or a syllabic r). null means the token is not stressed.
"""

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path("/tmp/wiki-sh.json")
EXTRA = Path("/tmp/wiki-extra.json")
OUT = ROOT / "data" / "stress.json"

# Drop these combining marks only when they sit on a vowel or syllabic r.
# Acute on c is the letter ć and must stay.
STRESS_MARKS = set("\u0300\u0301\u0302\u030f\u0311")
LENGTH_MARKS = set("\u0304")
VOWEL_BASES = set("aeiour")

# Present/imperative pairs where Wiktionary lists both. These cards are present.
OVERRIDES = {
    "vremena": 0,  # Koliko vremena: genitive vrȅmena
    "meseca": 0,  # dva meseca: genitive mȅseca
    "prodavnica": 0,  # pròdāvnica, the form listed first
    "široko": 0,
    "govori": 0,
    "govorimo": 0,
    "govorite": 0,
    "koristiti": 0,  # kòristiti, the form listed first
    "idemo": 0,  # ȉdēmo, the form listed first
    "idete": 0,
    "hirurg": 0,  # hìrūrg
    "ključevi": 0,  # kljȕčevi
    "putuje": 0,
    "putujem": 0,
    "putujemo": 0,
    "putujete": 0,
    "putuješ": 0,
    "putuju": 0,  # pùtujē
    "roditelji": 0,  # ròditelji
    "sledeće": 0,  # slèdećē
    "spavaća": 0,  # spȁvaćā
    # Forms whose paradigm is unaccented on Wiktionary, checked against the
    # headword or a sister dictionary (sh.wiktionary / en.wiktionary).
    "autobusom": 2,  # autóbus
    "moskvi": 0,  # Mȍskva
    "velika": 0,  # vèlik
    "kakvo": 0,  # kàkāv
    "ove": 0,  # òvē
    "prošle": 0,  # prȍšlī
    "meni": 0,  # mȅni, the stressed dative of ja
    "verenica": 0,  # vȅrenica
    "dvosoban": 0,  # dvòsoban
    "bankovna": 0,  # bànkōvnī
    "košta": 0,  # kȍštajūći
    "može": 0,  # mȍgūći
    "čekam": 0,  # čȅkajūći
    "završimo": 1,  # zavŕšiti, past adverb zavŕšīvši
    "visoko": 0,  # adjective vìsok; adverb visòko is the second gloss on the same card
    "visoka": 0,
    "zauzeti": 0,  # adjective “занятые”, not the verb zaùzēti
}

# Short datives are clitics in this dictionary. Subject „mi“ is stressed later, in a phrase.
CLITICS = {"sam", "si", "je", "smo", "ste", "su", "se", "li", "mi", "mu", "joj", "im"}


def sc_body(text: str) -> str:
    parts = re.split(r"(?m)^==([^=].*?)==\s*$", text)
    chunks = []
    for i in range(1, len(parts), 2):
        title = parts[i].strip().lower()
        if "serbo-croatian" in title or title in {"serbian", "croatian", "bosnian"}:
            chunks.append(parts[i + 1])
    return "\n".join(chunks)


def analyze(accented: str):
    nfd = unicodedata.normalize("NFD", accented)
    pieces = []
    stressed_at = []
    i = 0
    while i < len(nfd):
        ch = nfd[i]
        if unicodedata.category(ch) == "Mn":
            i += 1
            continue
        j = i + 1
        marks = []
        while j < len(nfd) and unicodedata.category(nfd[j]) == "Mn":
            marks.append(nfd[j])
            j += 1
        base = ch.lower()
        keep = []
        stressed = False
        for mark in marks:
            if base in VOWEL_BASES and mark in STRESS_MARKS | LENGTH_MARKS:
                if mark in STRESS_MARKS:
                    stressed = True
                continue
            keep.append(mark)
        piece = unicodedata.normalize("NFC", "".join([base, *keep]))
        if piece and any(unicodedata.category(c).startswith("L") for c in piece):
            if stressed:
                stressed_at.append(len("".join(pieces)))
            pieces.append(piece)
        i = j
    raw = re.sub(r"[^a-zčćđšž]", "", "".join(pieces))
    nuclei = vowel_offsets(raw)
    indexes = [nuclei.index(pos) for pos in stressed_at if pos in nuclei]
    return raw, (indexes[0] if indexes else None)


def wiki_pieces(value: str):
    value = re.sub(r"<br\s*/?>", " / ", value, flags=re.I)
    value = re.sub(r"''+", " ", value)
    value = re.sub(r"\{\{[^}]*\}\}", " ", value)
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"<[^>]+>", " ", value)
    return [piece.strip() for piece in re.split(r"[,/]", value) if piece.strip()]


def adverb_stem(accented: str):
    """Return (vowel index, stressed letter) from a present adverb, if marked."""
    for piece in wiki_pieces(accented):
        plain, index = analyze(piece)
        if not plain or index is None:
            continue
        stem = plain
        for suffix in ("jući", "eći", "ući", "ći"):
            if plain.endswith(suffix) and len(plain) > len(suffix):
                stem = plain[: -len(suffix)]
                break
        offsets = vowel_offsets(stem)
        if index < len(offsets):
            return index, stem[offsets[index]]
    return None


def derive_unmarked_presents(pages, tokens, best):
    """Fill present-tense tokens whose cells are written without accent marks.

    An accented present adverb wins. Otherwise the infinitive's vowel index is
    copied when that same letter is still the vowel at that index.
    """
    derived = {}
    for text in pages.values():
        body = sc_body(text)
        if not body or "{{sh-conj" not in body:
            continue
        infinitive = None
        head = re.search(r"\{\{sh-verb\|([^}|\n]+)", body)
        if head:
            for part in re.split(r"[,/]", head.group(1)):
                plain, index = analyze(part.strip())
                if plain and index is not None:
                    infinitive = (plain, index)
                    break
        for match in re.finditer(r"\{\{sh-conj\b([\s\S]*?)\n\}\}", body):
            fields = dict(re.findall(r"\|([A-Za-z0-9.]+)=([^\n]+)", match.group(1)))
            stem_stress = adverb_stem(fields.get("pr.va", ""))
            for key, value in fields.items():
                if not key.startswith("pr.") or key == "pr.va":
                    continue
                for piece in wiki_pieces(value):
                    plain, index = analyze(piece)
                    if not plain or index is not None or plain not in tokens:
                        continue
                    if plain in best or plain in CLITICS:
                        continue
                    choice = None
                    offsets = vowel_offsets(plain)
                    if stem_stress is not None:
                        vowel_index, letter = stem_stress
                        if vowel_index < len(offsets) and plain[offsets[vowel_index]] == letter:
                            choice = vowel_index
                    if choice is None and infinitive is not None:
                        inf_plain, inf_index = infinitive
                        inf_offsets = vowel_offsets(inf_plain)
                        if (
                            inf_index < len(inf_offsets)
                            and inf_index < len(offsets)
                            and plain[offsets[inf_index]] == inf_plain[inf_offsets[inf_index]]
                        ):
                            choice = inf_index
                    if choice is not None:
                        derived.setdefault(plain, set()).add(choice)
    for plain, indexes in derived.items():
        if plain not in best and len(indexes) == 1:
            best[plain] = indexes.pop()


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


def main() -> None:
    blob = json.loads(CACHE.read_text())
    pages = dict(blob["pages"])
    if EXTRA.exists():
        pages.update(json.loads(EXTRA.read_text()))
    tokens = {unicodedata.normalize("NFC", token) for token in blob["tokens"]}
    word_re = re.compile(r"[^\W\d_]+", re.UNICODE)
    store = defaultdict(list)

    def consider(plain, index, priority):
        if plain in tokens and index is not None:
            store[plain].append((priority, index))

    for title, text in pages.items():
        body = sc_body(text)
        if not body:
            continue
        title_n = unicodedata.normalize("NFC", title)
        body = re.sub(r"\{\{IPA\|[^}]+\}\}", " ", body)
        for match in re.finditer(r"\{\{sh-(?:IPA|verb|noun|adv|adj|pron)\|([^\}\n]+)", body):
            for part in match.group(1).split("|"):
                part = part.strip()
                if not part or "=" in part:
                    continue
                for piece in re.split(r"[,/]", part):
                    plain, index = analyze(piece.strip())
                    consider(plain, index, 3 if plain == title_n else 2)
        for match in re.finditer(r"\{\{sh-(?:conj|decl-noun\w*)[\s\S]*?\n\}\}", body):
            for raw in word_re.findall(match.group(0)):
                plain, index = analyze(raw)
                consider(plain, index, 2)
        for raw in word_re.findall(body):
            plain, index = analyze(raw)
            consider(plain, index, 1)

    best = {}
    for plain, items in store.items():
        top = max(priority for priority, _ in items)
        indexes = sorted({index for priority, index in items if priority == top})
        if len(indexes) == 1:
            best[plain] = indexes[0]

    best.update(OVERRIDES)
    derive_unmarked_presents(pages, tokens, best)

    def stressed_offset(token, index):
        offsets = vowel_offsets(token)
        if index is None or index >= len(offsets):
            return None
        return offsets[index]

    # Copy stress onto an inflected form when the stressed letter is still
    # the same letter in the same place. One pass, only from dictionary forms.
    donated = dict(best)
    endings = {
        "",
        "a", "e", "i", "o", "u", "m", "š",
        "om", "oj", "og", "im", "ih", "em", "eš", "am", "aš", "ju", "je", "ti", "ći",
        "la", "lo", "li", "le", "io",
        "an", "na", "no", "ni", "ne", "ak", "ka", "ko", "ke",
        "ci", "ca", "cu", "com", "kom", "jom",
        "ama", "ima", "ah", "nja", "nje", "nji",
        "ati", "iti", "eti", "uti", "ovati", "ivati", "avati",
        "amo", "ate", "aju", "emo", "ete", "imo", "ite", "mo",
        "uje", "uju", "ujem", "uješ", "ujemo", "ujete",
        "uj", "ova", "ove", "ovu",
        "š", "iš", "eš", "aš", "uš",
    }
    derivational = ("uj", "ov", "iv", "av", "ir")

    def related(left: str, right: str):
        limit = min(len(left), len(right))
        for shared in range(limit, 2, -1):
            if left[:shared] != right[:shared]:
                continue
            left_end = left[shared:]
            right_end = right[shared:]
            if left_end not in endings or right_end not in endings:
                continue

            def derived(ending: str) -> bool:
                return any(ending.startswith(piece) for piece in derivational)

            # kupi/kupujete share "kup" but only one side grew a derivational suffix.
            if derived(left_end) != derived(right_end):
                continue
            return shared
        return None

    inherited = {}
    for token in sorted(tokens - set(best) - CLITICS, key=len):
        options = []
        for known, index in best.items():
            shared = related(token, known)
            if shared is None:
                continue
            offset = stressed_offset(known, index)
            if offset is None or offset >= shared or offset >= len(token):
                continue
            if token[offset] != known[offset]:
                continue
            options.append((shared, len(known), offset, known))
        if not options:
            continue
        options.sort(key=lambda item: (item[0], -item[1]), reverse=True)
        _shared, _length, offset, known = options[0]
        nuclei = vowel_offsets(token)
        if offset in nuclei:
            donated[token] = nuclei.index(offset)
            inherited[token] = known

    for token in tokens:
        if token in CLITICS:
            donated[token] = None
            continue
        if token in donated:
            continue
        if len(vowel_offsets(token)) == 1:
            donated[token] = 0

    print(f"inherited {len(inherited)}")
    for token, known in sorted(inherited.items()):
        print(f"  {token} <- {known} [{donated[token]}]")

    missing = sorted(token for token in tokens if token not in donated)
    if missing:
        print("still without stress:", " ".join(missing))
    else:
        print("every token has a stress decision")

    payload = {token: donated.get(token) for token in sorted(tokens)}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(payload)} entries, stressed {sum(v is not None for v in payload.values())}")


if __name__ == "__main__":
    main()
