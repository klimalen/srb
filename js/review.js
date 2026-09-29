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

export function pickWord(words, stats, excludeId, random = Math.random) {
  if (!words.length) {
    throw new Error("Словарь пуст")
  }
  let pool = words
  if (excludeId && words.length > 1) {
    const filtered = words.filter((word) => word.id !== excludeId)
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

export function pickDirection(random = Math.random) {
  return random() < 0.5 ? "sr-ru" : "ru-sr"
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
  return { version: STORAGE_VERSION, stats, lastId }
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
