// Админка «Рилсовой» ivan-loginov.ru/admin/rilsovaya/ (26.10.2026): режим доступа, использование по дням, аккаунты, оплаты, подарки.
// Данные - uniq-api /admin/list, подарок - /admin/grant (те же, что у svodka.sh и grant.sh с Мака)
import { byId, isOwn, $, esc, rub, mskDay, d, dt, dDay, time, show, money, store, api, keyFromHash, DAY } from '../lib.js';

const P = byId('uq');
const KINDS = [['video', 'Видео'], ['link', 'Ссылка'], ['ocr', 'С картинки'], ['uniq', 'Уникализация'], ['voice', 'Лицо']];
let data = null, loadedAt = 0, loading = false;

keyFromHash(P);
addEventListener('hashchange', () => { if (keyFromHash(P)) start(); });

async function load() {
  if (loading) return;
  loading = true;
  show('apperr', ''); $('loaded').textContent = 'загружаю…';
  try {
    data = await api(P, '/admin/list', { body: {} });
    render();
    $('loaded').textContent = 'обновлено ' + time(Date.now()) + ' · время московское';
  } catch (e) {
    if (e.auth) { store.set(P.store, ''); showLogin('Ключ не подошёл'); }
    else { show('apperr', 'Не получилось загрузить: ' + e.message); $('loaded').textContent = 'не загрузилось'; }
  } finally { loading = false; loadedAt = Date.now(); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('app').hidden && Date.now() - loadedAt > 60e3) load(); });

const subs = () => (data.subs || []).map(s => ({ ...s, own: isOwn(s.email) }));
const pays = () => subs().flatMap(s => s.pays.map(p => ({ ...p, email: s.email, own: s.own })));
const status = a => a.forever ? ['навсегда', 'gift'] : a.paid ? [(a.gift ? 'подарок до ' : 'платит до ') + d(a.until), a.gift ? 'gift' : 'ok'] : ['проба ' + a.used + ' из 3', ''];

function render() {
  const now = Date.now(), today = mskDay(now), week = mskDay(now - 6 * DAY), U = data.use || [];
  const n = f => U.filter(f).reduce((a, u) => a + u.n, 0);
  const open = data.mode === 'open';
  $('mode').hidden = false;
  $('mode').className = 'banner' + (open ? '' : ' ok');
  $('mode').textContent = open
    ? 'Тестовые дни: приложение открыто всем, без входа и бесплатно. Людей поэтому не видно, видно, сколько раз пользовались. Платный режим включается обратно по твоему слову'
    : 'Платный режим: после входа через бота 3 бесплатные генерации, дальше подписка';
  const A = data.accounts || [], live = pays().filter(p => !p.own), m = money(live, now);
  $('cards').innerHTML = [
    [n(u => u.day === today), 'раз пользовались сегодня', '', 1],
    [n(u => u.day >= week), 'за 7 дней', 'видео ' + n(u => u.day >= week && u.kind === 'video')],
    [A.length, 'аккаунтов', 'вошли через бота'],
    [A.filter(a => a.paid && !a.gift).length, 'платят сейчас', 'подарков ' + A.filter(a => a.gift || a.forever).length],
    [rub(m.month), 'выручка за месяц', 'сегодня ' + rub(m.today), 1],
    [rub(m.total), 'выручка всего', live.length + ' оплат']
  ].map(c => '<div class="card' + (c[3] ? ' hot' : '') + '"><b>' + esc(c[0]) + '</b><span>' + c[1] + '</span>' + (c[2] ? '<em>' + esc(c[2]) + '</em>' : '') + '</div>').join('');

  // виды работы строками, а не столбцами: на ширине телефона помещаются только 4 столбца
  const kindRow = f => '<td class="n">' + n(u => u.day === today && f(u)) + '</td><td class="n">' + n(u => u.day >= week && f(u)) + '</td><td class="n">' + n(f) + '</td>';
  $('bykind').innerHTML = '<tr><th></th><th class="n">Сегодня</th><th class="n">7 дней</th><th class="n">30 дней</th></tr>'
    + KINDS.map(k => '<tr><td>' + k[1] + '</td>' + kindRow(u => u.kind === k[0]) + '</tr>').join('')
    + '<tr class="tot"><td>Всего</td>' + kindRow(() => true) + '</tr>';
  const by = {};
  U.forEach(u => { (by[u.day] = by[u.day] || {})[u.kind] = (by[u.day][u.kind] || 0) + u.n; });
  const days = Object.keys(by).sort().reverse(), tot = o => KINDS.reduce((a, k) => a + (o[k[0]] || 0), 0);
  $('byday').innerHTML = '<tr><th>День</th><th>Из чего</th><th class="n">Всего</th></tr>'
    + (days.map(k => '<tr><td class="day">' + dDay(k) + '</td><td class="hint" style="margin:0">' + KINDS.filter(x => by[k][x[0]]).map(x => x[1].toLowerCase() + ' ' + by[k][x[0]]).join(' · ') + '</td><td class="n"><b>' + tot(by[k]) + '</b></td></tr>').join('')
      || '<tr><td colspan="3" class="hint">Пока ни одного раза: учёт включён 26 октября</td></tr>');
  renderAccs();
  const L = pays().sort((a, b) => b.at - a.at);
  $('paylist').innerHTML = '<tr><th>Дата</th><th>Почта</th><th class="n">Сумма</th></tr>'
    + (L.map(p => '<tr><td class="day">' + d(p.at) + '</td><td>' + esc(p.email) + (p.own ? ' <span class="own">свой</span>' : '') + '</td><td class="n">' + rub(p.sum) + '</td></tr>').join('')
      || '<tr><td colspan="3" class="hint">Оплат пока нет</td></tr>');
}

function renderAccs() {
  const q = $('q').value.trim().toLowerCase();
  const A = (data.accounts || []).filter(a => !q || [a.name, a.un, a.email, String(a.id)].join(' ').toLowerCase().includes(q));
  $('accs').innerHTML = A.map(a => {
    const [st, cls] = status(a);
    const meta = ['заходил ' + dt(a.seen), 'вошёл впервые ' + d(a.created)];
    if (a.email) meta.push(a.email);
    return '<div class="row" data-id="' + esc(a.id) + '"><button class="h"><div class="l1"><span class="em">' + esc(a.name || 'Без имени') + (a.un ? ' @' + esc(a.un) : '') + '</span>'
      + '<span class="badge ' + cls + '">' + esc(st) + '</span></div><div class="meta">' + meta.map(x => '<span>' + esc(x) + '</span>').join('') + '</div></button>'
      + '<div class="more"><div class="acts"><button class="btn ghost sm" data-g="30">Подарок 30 дней</button><button class="btn ghost sm" data-g="forever">Подарок навсегда</button>'
      + (a.gift || a.forever ? '<button class="btn red sm" data-g="revoke">Забрать подарок</button>' : '') + '</div></div></div>';
  }).join('') || '<div class="hint" style="margin-bottom:8px">' + (q ? 'Никого не нашлось' : 'Аккаунтов пока нет') + '</div>';
}

async function grant(who, what, note) {
  const body = { who, note: note || 'из админки' };
  if (what === 'revoke') body.revoke = true; else if (what === 'forever') body.forever = true; else body.days = +what;
  return api(P, '/admin/grant', { body });
}
$('accs').addEventListener('click', async e => {
  const row = e.target.closest('.row'); if (!row) return;
  const b = e.target.closest('[data-g]');
  if (!b) { if (e.target.closest('.h')) row.classList.toggle('open'); return; }
  const q = { 30: 'Подарить доступ на 30 дней?', forever: 'Подарить доступ навсегда?', revoke: 'Забрать подарок? Оплаченную подписку это не трогает' }[b.dataset.g];
  if (!confirm(q)) return;
  b.disabled = true;
  try { await grant(row.dataset.id, b.dataset.g); await load(); } catch (ex) { b.disabled = false; alert('Не получилось: ' + ex.message); }
});
async function giftForm(what) {
  show('gerr', ''); $('gok').textContent = '';
  const who = $('gwho').value.trim();
  if (!who) return show('gerr', 'Напиши @ник или номер человека в Telegram');
  try {
    const r = await grant(who, what, $('gnote').value.trim());
    $('gok').textContent = (what === 'revoke' ? 'Подарок забран: ' : 'Готово: ') + (r.me.name || who) + (r.me.forever ? ', навсегда' : r.me.paid ? ', доступ до ' + d(r.me.until) : '');
    load();
  } catch (ex) { show('gerr', /такого аккаунта нет/.test(ex.message) ? 'Такого аккаунта нет: человек ещё не входил через бота' : ex.message); }
}
$('gdo').onclick = () => giftForm($('gdays').value);
$('gundo').onclick = () => { if (confirm('Забрать подарок?')) giftForm('revoke'); };

$('q').addEventListener('input', () => data && renderAccs());
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('section[data-s]').forEach(s => { s.hidden = s.dataset.s !== b.dataset.t; });
});
$('reload').onclick = load;
$('logout').onclick = () => { store.set(P.store, ''); showLogin(''); };
$('keysave').onclick = () => { const k = $('keyin').value.trim(); if (!k) return; store.set(P.store, k); start(); };
$('keyin').addEventListener('keydown', e => { if (e.key === 'Enter') $('keysave').click(); });

function showLogin(msg) { $('app').hidden = true; $('login').hidden = false; show('loginerr', msg); }
function start() { if (!store.get(P.store)) return showLogin(''); $('login').hidden = true; $('app').hidden = false; load(); }
start();
