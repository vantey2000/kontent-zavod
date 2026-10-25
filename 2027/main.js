// Страница «Твой 2027»: дата → бесплатная часть сразу в браузере → оплата → полный разбор с сервера.
// Бесплатные тексты лежат здесь (free.js), платные отдаёт только сервер после оплаты (api/worker.js)
import { profile, SIGNS, animalTitle, YEAR_MIN, YEAR_MAX } from './engine.js';
import { FREE } from './free.js';
import { md } from './md.js';

const API = 'https://goroskop-api.aivan-loginov.workers.dev';
const PRICE_LABEL = 'Открыть полный разбор - 490 ₽';
const SIGNS_GEN = ['Овна', 'Тельца', 'Близнецов', 'Рака', 'Льва', 'Девы', 'Весов', 'Скорпиона', 'Стрельца', 'Козерога', 'Водолея', 'Рыб'];
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим: просто не запоминаем */ } },
};

let state = null; // {y, m, d, p, sign}

/* ---------- форма ---------- */

function formError(msg) {
  const e = $('f-err');
  e.textContent = msg;
  e.hidden = !msg;
}

function readForm() {
  const d = +$('f-d').value.trim(), m = +$('f-m').value, y = +$('f-y').value.trim();
  if (!Number.isInteger(d) || d < 1 || d > 31) return formError('Укажи день рождения: число от 1 до 31');
  if (!m) return formError('Выбери месяц рождения');
  if (!/^\d{4}$/.test($('f-y').value.trim())) return formError('Укажи год рождения четырьмя цифрами, например 1985');
  if (y < YEAR_MIN || y > YEAR_MAX) return formError(`Разбор считается для годов рождения с ${YEAR_MIN} по ${YEAR_MAX}`);
  const p = profile(y, m, d);
  if (!p) return formError('Такой даты нет в календаре. Проверь день и месяц');
  formError('');
  return { y, m, d, p, sign: p.zodiac.sign };
}

/* ---------- бесплатная часть ---------- */

function cuspBlock(prefix, z, sign, onPick) {
  const box = $(prefix + '-cusp');
  if (z.cusp === null || z.cusp === undefined) { box.hidden = true; return; }
  box.hidden = false;
  const [a, b] = (z.sign + 1) % 12 === z.cusp ? [z.sign, z.cusp] : [z.cusp, z.sign]; // по порядку зодиака
  $(prefix + '-cusp-text').textContent = `Ты родилась в день, когда Солнце переходило из знака в знак, на стыке ${SIGNS_GEN[a]} и ${SIGNS_GEN[b]}. По Москве в полдень это ${SIGNS[z.sign]}. Если знаешь, что родилась ночью или рано утром, посмотри и второй знак`;
  const btns = $(prefix + '-cusp-btns');
  btns.innerHTML = '';
  for (const s of [z.sign, z.cusp]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = SIGNS[s];
    b.setAttribute('aria-pressed', String(s === sign));
    b.addEventListener('click', () => onPick(s));
    btns.append(b);
  }
}

function renderFree() {
  const { p, sign } = state;
  const c = p.chinese;
  const f = FREE.signs[sign];
  $('r-title').textContent = SIGNS[sign];
  $('r-sub').textContent = `${animalTitle(c.animal, c.element)} · число года ${p.personalYear}`;
  cuspBlock('r', p.zodiac, sign, s => { state.sign = s; renderFree(); });
  const parts = [
    f ? f.free : `**Разбор знака ${SIGNS[sign]} дописываем.** Загляни чуть позже`,
    FREE.animals[c.animal] + '. ' + FREE.elements[c.element],
    FREE.numbers[p.personalYear],
  ];
  $('r-free').innerHTML = md(parts.join('\n\n'));
  const best = $('r-best');
  best.hidden = !f;
  if (f) best.innerHTML = `Твой самый сильный месяц - <b>${f.best}</b>. Почему именно он и что успеть до него, в полном разборе`;
  $('r-lock-animal').textContent = `${animalTitle(c.animal, c.element)} в год Огненной Козы и что значит число ${p.personalYear}`;
  $('pay').disabled = !f;
}

function showResult() {
  $('full').hidden = true;
  $('result').hidden = false;
  renderFree();
  $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* ---------- оплата ---------- */

function payError(msg) {
  const e = $('pay-err');
  e.textContent = msg;
  e.hidden = !msg;
}

async function pay() {
  const btn = $('pay');
  btn.disabled = true;
  btn.textContent = 'Открываю оплату…';
  payError('');
  const { y, m, d, sign } = state;
  try {
    const r = await fetch(API + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ y, m, d, sign }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.url) {
      store.set('g27.order', { order: b.order, k: b.k, at: Date.now() });
      location.href = b.url;
      return;
    }
    payError(b.error || 'Касса не ответила. Попробуй ещё раз через минуту');
  } catch {
    payError('Нет связи. Проверь интернет и попробуй ещё раз');
  }
  btn.disabled = false;
  btn.textContent = PRICE_LABEL;
}

/* ---------- полный разбор ---------- */

function fullWait(msg) {
  const w = $('full-wait');
  w.textContent = msg;
  w.hidden = !msg;
}

async function openFull(order, k, sign, { tries = 0, quiet = false } = {}) {
  if (!quiet) {
    $('result').hidden = true;
    $('full').hidden = false;
    if (tries === 0) {
      fullWait('Открываю твой разбор…');
      $('full').scrollIntoView();
    }
  }
  let r, b;
  try {
    r = await fetch(API + '/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, k, sign }) });
    b = await r.json().catch(() => ({}));
  } catch {
    if (!quiet) fullWait('Нет связи. Проверь интернет и обнови страницу');
    return;
  }
  if (r.status === 202) {
    if (quiet) return;
    if (tries < 40) {
      fullWait('Оплата прошла, касса подтверждает платёж. Разбор откроется здесь сам через несколько секунд');
      setTimeout(() => openFull(order, k, sign, { tries: tries + 1 }), 2500);
    } else {
      fullWait('Касса ещё не прислала подтверждение. Разбор откроется по личной ссылке из письма кассы, обычно это пара минут');
    }
    return;
  }
  if (!r.ok) {
    if (!quiet) fullWait(b.error || 'Не получилось открыть разбор. Напиши в поддержку, откроем вручную');
    return;
  }
  $('result').hidden = true;
  $('full').hidden = false;
  fullWait('');
  const p = profile(b.y, b.m, b.d);
  const c = p.chinese;
  $('full-title').textContent = SIGNS[b.sign];
  $('full-sub').textContent = `${animalTitle(c.animal, c.element)} · число года ${p.personalYear}`;
  cuspBlock('full', { sign: b.main, cusp: b.cusp }, b.sign, s => openFull(order, k, s));
  $('full-md').innerHTML = md(b.md);
  $('full-save').hidden = false;
  if (quiet) $('full').scrollIntoView();
}

/* ---------- старт ---------- */

$('form').addEventListener('submit', e => {
  e.preventDefault();
  const s = readForm();
  if (!s) return;
  state = s;
  store.set('g27.date', { y: s.y, m: s.m, d: s.d });
  showResult();
});
$('pay').addEventListener('click', pay);
for (const id of ['again', 'full-again']) {
  $(id).addEventListener('click', () => {
    $('result').hidden = true;
    $('full').hidden = true;
    window.scrollTo(0, 0);
    $('f-d').focus();
  });
}

const saved = store.get('g27.date');
if (saved) {
  $('f-d').value = saved.d;
  $('f-m').value = String(saved.m);
  $('f-y').value = saved.y;
}
const claim = new URLSearchParams(location.search).get('claim');
if (claim && /^g[\w-]{4,40}\.[\w-]{8,64}$/.test(claim)) {
  const [order, k] = claim.split('.');
  store.set('g27.order', { order, k, at: Date.now() });
  history.replaceState(null, '', location.pathname);
  openFull(order, k);
} else {
  const o = store.get('g27.order');
  if (o && o.order && o.k) openFull(o.order, o.k, undefined, { quiet: true });
}
