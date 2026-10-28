// Админка «Твоего дня» ivan-loginov.ru/admin/den/ (29.10.2026): путь человека по дням, подписчики, оплаты, кто пишет дни.
// Данные - tvoy-den-api /api/admin/overview
import { byId, $, esc, rub, mskDay, pct, d, dDay, time, show, money, store, api, keyFromHash, DAY } from '../lib.js';

const P = byId('td');
const STATUS = { active: 'платит', stopped: 'отменил, доступ идёт', ended: 'подписка закончилась', nopay: 'не оплатил' };
const EV = { paid: 'первая', renewal: 'продление' };
let loadedAt = 0, loading = false;

keyFromHash(P);
addEventListener('hashchange', () => { if (keyFromHash(P)) start(); });

async function load() {
  if (loading) return;
  loading = true;
  show('apperr', ''); $('loaded').textContent = 'загружаю…';
  try {
    render(await api(P, '/api/admin/overview'));
    $('loaded').textContent = 'обновлено ' + time(Date.now()) + ' · время московское';
  } catch (e) {
    if (e.auth) { store.set(P.store, ''); showLogin('Ключ не подошёл'); }
    else { show('apperr', 'Не получилось загрузить: ' + e.message); $('loaded').textContent = 'не загрузилось'; }
  } finally { loading = false; loadedAt = Date.now(); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('app').hidden && Date.now() - loadedAt > 60e3) load(); });

const sumBy = (rows, k, from) => rows.filter(r => r.d >= from).reduce((a, r) => a + (r[k] || 0), 0);

function render(j) {
  const now = Date.now(), today = mskDay(now), week = mskDay(now - 6 * DAY);
  $('sell').hidden = false;
  $('sell').className = 'banner' + (j.sell ? ' ok' : '');
  $('sell').textContent = j.sell ? 'Оплата включена: бот выдаёт кнопку кассы, подписка 490 ₽ в месяц' : 'Оплата выключена: бот пишет, что подписка скоро откроется';
  const B = j.byday || [], C = j.counters || {};
  const live = (j.pays || []).filter(p => !p.own), m = money(live, now);
  $('cards').innerHTML = [
    [sumBy(B, 'visitors', today), 'зашли сегодня', 'за 7 дней ' + sumBy(B, 'visitors', week)],
    [sumBy(B, 'ready', week), 'получили день за 7 дней', pct(sumBy(B, 'ready', week), sumBy(B, 'visitors', week)) + ' от зашедших'],
    [sumBy(B, 'toBot', week), 'перешли в бота за 7 дней', pct(sumBy(B, 'toBot', week), sumBy(B, 'ready', week)) + ' от получивших'],
    [C.active || 0, 'подписчиков сейчас', (C.stopped ? 'из них отменили ' + C.stopped : 'отмен нет'), 1],
    [rub(m.month), 'выручка за месяц', 'сегодня ' + rub(m.today), 1],
    [rub(m.total), 'выручка всего', live.length + ' оплат']
  ].map(c => '<div class="card' + (c[3] ? ' hot' : '') + '"><b>' + esc(c[0]) + '</b><span>' + c[1] + '</span>' + (c[2] ? '<em>' + esc(c[2]) + '</em>' : '') + '</div>').join('');

  $('byday').innerHTML = '<tr><th>День</th><th class="n">Зашли</th><th class="n">Прочли</th><th class="n">Бот</th><th class="n">Оплата</th></tr>'
    + (B.map(r => '<tr><td class="day">' + dDay(r.d) + '</td><td class="n">' + r.visitors + '</td><td class="n">' + r.ready + '</td><td class="n">' + r.toBot + '</td><td class="n">' + r.paid + '</td></tr>').join('')
      || '<tr><td colspan="5" class="hint">За 30 дней заходов нет</td></tr>');

  const S = j.subs || [], name = c => (S.find(s => s.chat === c) || {}).name || 'чат ' + c;
  $('subs').innerHTML = '<tr><th>Имя</th><th>Знак</th><th>Пришёл</th><th>Статус</th></tr>'
    + (S.map(s => '<tr><td>' + esc(s.name || '-') + (s.own ? ' <span class="own">свой</span>' : '') + '</td><td>' + esc(s.sign) + '</td><td class="day">' + d(s.since) + '</td><td>'
      + esc(STATUS[s.status] || s.status) + (s.status === 'active' || s.status === 'stopped' ? ' до ' + esc(d(s.until)) : '') + '</td></tr>').join('')
      || '<tr><td colspan="4" class="hint">В бота пока никто не пришёл</td></tr>');

  $('paylist').innerHTML = '<tr><th>Дата</th><th>Оплата</th><th>Кто</th><th class="n">₽</th></tr>'
    + ((j.pays || []).map(p => '<tr><td class="day">' + d(p.at) + '</td><td>' + esc(EV[p.ev] || p.ev) + '</td><td>' + esc(name(p.chat)) + (p.own ? ' <span class="own">свой</span>' : '') + '</td><td class="n">' + rub(p.sum) + '</td></tr>').join('')
      || '<tr><td colspan="4" class="hint">Оплат пока нет</td></tr>');

  const by = Object.fromEntries((j.by || []).map(r => [r.by, r.c])), q = Object.fromEntries((j.queue || []).map(r => [r.status, r.c])), mo = j.morning || {};
  const src = (j.src || []).filter(r => r.src !== 'test').map(r => (r.src === '-' ? 'без метки' : r.src) + ' ' + r.c).join(', ') || 'нет';
  $('tech').innerHTML = [
    'Дни написал Claude с Мака: <b>' + (by.claude || 0) + '</b>, запасная Gemma: <b>' + (by.gemma || 0) + '</b>. Много Gemma значит, что Мак был выключен или очередь не работала',
    'Утро сегодня: готово <b>' + (mo.c || 0) + '</b>, отправлено <b>' + (mo.sent || 0) + '</b>. Рассылка в 7:00, тексты ставятся в очередь в 3:30',
    'Очередь: ' + (['new', 'taken', 'done', 'failed'].map(k => k + ' ' + (q[k] || 0)).join(', ')) + (q.failed ? '. Есть failed: день не собрался ни у Мака, ни у Gemma' : ''),
    'Откуда пришли: ' + esc(src) + ' (ig - дверь ГОРОСКОП в директе, ig2 - напоминание двери наутро)'
  ].map(x => '<p>' + x + '</p>').join('');
}

$('reload').onclick = load;
$('logout').onclick = () => { store.set(P.store, ''); showLogin(''); };
$('keysave').onclick = () => { const k = $('keyin').value.trim(); if (!k) return; store.set(P.store, k); start(); };
$('keyin').addEventListener('keydown', e => { if (e.key === 'Enter') $('keysave').click(); });

function showLogin(msg) { $('app').hidden = true; $('login').hidden = false; show('loginerr', msg); }
function start() { if (!store.get(P.store)) return showLogin(''); $('login').hidden = true; $('app').hidden = false; load(); }
start();
