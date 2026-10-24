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

// Сначала короткая колода. Дальше новое слово приходит, как только
// предыдущие начинают получаться: незакреплённых держим около LESSON_AHEAD,
// а не ждём, пока закроется вся пачка. Иначе знакомое слово возвращается
// слишком поздно, а очередь к новым стоит на месте.
// Освободившееся место занимают недавно добавленные слова (большая партия
// word.added раньше), а не старый хвост словаря. Первые LESSON_SIZE слов
// остаются началом колоды.
export const LESSON_SIZE = 20
export const LESSON_AHEAD = 14
export const LESSON_CORRECT = 2
export const LESSON_SHOWN = 6

export function lessonReady(stat) {
  const { correct, wrong, shown } = readStat(stat)
  if (shown >= LESSON_SHOWN) return true
  return correct >= LESSON_CORRECT && correct > wrong
}

function addedBatch(word) {
  const batch = Number(word?.added)
  if (!Number.isInteger(batch) || batch < 0) return 0
  return batch
}

export function learningOrder(words) {
  if (words.length <= LESSON_SIZE) return words.slice()
  const head = words.slice(0, LESSON_SIZE)
  const rest = words.slice(LESSON_SIZE).map((word, index) => ({ word, index }))
  rest.sort((a, b) => {
    const byBatch = addedBatch(b.word) - addedBatch(a.word)
    if (byBatch !== 0) return byBatch
    return a.index - b.index
  })
  return head.concat(rest.map((item) => item.word))
}

function openCount(order, stats) {
  const total = order.length
  if (!total) return 0
  let open = Math.min(LESSON_SIZE, total)
  let settled = 0
  for (let i = 0; i < open; i += 1) {
    if (lessonReady(stats?.[order[i].id])) settled += 1
  }
  while (open < total && settled + LESSON_AHEAD > open) {
    if (lessonReady(stats?.[order[open].id])) settled += 1
    open += 1
  }
  return open
}

export function unlockedCount(words, stats) {
  return openCount(learningOrder(words), stats)
}

export function learningDeck(words, stats) {
  if (!words.length) return []
  const order = learningOrder(words)
  const limit = openCount(order, stats)
  const deck = order.slice(0, limit)
  const seen = new Set(deck.map((word) => word.id))
  for (const word of order) {
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
