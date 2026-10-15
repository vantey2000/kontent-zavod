// Логика приложения без DOM: всё, что считается, живёт здесь и покрыто tests/core.test.mjs

export const CONFIG = {
  appName: 'Темп',                     // рабочее имя, финальное выбирает Иван (развилка 2 плана)
  tagline: 'тренажёр для мозга',
  programName: 'Скорочтение за 30 дней',
  priceYear: 2990,
  priceMonth: 490,
  refundDays: 14,
  programDays: 30,
  retestEveryDays: 7,
  freeReadsPerDay: 1,
  avgAdultWpm: 200,                    // «обычно взрослый читает про себя около 200», как в ролике
  maxHonestWpm: 1500,                  // быстрее = текст пролистан, результат не сохраняем
  minHonestWpm: 40,                    // медленнее = тест прерывался (вкладка лежала открытой), тоже не сохраняем
  eventsUrl: 'https://skorochtenie-events.aivan-loginov.workers.dev/e',   // счётчик воронки, сигнал уходит в фоне
};

// Метка площадки из адреса после «#»: ivan-loginov.ru/skorochtenie/#ig → 'ig'. Контракт пути клиента:
// учёт меткой после решётки, без переадресаций и прокладок. Нет метки или мусор = null
export function sourceFromHash(hash) {
  const m = /^#?([a-z0-9-]{1,16})$/i.exec(String(hash ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

const LETTER = /[\p{L}\p{N}]/u;
const hasLetter = t => LETTER.test(t);

// Опорная буква: 1 / 2-5 / 6-9 / 10-13 / 14+ букв -> 1-я / 2-я / 3-я / 4-я / 5-я (как в генераторе роликов)
export function orpIndex(token) {
  const idx = [];
  let u = 0;
  for (const ch of String(token)) { if (LETTER.test(ch)) idx.push(u); u += ch.length; }   // по кодовым точкам: эмодзи и «жирные» буквы занимают две UTF-16 единицы
  const n = idx.length;
  if (!n) return 0;
  const k = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  return idx[k];
}

// Сколько UTF-16 единиц занимает символ на позиции i (1 для обычных букв, 2 для символов вне базовой плоскости)
export function orpLength(token, i) {
  const cp = String(token).codePointAt(i);
  return cp === undefined ? 0 : String.fromCodePoint(cp).length;
}

// Слова по пробелам; одиночные знаки (тире, многоточие) прилипают к следующему слову, в конце текста к предыдущему
export function tokenize(text) {
  const raw = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let pending = '';
  for (const t of raw) {
    if (!hasLetter(t)) { pending = pending ? pending + ' ' + t : t; continue; }
    out.push(pending ? pending + ' ' + t : t);
    pending = '';
  }
  if (pending) {
    if (out.length) out[out.length - 1] += ' ' + pending;
  }
  return out;
}

export const countWords = text => tokenize(text).length;

function tail(token) {
  return token.replace(/[»"'”“’)\]]+$/u, '').slice(-1);   // „лапки“ закрываются “, одинарные ’
}

// Паузы: x2 на конце предложения, x1,5 на запятой, +0,3 на словах от 10 букв
export function wordWeight(token) {
  const end = tail(token);
  const w = '.!?…'.includes(end) ? 2 : ',;:'.includes(end) ? 1.5 : 1;
  const letters = [...token].filter(ch => LETTER.test(ch)).length;
  return letters >= 10 ? Math.round((w + 0.3) * 10) / 10 : w;
}

export const wordDelayMs = (token, wpm) => (60000 / wpm) * wordWeight(token);

const lettersOf = t => [...t].filter(ch => LETTER.test(ch)).length;
const endsSentence = t => '.!?…'.includes(tail(t));

// Блоки по 2-3 слова: не длиннее 18 букв и не через конец предложения
export function chunk(tokens, maxWords = 3, maxLetters = 18) {
  const out = [];
  let cur = [], len = 0;
  for (const t of tokens) {
    const l = lettersOf(t);
    if (cur.length && (cur.length >= maxWords || len + l > maxLetters)) { out.push(cur); cur = []; len = 0; }
    cur.push(t); len += l;
    if (endsSentence(t)) { out.push(cur); cur = []; len = 0; }
  }
  if (cur.length) out.push(cur);
  return out;
}

export function levelFor(effective) {
  if (effective < 120) return { key: 'start', label: 'Начальный' };
  if (effective < 200) return { key: 'medium', label: 'Средний' };
  if (effective < 300) return { key: 'confident', label: 'Уверенный' };
  if (effective < 450) return { key: 'fast', label: 'Быстрый' };
  return { key: 'pro', label: 'Продвинутый' };
}

// Тест: скорость = слова / минуты, понимание = доля верных, эффективная = скорость x понимание
export function scoreTest({ words, seconds, correct, total }) {
  const wpm = seconds > 0 ? Math.round(words / (seconds / 60)) : 0;
  const comprehension = total ? correct / total : 0;
  const effective = Math.round(wpm * comprehension);
  const tooFast = !(seconds > 0) || wpm > CONFIG.maxHonestWpm;
  const tooSlow = seconds > 0 && wpm < CONFIG.minHonestWpm;
  return { wpm, comprehension, effective, tooFast, tooSlow, level: levelFor(effective) };
}

// Скорость читалки: от скорости теста (150-600), +2,5% в день, потолок 1000. Целые числа, без ошибок плавающей точки
export function readerSpeed(baseWpm, day) {
  const b = Math.min(600, Math.max(150, Math.round(baseWpm)));
  const v = (b * (1000 + 25 * (Math.max(1, day) - 1))) / 1000;
  return Math.min(1000, Math.round(v / 10) * 10);
}

export const goalSpeed = baseWpm => readerSpeed(baseWpm, CONFIG.programDays);

// Даты: ключ дня по локальному времени, разница считается по календарю, а не по миллисекундам
const pad = n => String(n).padStart(2, '0');
export const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export const daysBetween = (a, b) => Math.round((keyToUtc(b) - keyToUtc(a)) / 864e5);

export function addDays(key, n) {
  const t = new Date(keyToUtc(key) + n * 864e5);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function programDay(startKey, todayKey, total = CONFIG.programDays) {
  if (!startKey) return { day: 1, done: false };
  const n = daysBetween(startKey, todayKey) + 1;
  return { day: Math.min(total, Math.max(1, n)), done: n > total };
}

// Серия: дни подряд, заканчивая сегодня или вчера (сегодня ещё можно успеть)
export function streak(doneKeys, todayKey) {
  const set = new Set(doneKeys || []);
  let k = set.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let n = 0;
  while (set.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

export function grantDemo(tier, now) {
  const days = tier === 'year' ? 365 : 30;
  return { tier, demo: true, at: now, until: now + days * 864e5 };
}

export function access(state, now) {
  const p = state && state.plan;
  if (p && p.until > now) return { paid: true, demo: !!p.demo, until: p.until, tier: p.tier };
  return { paid: false, demo: false, until: null, tier: null };
}

export const canFreeRead = (freeReads, key) => ((freeReads || {})[key] || 0) < CONFIG.freeReadsPerDay;

const STEP = {
  schulte: { title: 'Таблица Шульте', hint: 'поле зрения' },
  'schulte-letters': { title: 'Шульте буквами', hint: 'буквы по алфавиту' },
  'schulte-6': { title: 'Шульте 6x6', hint: '36 чисел' },
  sight: { title: 'Растяжка взгляда', hint: 'шире охват' },
  flash: { title: 'Вспышка', hint: 'схватить группу' },
  memory: { title: 'Запомни число', hint: 'рабочая память' },
  search: { title: 'Поиск буквы', hint: 'сканировать, не читать' },
  reader: { title: 'Читалка', hint: 'слово за словом' },
  blocks: { title: 'Блоки', hint: 'по 2-3 слова' },
  pointer: { title: 'Указка', hint: 'без возвратов назад' },
  column: { title: 'Колонка', hint: 'сверху вниз' },
  hopscotch: { title: 'Указка по точкам', hint: 'две-три остановки на строку' },
  flipped: { title: 'Перевёрнутый текст', hint: 'вверх ногами' },
};
export const STEP_INFO = STEP;

// Программа: разминка по 7-дневному циклу, читалка каждый день, текстовая тренировка по 5-дневному циклу
export const WARMUPS = ['schulte', 'sight', 'flash', 'memory', 'schulte-letters', 'search', 'schulte-6'];
export const DRILLS = ['blocks', 'pointer', 'column', 'hopscotch', 'flipped'];

export function dailySteps(day, paid) {
  const mk = (kind, minutes) => ({ kind, minutes, ...STEP[kind] });
  if (!paid) return [mk('reader', 3)];
  const d = Math.max(1, Math.floor(day)) - 1;
  return [mk(WARMUPS[d % WARMUPS.length], 2), mk('reader', 5), mk(DRILLS[d % DRILLS.length], 3)];
}

export function retestStatus(tests, todayKey) {
  if (!tests || !tests.length) return { available: true, inDays: 0 };
  const d = daysBetween(tests[tests.length - 1].key, todayKey);
  if (d >= CONFIG.retestEveryDays) return { available: true, inDays: 0 };
  return { available: false, inDays: Math.min(CONFIG.retestEveryDays, Math.max(1, CONFIG.retestEveryDays - d)) };
}

export const testForIndex = (tests, i) => tests[((i % tests.length) + tests.length) % tests.length];

// Генератор случайных чисел с зерном (mulberry32): для тестов и повторяемых таблиц
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 25 букв для Шульте буквами: алфавит без ё, й, ц, щ, ъ, ы, ь, э (похожие и редкие), порядок алфавитный
export const SCHULTE_LETTERS = [...'абвгдежзиклмнопрстуфхчшюя'];

export function schulteGrid(size = 5, random = Math.random, symbols = null) {
  const n = size * size;
  const base = symbols ? symbols.slice(0, n) : Array.from({ length: n }, (_, i) => i + 1);
  const g = base.slice();
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [g[i], g[j]] = [g[j], g[i]];
  }
  if (g.every((v, i) => v === base[i])) [g[0], g[1]] = [g[1], g[0]];   // по порядку не отдаём никогда
  return g;
}

export const schulteTap = (expected, tapped) => expected === tapped;

// Кусок библиотеки на N слов; закладка идёт дальше и по кругу
const tokCache = new WeakMap();
function tokensOf(item) {
  if (!tokCache.has(item)) tokCache.set(item, tokenize(item.text));
  return tokCache.get(item);
}

export function passage(lib, bookmark, n) {
  let { t = 0, w = 0 } = bookmark || {};
  if (!(Number.isInteger(t) && t >= 0 && t < lib.length)) { t = 0; w = 0; }
  if (!(Number.isInteger(w) && w >= 0)) w = 0;
  const tokens = [];
  let title = null, author = null, next = { t, w };
  // добираем слова из следующих текстов по кругу, не больше одного круга по библиотеке
  for (let seg = 0; seg < lib.length && tokens.length < n; seg++) {
    const toks = tokensOf(lib[t]);
    if (w >= toks.length) { t = (t + 1) % lib.length; w = 0; next = { t, w }; continue; }
    if (title === null) { title = lib[t].title; author = lib[t].author; }
    const part = toks.slice(w, w + (n - tokens.length));
    tokens.push(...part);
    const end = w + part.length;
    next = end >= toks.length ? { t: (t + 1) % lib.length, w: 0 } : { t, w: end };
    t = next.t; w = next.w;
  }
  if (title === null) { title = lib[0].title; author = lib[0].author; }
  return { tokens, next, title, author };
}

export const formatRub = n => n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';

export function pluralDays(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return `${n} дней`;
  if (b === 1) return `${n} день`;
  if (b >= 2 && b <= 4) return `${n} дня`;
  return `${n} дней`;
}
