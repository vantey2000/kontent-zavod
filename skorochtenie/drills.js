// Логика новых упражнений без DOM: генераторы, правила уровня, разбивка текста. Под тестами tests/drills.test.mjs
import { tokenize, chunk } from './core.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Правило уровня для растяжки, вспышки и «запомни число»: вверх после верного, вниз после двух ошибок подряд
// (ReaderPro ругают за сброс уровня после одной ошибки, Readlax - за возврат к началу)
export function levelRule(level, correct, misses, { min, max }) {
  if (correct) return { level: clamp(level + 1, min, max), misses: 0 };
  const m = misses + 1;
  if (m >= 2) return { level: clamp(level - 1, min, max), misses: 0 };
  return { level: clamp(level, min, max), misses: m };
}

export function shuffle(arr, random = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// n разных элементов, не из exclude
export function pick(arr, random, n = 1, exclude = []) {
  const ex = new Set(exclude);
  const pool = arr.filter(x => !ex.has(x));
  if (pool.length < n) throw new Error(`pick: нужно ${n}, есть ${pool.length}`);
  return shuffle(pool, random).slice(0, n);
}

// Короткие слова из текстов библиотеки: только буквы, 3-6 штук, без повторов, в нижнем регистре
export function shortWords(texts, { min = 3, max = 6 } = {}) {
  const set = new Set();
  for (const text of texts) {
    for (const t of tokenize(text)) {
      const w = t.toLowerCase().replace(/[^\p{L}]/gu, '');
      if (w.length >= min && w.length <= max) set.add(w);
    }
  }
  return [...set];
}

// ---- Растяжка взгляда: пара слов слева и справа от центра, уровень задаёт расстояние ----
export const SIGHT = { min: 1, max: 12, showMs: 400 };
// доля ширины сцены от центра до середины слова: 12% на 1-м уровне, 45% на 12-м
export const sightOffset = level => Math.round((0.12 + (0.45 - 0.12) * (clamp(level, SIGHT.min, SIGHT.max) - 1) / (SIGHT.max - 1)) * 1000) / 1000;

export function sightRound(words, random = Math.random) {
  const [left, right, d1, d2] = pick(words, random, 4);
  const options = shuffle([right, d1, d2], random);
  return { left, right, options, answer: options.indexOf(right) };
}

// ---- Вспышка: группа из 2-3 слов на t мс, уровень задаёт выдержку ----
export const FLASH = { min: 1, max: 10 };
export const flashMs = level => Math.round(600 - (600 - 150) * (clamp(level, FLASH.min, FLASH.max) - 1) / (FLASH.max - 1));

export function flashRound(words, random = Math.random, size = 2) {
  const group = pick(words, random, size);
  const others = pick(words, random, 3, group);
  const target = group.join(' ');
  // ловушки: та же группа с одним заменённым словом, чтобы нельзя было угадать по длине
  const options = new Set([target]);
  let k = 0;
  while (options.size < 4) {
    const g = group.slice();
    g[k % size] = others[k % others.length];
    options.add(g.join(' '));
    k++;
    if (k > 12) break;
  }
  const opts = shuffle([...options], random);
  return { target, options: opts, answer: opts.indexOf(target) };
}

// ---- Поиск буквы: в куске текста найти все слова с буквой ----
export function letterSearch(tokens, random = Math.random, { minWords = 5, maxWords = 14 } = {}) {
  const byLetter = new Map();
  tokens.forEach((t, i) => {
    const seen = new Set();
    for (const ch of t.toLowerCase()) {
      if (!/\p{L}/u.test(ch) || seen.has(ch)) continue;
      seen.add(ch);
      if (!byLetter.has(ch)) byLetter.set(ch, []);
      byLetter.get(ch).push(i);
    }
  });
  const fit = [...byLetter.entries()].filter(([, idx]) => idx.length >= minWords && idx.length <= maxWords);
  const pool = fit.length ? fit : [...byLetter.entries()].sort((a, b) => Math.abs(a[1].length - 8) - Math.abs(b[1].length - 8)).slice(0, 1);
  if (!pool.length) return null;
  const [letter, targets] = pool[Math.floor(random() * pool.length)];
  return { letter, targets };
}

// ---- Запомни число ----
export const MEMORY = { min: 3, max: 12, showMs: 1500 };
export function memoryNumber(digits, random = Math.random) {
  const n = clamp(digits, MEMORY.min, MEMORY.max);
  let s = String(1 + Math.floor(random() * 9));
  while (s.length < n) s += String(Math.floor(random() * 10));
  return s;
}

// ---- Указка по точкам фиксации: строки по ~8 слов, в каждой 2-3 точки ----
export function linesWithStops(tokens, wordsPerLine = 8, stops = 3) {
  const lines = [];
  for (let i = 0; i < tokens.length; i += wordsPerLine) {
    const words = tokens.slice(i, i + wordsPerLine);
    const n = Math.min(stops, words.length);
    const idx = [];
    for (let s = 0; s < n; s++) idx.push(Math.min(words.length - 1, Math.round(((s + 0.5) / n) * words.length - 0.5)));
    lines.push({ words, stops: [...new Set(idx)] });
  }
  return lines;
}

// ---- Колонка: строки по 3-4 слова не длиннее 20 букв (вертикальное чтение) ----
export const columnLines = tokens => chunk(tokens, 4, 20);

// ---- Перевёрнутый текст: секунд на 100 слов ----
export const flippedScore = (words, seconds) => (words > 0 ? Math.round((seconds / words) * 100 * 10) / 10 : 0);

// ---- Кривые буквы (рилс @postolnik.anna, просьба Ивана 27.10.2026): буквы отражены зеркально, регистр скачет, похожие буквы
// заменены цифрами, часть букв гаснет. Доли те же, что в Ролике_14 (монтаж/Ролик_14/2_черновики/tools/render_14.py LEVELS) ----
export const SCRAMBLE = [
  { name: 'Лёгкий', swap: 0.35, mirror: 0, digit: 0, gone: 0 },
  { name: 'Средний', swap: 0.45, mirror: 0.35, digit: 0.04, gone: 0.02 },
  { name: 'Сложный', swap: 0.45, mirror: 0.75, digit: 0.08, gone: 0.05 },
  { name: 'Эксперт', swap: 0.5, mirror: 0.9, digit: 0.15, gone: 0.08 },
];
export const SCRAMBLE_WPM = { min: 40, max: 400, step: 10 };
const LOOKALIKE = { о: '0', О: '0', з: '3', З: '3', б: '6', Б: '6' };
const swapCase = ch => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase());
export const scrambleLevel = v => clamp(Math.round(Number(v)) || 0, 0, SCRAMBLE.length - 1);

// Слово -> буквы { ch, mirror, letter }. Цифра встаёт только вместо похожей буквы и не отражается, знаки препинания как есть
export function scrambleWord(word, level, random = Math.random) {
  const L = SCRAMBLE[scrambleLevel(level)];
  return [...word].map(ch => {
    if (!/\p{L}/u.test(ch)) return { ch, mirror: false, letter: false };
    if (LOOKALIKE[ch] && random() < L.digit) return { ch: LOOKALIKE[ch], mirror: false, letter: true };
    return { ch: random() < L.swap ? swapCase(ch) : ch, mirror: random() < L.mirror, letter: true };
  });
}

// Строки карточки, как стихотворные строки в рилсе: не длиннее maxChars знаков вместе с пробелами
export function scrambleLines(tokens, maxChars = 26) {
  const lines = [];
  let cur = [], len = 0;
  for (const t of tokens) {
    if (cur.length && len + 1 + t.length > maxChars) { lines.push(cur); cur = []; len = 0; }
    len += (cur.length ? 1 : 0) + t.length;
    cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Сколько букв погашено одновременно: доля уровня от всех букв карточки
export const goneCount = (level, letters) => Math.round(SCRAMBLE[scrambleLevel(level)].gone * letters);

// Темп подсветки по умолчанию: кривой текст читается медленнее, берём 40% скорости читалки на сегодня
export const scrambleWpm = (v, speed = 200) => {
  const n = Number(v);
  const w = Number.isFinite(n) && n > 0 ? n : speed * 0.4;
  return clamp(Math.round(w / SCRAMBLE_WPM.step) * SCRAMBLE_WPM.step, SCRAMBLE_WPM.min, SCRAMBLE_WPM.max);
};

// Что считается лучшим результатом: у времени меньше лучше, у уровней больше лучше
export const BETTER = {
  schulte: 'min', 'schulte-letters': 'min', 'schulte-6': 'min',
  sight: 'max', flash: 'min', memory: 'max', search: 'min', flipped: 'min',
};
export function better(kind, prev, cur) {
  if (prev == null) return cur;
  return BETTER[kind] === 'min' ? Math.min(prev, cur) : Math.max(prev, cur);
}
