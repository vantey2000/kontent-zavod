// Экраны новых упражнений: растяжка, вспышка, поиск буквы, запомни число, перевёрнутый текст.
// Вся арифметика в drills.js. Каждый экран получает body и ctx: { onDone, record(kind, value), words, tokens, random, setStop, fmtSec }
import * as d from './drills.js';
import { wordDelayMs } from './core.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const ROUNDS = { sight: 12, flash: 12, memory: 10 };

// Полоса раундов, подпись уровня и кнопка «Дальше», общие для раундовых упражнений
function frame(body, ctx, kind, total) {
  const bar = el('div', 'progress'); const barI = el('i'); bar.append(barI);
  const info = el('div', 'sch-info');
  const roundL = el('span', 'muted', ''); const levelL = el('span', 'muted', '');
  levelL.style.textAlign = 'right';
  info.append(roundL, levelL);
  const stage = el('div', 'drill-stage');
  const opts = el('div', 'drill-opts');
  const res = el('p', 'muted center drill-res');
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  doneB.addEventListener('click', () => ctx.onDone && ctx.onDone());
  body.append(info, stage, opts, res, bar, doneB);
  let round = 0;
  return {
    stage, opts, res, doneB, levelL,
    next() { round++; roundL.textContent = `Раунд ${Math.min(round, total)} из ${total}`; barI.style.width = `${((round - 1) / total) * 100}%`; return round <= total; },
    finish(text) { barI.style.width = '100%'; stage.textContent = ''; opts.textContent = ''; res.textContent = text; doneB.hidden = false; doneB.focus(); },
  };
}

function choice(opts, items, onPick) {
  opts.textContent = '';
  items.forEach((text, i) => {
    const b = el('button', 'opt drill-opt', text);
    b.addEventListener('click', () => onPick(i, b), { once: true });
    opts.append(b);
  });
}

function mark(b, ok) { b.classList.add(ok ? 'right' : 'wrong'); }

// ---- Растяжка взгляда ----
export function sight(body, ctx) {
  const f = frame(body, ctx, 'sight', ROUNDS.sight);
  let level = 1, misses = 0, best = 1, timer = null;
  const dot = el('span', 'dot'); f.stage.append(dot);
  const L = el('span', 'side'); const R = el('span', 'side'); f.stage.append(L, R);
  const setLevel = () => { f.levelL.textContent = `ширина ${Math.round(d.sightOffset(level) * 2 * 100)}%`; };

  function round() {
    if (!f.next()) return f.finish(`Лучшая ширина за раунд ${Math.round(d.sightOffset(best) * 2 * 100)}% экрана`);
    setLevel();
    const r = d.sightRound(ctx.words, ctx.random);
    const off = d.sightOffset(level);
    L.textContent = r.left; R.textContent = r.right;
    L.style.left = `calc(50% - ${off * 100}%)`; R.style.left = `calc(50% + ${off * 100}%)`;
    L.classList.add('on'); R.classList.add('on');
    f.opts.textContent = '';
    timer = setTimeout(() => {
      L.classList.remove('on'); R.classList.remove('on');
      choice(f.opts, r.options, (i, b) => {
        const ok = i === r.answer;
        mark(b, ok);
        if (!ok) f.opts.children[r.answer].classList.add('right');
        if (ok) best = Math.max(best, level);   // ширину этого уровня человек взял
        ({ level, misses } = d.levelRule(level, ok, misses, d.SIGHT));
        timer = setTimeout(round, 500);
      });
    }, d.SIGHT.showMs);
  }
  f.res.textContent = 'Смотри в точку. Что было справа?';
  ctx.setStop(() => clearTimeout(timer));
  ctx.recordAtDone(() => ctx.record('sight', best));
  timer = setTimeout(round, 600);
}

// ---- Вспышка ----
export function flash(body, ctx) {
  const f = frame(body, ctx, 'flash', ROUNDS.flash);
  let level = 1, misses = 0, bestMs = d.flashMs(1), timer = null;
  const word = el('div', 'chunk'); f.stage.append(word);
  const setLevel = () => { f.levelL.textContent = `${d.flashMs(level)} мс`; };

  function round(n) {
    if (!f.next()) return f.finish(`Лучшая выдержка ${bestMs} мс`);
    setLevel();
    const r = d.flashRound(ctx.words, ctx.random, n % 3 === 2 ? 3 : 2);
    word.textContent = r.target;
    word.classList.add('on');
    f.opts.textContent = '';
    timer = setTimeout(() => {
      word.classList.remove('on');
      word.textContent = '';
      choice(f.opts, r.options, (i, b) => {
        const ok = i === r.answer;
        mark(b, ok);
        if (!ok) f.opts.children[r.answer].classList.add('right');
        if (ok) bestMs = Math.min(bestMs, d.flashMs(level));
        ({ level, misses } = d.levelRule(level, ok, misses, d.FLASH));
        timer = setTimeout(() => round(n + 1), 500);
      });
    }, d.flashMs(level));
  }
  f.res.textContent = 'Группа мелькнёт один раз. Что было?';
  ctx.setStop(() => clearTimeout(timer));
  ctx.recordAtDone(() => ctx.record('flash', bestMs));
  timer = setTimeout(() => round(0), 600);
}

// ---- Поиск буквы ----
export function search(body, ctx) {
  const tokens = ctx.tokens.slice(0, 70);
  const r = d.letterSearch(tokens, ctx.random);
  const info = el('div', 'sch-info');
  const target = el('span', null, ''); target.append('Найди слова с буквой ', el('b', 'letter', r.letter));
  const timeL = el('span', 'muted', '0,0 с'); timeL.style.textAlign = 'right';
  info.append(target, timeL);
  const box = el('div', 'pointer-text search-text');
  const spans = tokens.map(t => { const s = el('span', null, t); s.tabIndex = 0; s.setAttribute('role', 'button'); return s; });
  spans.forEach((s, k) => { box.append(s); if (k < spans.length - 1) box.append(' '); });
  const res = el('p', 'muted center');
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  body.append(info, box, res, doneB);
  const left = new Set(r.targets);
  let misses = 0, t0 = performance.now(), timer = setInterval(() => { timeL.textContent = `${ctx.fmtSec(((performance.now() - t0) / 1000).toFixed(1))} с`; }, 100);
  res.textContent = `Осталось найти: ${left.size}`;
  function tap(i, s) {
    if (s.classList.contains('hit')) return;
    if (left.has(i)) {
      left.delete(i); s.classList.add('hit');
      res.textContent = `Осталось найти: ${left.size}`;
      if (!left.size) {
        clearInterval(timer);
        const sec = Math.round((performance.now() - t0) / 100) / 10;
        res.textContent = `${ctx.fmtSec(sec)} с, лишних нажатий: ${misses}`;
        ctx.record('search', sec);
        doneB.hidden = false; doneB.focus();
      }
    } else {
      misses++;
      s.classList.add('miss');
      setTimeout(() => s.classList.remove('miss'), 300);
    }
  }
  spans.forEach((s, i) => { s.addEventListener('click', () => tap(i, s)); s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(i, s); } }); });
  doneB.addEventListener('click', () => ctx.onDone && ctx.onDone());
  ctx.setStop(() => clearInterval(timer));
}

// ---- Запомни число ----
export function memory(body, ctx) {
  const f = frame(body, ctx, 'memory', ROUNDS.memory);
  let level = d.MEMORY.min, misses = 0, best = 0, timer = null, answer = '', typed = '';
  const num = el('div', 'big num'); f.stage.append(num);
  const pad = el('div', 'keypad');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
  const setLevel = () => { f.levelL.textContent = `${level} цифр`; };
  const draw = () => { num.textContent = typed || ' '; };

  function round() {
    if (!f.next()) return f.finish(best ? `Запомнил число из ${best} цифр` : 'Попробуй ещё раз завтра');
    setLevel();
    answer = d.memoryNumber(level, ctx.random); typed = '';
    num.textContent = answer; num.classList.add('on');
    pad.hidden = true;
    timer = setTimeout(() => { num.classList.remove('on'); num.textContent = ' '; pad.hidden = false; }, d.MEMORY.showMs);
  }
  function key(k) {
    if (pad.hidden) return;
    if (k === '⌫') typed = typed.slice(0, -1);
    else if (k === '✓') {
      if (!typed) return;
      const ok = typed === answer;
      num.textContent = answer; num.classList.add(ok ? 'right' : 'wrong');
      if (ok) best = Math.max(best, level);
      ({ level, misses } = d.levelRule(level, ok, misses, d.MEMORY));
      pad.hidden = true;
      timer = setTimeout(() => { num.classList.remove('right', 'wrong'); round(); }, 700);
      return;
    } else if (typed.length < d.MEMORY.max) typed += k;
    draw();
  }
  keys.forEach(k => { const b = el('button', 'key' + (k === '✓' ? ' ok' : ''), k); b.addEventListener('click', () => key(k)); pad.append(b); });
  f.opts.append(pad);
  f.res.textContent = 'Число покажется на полторы секунды';
  ctx.setStop(() => clearTimeout(timer));
  ctx.recordAtDone(() => { if (best) ctx.record('memory', best); });
  timer = setTimeout(round, 600);
}

// ---- Перевёрнутый текст ----
export function flipped(body, ctx) {
  const tokens = ctx.tokens.slice(0, 120);
  const box = el('div', 'read-text flipped-text', tokens.join(' '));
  const res = el('p', 'muted center');
  const readB = el('button', 'btn', 'Прочитал');
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  body.append(box, res, readB, doneB);
  const t0 = performance.now();
  readB.addEventListener('click', () => {
    const sec = (performance.now() - t0) / 1000;
    const score = d.flippedScore(tokens.length, sec);
    res.textContent = `${tokens.length} слов за ${ctx.fmtSec(Math.round(sec * 10) / 10)} с, это ${ctx.fmtSec(score)} с на 100 слов`;
    ctx.record('flipped', score);
    readB.hidden = true; doneB.hidden = false; doneB.focus();
  }, { once: true });
  doneB.addEventListener('click', () => ctx.onDone && ctx.onDone());
  ctx.setStop(() => {});
}

export const DRILL_UI = { sight, flash, search, memory, flipped };
