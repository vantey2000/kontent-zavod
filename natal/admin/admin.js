// Админка «Твоя натальная карта» ivan-loginov.ru/natal/admin/ (26.10.2026). Образец - админка «Твой 2027»:
// ключ приходит один раз ссылкой ...admin/#k=ключ, запоминается на телефоне и убирается из адреса.
// Данные - natal-api /api/admin/overview, действия - /api/admin/link, /open, /gift (api/admin.js)
import { $, show, esc, linkBox, MONTHS } from './fmt.js';
import { renderAll, renderBuyers, renderOrders, renderFunnel, orders } from './view.js';
import { makeIndex, searchCities, normName } from '../cities.js';
import { YEAR_MIN } from '../labels.js';

const API = 'https://natal-api.aivan-loginov.workers.dev';
const STORE = 'nat_admin';
const S = { data: null, own: false, q: '', ofilter: 'all', period: 7, links: {}, opened: new Set() };
let KEY = '';

const save = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } };
function keyFromHash() {
  const m = location.hash.match(/k=([A-Za-z0-9_-]{16,})/);
  if (!m) return false;
  KEY = m[1];
  save(STORE, KEY);
  history.replaceState(null, '', location.pathname);
  return true;
}
keyFromHash();
if (!KEY) { try { KEY = localStorage.getItem(STORE) || ''; } catch { /* нет хранилища */ } }
addEventListener('hashchange', () => { if (keyFromHash()) start(); });

async function api(path, body) {
  const opts = { cache: 'no-store', headers: { 'X-Admin-Key': KEY } };
  if (body) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(API + path, opts);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* не JSON */ }
  if (r.status !== 200) throw Object.assign(new Error((j && j.error) || t || 'ошибка ' + r.status), { status: r.status });
  return j;
}

// телефон возвращает вкладку из памяти без перезагрузки: при возврате данные старше минуты подтягиваются сами
let loading = false, loadedAt = 0;
async function load() {
  if (loading) return;
  loading = true;
  show('apperr', ''); $('loaded').textContent = 'загружаю…';
  try {
    S.data = await api('/api/admin/overview');
    // этот телефон - Ивана: страница /natal/ с него шаги в воронку не шлёт (main.js читает nat.own через JSON.parse)
    save('nat.own', 'true');
    renderAll(S);
    $('loaded').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' · всё время в админке московское';
  } catch (e) {
    if (e.status === 403) { save(STORE, null); KEY = ''; showLogin('Ключ не подошёл'); }
    else { show('apperr', 'Не получилось загрузить: ' + e.message); $('loaded').textContent = 'не загрузилось'; }
  } finally { loading = false; loadedAt = Date.now(); }
}
const fresh = () => { if (KEY && !$('app').hidden && Date.now() - loadedAt > 60e3) load(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fresh(); });
addEventListener('pageshow', e => { if (e.persisted) fresh(); });

/* строки покупателей и заказов: раскрыть, ссылка на разбор, открыть вручную */
async function onRow(e) {
  const row = e.target.closest('.row');
  if (!row || e.target.closest('[data-copy], a, input')) return;
  const id = row.dataset.o, b = e.target.closest('[data-a]');
  if (!b) {
    if (!e.target.closest('.h')) return;
    S.opened.has(id) ? S.opened.delete(id) : S.opened.add(id);
    row.classList.toggle('open', S.opened.has(id));
    row.querySelector('.h').setAttribute('aria-expanded', S.opened.has(id));
    return;
  }
  const out = row.querySelector('.lout');
  try {
    b.disabled = true;
    if (b.dataset.a === 'link') {
      S.links[id] = (await api('/api/admin/link', { order: id })).url;
    } else {
      if (!confirm('Открыть этот заказ без оплаты? Разбор откроется на телефоне человека сам, а тебе будет ссылка для него. Деньги сначала проверь в кабинете кассы')) { b.disabled = false; return; }
      const note = (row.querySelector('[data-note]') || {}).value || '';
      S.links[id] = (await api('/api/admin/open', { order: id, note })).url;
      const o = orders(S).find(x => x.id === id);
      if (o) { o.paid = { at: Date.now(), sum: 0, email: '', via: 'manual' }; o.note = note.replace(/\s+/g, ' ').trim().slice(0, 80); }
      S.ofilter = 'all';   // в «ждут оплаты» открытого заказа уже нет, а ссылка для человека должна остаться на экране
    }
    renderAll(S);
  } catch (ex) { b.disabled = false; out.innerHTML = '<div class="err">Не получилось: ' + esc(ex.message) + '</div>'; }
}
$('buyers').addEventListener('click', onRow);
$('orders').addEventListener('click', onRow);

document.addEventListener('click', async e => {
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  const box = c.closest('.linkout'), inp = box.querySelector('input'), said = box.nextElementSibling;
  try { await navigator.clipboard.writeText(inp.value); said.textContent = 'Скопировано. Отправь человеку в личку'; }
  catch { inp.focus(); inp.select(); said.textContent = 'Выделил ссылку: нажми «Скопировать» в меню телефона'; }
});

/* город рождения для подарка: справочник страницы ../cities.json грузится при первом касании поля */
let cindex = null, cload = null, picked = null, hits = [];
const loadCities = () => cload || (cload = fetch('../cities.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(d => (cindex = makeIndex(d))).catch(() => { cload = null; show('gerr', 'Справочник городов не загрузился. Проверь связь и начни вводить город заново'); }));
const cityLabel = c => (c.region && c.region !== c.name ? c.name + ', ' + c.region : c.name);
function showCities() {
  const ul = $('gclist');
  ul.innerHTML = hits.map((c, i) => '<li><button type="button" data-i="' + i + '"><b>' + esc(c.name) + '</b>'
    + (c.region && c.region !== c.name ? '<span>' + esc(c.region) + '</span>' : '') + (c.via ? '<span>было: ' + esc(c.via) + '</span>' : '') + '</button></li>').join('');
  ul.hidden = !hits.length;
}
function setCity(c) {
  picked = c || null;
  $('gcity').value = c ? cityLabel(c) : '';
  hits = [];
  showCities();
  show('gpicked', c ? 'координаты ' + c.lat + ', ' + c.lon + ' · пояс ' + c.tz : '');
  if (c) show('gerr', '');   // старая ошибка «выбери город» не должна висеть над выбранным городом
}
$('gcity').addEventListener('focus', loadCities, { once: true });
$('gcity').addEventListener('input', async () => {
  picked = null; show('gpicked', '');
  const q = $('gcity').value;
  if (!cindex) await loadCities();
  if (!cindex || q !== $('gcity').value) return;   // пока грузилось, дописали: искать по новому тексту
  hits = searchCities(cindex, q, 7);
  showCities();
});
$('gcity').addEventListener('keydown', e => { if (e.key === 'Enter' && hits.length && !picked) { e.preventDefault(); setCity(hits[0]); } });
$('gclist').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) setCity(hits[+b.dataset.i]); });
document.addEventListener('click', e => { if (hits.length && !e.target.closest('.cityw')) { hits = []; showCities(); } });
$('gnotime').addEventListener('change', () => { $('gt').disabled = $('gnotime').checked; if ($('gnotime').checked) $('gt').value = ''; });

/* подарочный разбор: дата, время или «время неизвестно» (hh = null), город из справочника */
$('gm').innerHTML = '<option value="">Месяц</option>' + MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
async function giftBody() {
  const dd = $('gd').value.trim(), mm = +$('gm').value, yy = $('gy').value.trim(), maxY = new Date().getFullYear();
  if (!/^\d{1,2}$/.test(dd) || +dd < 1 || +dd > 31 || !mm || !/^\d{4}$/.test(yy)) return 'Проверь дату: день, месяц и год четырьмя цифрами';
  if (+yy < YEAR_MIN || +yy > maxY) return 'Год рождения - с ' + YEAR_MIN + ' по ' + maxY;
  if (+dd > new Date(Date.UTC(+yy, mm, 0)).getUTCDate()) return 'Такой даты нет в календаре. Проверь день и месяц';
  let hh = null, mi = null;
  if (!$('gnotime').checked) {
    const t = /^(\d{1,2}):(\d{2})/.exec($('gt').value);
    if (!t) return 'Укажи время рождения или отметь «время неизвестно»';
    hh = +t[1]; mi = +t[2];
  }
  if (!picked && $('gcity').value.trim()) {
    // город вписан руками без выбора из подсказки: берём, только если название совпало точно
    if (!cindex) await loadCities();
    const typed = normName($('gcity').value.split(',')[0]);
    const exact = cindex ? searchCities(cindex, typed, 1).filter(c => normName(c.name) === typed || normName(c.via || '') === typed) : [];
    if (exact.length) setCity(exact[0]);
  }
  if (!picked) return 'Начни вводить город рождения и выбери его в подсказке под полем';
  return { y: +yy, m: mm, d: +dd, hh, mi, lat: picked.lat, lon: picked.lon, tz: picked.tz, city: picked.name, note: $('gnote').value };
}
$('gdo').onclick = async () => {
  show('gerr', ''); $('gout').innerHTML = '';
  $('gdo').disabled = true;
  try {
    const b = await giftBody();
    if (typeof b === 'string') { show('gerr', b); return; }
    const r = await api('/api/admin/gift', b);
    $('gout').innerHTML = '<div class="okmsg">Готово: Солнце - ' + esc(r.signName) + ', ' + esc(b.city) + (b.hh === null ? ', без времени рождения' : '')
      + '. В списке покупателей появится в течение минуты</div>' + linkBox(r.url);
    ['gd', 'gy', 'gm', 'gt', 'gnote'].forEach(id => { $(id).value = ''; });
    $('gnotime').checked = false; $('gt').disabled = false;
    setCity(null);
    setTimeout(load, 65e3);
  } catch (ex) { show('gerr', ex.message); }
  finally { $('gdo').disabled = false; }
};

$('ofilters').addEventListener('click', e => { const f = e.target.closest('[data-f]'); if (!f) return; S.ofilter = f.dataset.f; renderOrders(S); });
$('periods').addEventListener('click', e => {
  const p = e.target.closest('[data-p]'); if (!p) return;
  S.period = +p.dataset.p;
  document.querySelectorAll('#periods .chip').forEach(x => x.classList.toggle('on', x === p));
  renderFunnel(S);
});
$('q').addEventListener('input', () => { S.q = $('q').value; renderBuyers(S); });
$('showown').addEventListener('change', () => { S.own = $('showown').checked; renderAll(S); });
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('section[data-s]').forEach(s => { s.hidden = s.dataset.s !== b.dataset.t; });
});
$('reload').onclick = load;
$('logout').onclick = () => { save(STORE, null); KEY = ''; showLogin(''); };
$('keysave').onclick = () => { const k = $('keyin').value.trim(); if (!k) return; KEY = k; save(STORE, k); start(); };
$('keyin').addEventListener('keydown', e => { if (e.key === 'Enter') $('keysave').click(); });

function showLogin(msg) { $('app').hidden = true; $('login').hidden = false; show('loginerr', msg); }
function start() { if (!KEY) return showLogin(''); $('login').hidden = true; $('app').hidden = false; load(); }
start();
