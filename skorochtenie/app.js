// Интерфейс: экраны и упражнения. Вся арифметика в core.js, хранение в store.js
import * as c from './core.js';
import * as dr from './drills.js';
import { DRILL_UI } from './drills-ui.js';
import { TESTS, LIBRARY } from './content.js';
import * as store from './store.js';
import * as m from './motion.js';

const $ = id => document.getElementById(id);
const SCREENS = ['start', 'read', 'quiz', 'result', 'pay', 'wait', 'acct', 'login', 'home', 'ex', 'lib', 'own', 'done'];
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
let ready = false, showSeq = 0;   // первый экран рисуется сразу, без перехода: переходы включаются после первого кадра
requestAnimationFrame(() => { ready = true; });
function show(name, { instant = false } = {}) {
  // старый экран гасим сразу: если отложить вместе с переходом, остановка заденет уже запущенный новый
  stopActive();
  stopActive = () => {};
  stopDemo();
  const id = ++showSeq;
  const swap = () => {
    if (id !== showSeq) return;   // пока переход ждал кадра, показали другой экран: устаревшая смена не применяется
    for (const s of SCREENS) $('s-' + s).hidden = s !== name;
    window.scrollTo(0, 0);
  };
  const done = ready && !instant ? m.transition(swap) : (swap(), Promise.resolve());
  if (name === 'start') startDemo();
  return done;   // выполняется, когда экран уже показан: фокус и замеры ставить после него
}

// Опорная буква слова встаёт на засечку сцены; длинное слово ужимается, чтобы влезть по обе стороны
function placeWord(word, stage, tok, px) {
  word.style.fontSize = `${px}px`;
  const o = orpInto(word, tok);
  const W = stage.clientWidth;
  if (!W) return false;   // сцена ещё скрыта (переход не дорисован): позицию поставит следующее слово
  const ax = W * ANCHOR;
  let center = o.offsetLeft + o.offsetWidth / 2;
  const width = word.offsetWidth;
  const k = Math.min(1, (ax - 12) / Math.max(1, center), (W - ax - 12) / Math.max(1, width - center));
  if (k < 1) { word.style.fontSize = `${Math.floor(px * k)}px`; center = o.offsetLeft + o.offsetWidth / 2; }
  word.style.left = `${ax - center}px`;
  return true;
}

// Старт: демо-слово меняется само, красная буква стоит на месте - механика видна до нажатия
const DEMO = ['читаешь', 'быстрее', 'понимаешь', 'темп', 'слово', 'смысл'];
let demoTimer = null;
function startDemo() {
  const stage = $('demo'), word = $('demo-word');
  let k = 0, tries = 0;
  const px = parseFloat(getComputedStyle(stage).fontSize) || 58;
  const first = () => { if (!placeWord(word, stage, DEMO[0], px) && ++tries < 10) setTimeout(first, 60); };
  requestAnimationFrame(first);
  if (m.reduced()) return;
  demoTimer = setInterval(() => { k = (k + 1) % DEMO.length; placeWord(word, stage, DEMO[k], px); }, 900);
}
function stopDemo() { clearInterval(demoTimer); demoTimer = null; }

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
// Safari на iOS включает :active (сжатие кнопок) только при обработчике touchstart на странице
document.addEventListener('touchstart', () => {}, { passive: true });

// Тема: ночная по умолчанию или дневная. Выбор хранится отдельно от прогресса (ключ temp.theme): встроенный скрипт
// в head ставит её до первой отрисовки, без мигания. Переключатель «Сменить тему» на первом экране, главной и в упражнениях
const isDay = () => document.documentElement.dataset.mode === 'day';
function paintThemeButtons() {
  const day = isDay();
  document.querySelectorAll('[data-mode-set]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.modeSet === 'day') === day)));
}
function setTheme(day) {
  m.transition(() => {
    const root = document.documentElement;
    if (day) root.dataset.mode = 'day'; else delete root.dataset.mode;
    $('meta-theme').content = getComputedStyle(root).getPropertyValue('--bg').trim();   // цвет полосы браузера
    paintThemeButtons();
  }, 'theme');
  try { localStorage.setItem('temp.theme', day ? 'day' : 'night'); } catch {}
}
document.querySelectorAll('[data-mode-set]').forEach(b => b.addEventListener('click', () => { const day = b.dataset.modeSet === 'day'; if (day !== isDay()) setTheme(day); }));
paintThemeButtons();

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
  show('read', { instant: true });   // текст теста появляется мгновенно: секундомер идёт ровно с показа
  run = { test: t, words: c.countWords(t.text), started: performance.now(), seconds: 0, correct: 0, idx: 0 };
}

function showQuestion() {
  const q = run.test.questions[run.idx];
  const n = run.test.questions.length;
  $('quiz-count').textContent = `Вопрос ${run.idx + 1} из ${n}`;
  $('quiz-bar').style.transform = `scaleX(${run.idx / n})`;
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
  let reveal = null;
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
    $('r-level').textContent = `Уровень: ${r.level.label}`;
    $('r-delta').textContent = prev ? `${r.wpm >= prev.wpm ? '+' : ''}${r.wpm - prev.wpm} к прошлому тесту` : '';
    // цифры набегают, кольцо понимания заполняется, уровень проявляется после (CSS .later); первый результат - праздник
    reveal = () => {
      m.countUp($('r-wpm'), r.wpm);
      m.countUp($('r-comp'), Math.round(r.comprehension * 100), { ms: m.DUR.ring, format: v => `${Math.round(v)}%` });
      m.ring($('r-ring'), r.comprehension);
      m.countUp($('r-eff'), r.effective);
      if (first) m.confetti();
    };
    $('r-avg').textContent = r.wpm > c.CONFIG.avgAdultWpm
      ? `Обычно взрослый читает про себя около ${c.CONFIG.avgAdultWpm} слов в минуту. Ты уже быстрее`
      : `Обычно взрослый читает про себя около ${c.CONFIG.avgAdultWpm} слов в минуту`;
    $('r-start-l').textContent = first ? 'Читалка начнёт с' : 'Читалка сегодня идёт на';
    $('r-start').textContent = first ? c.readerSpeed(state.baseWpm, 1) : speedToday();
    $('r-goal').textContent = c.goalSpeed(state.baseWpm);
    $('b-result-next').textContent = acc().paid ? 'К тренировке' : 'Начать программу';
  }
  show('result');
  if (reveal) reveal();
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
// Оплата: сервер заводит заказ и даёт ссылку кассы, почту и карту человек вводит на форме кассы. Телефон хранит
// номер заказа с секретом и после возврата забирает по нему доступ (сервер .business/scripts/skorochtenie-api)

let payTier = 'life';
let payBack = 'home';
let payUp = false;   // переход с месяца на «навсегда»: экран оплаты только с одним тарифом

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && state.auth) headers.Authorization = 'Bearer ' + state.auth.token;
  try {
    const r = await fetch(c.CONFIG.apiUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    return { status: 0, data: { error: 'Нет связи с сервером. Проверь интернет и попробуй ещё раз' } };
  }
}

function showErr(id, msg) {
  $(id).textContent = msg || '';
  $(id).hidden = !msg;
}

function payTerms() {
  const { priceLife, priceMonth } = c.CONFIG;
  $('pay-terms').textContent = payTier === 'life'
    ? `: ${c.formatRub(priceLife)} один раз, повторных списаний не будет`
    : ` и автопродлением: ${c.formatRub(priceMonth)} раз в месяц. Отменить можно в приложении в любой момент`;
}

// согласие относится к условиям тарифа: сменил тариф - отмечает заново (у месяца автопродление, у «навсегда» нет)
function selectTier(tier) {
  if (tier !== payTier) $('pay-ok').checked = false;
  payTier = tier;
  document.querySelectorAll('.plan').forEach(x => x.setAttribute('aria-checked', String(x.dataset.tier === tier)));
  payTerms();
}

// up = переход с месяца на «навсегда» из раздела подписки: месячный тариф скрыт, назад - в подписку
function showPay(back, up = false) {
  if (acc().paid && !up) return showAcct();
  payBack = back;
  payUp = up;
  const { priceLife, priceMonth, refundDays } = c.CONFIG;
  $('pay-life').textContent = c.formatRub(priceLife);
  $('pay-month').textContent = c.formatRub(priceMonth);
  $('plan-month').hidden = up;
  $('b-free').hidden = up;
  $('b-login-open').hidden = up;
  $('pay-refund').textContent = `Если не подойдёт, вернём деньги в течение ${refundDays} дней`;
  if (up) { $('pay-ok').checked = false; selectTier('life'); } else payTerms();
  showErr('pay-err', '');
  $('pay-consent').classList.remove('need');
  track('pay');
  show('pay');
}

document.querySelectorAll('.plan').forEach(p => p.addEventListener('click', () => selectTier(p.dataset.tier)));
$('pay-ok').addEventListener('change', () => { if ($('pay-ok').checked) { $('pay-consent').classList.remove('need'); showErr('pay-err', ''); } });
$('b-pay').addEventListener('click', async () => {
  if (!$('pay-ok').checked) {
    $('pay-consent').classList.add('need');
    showErr('pay-err', payTier === 'life' ? 'Отметь согласие с офертой' : 'Отметь согласие с офертой и автопродлением');
    return;
  }
  const b = $('b-pay');
  b.disabled = true;
  b.textContent = 'Готовим оплату…';
  showErr('pay-err', '');
  track(payTier === 'life' ? 'year' : 'month');   // в счётчике воронки столбец year = нажали тариф 2 990 (сейчас «Навсегда»)
  const r = await api('/api/paylink', { method: 'POST', body: { plan: payTier } });
  if (r.status === 200 && r.data.url) {
    state.pending = { order: r.data.order, k: r.data.k, plan: payTier, at: Date.now() };
    persist();
    location.href = r.data.url;
    return;   // кнопка остаётся «Готовим оплату…» до ухода на кассу
  }
  b.disabled = false;
  b.textContent = 'Открыть доступ';
  showErr('pay-err', r.data.error || 'Касса не ответила. Попробуй ещё раз через минуту');
});
$('b-free').addEventListener('click', () => { track('free'); goHome(); });
$('b-pay-back').addEventListener('click', () => (payBack === 'acct' ? showAcct() : payBack === 'result' && run ? show('result') : goHome()));

// доступ пришёл с сервера: запоминаем вход и кэш доступа
function applyAccess(d) {
  if (d.token) state.auth = { token: d.token, email: d.email, pw: !!d.password };
  else if (state.auth && typeof d.password === 'boolean') state.auth.pw = d.password;
  if (d.access) state.acc = d.access;
  persist();
}

// Забрать доступ по заказу. Ответ: 'ok' | 'wait' | 'gone' | 'net'
async function claim() {
  const p = state.pending;
  if (!p) return 'gone';
  const r = await api('/api/claim', { method: 'POST', body: { order: p.order, k: p.k }, auth: false });
  if (r.status === 200) { state.pending = null; applyAccess(r.data); return 'ok'; }
  if (r.status === 202) return 'wait';
  if (r.status === 0 || r.status >= 500) return 'net';
  state.pending = null;   // заказа нет или устарел (3 дня): не спрашиваем вечно
  persist();
  return 'gone';
}

async function waitForPayment() {
  $('wait-title').textContent = 'Проверяем оплату';
  $('wait-text').textContent = 'Касса подтверждает платёж, обычно это меньше минуты. Не закрывай страницу';
  $('b-wait-home').hidden = true;
  show('wait');
  const until = Date.now() + c.CONFIG.claimWaitMs;
  for (;;) {
    const res = await claim();
    if (res === 'ok') return showAcct(true);
    if (res === 'gone') return homeOrStart();
    if (Date.now() > until) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  $('wait-title').textContent = 'Касса ещё не подтвердила';
  $('wait-text').textContent = 'Если деньги списались, доступ откроется сам при следующем входе в приложение, обычно в течение нескольких минут. Не открылся за час - напиши в поддержку';
  $('b-wait-home').hidden = false;
}
// пришёл по ссылке доступа на новом телефоне без пройденного теста - сначала тест, от него растёт читалка
const homeOrStart = () => (state.tests.length ? goHome() : show('start'));
$('b-wait-home').addEventListener('click', homeOrStart);

function showAcct(fresh = false) {
  const a = acc();
  $('acct-title').textContent = fresh ? 'Доступ открыт' : a.life ? 'Доступ' : 'Подписка';
  $('acct-line').textContent = c.accessLine(a, fmtDate);
  $('acct-email').textContent = state.auth ? `Почта: ${state.auth.email}` : '';
  const pw = !!(state.auth && state.auth.pw);
  $('acct-pw-box').hidden = pw || !state.auth;
  $('acct-pw-done').hidden = !pw;
  $('acct-pw').value = '';
  showErr('acct-pw-err', '');
  showErr('acct-err', '');
  $('b-acct-cancel').hidden = !a.renews;
  $('acct-up').hidden = !(a.paid && !a.forever && a.tier === 'month');   // платит за месяц - можно перейти на «навсегда»
  $('acct-up-price').textContent = c.formatRub(c.CONFIG.priceLife);
  $('b-acct-home').textContent = state.tests.length ? 'К тренировке' : 'Пройти тест';
  show('acct');
}
$('b-acct-back').addEventListener('click', homeOrStart);
$('b-acct-up').addEventListener('click', () => showPay('acct', true));
$('b-acct-home').addEventListener('click', homeOrStart);
$('b-acct-pw').addEventListener('click', async () => {
  const pw = $('acct-pw').value;
  if (pw.length < 8) { showErr('acct-pw-err', 'Нужно не меньше 8 знаков'); $('acct-pw').focus(); return; }
  $('b-acct-pw').disabled = true;
  const r = await api('/api/password', { method: 'POST', body: { password: pw } });
  $('b-acct-pw').disabled = false;
  if (r.status !== 200) return showErr('acct-pw-err', r.data.error || 'Не сохранилось. Попробуй ещё раз');
  state.auth.pw = true;
  persist();
  showAcct();
});
$('b-acct-cancel').addEventListener('click', async () => {
  const a = acc();
  if (!confirm(`Отключить автопродление? Доступ останется до ${fmtDate(a.until)}, дальше списаний не будет`)) return;
  $('b-acct-cancel').disabled = true;
  const r = await api('/api/sub/cancel', { method: 'POST' });
  $('b-acct-cancel').disabled = false;
  if (r.data.access) applyAccess({ access: r.data.access });
  if (r.status !== 200) return showErr('acct-err', r.data.error || 'Не получилось. Напиши в поддержку');
  showAcct();
});

function showLogin() {
  showErr('login-err', '');
  show('login').then(() => $('login-email').focus());   // при переходе экран показывается кадром позже
}
$('b-login-open').addEventListener('click', showLogin);
$('b-login-back').addEventListener('click', () => showPay(payBack));
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('login-email').value.trim(), password = $('login-pw').value;
  if (!email || !password) return showErr('login-err', 'Введи почту и пароль');
  $('b-login').disabled = true;
  const r = await api('/api/login', { method: 'POST', body: { email, password }, auth: false });
  $('b-login').disabled = false;
  if (r.status !== 200) return showErr('login-err', r.data.error || 'Не получилось войти');
  applyAccess(r.data);
  $('login-pw').value = '';
  if (acc().paid) showAcct(); else showPay('home');
});
for (const id of ['acct-support', 'login-support']) $(id).href = c.CONFIG.supportUrl;

// ---------- главная ----------

function goHome() {
  renderHome();
  show('home');
}

let shownStreak = null;   // серия, которую человек видел в прошлый раз: новое число набегает от неё
function renderHome() {
  const entering = $('s-home').hidden;   // каскад и рисование графика только при входе на экран, не при фоновом обновлении
  const a = acc();
  const key = today();
  const pd = day();
  const st = c.streak(state.done, key);
  const doneToday = state.done.includes(key);
  const freeLeft = c.canFreeRead(state.freeReads, key);

  $('h-mode').textContent = a.paid
    ? (pd.done ? 'Программа пройдена, тренировки продолжаются' : `День ${pd.day} из ${c.CONFIG.programDays}`)
    : `Бесплатный режим · день ${pd.day}`;
  $('b-home-pay').textContent = a.paid ? (a.life ? 'Доступ навсегда' : a.forever ? 'Доступ без срока' : `Доступ до ${fmtDate(a.until)}`) : 'Открыть доступ';
  m.countUp($('h-streak'), st, { from: shownStreak ?? st, ms: 400 });
  shownStreak = st;
  $('h-streak-l').textContent = `${c.pluralDays(st).replace(/^\d+ /, '')} подряд`;

  const segs = $('h-segs');
  segs.textContent = '';
  segs.classList.toggle('enter', entering);
  for (let i = 6; i >= 0; i--) {
    const s = el('i');
    if (state.done.includes(c.addDays(key, -i))) s.className = 'on';
    s.style.setProperty('--i', String((6 - i) * 60));
    segs.append(s);
  }
  $('h-prog').style.setProperty('--p', String(pd.done ? 1 : pd.day / c.CONFIG.programDays));

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
    const n = el('span', 'n');
    n.append(el('i', 'lock'));
    row.append(n);
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
  renderChart($('h-chart'), entering);

  const rt = c.retestStatus(state.tests, key);
  const B = state.best;
  const sec = v => (v == null ? null : `${fmtSec(v)} с`);
  const tiles = [
    { k: 'reader', ic: 'Aa', nm: 'Читалка', ds: `слово за словом, ${speedToday()} сл/мин`, free: true },
    { k: 'schulte', ic: '25', nm: 'Таблица Шульте', ds: sec(B.schulte) ? `лучшее время ${sec(B.schulte)}` : 'поле зрения' },
    { k: 'schulte-letters', ic: 'аб', nm: 'Шульте буквами', ds: sec(B['schulte-letters']) ? `лучшее время ${sec(B['schulte-letters'])}` : 'буквы по алфавиту' },
    { k: 'schulte-6', ic: '36', nm: 'Шульте 6x6', ds: sec(B['schulte-6']) ? `лучшее время ${sec(B['schulte-6'])}` : '36 чисел' },
    { k: 'sight', ic: '◁ ▷', nm: 'Растяжка взгляда', ds: B.sight ? `ширина ${Math.round(dr.sightOffset(B.sight) * 200)}%` : 'шире охват' },
    { k: 'flash', ic: '✶', nm: 'Вспышка', ds: B.flash ? `выдержка ${B.flash} мс` : 'схватить группу' },
    { k: 'memory', ic: '№', nm: 'Запомни число', ds: B.memory ? `${B.memory} цифр` : 'рабочая память' },
    { k: 'search', ic: '◎', nm: 'Поиск буквы', ds: sec(B.search) ? `лучшее время ${sec(B.search)}` : 'сканировать, не читать' },
    { k: 'blocks', ic: '≡', nm: 'Блоки', ds: 'по 2-3 слова' },
    { k: 'pointer', ic: '▸', nm: 'Указка', ds: 'без возвратов назад' },
    { k: 'column', ic: '⫶', nm: 'Колонка', ds: 'сверху вниз' },
    { k: 'hopscotch', ic: '∴', nm: 'Указка по точкам', ds: 'две-три остановки на строку' },
    { k: 'flipped', ic: '∀', nm: 'Перевёрнутый текст', ds: B.flipped ? `${fmtSec(B.flipped)} с на 100 слов` : 'вверх ногами' },
    { k: 'lib', ic: '¶', nm: 'Библиотека', ds: `Чехов и Тургенев, ${LIBRARY.length} текстов` },
    { k: 'own', ic: '✎', nm: 'Свой текст', ds: 'статьи, книги, письма' },
    { k: 'test', ic: '◷', nm: 'Тест скорости', ds: rt.available ? 'можно пройти сейчас' : `повторный через ${c.pluralDays(rt.inDays)}`, free: true, wide: true },
  ];
  const box = $('h-tiles');
  box.textContent = '';
  box.classList.toggle('enter', entering);
  for (const [n, t] of tiles.entries()) {
    const locked = (!t.free && !a.paid) || (t.k === 'reader' && !a.paid && !freeLeft);
    const b = el('button', 'tile' + (locked ? ' locked' : ''));
    b.dataset.tile = t.k;
    if (t.wide) b.style.gridColumn = '1 / -1';
    b.style.setProperty('--i', String(Math.min(n, 10) * 35));
    b.append(el('span', 'ic', t.ic), el('span', 'nm', t.nm), el('span', 'ds', t.ds));
    b.addEventListener('click', () => openTile(t.k, locked, rt));
    box.append(b);
  }
  $('h-storage').hidden = store.isPersistent();
}

// График: линия читалки по дням тренировок и точки тестов, ось X = дни программы
function renderChart(box, animate = false) {
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
  svg.setAttribute('class', animate ? 'chart enter' : 'chart');
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
    add('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'grid', 'stroke-width': 1 });
    add('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end', 'font-size': 10 }, Math.round(v));
  }
  add('text', { x: L, y: H - 6, 'font-size': 10 }, 'день 1');
  add('text', { x: W - R, y: H - 6, 'text-anchor': 'end', 'font-size': 10 }, `день ${maxX + 1}`);
  if (reader.length > 1) {
    const pts = reader.map(p => [sx(p.x), sy(p.y)]);
    const line = add('polyline', { points: pts.map(q => q.join(',')).join(' '), fill: 'none', class: 'line', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    // линия рисуется слева направо; длину считаем сами, на скрытом экране браузер её не даёт
    if (animate) m.drawPath(line, { ms: 900, len: pts.slice(1).reduce((sum, q, k) => sum + Math.hypot(q[0] - pts[k][0], q[1] - pts[k][1]), 0) });
  }
  // цвета линий и точек задают классы из токенов темы (index.html, .chart)
  reader.forEach(p => add('circle', { cx: sx(p.x), cy: sy(p.y), r: 3, class: 'pt pt-r' }));
  tests.forEach(p => add('circle', { cx: sx(p.x), cy: sy(p.y), r: 4.5, 'stroke-width': 1.5, class: 'pt pt-t' }));
  box.append(svg);
  const legend = el('p', 'muted small legend');
  const key = (cls, text) => { const s = el('span'); s.append(el('i', cls), text); return s; };
  legend.append(key('k-r', 'читалка, слов/мин'), key('k-t', 'тесты'));
  box.append(legend);
}

$('b-home-pay').addEventListener('click', () => (acc().paid ? showAcct() : showPay('home')));
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
  const fresh = !state.done.includes(key);   // повтор тренировки в тот же день вехой не считается
  if (fresh) state.done.push(key);
  state.readerLog[key] = speedToday();
  if (!acc().paid) useFreeRead();   // бесплатный режим: читалка дня потрачена только когда пройдена до конца
  persist();
  session = null;
  const st = c.streak(state.done, key);
  $('done-streak').textContent = `${c.pluralDays(st)} подряд. Возвращайся завтра, чтобы не прервать серию`;
  show('done');
  // кольцо и галочка рисуются штрихом; конфетти только на вехах серии 7, 14 и 30
  const chk = $('done-check');
  m.drawPath(chk.querySelector('circle'), { len: 2 * Math.PI * 44, ms: 450 });
  m.drawPath(chk.querySelector('.tick'), { len: 54, ms: 350, delay: 300 });
  if (fresh && c.isMilestone(st)) m.confetti();
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

  const place = tok => placeWord(word, stage, tok, WORD_PX);

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
    barI.style.transform = `scaleX(${i / units.length})`;
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
    if (stage) stage.classList.toggle('paused', p);   // на паузе засечки пульсируют
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
      b.classList.remove('bad');
      void b.offsetWidth;   // повторная ошибка по той же клетке тоже вздрагивает
      b.classList.add('bad');
      if (navigator.vibrate) navigator.vibrate(30);   // Android; на iOS вибрации из браузера нет
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

// Доступ сверяется с сервером в фоне, после первого экрана. Вернулся с кассы (?paid=1) или пришёл по ссылке
// доступа (?claim=) - ждём подтверждения на экране ожидания. Адрес чистим, метку площадки после # не трогаем
(async function syncAccess() {
  const q = new URLSearchParams(location.search);
  const link = c.parseClaim(location.search);
  const back = q.has('paid');
  if (link) { state.pending = { ...link, plan: 'link', at: Date.now() }; persist(); }
  if (link || back) { try { history.replaceState(null, '', location.pathname + location.hash); } catch {} }
  if (state.pending) {
    if (Date.now() - state.pending.at > 3 * 864e5) { state.pending = null; persist(); }
    else if (link || back) return waitForPayment();
    else if (await claim() === 'ok') return showAcct(true);
  }
  if (!state.auth) return;
  const r = await api('/api/me');
  if (r.status === 401) { state.auth = null; state.acc = null; persist(); }
  else if (r.status === 200) applyAccess(r.data);
  else return;
  if (!$('s-home').hidden) renderHome();
})();
// «Открыл» уходит после полной загрузки, уже с нарисованным первым экраном: учёт в фоне, не на пути человека
if (document.readyState === 'complete') track('open'); else addEventListener('load', () => track('open'), { once: true });
