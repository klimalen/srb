import { dictionary } from "./dictionary.js"
import {
  applyAnswer,
  compareWords,
  formatPercent,
  learningDeck,
  matchesQuery,
  normalizeStore,
  nextDirectionSlot,
  pickDirection,
  pickWord,
  promptSize,
  readStat,
} from "./review.js"

const STORAGE_KEY = "srb.review.v1"

const view = document.querySelector("#view")
const nav = document.querySelector("#nav")
const live = document.querySelector("#live")

const state = {
  view: viewFromHash(),
  phase: "front",
  card: null,
  query: "",
  store: loadStore(),
}

init()

function init() {
  deal()
  window.addEventListener("hashchange", () => {
    state.view = viewFromHash()
    render()
  })
  document.addEventListener("keydown", onKeydown)
  document.querySelector(".app").addEventListener("click", onViewClick)
  render()
}

function viewFromHash() {
  const hash = location.hash.replace(/^#/, "").replace(/\/$/, "")
  return hash === "/words" ? "words" : "cards"
}

function loadStore() {
  try {
    return normalizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"))
  } catch {
    return normalizeStore(null)
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store))
  } catch {
    // Приватный режим или переполненное хранилище: сессия всё равно жива.
  }
}

function deal() {
  const word = pickWord(dictionary, state.store.stats, state.store.lastId)
  state.card = { word, direction: pickDirection(state.store.directionSlot) }
  state.phase = "front"
  state.store.lastId = word.id
  saveStore()
}

function reveal() {
  if (state.view !== "cards" || state.phase !== "front" || !state.card) return
  state.phase = "back"
  render()
}

function answer(isCorrect) {
  if (state.view !== "cards" || state.phase !== "back" || !state.card) return
  const { word } = state.card
  state.store.stats[word.id] = applyAnswer(state.store.stats[word.id], isCorrect)
  state.store.directionSlot = nextDirectionSlot(state.store.directionSlot)
  deal()
  render()
}

function onViewClick(event) {
  if (event.target.closest("[data-clear]")) {
    state.query = ""
    const search = document.querySelector("#search")
    if (search) {
      search.value = ""
      search.focus()
    }
    paintWords()
    return
  }
  const answerButton = event.target.closest("[data-answer]")
  if (answerButton) {
    answer(answerButton.dataset.answer === "correct")
    return
  }
  if (state.view === "cards" && state.phase === "front") reveal()
}

function onKeydown(event) {
  if (event.target.closest("input, textarea") || state.view !== "cards") return
  const onControl = Boolean(event.target.closest("a, button"))
  if (state.phase === "front" && (event.key === " " || event.key === "Enter")) {
    if (onControl) return
    event.preventDefault()
    reveal()
    return
  }
  if (state.phase !== "back" || (onControl && (event.key === "Enter" || event.key === " "))) return
  if (event.key === "ArrowLeft" || event.key === "1" || event.key === "x" || event.key === "X") {
    event.preventDefault()
    answer(false)
  } else if (event.key === "ArrowRight" || event.key === "2" || event.key === "Enter") {
    event.preventDefault()
    answer(true)
  }
}

function render() {
  document.body.dataset.view = state.view
  if (state.view === "words") {
    nav.textContent = "Карточки"
    nav.href = "#/"
    document.title = "Слова — srb"
    if (view.dataset.screen !== "words") mountWords()
    paintWords()
    return
  }
  nav.textContent = "Слова"
  nav.href = "#/words"
  document.title = "srb"
  view.dataset.screen = "cards"
  paintCards()
}

function paintCards() {
  const { word, direction } = state.card
  const revealed = state.phase === "back"
  view.innerHTML = revealed ? backMarkup(word, direction) : frontMarkup(word, direction)
  live.textContent = revealed ? announcement(word, true) : announcement(word, false, direction)
}

function frontMarkup(word, direction) {
  const serbian = direction === "sr-ru"
  const prompt = serbian ? word.serbian : word.russian
  const reading = serbian
    ? `<span class="reading" lang="ru">${esc(word.transcription)}</span>`
    : ""
  return `
    <div class="stage">
      ${deckLine()}
      <button type="button" class="card">
        <span class="kicker">${serbian ? "сербский" : "русский"}</span>
        <span class="prompt" lang="${serbian ? "sr" : "ru"}" data-size="${promptSize(prompt)}">${esc(prompt)}</span>
        ${reading}
        <span class="tap-hint">нажмите, чтобы открыть</span>
      </button>
    </div>
  `
}

function backMarkup(word, direction) {
  const answerIsRussian = direction === "sr-ru"
  return `
    <div class="stage is-revealed">
      ${deckLine()}
      <div class="card is-back">
        <span class="line serbian ${answerIsRussian ? "is-known" : "is-answer"}" lang="sr" data-size="${promptSize(word.serbian)}">${esc(word.serbian)}</span>
        <span class="reading" lang="ru">${esc(word.transcription)}</span>
        <span class="line russian ${answerIsRussian ? "is-answer" : "is-known"}" lang="ru" data-size="${promptSize(word.russian)}">${esc(word.russian)}</span>
      </div>
      <div class="answers">
        <button type="button" class="answer wrong" data-answer="wrong">
          <span class="glyph" aria-hidden="true">✕</span>
          <span>Неправильно</span>
        </button>
        <button type="button" class="answer correct" data-answer="correct">
          <span class="glyph" aria-hidden="true">✓</span>
          <span>Правильно</span>
        </button>
      </div>
    </div>
  `
}

function announcement(word, revealed, direction) {
  if (revealed) {
    return `${word.serbian}. ${word.transcription}. ${word.russian}.`
  }
  if (direction === "sr-ru") {
    return `Сербский. ${word.serbian}. ${word.transcription}.`
  }
  return `Русский. ${word.russian}.`
}

function deckLine() {
  const size = learningDeck(dictionary, state.store.stats).length
  if (size >= dictionary.length) return ""
  return `<p class="deck">${size} в колоде</p>`
}

function mountWords() {
  view.dataset.screen = "words"
  view.innerHTML = `
    <section class="words">
      <div class="words-head">
        <h1>Слова</h1>
        <p class="lede" id="lede">Сначала те, что запоминаются хуже.</p>
        <div class="search-row">
          <label class="sr-only" for="search">Поиск по словарю</label>
          <input id="search" type="search" enterkeyhint="search" placeholder="Поиск" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(state.query)}">
          <button type="button" class="clear" data-clear hidden>Стереть</button>
        </div>
        <p class="count" id="count"></p>
      </div>
      <ul class="entries" id="entries"></ul>
    </section>
  `
  document.querySelector("#search").addEventListener("input", (event) => {
    state.query = event.target.value
    paintWords()
  })
}

function paintWords() {
  const list = document.querySelector("#entries")
  const count = document.querySelector("#count")
  const clear = document.querySelector("[data-clear]")
  if (!list || !count || !clear) return
  const query = state.query.trim()
  const items = dictionary
    .filter((word) => matchesQuery(word, state.query))
    .sort((a, b) => compareWords(a, b, state.store.stats))
  clear.hidden = query.length === 0
  const lede = document.querySelector("#lede")
  if (lede && !query) {
    const size = learningDeck(dictionary, state.store.stats).length
    lede.textContent = size < dictionary.length
      ? `Сначала те, что запоминаются хуже. В карточках сейчас ${size}.`
      : "Сначала те, что запоминаются хуже."
  }
  count.textContent = query
    ? `${items.length} из ${dictionary.length}`
    : `${dictionary.length} слов`
  if (!items.length) {
    list.innerHTML = `<li class="empty">Ничего не нашлось</li>`
    return
  }
  list.innerHTML = items.map((word) => entryMarkup(word)).join("")
}

function entryMarkup(word) {
  const stat = readStat(state.store.stats[word.id])
  const tone = percentTone(stat)
  const meta =
    stat.shown === 0
      ? "ещё не было"
      : `${stat.shown} показано · ✓ ${stat.correct} · ✕ ${stat.wrong}`
  return `
    <li class="entry">
      <div class="entry-copy">
        <p class="entry-sr" lang="sr">${esc(word.serbian)}</p>
        <p class="entry-ru" lang="ru">${esc(word.russian)}</p>
      </div>
      <p class="entry-pct" data-tone="${tone}">${formatPercent(stat)}</p>
      <p class="entry-meta">${meta}</p>
    </li>
  `
}

function percentTone(stat) {
  if (stat.shown === 0) return "none"
  const ratio = stat.correct / stat.shown
  if (ratio < 0.6) return "bad"
  if (ratio >= 0.85) return "good"
  return "mid"
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  })
}
