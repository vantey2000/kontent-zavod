// «Твой день» (28.10.2026): дата рождения → бесплатный день на сегодня прямо на странице → кнопка подписки ведёт в бота.
// Текст пишет Мак (Claude) или запасная Gemma на воркере tvoy-den-api, страница только спрашивает готовность.
// Ответ сервера выводится только через textContent: в тексте не может оказаться разметки
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
// подмена адреса сервера разрешена только на локальной машине, на боевой странице из адресной строки нельзя
const API = (LOCAL && new URLSearchParams(location.search).get('api')) || 'https://tvoy-den-api.aivan-loginov.workers.dev';
const KEY = 'tvoyden';
const POLL_MS = 2500, POLL_MAX_MS = 120000;
const SECTIONS = ['✨', '❤️', '💼', '🕐', '🔢', '👉', '🔮'];
const STEPS = ['Ищу Луну в твоих домах', 'Сверяю планеты с твоей датой', 'Считаю твой точный час', 'Пишу твой день'];

const $ = id => document.getElementById(id);
const screens = ['form', 'wait', 'day', 'fail'];
const show = name => {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
};

const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* приватный режим: работаем без памяти */ } },
};

/** сегодняшняя дата по Москве ГГГГ-ММ-ДД: «твой день» считается по московскому утру */
export function todayMsk(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** проверка даты рождения как в natal.js: год от 1930, такой день существует, не в будущем */
export function birthIso(d, m, y, now = new Date()) {
  const [dd, mm, yy] = [d, m, y].map(v => Number(String(v).trim()));
  if (![dd, mm, yy].every(Number.isInteger) || yy < 1930 || mm < 1 || mm > 12 || dd < 1) return null;
  const t = new Date(Date.UTC(yy, mm - 1, dd));
  if (t.getUTCMonth() !== mm - 1 || t.getUTCDate() !== dd) return null;
  if (`${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` > todayMsk(now)) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** текст дня (формат сообщения Telegram) → шапка, настрой и разделы с заголовками-эмодзи */
export function parseDay(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const head = (lines.shift() || '').replace(/^\S+\s+Твой день\s*·\s*/u, '').trim();
  const sign = (lines.shift() || '').trim();
  const out = { head, sign, mood: [], sections: [] };
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (SECTIONS.some(e => l.startsWith(e))) { cur = { title: l, paras: [] }; out.sections.push(cur); continue; }
    (cur ? cur.paras : out.mood).push(l);
  }
  return out;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderDay(text, payUrl) {
  const d = parseDay(text);
  const box = $('day');
  box.replaceChildren();
  const head = el('div', 'day-head');
  head.append(el('div', 'date', d.head), el('div', 'sign', d.sign));
  box.append(head);
  for (const p of d.mood) box.append(el('p', 'mood', p));
  for (const s of d.sections) {
    const sec = el('section', 'sec');
    sec.append(el('h3', null, s.title));
    for (const p of s.paras) sec.append(el('p', null, p));
    box.append(sec);
  }
  const pay = $('pay');
  if (payUrl && /^https:\/\/t\.me\//.test(payUrl)) pay.href = payUrl; else pay.hidden = true;
  show('day');
}

function fail(title, text) {
  $('fail-title').textContent = title;
  $('fail-text').textContent = text;
  show('fail');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function poll(id) {
  const t0 = Date.now();
  let k = 0;
  const stepper = setInterval(() => { $('step').textContent = STEPS[++k % STEPS.length]; }, 3500);
  try {
    while (Date.now() - t0 < POLL_MAX_MS) {
      try {
        const r = await fetch(`${API}/api/day/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (r.status === 404) return 'gone';
        if (r.ok) {
          const j = await r.json();
          if (j.status === 'ready' && j.text) { renderDay(j.text, j.payUrl); return 'ready'; }
          if (j.status === 'failed') break;
        }
      } catch { /* сеть моргнула: спросим ещё раз */ }
      await sleep(POLL_MS);
    }
    fail('Небо сегодня затянуло', 'Попробуй через пару минут');
    return 'failed';
  } finally {
    clearInterval(stepper);
  }
}

const state = { gender: null, love: null };

function setChip(attr, value) {
  for (const b of document.querySelectorAll(`[data-${attr}]`)) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}

function setGender(g) {
  state.gender = g;
  setChip('g', g);
  // подписи по роду: «Свободна» / «Свободен»
  document.querySelector('[data-l="free"]').textContent = g === 'm' ? 'Свободен' : 'Свободна';
}

function setLove(l) { state.love = l; setChip('l', l); }

async function submit(e) {
  e.preventDefault();
  const err = $('err');
  err.textContent = '';
  const birth = birthIso($('d').value, $('m').value, $('y').value);
  if (!birth) { err.textContent = 'Проверь дату рождения: день, месяц и год, например 9 ноября 1985'; return; }
  if (!state.gender) { err.textContent = 'Выбери, ты женщина или мужчина'; return; }
  if (!state.love) { err.textContent = 'Выбери, свободна ты или в паре'; return; }
  const src = (location.hash.match(/^#([a-z0-9_-]{1,20})$/i) || [])[1] || null;
  $('go').disabled = true;
  try {
    const r = await fetch(`${API}/api/day`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birth, gender: state.gender, love: state.love, src }) });
    if (r.status === 429) { err.textContent = 'Слишком много попыток, попробуй через час'; return; }
    if (!r.ok) { err.textContent = 'Не получилось отправить, попробуй ещё раз'; return; }
    const { id } = await r.json();
    store.set({ birth, gender: state.gender, love: state.love, id, day: todayMsk() });
    $('step').textContent = STEPS[0];
    show('wait');
    await poll(id);
  } catch {
    err.textContent = 'Нет связи. Проверь интернет и нажми ещё раз';
  } finally {
    $('go').disabled = false;
  }
}

function restore() {
  const s = store.get();
  if (!s || !s.birth) return null;
  const [y, m, d] = s.birth.split('-').map(Number);
  $('d').value = d; $('m').value = String(m); $('y').value = y;
  if (s.gender) setGender(s.gender);
  if (s.love) setLove(s.love);
  return s;
}

function init() {
  const stars = $('stars');
  let html = '';
  for (let i = 0; i < 46; i++) {
    const x = (Math.random() * 100).toFixed(1), y = (Math.random() * 100).toFixed(1), r = (0.5 + Math.random()).toFixed(1);
    html += `<circle cx="${x}%" cy="${y}%" r="${r}" opacity="${(0.3 + Math.random() * 0.6).toFixed(2)}" style="animation-delay:-${(Math.random() * 6).toFixed(1)}s"/>`;
  }
  stars.innerHTML = html;      // только свои числа, данных сервера здесь нет
  for (const b of document.querySelectorAll('[data-g]')) b.addEventListener('click', () => setGender(b.dataset.g));
  for (const b of document.querySelectorAll('[data-l]')) b.addEventListener('click', () => setLove(b.dataset.l));
  $('form').addEventListener('submit', submit);
  $('edit').addEventListener('click', () => show('form'));
  $('retry').addEventListener('click', () => show('form'));
  const s = restore();
  // сегодня день уже получен: показать его сразу, без новой заявки
  if (s && s.id && s.day === todayMsk()) { show('wait'); poll(s.id).then(r => { if (r === 'gone') show('form'); }); }
}

if (typeof document !== 'undefined') init();
