import assert from "node:assert/strict"
import test from "node:test"
import { dictionary } from "../js/dictionary.js"
import {
  MIN_WEIGHT,
  applyAnswer,
  compareWords,
  fold,
  formatPercent,
  matchesQuery,
  normalizeStore,
  pickDirection,
  pickWord,
  readStat,
  weight,
} from "../js/review.js"

test("new words start near weight 1 and never fall through the floor", () => {
  assert.equal(weight(undefined), 1)
  assert.equal(weight({ correct: 0, wrong: 0 }), 1)
  assert.ok(weight({ correct: 0, wrong: 4 }) > weight({ correct: 0, wrong: 1 }))
  assert.ok(weight({ correct: 3, wrong: 0 }) < weight({ correct: 1, wrong: 0 }))
  assert.equal(weight({ correct: 40, wrong: 0 }), MIN_WEIGHT)
  assert.ok(MIN_WEIGHT > 0)
})

test("errors raise a word above a clean run", () => {
  const missed = weight({ correct: 1, wrong: 6 })
  const clean = weight({ correct: 6, wrong: 1 })
  assert.ok(missed > 1)
  assert.ok(clean < 1)
})

test("pickWord is uniform when nothing has been answered", () => {
  const words = [{ id: "a" }, { id: "b" }]
  assert.equal(pickWord(words, {}, null, () => 0).id, "a")
  assert.equal(pickWord(words, {}, null, () => 0.999999).id, "b")
})

test("mistakes are drawn more often, mastered words still appear", () => {
  const words = [{ id: "hard" }, { id: "easy" }]
  const stats = {
    hard: { correct: 0, wrong: 1 },
    easy: { correct: 9, wrong: 0 },
  }
  assert.equal(weight(stats.hard), 2)
  assert.equal(weight(stats.easy), 0.1)
  assert.equal(pickWord(words, stats, null, () => 0.5).id, "hard")
  assert.equal(pickWord(words, stats, null, () => 0.97).id, "easy")
})

test("the word just shown is skipped until the one after", () => {
  const words = [{ id: "hard" }, { id: "easy" }, { id: "new" }]
  const stats = { hard: { correct: 0, wrong: 8 } }
  assert.equal(pickWord(words, stats, "hard", () => 0).id, "easy")
  assert.notEqual(pickWord(words, stats, "hard", () => 0).id, "hard")
  assert.equal(pickWord([{ id: "only" }], {}, "only", () => 0.2).id, "only")
})

test("direction is one of the two sides", () => {
  assert.equal(pickDirection(() => 0), "sr-ru")
  assert.equal(pickDirection(() => 0.5), "ru-sr")
  assert.equal(pickDirection(() => 0.99), "ru-sr")
})

test("an answer updates shown, correct and wrong together", () => {
  const once = applyAnswer(undefined, false)
  assert.deepEqual(once, { shown: 1, correct: 0, wrong: 1 })
  const twice = applyAnswer(once, true)
  assert.deepEqual(twice, { shown: 2, correct: 1, wrong: 1 })
  assert.equal(formatPercent({ correct: 8, wrong: 4 }), "67%")
  assert.equal(formatPercent(undefined), "—")
})

test("dictionary sort puts misses first, unseen next, mastered last", () => {
  const words = [
    { id: "miss", serbian: "z" },
    { id: "shaky", serbian: "a" },
    { id: "fresh", serbian: "m" },
    { id: "fresh-b", serbian: "b" },
    { id: "known", serbian: "k" },
    { id: "solid", serbian: "s" },
  ]
  const stats = {
    miss: { correct: 0, wrong: 1 },
    shaky: { correct: 4, wrong: 8 },
    known: { correct: 2, wrong: 0 },
    solid: { correct: 12, wrong: 0 },
  }
  const ordered = [...words].sort((a, b) => compareWords(a, b, stats)).map((word) => word.id)
  assert.deepEqual(ordered, ["miss", "shaky", "fresh-b", "fresh", "known", "solid"])
})

test("same error rate prefers the word missed more often", () => {
  const words = [
    { id: "once", serbian: "a" },
    { id: "often", serbian: "b" },
  ]
  const stats = {
    once: { correct: 1, wrong: 1 },
    often: { correct: 4, wrong: 4 },
  }
  assert.ok(compareWords(words[1], words[0], stats) < 0)
})

test("search ignores case and Serbian diacritics", () => {
  const word = {
    serbian: "međutim",
    transcription: "меджутим",
    russian: "однако",
  }
  assert.equal(matchesQuery(word, "   "), true)
  assert.equal(matchesQuery(word, "MEDJUTIM"), true)
  assert.equal(matchesQuery(word, "međutim"), true)
  assert.equal(matchesQuery(word, "ОДНАКО"), true)
  assert.equal(matchesQuery(word, "меджу"), true)
  assert.equal(matchesQuery(word, "učiti"), false)
  assert.equal(fold("Čaša Đak"), "casa djak")
})

test("stored stats ignore garbage and keep a last id", () => {
  const store = normalizeStore({
    stats: {
      ok: { correct: 2, wrong: 1, shown: 99 },
      empty: { correct: 0, wrong: 0 },
      bad: "nope",
      negative: { correct: -3, wrong: 1.9 },
    },
    lastId: "ok",
  })
  assert.deepEqual(store.stats.ok, { shown: 3, correct: 2, wrong: 1 })
  assert.equal(store.stats.empty, undefined)
  assert.equal(store.stats.bad, undefined)
  assert.deepEqual(readStat(store.stats.negative), { shown: 1, correct: 0, wrong: 1 })
  assert.equal(store.lastId, "ok")
  assert.deepEqual(normalizeStore(null), { version: 1, stats: {}, lastId: null })
})

test("the shipped dictionary is complete and addressable", () => {
  assert.equal(dictionary.length, 778)
  const ids = new Set(dictionary.map((word) => word.id))
  assert.equal(ids.size, 778)
  for (const word of dictionary) {
    assert.ok(word.serbian)
    assert.ok(word.transcription)
    assert.ok(word.russian)
  }
  const slobodno = dictionary.filter((word) => word.serbian === "slobodno")
  assert.equal(slobodno.length, 2)
  assert.notEqual(slobodno[0].russian, slobodno[1].russian)
  assert.ok(dictionary.some((word) => word.serbian === "međutim"))
  assert.equal(pickWord(dictionary, {}, null, () => 0).id, dictionary[0].id)
})
