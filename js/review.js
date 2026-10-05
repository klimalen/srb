// Вес карточки: новое слово около 1.
// Ошибки поднимают вес, верные ответы опускают.
// Пол не даёт выученному слову исчезнуть совсем —
// иначе через месяц оно так и не вернётся.
export const MIN_WEIGHT = 0.08

const STORAGE_VERSION = 1

export function readStat(stat) {
  const correct = nonNeg(stat?.correct)
  const wrong = nonNeg(stat?.wrong)
  return { shown: correct + wrong, correct, wrong }
}

export function weight(stat) {
  const { correct, wrong } = readStat(stat)
  const raw = (1 + wrong) / (1 + correct)
  return raw < MIN_WEIGHT ? MIN_WEIGHT : raw
}

// Сначала короткая колода, потом к ней подмешиваются следующие слова.
// Иначе знакомое слово возвращается слишком поздно и забывается.
export const LESSON_SIZE = 20
export const LESSON_STEP = 5
export const LESSON_CORRECT = 3
export const LESSON_SHOWN = 8

export function lessonReady(stat) {
  const { correct, shown } = readStat(stat)
  return correct >= LESSON_CORRECT || shown >= LESSON_SHOWN
}

export function unlockedCount(words, stats) {
  const total = words.length
  let count = Math.min(LESSON_SIZE, total)
  while (count < total) {
    const start = count <= LESSON_SIZE ? 0 : count - LESSON_STEP
    let ready = true
    for (let i = start; i < count; i += 1) {
      if (!lessonReady(stats?.[words[i].id])) {
        ready = false
        break
      }
    }
    if (!ready) break
    count = Math.min(total, count + LESSON_STEP)
  }
  return count
}

export function learningDeck(words, stats) {
  if (!words.length) return []
  const limit = unlockedCount(words, stats)
  const deck = words.slice(0, limit)
  const seen = new Set(deck.map((word) => word.id))
  for (let i = limit; i < words.length; i += 1) {
    const word = words[i]
    if (seen.has(word.id)) continue
    if (readStat(stats?.[word.id]).wrong > 0) {
      deck.push(word)
      seen.add(word.id)
    }
  }
  return deck
}

export function pickWord(words, stats, excludeId, random = Math.random) {
  if (!words.length) {
    throw new Error("Словарь пуст")
  }
  const deck = learningDeck(words, stats)
  let pool = deck.length ? deck : words
  if (excludeId && pool.length > 1) {
    const filtered = pool.filter((word) => word.id !== excludeId)
    if (filtered.length) pool = filtered
  }
  const weights = pool.map((word) => weight(stats?.[word.id]))
  const total = weights.reduce((sum, value) => sum + value, 0)
  let cursor = random() * total
  for (let i = 0; i < pool.length; i += 1) {
    cursor -= weights[i]
    if (cursor < 0) return pool[i]
  }
  return pool[pool.length - 1]
}

// Три карточки с русского на сербский, затем одна с сербского на русский.
const DIRECTION_CYCLE = ["ru-sr", "ru-sr", "ru-sr", "sr-ru"]

export function pickDirection(slot = 0) {
  const index = directionIndex(slot)
  return DIRECTION_CYCLE[index]
}

export function nextDirectionSlot(slot = 0) {
  return (directionIndex(slot) + 1) % DIRECTION_CYCLE.length
}

function directionIndex(slot) {
  const index = Number(slot)
  if (!Number.isInteger(index) || index < 0) return 0
  return index % DIRECTION_CYCLE.length
}

export function applyAnswer(stat, isCorrect) {
  const current = readStat(stat)
  const correct = current.correct + (isCorrect ? 1 : 0)
  const wrong = current.wrong + (isCorrect ? 0 : 1)
  return { shown: correct + wrong, correct, wrong }
}

export function promptSize(text) {
  const length = String(text).length
  if (length > 26) return "xl"
  if (length > 12) return "lg"
  return "md"
}

export function formatPercent(stat) {
  const { shown, correct } = readStat(stat)
  if (shown === 0) return "—"
  return `${Math.round((correct / shown) * 100)}%`
}

// Сверху проблемные, затем ещё не показанные, внизу устойчиво верные.
export function compareWords(a, b, stats) {
  const sa = readStat(stats?.[a.id])
  const sb = readStat(stats?.[b.id])
  const bucketDiff = bucket(sa) - bucket(sb)
  if (bucketDiff !== 0) return bucketDiff

  if (sa.wrong > 0 || sb.wrong > 0) {
    const rate = sa.wrong * sb.shown - sb.wrong * sa.shown
    if (rate !== 0) return -rate
    if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong
  } else if (sa.correct !== sb.correct) {
    return sa.correct - sb.correct
  }

  const byName = a.serbian.localeCompare(b.serbian, "sr")
  if (byName !== 0) return byName
  return a.id.localeCompare(b.id)
}

export function fold(text) {
  return String(text)
    .toLocaleLowerCase("sr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "dj")
}

export function matchesQuery(word, query) {
  const needle = fold(query).trim()
  if (!needle) return true
  return [word.serbian, word.transcription, word.russian].some((field) =>
    fold(field).includes(needle),
  )
}

export function normalizeStore(data) {
  const stats = {}
  const rawStats = data && typeof data === "object" ? data.stats : null
  if (rawStats && typeof rawStats === "object") {
    for (const [id, value] of Object.entries(rawStats)) {
      if (!value || typeof value !== "object") continue
      const stat = readStat(value)
      if (stat.shown === 0) continue
      stats[id] = stat
    }
  }
  const lastId = data && typeof data.lastId === "string" ? data.lastId : null
  return { version: STORAGE_VERSION, stats, lastId, directionSlot: directionIndex(data?.directionSlot) }
}

function bucket(stat) {
  if (stat.wrong > 0) return 0
  if (stat.shown === 0) return 1
  return 2
}

function nonNeg(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}
