// Общая админка ivan-loginov.ru/admin/ (26.10.2026): сводка денег по всем продуктам + админка каждого продукта во вкладке.
// Вход одной ссылкой ...admin/#g27=…&kb=…&sk=…&uq=…&kz=…: ключи кладутся под имена админок продуктов, и встроенные админки входят сами
import { PRODUCTS, byId, isOwn, $, esc, rub, mskDay, time, money, store, api, DAY } from './lib.js';

const KEY_RE = /^[A-Za-z0-9_-]{16,}$/;
function keysFromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  let got = 0;
  for (const p of PRODUCTS) { const v = q.get(p.id); if (v && KEY_RE.test(v)) { store.set(p.store, v); got++; } }
  if (got) history.replaceState(null, '', location.pathname);
  return got;
}
keysFromHash();
store.set('g27.own', '1');   // телефон Ивана: страница гороскопа с него шаги в воронку не шлёт

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
/* цифры продукта: pays [{at, sum}] без своих оплат, facts [[подпись, число]], warn - о чём предупредить */
const LOAD = {
  async g27(p) {
    const j = await api(p, '/api/admin/overview'), O = j.orders || [], now = Date.now();
    const pays = O.filter(o => o.paid && o.paid.via === 'kassa' && !o.own).map(o => ({ at: o.paid.at, sum: o.paid.sum }));
    const started = O.filter(o => now - o.at <= 3 * DAY && (!o.paid || o.paid.via === 'kassa')).length;
    return { pays, facts: [['купили', pays.length], ['начали оплату за 3 дня', started]],
      warn: !j.sell ? 'оплата выключена' : !j.lastNotify ? 'касса ещё не присылала уведомлений' : '' };
  },
  async kb(p) {
    let rows = [], cur = '', n = 0;
    do {   // сервер отдаёт кабинеты страницами, как в админке конструктора
      const j = await api(p, '/api/admin/overview' + (cur ? '?cursor=' + encodeURIComponent(cur) : ''));
      rows = rows.concat(j.rows || []); cur = j.next; n++;
    } while (cur && n < 200);
    const R = rows.filter(r => !r.test), st = s => R.filter(r => r.status === s).length;
    return { pays: R.flatMap(r => r.pays || []), facts: [['платят', st('paying')], ['отменили, доступ идёт', st('cancelled')], ['кабинетов', R.filter(r => r.cabinet).length]] };
  },
  async sk(p) {
    const j = await api(p, '/api/admin/overview'), U = (j.users || []).filter(u => !u.own), st = s => U.filter(u => u.status === s).length;
    return { pays: U.flatMap(u => u.pays || []), facts: [['платят помесячно', st('paying')], ['купили навсегда', st('life')], ['отменили', st('cancelled')]] };
  },
  async uq(p) {
    const j = await api(p, '/admin/list', { body: {} }), U = j.use || [], now = Date.now();
    const today = mskDay(now), week = mskDay(now - 6 * DAY);
    const subs = (j.subs || []).filter(s => !isOwn(s.email));
    return { pays: subs.flatMap(s => s.pays || []),
      facts: [['пользовались сегодня, раз', sum(U.filter(u => u.day === today), u => u.n)], ['за 7 дней', sum(U.filter(u => u.day >= week), u => u.n)], ['аккаунтов', j.total || 0]],
      warn: j.mode === 'open' ? 'тестовые дни: открыто всем бесплатно, оплата не берётся' : '' };
  },
  async kz(p) {
    const j = await api(p, '/api/stats'), today = mskDay(Date.now());
    const pays = (j.pays || []).filter(x => !isOwn(x.email)).map(x => ({ at: x.at, sum: x.sum }));
    return { pays, facts: [['зашли сегодня', sum((j.days || []).filter(r => r.d === today && r.ev === 'visit'), r => r.n)], ['купили', pays.length]],
      warn: !j.sell ? 'оплата выключена, продажи не начаты' : '' };
  }
};

const S = {};   // id -> {data?, err?, auth?, nokey?, loading?}
let loadedAt = 0, tab = 'sum';

async function loadOne(p) {
  if (!store.get(p.store)) { S[p.id] = { nokey: true }; return render(); }
  S[p.id] = { ...S[p.id], loading: true, nokey: false };
  render();
  try { S[p.id] = { data: await LOAD[p.id](p) }; }
  catch (e) {
    if (e.auth) store.set(p.store, '');   // как в админках продуктов: чужой ключ забываем и просим новый
    S[p.id] = { err: e.message, auth: !!e.auth };
  }
  render();
}
async function loadAll() {
  $('loaded').textContent = 'загружаю…';
  await Promise.all(PRODUCTS.map(loadOne));
  loadedAt = Date.now();
  $('loaded').textContent = 'обновлено ' + time(loadedAt) + ' мск';
}

const m3 = (m, cls = '') => '<div class="m3' + cls + '"><div><b>' + rub(m.today) + '</b><span>сегодня</span></div><div><b>' + rub(m.month) + '</b><span>за месяц</span></div><div><b>' + rub(m.total) + '</b><span>всего</span></div></div>';
const keyIn = p => '<div class="keyin"><input type="password" data-key="' + p.id + '" placeholder="ключ" autocomplete="off" aria-label="Ключ: ' + esc(p.name) + '"><button class="btn sm" data-save="' + p.id + '">Сохранить</button></div>';

function card(p, s) {
  let body;
  if (s.nokey) body = '<div class="st warn">На этом телефоне нет ключа. Открой ссылку входа из Telegram или вставь ключ</div>' + keyIn(p);
  else if (s.err) body = '<div class="st bad">Не загрузилось: ' + esc(s.err) + '</div>' + (s.auth ? keyIn(p) : '');
  else if (!s.data) body = '<div class="m3 skel"><div><b>…</b><span>сегодня</span></div><div><b>…</b><span>за месяц</span></div><div><b>…</b><span>всего</span></div></div>';
  else body = m3(money(s.data.pays)) + '<div class="facts">' + s.data.facts.map(f => '<span>' + esc(f[0]) + ' <b>' + esc(f[1]) + '</b></span>').join('') + '</div>'
    + (s.data.warn ? '<div class="st warn">' + esc(s.data.warn) + '</div>' : '');
  return '<div class="pcard" data-p="' + p.id + '"><div class="ph"><b>' + esc(p.name) + '</b><span>' + esc(p.what) + '</span></div>' + body
    + '<button class="btn ghost sm go" data-open="' + p.id + '">Открыть админку</button></div>';
}

function render() {
  $('cards').innerHTML = PRODUCTS.map(p => card(p, S[p.id] || {})).join('');
  const ok = PRODUCTS.filter(p => S[p.id] && S[p.id].data), miss = PRODUCTS.filter(p => S[p.id] && (S[p.id].err || S[p.id].nokey));
  $('total').innerHTML = m3(money(ok.flatMap(p => S[p.id].data.pays)));
  $('totalhint').textContent = miss.length ? 'Без: ' + miss.map(p => p.name + (S[p.id].nokey ? ' (нет ключа)' : ' (не загрузилось)')).join(', ') : '';
  document.querySelectorAll('#tabs [data-tab] i').forEach(i => {
    const s = S[i.parentNode.dataset.tab] || {};
    i.className = s.err || s.nokey ? 'bad' : s.data ? (s.data.warn ? 'warn' : 'ok') : '';
  });
}

/* вкладки: админка продукта грузится при первом открытии и остаётся живой при переключении */
function openTab(id) {
  const p = byId(id);
  tab = p ? id : 'sum';
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (p && !$('main').querySelector('[data-pane="' + id + '"]')) {
    const pane = document.createElement('section');
    pane.className = 'pane'; pane.dataset.pane = id;
    pane.innerHTML = '<iframe title="Админка: ' + esc(p.name) + '" src="' + esc(p.admin) + '"></iframe>';
    $('main').append(pane);
  }
  document.querySelectorAll('.pane').forEach(x => { x.hidden = x.dataset.pane !== tab; });
  history.replaceState(null, '', location.pathname + (p ? '#' + id : ''));
}

$('tabs').innerHTML += PRODUCTS.map(p => '<button data-tab="' + p.id + '">' + esc(p.tab) + '<i></i></button>').join('');
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });
$('cards').addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) return openTab(o.dataset.open);
  const s = e.target.closest('[data-save]');
  if (!s) return;
  const p = byId(s.dataset.save), v = $('cards').querySelector('[data-key="' + p.id + '"]').value.trim();
  if (!KEY_RE.test(v)) return;
  store.set(p.store, v);
  const fr = $('main').querySelector('[data-pane="' + p.id + '"] iframe');
  if (fr) fr.src = p.admin;
  loadOne(p);
});
$('reload').onclick = () => {
  if (tab === 'sum') return loadAll();
  const fr = $('main').querySelector('[data-pane="' + tab + '"] iframe');
  try { fr.contentWindow.location.reload(); } catch { fr.src = byId(tab).admin; }
};
// ссылку входа открыли в уже открытой вкладке: адрес меняется только после #, страница не перезагружается
addEventListener('hashchange', () => {
  if (!keysFromHash()) return;
  document.querySelectorAll('.pane iframe').forEach(fr => { fr.src = fr.getAttribute('src'); });
  openTab('sum');
  loadAll();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && tab === 'sum' && Date.now() - loadedAt > 60e3) loadAll(); });

openTab((location.hash.match(/^#([a-z0-9]+)$/) || [])[1]);
loadAll();
