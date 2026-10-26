// Страница «Вы с ним»: две даты → процент и бесплатная часть сразу в браузере → оплата → полный разбор с сервера.
// Бесплатные тексты лежат в free.js (грузится в фоне после показа страницы), платные отдаёт только сервер (api/worker.js)
import { SIGNS, animalTitle, YEAR_MIN } from './engine.js';
import { pairScore, pairIndex, pairOf } from './pair.js';
import { md } from './md.js';

const API = 'https://para-api.aivan-loginov.workers.dev';
const PRICE_LABEL = 'Открыть разбор пары - 490 ₽';
const YEAR_TOP = 2012;
const SIGNS_GEN = ['Овна', 'Тельца', 'Близнецов', 'Рака', 'Льва', 'Девы', 'Весов', 'Скорпиона', 'Стрельца', 'Козерога', 'Водолея', 'Рыб'];
const ANIMAL_GEN = ['Крысы', 'Быка', 'Тигра', 'Кролика', 'Дракона', 'Змеи', 'Лошади', 'Козы', 'Обезьяны', 'Петуха', 'Собаки', 'Свиньи'];
const ANIMALS = ['Крыса', 'Бык', 'Тигр', 'Кролик', 'Дракон', 'Змея', 'Лошадь', 'Коза', 'Обезьяна', 'Петух', 'Собака', 'Свинья'];
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим: просто не запоминаем */ } },
};

// бесплатные тексты 78 пар весят ~100 КБ: первый экран их не ждёт, модуль подтягивается в фоне после load
let freeMod = null;
const loadFree = () => (freeMod ||= import('./free.js').then(m => m.FREE));

let state = null; // {h:[y,m,d], b:[y,m,d], sh, sm}

/* ---------- учёт шагов для админки /para/admin/ ---------- */
// Каждый шаг уходит с телефона один раз (числа в админке = люди), фоновым сигналом: страница ответа не ждёт.
// Площадка - метка после # (дверь ChatPlace ведёт на /para/#ig). Телефон, с которого открывали админку, не считается
const hashSrc = (/^#([a-z0-9-]{1,16})$/.exec(location.hash) || [])[1];
if (hashSrc && !store.get('vsn.src')) store.set('vsn.src', hashSrc);

function track(e, z) {
  if (store.get('vsn.own')) return;
  const sent = store.get('vsn.sent');
  const list = Array.isArray(sent) ? sent : [];
  if (list.includes(e)) return;
  store.set('vsn.sent', [...list, e]);
  const s = store.get('vsn.src') || hashSrc || 'direct';
  try { navigator.sendBeacon(API + '/e', `e=${e}&s=${s}` + (z === undefined ? '' : `&z=${z}`)); } catch { /* учёт не важнее страницы */ }
}

/* ---------- форма ---------- */

function formError(msg) {
  const e = $('f-err');
  e.textContent = msg;
  e.hidden = !msg;
}

// p - префикс полей: f - её дата, g - его
function readDate(p, who) {
  const d = +$(p + '-d').value.trim(), m = +$(p + '-m').value, ys = $(p + '-y').value.trim(), y = +ys;
  if (!Number.isInteger(d) || d < 1 || d > 31) return formError(`Укажи ${who}: день числом от 1 до 31`);
  if (!m) return formError(`Выбери месяц: ${who}`);
  if (!/^\d{4}$/.test(ys)) return formError(`Год четырьмя цифрами, например 1990: ${who}`);
  if (y < YEAR_MIN || y > YEAR_TOP) return formError(`Разбор считается для годов рождения с ${YEAR_MIN} по ${YEAR_TOP}: ${who}`);
  return [y, m, d];
}

function readForm() {
  const h = readDate('f', 'твоя дата рождения');
  if (!h) return null;
  const b = readDate('g', 'его дата рождения');
  if (!b) return null;
  const pr = pairOf(h, b);
  if (!pr) { formError('Такой даты нет в календаре. Проверь день и месяц'); return null; }
  formError('');
  return { h, b, sh: pr.sh, sm: pr.sm };
}

/* ---------- бесплатная часть ---------- */

// стык знаков: человек родился в день перехода Солнца, без времени рождения знак не определить. who - 'her' | 'him'
function cuspBlock(id, z, sign, who, onPick) {
  const box = $(id);
  if (z.cusp === null || z.cusp === undefined) { box.hidden = true; return; }
  box.hidden = false;
  const [a, b] = (z.sign + 1) % 12 === z.cusp ? [z.sign, z.cusp] : [z.cusp, z.sign];
  box.querySelector('.cusp-t').textContent = who === 'her'
    ? `Ты родилась на стыке ${SIGNS_GEN[a]} и ${SIGNS_GEN[b]}. По Москве в полдень это ${SIGNS[z.sign]}. Если родилась ночью или рано утром, посмотри и второй знак`
    : `Он родился на стыке ${SIGNS_GEN[a]} и ${SIGNS_GEN[b]}. По Москве в полдень это ${SIGNS[z.sign]}. Если знаешь, что он родился ночью или рано утром, посмотри и второй знак`;
  const btns = box.querySelector('.cusp-btns');
  btns.innerHTML = '';
  for (const s of [z.sign, z.cusp]) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = SIGNS[s];
    el.setAttribute('aria-pressed', String(s === sign));
    el.addEventListener('click', () => onPick(s));
    btns.append(el);
  }
}

const relKey = sc => sc.animals;
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

// шапка пары: процент, ярлык, кто есть кто
function head(prefix, pr, sc) {
  $(prefix + '-score').textContent = sc.score;
  $(prefix + '-tier').textContent = sc.tier;
  $(prefix + '-score-box').style.setProperty('--p', sc.score);
  const hc = pr.hp.chinese, mc = pr.mp.chinese;
  $(prefix + '-her').textContent = `${SIGNS[pr.sh]} · ${animalTitle(hc.animal, hc.element)}`;
  $(prefix + '-him').textContent = `${SIGNS[pr.sm]} · ${animalTitle(mc.animal, mc.element)}`;
}

async function renderFree() {
  const pr = pairOf(state.h, state.b, state.sh, state.sm);
  const sc = pairScore(pr.hp, pr.mp, pr.sh, pr.sm);
  head('r', pr, sc);
  cuspBlock('r-cusp-her', pr.hp.zodiac, pr.sh, 'her', s => { state.sh = s; renderFree(); });
  cuspBlock('r-cusp-him', pr.mp.zodiac, pr.sm, 'him', s => { state.sm = s; renderFree(); });
  $('r-lock-he').textContent = `Какой он в любви: чего ждёт мужчина-${SIGNS[pr.sm]} и что он не прощает`;
  $('pay').disabled = true;
  let FREE;
  try { FREE = await loadFree(); } catch {
    $('r-free').innerHTML = md('**Не получилось загрузить текст.** Проверь интернет и нажми кнопку ещё раз');
    return;
  }
  const f = FREE.pairs[pairIndex(pr.sh, pr.sm)];
  const v = { ty: ANIMALS[pr.hp.chinese.animal], on: ANIMALS[pr.mp.chinese.animal], ty_gen: ANIMAL_GEN[pr.hp.chinese.animal] };
  $('r-free').innerHTML = md(f.free);
  $('r-strast').textContent = f.strast;
  $('r-east').innerHTML = md(fill(FREE.animals[relKey(sc)], v));
  $('pay').disabled = false;
  vpnStep(null);
}

function showResult() {
  $('full').hidden = true;
  $('result').hidden = false;
  renderFree();
  checkKassa();
  $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* ---------- оплата ---------- */

function payError(msg) {
  const e = $('pay-err');
  e.textContent = msg;
  e.hidden = !msg;
}

/* Открывается ли касса с этого телефона (как у 2027, 26.10): через часть VPN форма кассы висит белым экраном.
   Страница сама стучится в кассу в фоне, пока человек читает бесплатную часть. Нет ответа за 4 с = не открывается */
const KASSA_PING = 'https://ivanloginov.payform.ru/favicon.ico';
const KASSA_WAIT = 4000;
let kassaCheck = null, kassaUp = null;
function checkKassa() {
  if (kassaCheck && kassaUp !== false) return kassaCheck;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), KASSA_WAIT);
  kassaUp = null;
  kassaCheck = fetch(`${KASSA_PING}?t=${Date.now()}`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
    .then(() => true, () => false)
    .then(ok => { clearTimeout(t); kassaUp = ok; return ok; });
  return kassaCheck;
}

function vpnStep(url) {
  $('vpn-step').hidden = !url;
  $('pay').hidden = !!url;
  $('vpn-note').hidden = !!url;
  if (url) {
    $('vpn-go').href = url;
    $('vpn-step').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

const ymd = ([y, m, d]) => ({ y, m, d });

async function pay() {
  const btn = $('pay');
  track('pay');
  btn.disabled = true;
  btn.textContent = 'Открываю оплату…';
  payError('');
  try {
    const kassa = kassaCheck || checkKassa();
    const r = await fetch(API + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ h: ymd(state.h), b: ymd(state.b), sh: state.sh, sm: state.sm }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.url) {
      store.set('vsn.order', { order: b.order, k: b.k, at: Date.now() });
      if (!(await kassa)) {
        btn.disabled = false;
        btn.textContent = PRICE_LABEL;
        vpnStep(b.url);
        track('block');
        return;
      }
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

async function openFull(order, k, { tries = 0, quiet = false } = {}) {
  if (!quiet) {
    $('result').hidden = true;
    $('full').hidden = false;
    if (tries === 0) {
      fullWait('Открываю ваш разбор…');
      $('full').scrollIntoView();
    }
  }
  let r, b;
  try {
    r = await fetch(API + '/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, k }) });
    b = await r.json().catch(() => ({}));
  } catch {
    if (!quiet) fullWait('Нет связи. Проверь интернет и обнови страницу');
    return;
  }
  if (r.status === 202) {
    if (quiet) return;
    if (tries < 40) {
      fullWait('Оплата прошла, касса подтверждает платёж. Разбор откроется здесь сам через несколько секунд');
      setTimeout(() => openFull(order, k, { tries: tries + 1 }), 2500);
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
  const pr = pairOf(b.h, b.b, b.sh, b.sm);
  head('full', pr, b);
  $('full-md').innerHTML = md(b.md);
  $('full-save').hidden = false;
  track('full');
  if (quiet) $('full').scrollIntoView();
}

/* ---------- старт ---------- */

$('form').addEventListener('submit', e => {
  e.preventDefault();
  const s = readForm();
  if (!s) return;
  state = s;
  store.set('vsn.dates', { h: s.h, b: s.b });
  showResult();
  track('date', pairIndex(s.sh, s.sm));
});
$('pay').addEventListener('click', pay);
$('vpn-go').addEventListener('click', () => track('vpngo'));
for (const id of ['again', 'full-again']) {
  $(id).addEventListener('click', () => {
    $('result').hidden = true;
    $('full').hidden = true;
    window.scrollTo(0, 0);
    $('g-d').focus();
  });
}

const saved = store.get('vsn.dates');
if (saved && Array.isArray(saved.h) && Array.isArray(saved.b)) {
  for (const [p, v] of [['f', saved.h], ['g', saved.b]]) {
    $(p + '-y').value = v[0];
    $(p + '-m').value = String(v[1]);
    $(p + '-d').value = v[2];
  }
}
const claim = new URLSearchParams(location.search).get('claim');
if (claim && /^p[\w-]{4,40}\.[\w-]{8,64}$/.test(claim)) {
  const [order, k] = claim.split('.');
  store.set('vsn.order', { order, k, at: Date.now() });
  history.replaceState(null, '', location.pathname);
  openFull(order, k);
} else {
  const o = store.get('vsn.order');
  if (o && o.order && o.k) openFull(o.order, o.k, { quiet: true });
}
const loaded = () => setTimeout(() => {
  if (!claim) track('open');   // возврат с кассы по личной ссылке - не новый человек
  loadFree().catch(() => {});  // тексты в фоне, чтобы после кнопки всё было сразу
}, 0);
if (document.readyState === 'complete') loaded(); else addEventListener('load', loaded, { once: true });
