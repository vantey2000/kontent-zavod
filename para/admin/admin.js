// Админка «Вы с ним» ivan-loginov.ru/para/admin/ (26.10.2026). Образец - админка «Твой 2027» /2027/admin/:
// ключ приходит один раз ссылкой ...admin/#k=ключ, запоминается на телефоне и убирается из адреса.
// Данные - para-api /api/admin/overview, действия - /api/admin/link, /open, /gift (api/admin.js)
import { $, esc, show, linkBox, MONTHS, SIGNS, zodiac, isValidDate, withSign, YEAR_MIN, YEAR_MAX } from './fmt.js';
import { renderAll, renderBuyers, renderOrders, renderFunnel, orders } from './view.js';

const API = 'https://para-api.aivan-loginov.workers.dev';
const STORE = 'vsn_admin';
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
    save('vsn.own', '1');   // этот телефон - Ивана: страница /para/ с него шаги в воронку не шлёт
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
      if (!confirm('Открыть этот заказ без оплаты? Разбор пары откроется на телефоне человека сам, а тебе будет ссылка для него. Деньги сначала проверь в кабинете кассы')) { b.disabled = false; return; }
      const note = (row.querySelector('[data-note]') || {}).value || '';
      S.links[id] = (await api('/api/admin/open', { order: id, note })).url;
      const o = orders(S).find(x => x.id === id);
      if (o) { o.paid = { at: Date.now(), sum: 0, email: '', via: 'manual' }; o.note = note.trim().slice(0, 80); }
      S.ofilter = 'all';   // в «ждут оплаты» открытого заказа уже нет, а ссылка для человека должна остаться на экране
    }
    renderAll(S);
  } catch (ex) { b.disabled = false; out.innerHTML = '<div class="err">Не получилось: ' + ex.message.replace(/[<>&]/g, '') + '</div>'; }
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

/* подарочный разбор пары: её дата (h) и его дата (b), как на странице */
const months = '<option value="">Месяц</option>' + MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
$('hm').innerHTML = months; $('bm').innerHTML = months;
const readDate = p => {
  const d = +$(p + 'd').value.trim(), m = +$(p + 'm').value, y = $(p + 'y').value.trim();
  return /^\d{4}$/.test(y) && isValidDate(+y, m, d) ? { y: +y, m, d } : null;
};
// стык знаков: сервер берёт знак по Москве в полдень, как страница до выбора (pair.js pairOf)
const cuspSay = (who, x) => { const z = zodiac(x.y, x.m, x.d); return z.cusp === null ? '' : ', ' + who + ' дата на стыке с ' + withSign(z.cusp) + ' (взят ' + SIGNS[z.sign] + ')'; };
$('gdo').onclick = async () => {
  show('gerr', ''); $('gout').innerHTML = '';
  const h = readDate('h'), b = readDate('b');
  const bad = who => 'Проверь ' + who + ' дату: день, месяц и год четырьмя цифрами, год от ' + YEAR_MIN + ' до ' + YEAR_MAX;
  if (!h) return show('gerr', bad('её'));
  if (!b) return show('gerr', bad('его'));
  $('gdo').disabled = true;
  try {
    const r = await api('/api/admin/gift', { h, b, note: $('gnote').value });
    $('gout').innerHTML = '<div class="okmsg">Готово: ' + esc(r.her + ' + ' + r.him) + esc(cuspSay('её', h) + cuspSay('его', b)) + '. В списке покупателей появится в течение минуты</div>' + linkBox(r.url);
    for (const id of ['hd', 'hm', 'hy', 'bd', 'bm', 'by', 'gnote']) $(id).value = '';
    setTimeout(load, 65e3);
  } catch (ex) { show('gerr', ex.message); }
  $('gdo').disabled = false;
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
