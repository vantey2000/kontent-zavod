// Интерфейс: экраны и упражнения. Вся арифметика в core.js, хранение в store.js
import * as c from './core.js';
import * as dr from './drills.js';
import { DRILL_UI } from './drills-ui.js';
import { TESTS, LIBRARY } from './content.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const SCREENS = ['start', 'read', 'quiz', 'result', 'pay', 'home', 'ex', 'lib', 'own', 'done'];
const ANCHOR = 0.38;          // опорная буква на 38% ширины, как засечка в ролике
const WORD_PX = 46;

let state = store.load();
const today = () => c.dateKey(new Date());
const persist = () => store.save(state);

// Учёт воронки. Источник = первое касание, запоминается навсегда. Каждое событие уходит с этого
// телефона один раз, поэтому счётчик считает людей, а не загрузки. Страница сигнала не ждёт
const src = c.sourceFromHash(location.hash);
if (src && !state.src) { state.src = src; persist(); }
function track(e) {
  if (!Array.isArray(state.sent)) state.sent = [];
  if (state.sent.includes(e)) return;
  state.sent.push(e);
  persist();
  try { navigator.sendBeacon(c.CONFIG.eventsUrl, `e=${e}&s=${state.src || 'direct'}`); } catch {}
}
const acc = () => c.access(state, Date.now());
const day = () => c.programDay(state.startKey, today());
const speedToday = () => c.readerSpeed(state.baseWpm || c.CONFIG.avgAdultWpm, day().day);
const round10 = n => Math.round(n / 10) * 10;
const fmtDate = ms => new Date(ms).toLocaleDateString('ru-RU');
const fmtSec = n => String(n).replace('.', ',');

// ---------- общие помощники ----------

let stopActive = () => {};
function show(name) {
  stopActive();
  stopActive = () => {};
  for (const s of SCREENS) $('s-' + s).hidden = s !== name;
  window.scrollTo(0, 0);
}

function orpInto(el, tok) {
  el.textContent = '';
  const i = c.orpIndex(tok);
  const len = c.orpLength(tok, i);
  const o = document.createElement('span');
  o.className = 'o';
  o.textContent = tok.slice(i, i + len);
  el.append(tok.slice(0, i), o, tok.slice(i + len));
  return o;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

document.title = `${c.CONFIG.appName} · тест скорости чтения`;
document.querySelectorAll('[data-name]').forEach(n => orpInto(n, c.CONFIG.appName));
document.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', goHome));

// ---------- тест ----------

let run = null;

function startTest() {
  const t = c.testForIndex(TESTS, state.testSeq || 0);
  state.testSeq = (state.testSeq || 0) + 1;
  persist();
  $('read-title').textContent = t.title;
  $('read-count').textContent = `${c.countWords(t.text)} слов`;
  const box = $('read-text');
  box.textContent = '';
  t.text.split(/\n\s*\n/).forEach(p => box.append(el('p', null, p)));
  show('read');
  run = { test: t, words: c.countWords(t.text), started: performance.now(), seconds: 0, correct: 0, idx: 0 };
}

function showQuestion() {
  const q = run.test.questions[run.idx];
  const n = run.test.questions.length;
  $('quiz-count').textContent = `Вопрос ${run.idx + 1} из ${n}`;
  $('quiz-bar').style.width = `${(run.idx / n) * 100}%`;
  $('quiz-q').textContent = q.text;
  const box = $('quiz-opts');
  box.textContent = '';
  q.options.forEach((opt, i) => {
    const b = el('button', 'opt', opt);
    b.addEventListener('click', () => {
      if (i === q.answer) run.correct++;
      run.idx++;
      if (run.idx < n) showQuestion(); else finishTest();
    }, { once: true });
    box.append(b);
  });
}

function finishTest() {
  const r = c.scoreTest({ words: run.words, seconds: run.seconds, correct: run.correct, total: run.test.questions.length });
  const invalid = r.tooFast || r.tooSlow;
  $('result-ok').hidden = invalid;
  $('result-fast').hidden = !invalid;
  if (invalid) {
    $('rf-title').textContent = r.tooFast ? 'Похоже, текст пролистан' : 'Похоже, тест прерывался';
    $('rf-text').textContent = r.tooFast
      ? `Получилось быстрее ${c.CONFIG.maxHonestWpm} слов в минуту. Так читать с пониманием не выходит ни у кого, поэтому результат не сохраняем. Прочитай новый текст в своём обычном темпе`
      : `Получилось меньше ${c.CONFIG.minHonestWpm} слов в минуту: скорее всего, текст лежал открытым, пока ты отвлёкся. Результат не сохраняем. Прочитай новый текст, не отрываясь`;
  } else {
    const key = today();
    const prev = state.tests[state.tests.length - 1];
    const first = !state.startKey;
    state.tests.push({ key, wpm: r.wpm, comprehension: r.comprehension, effective: r.effective, textId: run.test.id });
    if (first) { state.startKey = key; state.baseWpm = r.wpm; }
    else if (r.wpm > state.baseWpm) state.baseWpm = r.wpm;   // повторный тест быстрее: читалка подтягивается, медленнее - не откатываем
    persist();
    track('test');
    $('r-wpm').textContent = r.wpm;
    $('r-level').textContent = `Уровень: ${r.level.label}`;
    $('r-delta').textContent = prev ? `${r.wpm >= prev.wpm ? '+' : ''}${r.wpm - prev.wpm} к прошлому тесту` : '';
    $('r-comp').textContent = `${Math.round(r.comprehension * 100)}%`;
    $('r-eff').textContent = r.effective;
    $('r-avg').textContent = r.wpm > c.CONFIG.avgAdultWpm
      ? `Обычно взрослый читает про себя около ${c.CONFIG.avgAdultWpm} слов в минуту. Ты уже быстрее`
      : `Обычно взрослый читает про себя около ${c.CONFIG.avgAdultWpm} слов в минуту`;
    $('r-start-l').textContent = first ? 'Читалка начнёт с' : 'Читалка сегодня идёт на';
    $('r-start').textContent = first ? c.readerSpeed(state.baseWpm, 1) : speedToday();
    $('r-goal').textContent = c.goalSpeed(state.baseWpm);
    $('b-result-next').textContent = acc().paid ? 'К тренировке' : 'Начать программу';
  }
  show('result');
}

$('b-start').addEventListener('click', startTest);
$('b-retry').addEventListener('click', startTest);
$('b-read-done').addEventListener('click', () => {
  run.seconds = (performance.now() - run.started) / 1000;
  show('quiz');
  showQuestion();
});
$('b-result-next').addEventListener('click', () => (acc().paid ? goHome() : showPay('result')));

// ---------- подписка ----------

let payTier = 'year';
let payBack = 'home';

function showPay(back) {
  payBack = back;
  const { priceYear, priceMonth, refundDays } = c.CONFIG;
  $('pay-year').textContent = c.formatRub(priceYear);
  $('pay-month').textContent = c.formatRub(priceMonth);
  $('pay-year-month').textContent = `≈ ${c.formatRub(Math.round(priceYear / 12))} в месяц`;
  $('pay-refund').textContent = `Если не подойдёт, вернём деньги в течение ${refundDays} дней`;
  track('pay');
  show('pay');
}

document.querySelectorAll('.plan').forEach(p => p.addEventListener('click', () => {
  payTier = p.dataset.tier;
  document.querySelectorAll('.plan').forEach(x => x.setAttribute('aria-checked', String(x === p)));
}));
$('b-pay').addEventListener('click', () => {
  state.plan = c.grantDemo(payTier, Date.now());
  persist();
  track(payTier === 'year' ? 'year' : 'month');
  goHome();
});
$('b-free').addEventListener('click', () => { track('free'); goHome(); });
$('b-pay-back').addEventListener('click', () => (payBack === 'result' && run ? show('result') : goHome()));

// ---------- главная ----------

function goHome() {
  renderHome();
  show('home');
}

function renderHome() {
  const a = acc();
  const key = today();
  const pd = day();
  const st = c.streak(state.done, key);
  const doneToday = state.done.includes(key);
  const freeLeft = c.canFreeRead(state.freeReads, key);

  $('h-mode').textContent = a.paid
    ? (pd.done ? 'Программа пройдена, тренировки продолжаются' : `День ${pd.day} из ${c.CONFIG.programDays}`)
    : `Бесплатный режим · день ${pd.day}`;
  const payBtn = $('b-home-pay');
  payBtn.textContent = a.paid ? `Демо до ${fmtDate(a.until)}` : 'Открыть доступ';
  payBtn.disabled = a.paid;
  $('h-streak').textContent = st;
  $('h-streak-l').textContent = `${c.pluralDays(st).replace(/^\d+ /, '')} подряд`;

  const segs = $('h-segs');
  segs.textContent = '';
  for (let i = 6; i >= 0; i--) {
    const s = el('i');
    if (state.done.includes(c.addDays(key, -i))) s.className = 'on';
    segs.append(s);
  }

  const steps = c.dailySteps(pd.day, a.paid);
  const list = $('h-steps');
  list.textContent = '';
  steps.forEach((s, i) => {
    const row = el('div', 'step' + (doneToday ? ' done' : ''));
    row.append(el('span', 'n', doneToday ? '✓' : String(i + 1)));
    const t = el('div', 't');
    t.append(el('div', null, s.title), el('div', 'muted small', `${s.minutes} мин · ${s.kind === 'reader' ? speedToday() + ' слов/мин' : s.hint}`));
    row.append(t);
    list.append(row);
  });
  if (!a.paid) {
    const row = el('div', 'step');
    row.append(el('span', 'n', '🔒'));
    const t = el('div', 't');
    t.append(el('div', null, 'Разминка и текстовая тренировка'), el('div', 'muted small', 'полная тренировка дня, 10 минут, 13 упражнений по программе'));
    row.append(t);
    list.append(row);
  }

  const train = $('b-train');
  const note = $('h-train-note');
  if (!a.paid && !freeLeft) {
    train.textContent = 'Открыть полную тренировку';
    note.textContent = 'Бесплатная читалка на сегодня уже была, следующая завтра';
  } else if (doneToday) {
    train.textContent = 'Повторить ещё раз';
    note.textContent = 'Тренировка дня сделана';
  } else {
    train.textContent = a.paid ? 'Начать · 10 минут' : 'Начать · 3 минуты';
    note.textContent = a.paid ? '' : 'В бесплатном режиме одна читалка в день';
  }

  const last = state.tests[state.tests.length - 1];
  $('h-speed').textContent = last ? `тест ${last.wpm} → читалка сегодня ${speedToday()}` : '';
  renderChart($('h-chart'));

  const rt = c.retestStatus(state.tests, key);
  const B = state.best;
  const sec = v => (v == null ? null : `${fmtSec(v)} с`);
  const tiles = [
    { k: 'reader', ic: 'Aa', nm: 'Читалка', ds: `слово за словом, ${speedToday()} сл/мин`, free: true },
    { k: 'schulte', ic: '25', nm: 'Таблица Шульте', ds: sec(B.schulte) ? `лучшее время ${sec(B.schulte)}` : 'поле зрения' },
    { k: 'schulte-letters', ic: 'аб', nm: 'Шульте буквами', ds: sec(B['schulte-letters']) ? `лучшее время ${sec(B['schulte-letters'])}` : 'буквы по алфавиту' },
    { k: 'schulte-6', ic: '36', nm: 'Шульте 6x6', ds: sec(B['schulte-6']) ? `лучшее время ${sec(B['schulte-6'])}` : '36 чисел' },
    { k: 'sight', ic: '◁ ▷', nm: 'Растяжка взгляда', ds: B.sight ? `ширина ${Math.round(dr.sightOffset(B.sight) * 200)}%` : 'шире охват' },
    { k: 'flash', ic: '⚡', nm: 'Вспышка', ds: B.flash ? `выдержка ${B.flash} мс` : 'схватить группу' },
    { k: 'memory', ic: '№', nm: 'Запомни число', ds: B.memory ? `${B.memory} цифр` : 'рабочая память' },
    { k: 'search', ic: '◎', nm: 'Поиск буквы', ds: sec(B.search) ? `лучшее время ${sec(B.search)}` : 'сканировать, не читать' },
    { k: 'blocks', ic: '≡', nm: 'Блоки', ds: 'по 2-3 слова' },
    { k: 'pointer', ic: '▸', nm: 'Указка', ds: 'без возвратов назад' },
    { k: 'column', ic: '⫶', nm: 'Колонка', ds: 'сверху вниз' },
    { k: 'hopscotch', ic: '∴', nm: 'Указка по точкам', ds: 'две-три остановки на строку' },
    { k: 'flipped', ic: '∀', nm: 'Перевёрнутый текст', ds: B.flipped ? `${fmtSec(B.flipped)} с на 100 слов` : 'вверх ногами' },
    { k: 'lib', ic: '¶', nm: 'Библиотека', ds: `Чехов и Тургенев, ${LIBRARY.length} текстов` },
    { k: 'own', ic: '✎', nm: 'Свой текст', ds: 'статьи, книги, письма' },
    { k: 'test', ic: '⏱', nm: 'Тест скорости', ds: rt.available ? 'можно пройти сейчас' : `повторный через ${c.pluralDays(rt.inDays)}`, free: true, wide: true },
  ];
  const box = $('h-tiles');
  box.textContent = '';
  for (const t of tiles) {
    const locked = (!t.free && !a.paid) || (t.k === 'reader' && !a.paid && !freeLeft);
    const b = el('button', 'tile' + (locked ? ' locked' : ''));
    b.dataset.tile = t.k;
    if (t.wide) b.style.gridColumn = '1 / -1';
    b.append(el('span', 'ic', t.ic), el('span', 'nm', t.nm), el('span', 'ds', t.ds));
    b.addEventListener('click', () => openTile(t.k, locked, rt));
    box.append(b);
  }
  $('h-storage').hidden = store.isPersistent();
}

// График: линия читалки по дням тренировок и точки тестов, ось X = дни программы
function renderChart(box) {
  box.textContent = '';
  const start = state.startKey;
  const reader = Object.entries(state.readerLog || {})
    .map(([k, v]) => ({ x: c.daysBetween(start, k), y: v })).filter(p => p.x >= 0).sort((a, b) => a.x - b.x);
  const tests = state.tests.map(t => ({ x: c.daysBetween(start, t.key), y: t.wpm })).filter(p => p.x >= 0);
  if (!start || !reader.length) {
    box.append(el('p', 'muted small', 'График появится после первой тренировки'));
    return;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const W = 320, H = 130, L = 34, R = 8, T = 10, B = 22;
  const maxX = Math.max(c.CONFIG.programDays - 1, ...reader.map(p => p.x), ...tests.map(p => p.x));
  const maxY = Math.ceil(Math.max(...reader.map(p => p.y), ...tests.map(p => p.y)) * 1.15 / 50) * 50;
  const sx = x => L + (x / maxX) * (W - L - R);
  const sy = y => T + (1 - y / maxY) * (H - T - B);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Скорость по дням программы');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (const v of [0, maxY / 2, maxY]) {
    add('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), stroke: '#26262a', 'stroke-width': 1 });
    add('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#9a9696' }, Math.round(v));
  }
  add('text', { x: L, y: H - 6, 'font-size': 10, fill: '#9a9696' }, 'день 1');
  add('text', { x: W - R, y: H - 6, 'text-anchor': 'end', 'font-size': 10, fill: '#9a9696' }, `день ${maxX + 1}`);
  if (reader.length > 1) add('polyline', { points: reader.map(p => `${sx(p.x)},${sy(p.y)}`).join(' '), fill: 'none', stroke: '#ed4345', 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
  reader.forEach(p => add('circle', { cx: sx(p.x), cy: sy(p.y), r: 3, fill: '#ed4345' }));
  tests.forEach(p => add('circle', { cx: sx(p.x), cy: sy(p.y), r: 4.5, fill: '#f4f2f2', stroke: '#050505', 'stroke-width': 1.5 }));
  box.append(svg);
  const legend = el('p', 'muted small');
  legend.append(el('span', null, '● '), 'читалка, слов/мин   ');
  legend.firstChild.style.color = '#ed4345';
  legend.append('○ тесты');
  box.append(legend);
}

$('b-home-pay').addEventListener('click', () => showPay('home'));
$('b-train').addEventListener('click', startTraining);

function openTile(k, locked, rt) {
  if (locked) { track('lock'); return showPay('home'); }
  if (k === 'test') return rt.available ? startTest() : null;
  if (k === 'lib') return showLib();
  if (k === 'own') return show('own');
  if (k === 'reader' && !acc().paid) return openExercise(k, { minutes: 3, onDone: () => { useFreeRead(); goHome(); } });
  openExercise(k, { minutes: 3, tables: 1, onDone: goHome });
}

function useFreeRead() {
  const key = today();
  state.freeReads[key] = (state.freeReads[key] || 0) + 1;
  persist();
}

// ---------- тренировка дня ----------

let session = null;

function startTraining() {
  const a = acc();
  if (!a.paid && !c.canFreeRead(state.freeReads, today())) return showPay('home');
  session = { steps: c.dailySteps(day().day, a.paid), i: 0 };
  runStep();
}

function runStep() {
  const s = session.steps[session.i];
  openExercise(s.kind, {
    minutes: s.minutes,
    tables: s.kind === 'schulte-6' ? 1 : 2,
    stepLabel: `Шаг ${session.i + 1} из ${session.steps.length}`,
    onDone: () => {
      session.i++;
      if (session.i < session.steps.length) runStep(); else finishDay();
    },
  });
}

function finishDay() {
  const key = today();
  if (!state.done.includes(key)) state.done.push(key);
  state.readerLog[key] = speedToday();
  if (!acc().paid) useFreeRead();   // бесплатный режим: читалка дня потрачена только когда пройдена до конца
  persist();
  session = null;
  const st = c.streak(state.done, key);
  $('done-streak').textContent = `${c.pluralDays(st)} подряд. Возвращайся завтра, чтобы не прервать серию`;
  show('done');
}

// ---------- упражнения ----------

const HINTS = {
  reader: 'Смотри на красную букву. Не пытайся поймать каждое слово, лови смысл',
  blocks: 'Схватывай группу слов целиком, одним взглядом',
  pointer: 'Глаза идут за подсветкой. Назад не возвращаемся',
  column: 'Взгляд идёт только вниз по колонке, строка целиком за одну остановку',
  hopscotch: 'В каждой строке две-три остановки. Глаз прыгает по подсветке, не скользит',
  schulte: 'Найди числа от 1 до 25 по порядку. Смотри в центр и старайся видеть таблицу целиком',
  'schulte-letters': 'Найди буквы по алфавиту: а, б, в… Смотри в центр, ищи периферией',
  'schulte-6': 'Числа от 1 до 36 по порядку. Взгляд в центр, таблица целиком',
  sight: 'Смотри только в красную точку. Слова вспыхнут по бокам, потом вопрос: что было справа?',
  flash: 'Группа слов мелькнёт один раз. Не читай по буквам, схвати целиком',
  memory: 'Число покажется на полторы секунды. Запомни и набери',
  search: 'Не читай текст, сканируй глазами. Нажимай каждое слово с нужной буквой',
  flipped: 'Прочитай абзац вверх ногами в своём темпе, потом нажми «Прочитал»',
};
const TITLES = Object.fromEntries(Object.entries(c.STEP_INFO).map(([k, v]) => [k, v.title]));
const SCHULTE = { schulte: { size: 5 }, 'schulte-letters': { size: 5, symbols: c.SCHULTE_LETTERS }, 'schulte-6': { size: 6 } };
let WORDS = null;   // короткие слова для растяжки и вспышки, считаются один раз
const words = () => WORDS || (WORDS = dr.shortWords(LIBRARY.map(b => b.text)));

function takePassage(n) {
  const p = c.passage(LIBRARY, state.bookmark, Math.max(20, n));
  state.bookmark = p.next;
  persist();
  return p;
}

function openExercise(kind, opts) {
  $('ex-title').textContent = opts.title || TITLES[kind];
  $('ex-hint').textContent = HINTS[kind];
  $('ex-step').textContent = opts.stepLabel || '';
  const body = $('ex-body');
  body.textContent = '';
  show('ex');
  const speed = speedToday();
  if (SCHULTE[kind]) return schulte(body, { ...opts, kind, ...SCHULTE[kind] });
  if (DRILL_UI[kind]) return DRILL_UI[kind](body, drillCtx(kind, opts));
  if (kind === 'reader') {
    const p = opts.tokens ? { tokens: opts.tokens } : takePassage(speed * opts.minutes);
    if (!opts.title && p.title) $('ex-title').textContent = `Читалка · ${p.author}, «${p.title}»`;
    return timed(body, { mode: 'reader', tokens: p.tokens, wpm: speed, onDone: opts.onDone });
  }
  const factor = { blocks: 0.8, pointer: 0.7, column: 0.8, hopscotch: 0.7 }[kind] || 0.7;
  const s = round10(speed * factor);
  const p = takePassage(s * opts.minutes);
  return timed(body, { mode: kind, tokens: p.tokens, wpm: s, onDone: opts.onDone });
}

// Контекст для экранов drills-ui: слова, кусок текста, запись лучшего результата, очистка таймеров
function drillCtx(kind, opts) {
  let atDone = null;
  const p = kind === 'search' ? takePassage(70) : kind === 'flipped' ? takePassage(120) : null;
  return {
    words: words(),
    tokens: p ? p.tokens : [],
    random: Math.random,
    fmtSec,
    onDone: () => { if (atDone) atDone(); opts.onDone && opts.onDone(); },
    record: (k, v) => { state.best[k] = dr.better(k, state.best[k], v); persist(); },
    recordAtDone: fn => { atDone = fn; },
    setStop: fn => { stopActive = fn; },
  };
}

$('b-ex-back').addEventListener('click', () => { session = null; goHome(); });

// Читалка, блоки и указка: один движок с паузой, скоростью и прогрессом
function timed(body, { mode, tokens, wpm, onDone }) {
  // единицы показа: слово, блок, строка колонки или остановка указки по точкам
  let hops = null;
  if (mode === 'hopscotch') {
    hops = [];
    dr.linesWithStops(tokens, 8, 3).forEach((line, li) => {
      const bounds = line.stops.map((st, k) => (k + 1 < line.stops.length ? Math.ceil((st + line.stops[k + 1]) / 2) : line.words.length));
      let from = 0;
      line.stops.forEach((st, k) => { hops.push({ li, stop: st, words: line.words.slice(from, bounds[k]) }); from = bounds[k]; });
    });
  }
  const lines = mode === 'column' ? dr.columnLines(tokens) : null;
  const units = mode === 'blocks' ? c.chunk(tokens) : mode === 'column' ? lines : mode === 'hopscotch' ? hops.map(h => h.words) : tokens.map(t => [t]);
  let i = 0, speed = wpm, paused = false, timer = null, finished = false;

  let stage, word, chunkEl, pointerSpans, pointerBox, lineEls, hopSpans;
  const keepVisible = elm => { if (elm.offsetTop - pointerBox.scrollTop > pointerBox.clientHeight * 0.6) pointerBox.scrollTop = elm.offsetTop - pointerBox.clientHeight * 0.3; };
  if (mode === 'pointer') {
    pointerBox = el('div', 'pointer-text');
    pointerSpans = tokens.map(t => { const s = el('span', null, t); return s; });
    pointerSpans.forEach((s, k) => { pointerBox.append(s); if (k < pointerSpans.length - 1) pointerBox.append(' '); });
    body.append(pointerBox);
  } else if (mode === 'column') {
    pointerBox = el('div', 'pointer-text lines column');
    lineEls = lines.map(l => el('div', 'line', l.join(' ')));
    lineEls.forEach(l => pointerBox.append(l));
    body.append(pointerBox);
  } else if (mode === 'hopscotch') {
    pointerBox = el('div', 'pointer-text lines hop');
    hopSpans = [];
    dr.linesWithStops(tokens, 8, 3).forEach(line => {
      const row = el('div', 'line');
      const spans = line.words.map(w => el('span', null, w));
      spans.forEach((sp, k) => { row.append(sp); if (k < spans.length - 1) row.append(' '); });
      hopSpans.push(spans);
      pointerBox.append(row);
    });
    body.append(pointerBox);
  } else {
    stage = el('div', 'stage');
    stage.style.setProperty('--anchor', `${ANCHOR * 100}%`);
    if (mode === 'reader') { word = el('span', 'word'); stage.append(word); } else { chunkEl = el('div', 'chunk'); stage.append(chunkEl); }
    body.append(stage);
  }

  const bar = el('div', 'progress'); const barI = el('i'); bar.append(barI);
  const label = el('span', 'muted small');
  const range = el('input'); range.type = 'range'; range.min = 100; range.max = 1000; range.step = 10; range.value = speed;
  range.setAttribute('aria-label', 'Скорость, слов в минуту');
  const rangeBox = el('div', 'range'); rangeBox.append(label, range);
  const back10 = el('button', 'btn ghost', '−10 слов');
  const pauseB = el('button', 'btn', 'Пауза');
  const row = el('div', 'row'); if (mode === 'reader' || mode === 'blocks') row.append(back10); row.append(pauseB);
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  const controls = el('div', 'controls'); controls.append(bar, rangeBox, row, doneB);
  controls.style.marginTop = '14px';
  body.append(controls);

  const setLabel = () => { label.textContent = `Скорость ${speed} слов/мин`; };
  setLabel();
  range.addEventListener('input', () => { speed = Number(range.value); setLabel(); });

  function place(tok) {
    word.style.fontSize = `${WORD_PX}px`;
    const o = orpInto(word, tok);
    const W = stage.clientWidth, ax = W * ANCHOR;
    let center = o.offsetLeft + o.offsetWidth / 2;
    const width = word.offsetWidth;
    const k = Math.min(1, (ax - 12) / Math.max(1, center), (W - ax - 12) / Math.max(1, width - center));
    if (k < 1) { word.style.fontSize = `${Math.floor(WORD_PX * k)}px`; center = o.offsetLeft + o.offsetWidth / 2; }
    word.style.left = `${ax - center}px`;
  }

  function fitChunk(text) {
    chunkEl.style.fontSize = '';
    chunkEl.textContent = text;
    const max = stage.clientWidth - 32;
    const r = document.createRange();
    r.selectNodeContents(chunkEl);
    const w = r.getBoundingClientRect().width;
    if (w > max) chunkEl.style.fontSize = `${Math.floor(parseFloat(getComputedStyle(chunkEl).fontSize) * max / w)}px`;
  }

  function showUnit(u) {
    if (mode === 'reader') place(u[0]);
    else if (mode === 'blocks') fitChunk(u.join(' '));
    else if (mode === 'column') {
      if (i > 0) { lineEls[i - 1].classList.remove('on'); lineEls[i - 1].classList.add('read'); }
      lineEls[i].classList.add('on');
      keepVisible(lineEls[i]);
    } else if (mode === 'hopscotch') {
      if (i > 0) { const h = hops[i - 1]; const sp = hopSpans[h.li][h.stop]; sp.classList.remove('on'); sp.classList.add('read'); }
      const h = hops[i];
      hopSpans[h.li][h.stop].classList.add('on');
      keepVisible(hopSpans[h.li][h.stop]);
    } else {
      if (i > 0) { pointerSpans[i - 1].classList.remove('on'); pointerSpans[i - 1].classList.add('read'); }
      const s = pointerSpans[i];
      s.classList.add('on');
      keepVisible(s);
    }
  }

  function tick() {
    timer = null;
    if (paused || finished) return;
    if (i >= units.length) return finish();
    const u = units[i];
    showUnit(u);
    i++;
    barI.style.width = `${(i / units.length) * 100}%`;
    const ms = u.reduce((s, t) => s + c.wordDelayMs(t, speed), 0);
    timer = setTimeout(tick, ms);
  }

  function finish() {
    finished = true;
    if (word) word.textContent = '';
    if (chunkEl) chunkEl.textContent = 'Готово';
    pauseB.hidden = true; back10.hidden = true;
    doneB.hidden = false;
    doneB.focus();
  }

  function setPaused(p) {
    paused = p;
    pauseB.textContent = p ? 'Продолжить' : 'Пауза';
    if (!p && !timer && !finished) tick();
    if (p && timer) { clearTimeout(timer); timer = null; }
  }

  pauseB.addEventListener('click', () => setPaused(!paused));
  back10.addEventListener('click', () => {
    i = Math.max(0, i - 11);
    if (paused) { showUnit(units[i]); i++; }
  });
  doneB.addEventListener('click', () => onDone && onDone());
  const onVis = () => { if (document.hidden) setPaused(true); };
  document.addEventListener('visibilitychange', onVis);

  stopActive = () => { finished = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  timer = setTimeout(tick, 600);   // полсекунды, чтобы глаз нашёл засечку
}

function schulte(body, opts) {
  const total = opts.tables || 1;
  const size = opts.size || 5, symbols = opts.symbols || null, kind = opts.kind || 'schulte';
  const n = size * size;
  const order = symbols ? symbols.slice(0, n) : Array.from({ length: n }, (_, i) => i + 1);
  let table = 0, next = 0, t0 = 0, timer = null;
  const info = el('div', 'sch-info');
  const nextL = el('span', 'muted', ''); const timeL = el('span', 'muted', '0,0 с');
  timeL.style.textAlign = 'right';
  info.append(nextL, timeL);
  const grid = el('div', size === 6 ? 'grid6' : 'grid5');
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  const res = el('p', 'muted center');
  body.append(info, grid, res, doneB);
  [info, res, doneB].forEach(x => { x.style.margin = '12px 0'; });
  const label = () => { nextL.textContent = `Таблица ${table + 1} из ${total} · найди ${order[next]}`; };

  function newTable() {
    next = 0;
    grid.textContent = '';
    label();
    for (const v of c.schulteGrid(size, Math.random, symbols)) {
      const b = el('button', 'cell', String(v));
      b.addEventListener('click', () => tap(b, v));
      grid.append(b);
    }
    t0 = performance.now();
    timer = setInterval(() => { timeL.textContent = `${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} с`; }, 100);
  }

  function tap(b, v) {
    if (!c.schulteTap(order[next], v)) {
      b.classList.add('bad');
      setTimeout(() => b.classList.remove('bad'), 250);
      return;
    }
    b.classList.add('ok');
    b.disabled = true;
    next++;
    if (next < n) return label();
    clearInterval(timer);
    const sec = Math.round((performance.now() - t0) / 100) / 10;
    state.best[kind] = dr.better(kind, state.best[kind], sec);
    persist();
    table++;
    res.textContent = `Таблица за ${fmtSec(sec)} с · лучшее ${fmtSec(state.best[kind])} с`;
    if (table < total) newTable(); else { grid.textContent = ''; nextL.textContent = 'Готово'; doneB.hidden = false; }
  }

  doneB.addEventListener('click', () => opts.onDone && opts.onDone());
  stopActive = () => clearInterval(timer);
  newTable();
}

// ---------- библиотека и свой текст ----------

function showLib() {
  const list = $('lib-list');
  list.textContent = '';
  const sp = speedToday();
  for (const item of LIBRARY) {
    const b = el('button', 'libitem');
    const left = el('span');
    left.append(el('b', null, item.title), el('br'), el('span', 'muted small', item.author));
    b.append(left, el('span', 'muted small', `${Math.max(1, Math.round(c.countWords(item.text) / sp))} мин`));
    b.addEventListener('click', () => openExercise('reader', {
      tokens: c.tokenize(item.text), title: `${item.author}, «${item.title}»`, onDone: showLib,
    }));
    list.append(b);
  }
  show('lib');
}

$('b-own').addEventListener('click', () => {
  const tokens = c.tokenize($('own-text').value);
  if (tokens.length < 5) { $('own-text').focus(); return; }
  openExercise('reader', { tokens, title: 'Свой текст', onDone: goHome });
});

// ---------- старт ----------

if (state.tests.length) goHome(); else show('start');
// «Открыл» уходит после полной загрузки, уже с нарисованным первым экраном: учёт в фоне, не на пути человека
if (document.readyState === 'complete') track('open'); else addEventListener('load', () => track('open'), { once: true });
