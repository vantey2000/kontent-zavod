// Экраны новых упражнений: растяжка, вспышка, поиск буквы, запомни число, перевёрнутый текст.
// Вся арифметика в drills.js. Каждый экран получает body и ctx: { onDone, record(kind, value), words, tokens, random, setStop, fmtSec,
// seconds - время своей тренировки (нет = по числу раундов, как в программе), more() - следующий кусок текста }
import * as d from './drills.js';
import { wordDelayMs, clockText } from './core.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const ROUNDS = { sight: 12, flash: 12, memory: 10 };

// Обратный отсчёт своей тренировки: полоса и «Осталось 0:42». over() - минуты вышли: новый раунд, таблицу или текст
// не начинаем, начатое доигрываем. Время идёт по часам, как у тренировки с секундомером
export function countdown(seconds) {
  const box = el('div', 'clock');
  const label = el('span', 'muted small');
  const bar = el('div', 'progress'); const barI = el('i'); bar.append(barI);
  box.append(label, bar);
  const ms = seconds * 1000, t0 = performance.now();
  const left = () => Math.max(0, ms - (performance.now() - t0));
  const paint = () => {
    const l = left();
    label.textContent = l > 0 ? `Осталось ${clockText(l)}` : 'Время вышло, доделай начатое';
    barI.style.transform = `scaleX(${1 - l / ms})`;
  };
  paint();
  const iv = setInterval(paint, 250);
  return {
    el: box,
    over: () => left() <= 0,
    stop() { clearInterval(iv); label.textContent = 'Время вышло'; barI.style.transform = 'scaleX(1)'; },
  };
}

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
  // своя тренировка: раунды идут, пока не вышло время, полосу раундов заменяет отсчёт сверху
  const clock = ctx.seconds ? countdown(ctx.seconds) : null;
  if (clock) { body.prepend(clock.el); bar.hidden = true; }
  return {
    stage, opts, res, doneB, levelL,
    stop() { if (clock) clock.stop(); },
    next() {
      if (clock) {
        if (round && clock.over()) return false;   // первый раунд всегда, дальше - пока есть время
        round++; roundL.textContent = `Раунд ${round}`; return true;
      }
      round++; roundL.textContent = `Раунд ${Math.min(round, total)} из ${total}`; barI.style.transform = `scaleX(${(round - 1) / total})`; return round <= total;
    },
    finish(text) { if (clock) clock.stop(); barI.style.transform = 'scaleX(1)'; stage.textContent = ''; opts.textContent = ''; res.textContent = text; doneB.hidden = false; doneB.focus(); },
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
  // Середина слова на доле ширины от точки, но слово не наезжает на точку (зазор 14 px) и не уходит за край
  function place(elm, side, off) {
    const W = f.stage.clientWidth, w = elm.offsetWidth, G = 14;
    if (!W) { elm.style.left = `calc(50% + ${side * off * 100}%)`; return; }
    let cx = W / 2 + side * off * W;
    cx = side > 0 ? Math.min(Math.max(cx, W / 2 + G + w / 2), W - 4 - w / 2) : Math.max(Math.min(cx, W / 2 - G - w / 2), 4 + w / 2);
    elm.style.left = `${cx}px`;
  }

  function round() {
    if (!f.next()) return f.finish(`Лучшая ширина за раунд ${Math.round(d.sightOffset(best) * 2 * 100)}% экрана`);
    setLevel();
    const r = d.sightRound(ctx.words, ctx.random);
    const off = d.sightOffset(level);
    L.textContent = r.left; R.textContent = r.right;
    place(L, -1, off); place(R, 1, off);
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
  ctx.setStop(() => { clearTimeout(timer); f.stop(); });
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
  ctx.setStop(() => { clearTimeout(timer); f.stop(); });
  ctx.recordAtDone(() => ctx.record('flash', bestMs));
  timer = setTimeout(() => round(0), 600);
}

// ---- Поиск буквы ----
// В своей тренировке по времени: нашёл все слова, а минуты ещё есть - следующий текст с новой буквой
export function search(body, ctx) {
  const clock = ctx.seconds ? countdown(ctx.seconds) : null;
  const info = el('div', 'sch-info');
  const target = el('span');
  const timeL = el('span', 'muted', '0,0 с'); timeL.style.textAlign = 'right';
  info.append(target, timeL);
  const box = el('div', 'pointer-text search-text');
  const res = el('p', 'muted center');
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  if (clock) body.append(clock.el);
  body.append(info, box, res, doneB);
  let timer = null, nextT = null;

  function page(all) {
    const tokens = all.slice(0, 70);
    const r = d.letterSearch(tokens, ctx.random);
    target.textContent = '';
    target.append('Найди слова с буквой ', el('b', 'letter', r.letter));
    box.textContent = '';
    const spans = tokens.map(t => { const s = el('span', null, t); s.tabIndex = 0; s.setAttribute('role', 'button'); return s; });
    spans.forEach((s, k) => { box.append(s); if (k < spans.length - 1) box.append(' '); });
    const left = new Set(r.targets);
    let misses = 0;
    const t0 = performance.now();
    clearInterval(timer);
    timer = setInterval(() => { timeL.textContent = `${ctx.fmtSec(((performance.now() - t0) / 1000).toFixed(1))} с`; }, 100);
    res.textContent = `Осталось найти: ${left.size}`;
    function tap(i, s) {
      if (s.classList.contains('hit')) return;
      if (left.has(i)) {
        left.delete(i); s.classList.add('hit');
        res.textContent = `Осталось найти: ${left.size}`;
        if (!left.size) {
          clearInterval(timer);
          const sec = Math.round((performance.now() - t0) / 100) / 10;
          ctx.record('search', sec);
          const line = `${ctx.fmtSec(sec)} с, лишних нажатий: ${misses}`;
          const finish = () => { if (clock) clock.stop(); res.textContent = line; doneB.hidden = false; doneB.focus(); };
          if (!clock || clock.over()) return finish();
          res.textContent = `${line}. Следующий текст…`;
          // время могло выйти за паузу: тогда нового текста нет, сразу «Дальше»
          nextT = setTimeout(() => (clock.over() ? finish() : page(ctx.more())), 900);
        }
      } else {
        misses++;
        s.classList.add('miss');
        setTimeout(() => s.classList.remove('miss'), 300);
      }
    }
    spans.forEach((s, i) => { s.addEventListener('click', () => tap(i, s)); s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(i, s); } }); });
  }

  doneB.addEventListener('click', () => ctx.onDone && ctx.onDone());
  ctx.setStop(() => { clearInterval(timer); clearTimeout(nextT); if (clock) clock.stop(); });
  page(ctx.tokens);
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
  ctx.setStop(() => { clearTimeout(timer); f.stop(); });
  ctx.recordAtDone(() => { if (best) ctx.record('memory', best); });
  timer = setTimeout(round, 600);
}

// ---- Перевёрнутый текст ----
// В своей тренировке по времени: прочитал абзац, а минуты ещё есть - следующий абзац
export function flipped(body, ctx) {
  const clock = ctx.seconds ? countdown(ctx.seconds) : null;
  const box = el('div', 'read-text flipped-text');
  const res = el('p', 'muted center');
  const readB = el('button', 'btn', 'Прочитал');
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  if (clock) body.append(clock.el);
  body.append(box, res, readB, doneB);
  let tokens = [], t0 = 0, nextT = null;
  function page(all) {
    tokens = all.slice(0, 120);
    box.textContent = tokens.join(' ');
    readB.hidden = false;
    t0 = performance.now();
  }
  readB.addEventListener('click', () => {
    const sec = (performance.now() - t0) / 1000;
    const score = d.flippedScore(tokens.length, sec);
    res.textContent = `${tokens.length} слов за ${ctx.fmtSec(Math.round(sec * 10) / 10)} с, это ${ctx.fmtSec(score)} с на 100 слов`;
    ctx.record('flipped', score);
    readB.hidden = true;
    const finish = () => { if (clock) clock.stop(); doneB.hidden = false; doneB.focus(); };
    if (!clock || clock.over()) return finish();
    nextT = setTimeout(() => (clock.over() ? finish() : page(ctx.more())), 1200);   // время могло выйти за паузу
  });
  doneB.addEventListener('click', () => ctx.onDone && ctx.onDone());
  ctx.setStop(() => { clearTimeout(nextT); if (clock) clock.stop(); });
  page(ctx.tokens);
}

// ---- Кривые буквы ----
// Карточка кривых букв строками, как в рилсе: слово = span.w, буква = i (зеркальная - .m). Общая для упражнения и теста #krivye
export function scrambleCard(box, tokens, level, random = Math.random) {
  box.textContent = '';
  const words = [], letters = [];
  for (const line of d.scrambleLines(tokens)) {
    const ln = el('div', 'line');
    line.forEach((t, k) => {
      const w = el('span', 'w');
      for (const g of d.scrambleWord(t, level, random)) {
        const ch = el('i', g.mirror ? 'm' : null, g.ch);
        w.append(ch);
        if (g.letter) letters.push(ch);
      }
      ln.append(w); if (k < line.length - 1) ln.append(' ');
      words.push(w);
    });
    box.append(ln);
  }
  return { words, letters };
}

// Гаснущие буквы: одновременно гаснет доля уровня от всех букв, каждая на 0,35-0,65 с. tick(..., off) возвращает все буквы
export function flickerer(random = Math.random) {
  const gone = new Map();   // буква -> когда вернуть
  return {
    tick(letters, level, off) {
      const now = performance.now();
      for (const [ch, t] of gone) if (t <= now || off) { ch.classList.remove('g'); gone.delete(ch); }
      if (off) return;
      const want = d.goneCount(level, letters.length);
      for (let n = 0; gone.size < want && n < 20; n++) {
        const ch = letters[Math.floor(random() * letters.length)];
        if (gone.has(ch)) continue;
        ch.classList.add('g'); gone.set(ch, now + 350 + random() * 300);
      }
    },
    clear() { gone.clear(); },
  };
}

// Упражнение: карточка строками, как в рилсе: буквы отражены, регистр скачет, часть букв гаснет. Подсветка идёт по словам в заданном темпе.
// Сложность и темп меняются на ходу и запоминаются (ctx.prefs / ctx.savePrefs). В своей тренировке тексты идут, пока есть время
export function scramble(body, ctx) {
  const clock = ctx.seconds ? countdown(ctx.seconds) : null;
  const prefs = ctx.prefs || {};
  let level = d.scrambleLevel(prefs.level ?? 2), speed = d.scrambleWpm(prefs.wpm, ctx.speed);
  const seg = el('div', 'seg scr-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Сложность');
  const segBtns = d.SCRAMBLE.map((L, i) => {
    const b = el('button', null, L.name); b.type = 'button'; b.setAttribute('role', 'radio');
    b.addEventListener('click', () => setLevel(i));
    seg.append(b); return b;
  });
  const box = el('div', 'scr-text');
  const res = el('p', 'muted center drill-res');
  const label = el('span', 'muted small');
  const range = el('input'); range.type = 'range';
  range.min = d.SCRAMBLE_WPM.min; range.max = d.SCRAMBLE_WPM.max; range.step = d.SCRAMBLE_WPM.step; range.value = speed;
  range.setAttribute('aria-label', 'Темп подсветки, слов в минуту');
  const rangeBox = el('div', 'range'); rangeBox.append(label, range);
  const pauseB = el('button', 'btn', 'Пауза');
  const newB = el('button', 'btn ghost', 'Новый текст');
  const row = el('div', 'row'); row.append(newB, pauseB);
  const doneB = el('button', 'btn', 'Дальше'); doneB.hidden = true;
  const controls = el('div', 'controls'); controls.append(rangeBox, row, doneB);
  if (clock) body.append(clock.el);
  body.append(seg, box, res, controls);

  let tokens = [], words = [], letters = [], i = 0, timer = null, flick = null, nextT = null, paused = false, finished = false;
  const fl = flickerer(ctx.random);

  const save = () => ctx.savePrefs && ctx.savePrefs({ level, wpm: speed });
  const setLabel = () => { label.textContent = `Темп подсветки ${speed} слов/мин`; };
  range.addEventListener('input', () => { speed = Number(range.value); setLabel(); save(); });
  setLabel();

  // текст рисуется заново на каждом уровне, подсветка остаётся на том же слове
  function paint() {
    segBtns.forEach((b, k) => b.setAttribute('aria-checked', String(k === level)));
    fl.clear();
    ({ words, letters } = scrambleCard(box, tokens, level, ctx.random));
    words.forEach((w, k) => { if (k < i - 1 || finished) w.classList.add('read'); else if (k === i - 1) w.classList.add('on'); });
  }
  function setLevel(k) {
    if (k === level) return;
    level = k; save(); paint();
  }

  // гаснет доля букв уровня, каждая на полсекунды; в паузе и после конца текста всё видно
  const flicker = () => fl.tick(letters, level, paused || finished);

  function tick() {
    timer = null;
    if (paused || finished) return;
    if (i >= words.length) return end();
    if (i > 0) { words[i - 1].classList.remove('on'); words[i - 1].classList.add('read'); }
    const w = words[i];
    w.classList.add('on');
    if (w.offsetTop - box.scrollTop > box.clientHeight * 0.6) box.scrollTop = w.offsetTop - box.clientHeight * 0.3;
    i++;
    timer = setTimeout(tick, wordDelayMs(tokens[i - 1], speed));
  }

  function end() {
    finished = true; flicker();
    if (words.length) words[words.length - 1].classList.remove('on');
    const line = `${tokens.length} слов · ${d.SCRAMBLE[level].name} · ${speed} слов/мин`;
    pauseB.hidden = true;
    if (clock && !clock.over()) { res.textContent = `${line}. Следующий текст…`; nextT = setTimeout(() => (clock.over() ? stopAll(line) : page(ctx.more())), 1200); return; }
    stopAll(line);
  }
  function stopAll(line) {
    if (clock) clock.stop();
    res.textContent = line;
    doneB.hidden = false; doneB.focus();
  }

  function page(all) {
    clearTimeout(timer); clearTimeout(nextT);
    tokens = all.slice(0, 50); i = 0; finished = false; paused = false;
    pauseB.hidden = false; pauseB.textContent = 'Пауза';
    res.textContent = 'Успевай за подсветкой. Сложность и темп меняй на ходу';
    box.scrollTop = 0;
    paint();
    timer = setTimeout(tick, 600);
  }

  pauseB.addEventListener('click', () => {
    paused = !paused;
    pauseB.textContent = paused ? 'Продолжить' : 'Пауза';
    if (paused) { clearTimeout(timer); timer = null; flicker(); } else if (!timer) tick();
  });
  newB.addEventListener('click', () => { doneB.hidden = true; page(ctx.more()); });
  doneB.addEventListener('click', () => ctx.onDone && ctx.onDone());
  const onVis = () => { if (document.hidden && !paused && !finished) pauseB.click(); };
  document.addEventListener('visibilitychange', onVis);
  ctx.setStop(() => { finished = true; clearTimeout(timer); clearTimeout(nextT); clearInterval(flick); document.removeEventListener('visibilitychange', onVis); if (clock) clock.stop(); });
  flick = setInterval(flicker, 120);
  page(ctx.tokens);
}

export const DRILL_UI = { sight, flash, search, memory, flipped, scramble };
