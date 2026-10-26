// Админка «Анти-Кортизола» ivan-loginov.ru/admin/kortizol/ (26.10.2026): оплата вкл/выкл, путь человека по дням, оплаты.
// Данные - kortizol-api /api/stats
import { byId, isOwn, $, esc, rub, mskDay, pct, d, dDay, time, show, money, store, api, keyFromHash, DAY } from '../lib.js';

const P = byId('kz');
const TIER = { start: 'Старт', opt: 'Оптимум', prem: 'Премиум' };
const STEPS = [['visit', 'Зашли'], ['quiz', 'Тест'], ['tier', 'Тариф'], ['order', 'Заказ'], ['paid', 'Оплата']];
let loadedAt = 0, loading = false;

keyFromHash(P);
addEventListener('hashchange', () => { if (keyFromHash(P)) start(); });

async function load() {
  if (loading) return;
  loading = true;
  show('apperr', ''); $('loaded').textContent = 'загружаю…';
  try {
    render(await api(P, '/api/stats'));
    $('loaded').textContent = 'обновлено ' + time(Date.now()) + ' · время московское';
  } catch (e) {
    if (e.auth) { store.set(P.store, ''); showLogin('Ключ не подошёл'); }
    else { show('apperr', 'Не получилось загрузить: ' + e.message); $('loaded').textContent = 'не загрузилось'; }
  } finally { loading = false; loadedAt = Date.now(); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('app').hidden && Date.now() - loadedAt > 60e3) load(); });

function render(j) {
  const now = Date.now(), week = mskDay(now - 6 * DAY), today = mskDay(now);
  $('sell').hidden = false;
  $('sell').className = 'banner' + (j.sell ? ' ok' : '');
  $('sell').textContent = j.sell ? 'Оплата включена: касса принимает деньги' : 'Оплата выключена: продажи не начаты, кнопка оплаты на странице не работает';
  const D = j.days || [], n = (ev, from) => D.filter(r => r.ev === ev && r.d >= from).reduce((a, r) => a + r.n, 0);
  const P2 = (j.pays || []).map(p => ({ ...p, own: isOwn(p.email) })), live = P2.filter(p => !p.own), m = money(live, now);
  $('cards').innerHTML = [
    [n('visit', today), 'зашли сегодня', 'за 7 дней ' + n('visit', week)],
    [n('quiz', week), 'прошли тест за 7 дней', pct(n('quiz', week), n('visit', week)) + ' от зашедших'],
    [n('order', week), 'ушли на оплату за 7 дней'],
    [live.length, 'купили всего', 'сегодня ' + live.filter(p => mskDay(p.at) === today).length, 1],
    [rub(m.month), 'выручка за месяц', 'сегодня ' + rub(m.today), 1],
    [rub(m.total), 'выручка всего']
  ].map(c => '<div class="card' + (c[3] ? ' hot' : '') + '"><b>' + esc(c[0]) + '</b><span>' + c[1] + '</span>' + (c[2] ? '<em>' + esc(c[2]) + '</em>' : '') + '</div>').join('');

  const by = {};
  D.forEach(r => { (by[r.d] = by[r.d] || {})[r.ev] = (by[r.d][r.ev] || 0) + r.n; });
  $('byday').innerHTML = '<tr><th>День</th>' + STEPS.map(s => '<th class="n">' + s[1] + '</th>').join('') + '</tr>'
    + (Object.keys(by).sort().reverse().map(k => '<tr><td class="day">' + dDay(k) + '</td>' + STEPS.map(s => '<td class="n">' + (by[k][s[0]] || 0) + '</td>').join('') + '</tr>').join('')
      || '<tr><td colspan="6" class="hint">За 30 дней событий нет</td></tr>');
  $('paylist').innerHTML = '<tr><th>Дата</th><th>Тариф</th><th>Почта</th><th class="n">Сумма</th></tr>'
    + (P2.map(p => '<tr><td class="day">' + d(p.at) + '</td><td>' + esc(TIER[p.tier] || p.tier) + '</td><td>' + esc(p.email) + (p.own ? ' <span class="own">свой</span>' : '') + '</td><td class="n">' + rub(p.sum) + '</td></tr>').join('')
      || '<tr><td colspan="4" class="hint">Оплат пока нет</td></tr>');
}

$('reload').onclick = load;
$('logout').onclick = () => { store.set(P.store, ''); showLogin(''); };
$('keysave').onclick = () => { const k = $('keyin').value.trim(); if (!k) return; store.set(P.store, k); start(); };
$('keyin').addEventListener('keydown', e => { if (e.key === 'Enter') $('keysave').click(); });

function showLogin(msg) { $('app').hidden = true; $('login').hidden = false; show('loginerr', msg); }
function start() { if (!store.get(P.store)) return showLogin(''); $('login').hidden = true; $('app').hidden = false; load(); }
start();
