// Страница «Твоя натальная карта» (26.10.2026): данные рождения → бесплатная часть в браузере → оплата → полный разбор с сервера.
// Путь и учёт шагов как у «Твоего 2027» (main.js там): учёт уходит фоном после показа, касса проверяется заранее
import { initForm, readForm, fillForm, loadCities, pickedRegion } from './form.js';
import { renderFree, renderFull } from './render.js';

const API = 'https://natal-api.aivan-loginov.workers.dev';
const PRICE_LABEL = 'Открыть полный разбор - 990 ₽';
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим: просто не запоминаем */ } },
};
const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
let engine = null;
const loadEngine = () => (engine = engine || import('./chart.js'));
let state = null;   // {b: данные рождения, c: карта}

/* ---------- учёт шагов для админки: каждый шаг с телефона один раз, фоном ---------- */
const hashSrc = (/^#([a-z0-9-]{1,16})$/.exec(location.hash) || [])[1];
if (hashSrc && !store.get('nat.src')) store.set('nat.src', hashSrc);
function track(e, z) {
  if (store.get('nat.own')) return;
  const list = Array.isArray(store.get('nat.sent')) ? store.get('nat.sent') : [];
  if (list.includes(e)) return;
  store.set('nat.sent', [...list, e]);
  const s = store.get('nat.src') || hashSrc || 'direct';
  try { navigator.sendBeacon(API + '/e', `e=${e}&s=${s}` + (z === undefined ? '' : `&z=${z}`)); } catch { /* учёт не важнее страницы */ }
}
const show = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; };

/* ---------- касса: открывается ли с этого телефона (через часть VPN форма висит белым экраном) ---------- */
let kassaCheck = null, kassaUp = null;
function checkKassa() {
  if (kassaCheck && kassaUp !== false) return kassaCheck;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  kassaUp = null;
  kassaCheck = fetch(`https://ivanloginov.payform.ru/favicon.ico?t=${Date.now()}`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
    .then(() => true, () => false).then(ok => { clearTimeout(t); kassaUp = ok; return ok; });
  return kassaCheck;
}
function vpnStep(url) {
  $('vpn-step').hidden = !url;
  $('pay').hidden = !!url;
  $('vpn-note').hidden = !!url;
  if (url) { $('vpn-go').href = url; $('vpn-step').scrollIntoView({ block: 'center', behavior: motion() }); }
}

/* ---------- бесплатная часть ---------- */
async function onSubmit(e) {
  e.preventDefault();
  const go = $('f-go');
  go.disabled = true;
  const b = await readForm(msg => show('f-err', msg));
  if (!b) { go.disabled = false; return; }
  const { chart } = await loadEngine();
  const c = chart(b);
  go.disabled = false;
  if (!c) return show('f-err', 'Не получилось построить карту. Проверь дату и время');
  state = { b, c };
  store.set('nat.form', { ...b, region: pickedRegion() });
  $('full').hidden = true;
  $('result').hidden = false;
  renderFree(c, b);
  vpnStep(null);
  checkKassa();
  $('result').scrollIntoView({ behavior: motion() });
  track('date', c.planets.sun.sign);
  if (!c.known) track('notime', c.planets.sun.sign);
}

/* ---------- оплата ---------- */
async function pay() {
  const btn = $('pay');
  track('pay');
  btn.disabled = true;
  btn.textContent = 'Открываю оплату…';
  show('pay-err', '');
  try {
    const kassa = kassaCheck || checkKassa();
    const r = await fetch(API + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.b) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.url) {
      store.set('nat.order', { order: j.order, k: j.k, at: Date.now() });
      if (!(await kassa)) { btn.disabled = false; btn.textContent = PRICE_LABEL; vpnStep(j.url); track('block'); return; }
      location.href = j.url;
      return;
    }
    show('pay-err', j.error || 'Касса не ответила. Попробуй ещё раз через минуту');
  } catch { show('pay-err', 'Нет связи. Проверь интернет и попробуй ещё раз'); }
  btn.disabled = false;
  btn.textContent = PRICE_LABEL;
}

/* ---------- полный разбор ---------- */
async function openFull(order, k, { tries = 0, quiet = false } = {}) {
  if (!quiet) { $('result').hidden = true; $('full').hidden = false; if (!tries) { show('full-wait', 'Открываю твой разбор…'); $('full').scrollIntoView(); } }
  let r, j;
  try {
    r = await fetch(API + '/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, k }) });
    j = await r.json().catch(() => ({}));
  } catch { if (!quiet) show('full-wait', 'Нет связи. Проверь интернет и обнови страницу'); return; }
  if (r.status === 202) {
    if (quiet) return;
    if (tries < 40) { show('full-wait', 'Оплата прошла, касса подтверждает платёж. Разбор откроется здесь сам через несколько секунд'); setTimeout(() => openFull(order, k, { tries: tries + 1 }), 2500); }
    else show('full-wait', 'Касса ещё не прислала подтверждение. Разбор откроется по личной ссылке из письма кассы, обычно это пара минут');
    return;
  }
  if (!r.ok) { if (!quiet) show('full-wait', j.error || 'Не получилось открыть разбор. Напиши в поддержку, откроем вручную'); return; }
  const { chart } = await loadEngine();
  const c = chart(j.birth);
  $('result').hidden = true;
  $('full').hidden = false;
  show('full-wait', '');
  renderFull(c, j.birth, j.md);
  $('full-save').hidden = false;
  track('full');
  if (quiet) $('full').scrollIntoView();
}

/* ---------- старт ---------- */
initForm();
$('form').addEventListener('submit', onSubmit);
$('pay').addEventListener('click', pay);
$('vpn-go').addEventListener('click', () => track('vpngo'));
$('print').addEventListener('click', () => print());
for (const id of ['again', 'full-again']) $(id).addEventListener('click', () => { $('result').hidden = true; $('full').hidden = true; scrollTo(0, 0); $('f-d').focus(); });
const saved = store.get('nat.form');
if (saved) fillForm(saved);
const claim = new URLSearchParams(location.search).get('claim');
if (claim && /^n[\w-]{4,40}\.[\w-]{8,64}$/.test(claim)) {
  const [order, k] = claim.split('.');
  store.set('nat.order', { order, k, at: Date.now() });
  history.replaceState(null, '', location.pathname);
  openFull(order, k);
} else {
  const o = store.get('nat.order');
  if (o && o.order && o.k) openFull(o.order, o.k, { quiet: true });
  const opened = () => setTimeout(() => { track('open'); loadEngine(); loadCities(); }, 1200);
  if (document.readyState === 'complete') opened(); else addEventListener('load', opened, { once: true });
}
