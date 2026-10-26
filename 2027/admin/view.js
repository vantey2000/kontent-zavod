// Отрисовка админки «Твой 2027». S - состояние из admin.js: {data, own, q, ofilter, period, links, opened}
import { $, esc, rub, mskDay, pct, bday, dt, dDay, dur, show, linkBox, withSign, land, DAY, SIGNS, SRC, VIA, NETS } from './fmt.js';

const vis = S => o => S.own || !o.own;   // свои и тестовые оплаты - по переключателю
export const orders = S => (S.data ? S.data.orders : []).filter(vis(S));
const sold = S => orders(S).filter(o => o.paid && o.paid.via === 'kassa');   // настоящие оплаты кассы
const fromDay = S => mskDay(Date.now() - (S.period - 1) * DAY);

export function renderKassa(S) {
  const D = S.data, n = D.lastNotify;
  const parts = [];
  if (!D.sell) parts.push(['warn', 'Оплата выключена: кнопка на странице пишет «оплата подключается»']);
  if (n) parts.push(['', 'Касса на связи: последнее уведомление ' + dt(n.at)]);
  else parts.push(['warn', 'Касса ещё не присылала уведомлений']);
  $('kassa').innerHTML = parts.map(p => '<span class="kp"><span class="dot ' + p[0] + '"></span>' + esc(p[1]) + '</span>').join('');
}

export function renderCards(S) {
  const now = Date.now(), today = mskDay(now), week = mskDay(now - 6 * DAY);
  const P = sold(S), sum = f => P.filter(f).reduce((a, o) => a + o.paid.sum, 0);
  const isToday = o => mskDay(o.paid.at) === today, inWeek = o => mskDay(o.paid.at) >= week;
  // неоплаченный заказ живёт 3 дня, поэтому долю оплативших честно считать только за 3 дня
  const started = orders(S).filter(o => now - o.at <= 3 * DAY && (!o.paid || o.paid.via === 'kassa'));
  const paid3 = started.filter(o => o.paid).length;
  const ev = (S.data.ev || []).filter(r => r.day >= week), n = (k, z) => ev.filter(r => r.ev === k && (z === undefined || r.z === z)).reduce((a, r) => a + r.n, 0);
  const free = orders(S).filter(o => o.paid && o.paid.via !== 'kassa').length;
  const payNet = NETS.filter(x => x[0] !== 1).map(([z, l]) => [l, n('pay', z)]).filter(x => x[1]).map(x => x[0] + ' ' + x[1]).join(' · ');
  const cells = [
    [P.length, 'купили разбор', 'сегодня ' + P.filter(isToday).length, 1],
    [rub(sum(() => true)), 'выручка всего', 'за 7 дней ' + rub(sum(inWeek)), 1],
    [rub(sum(isToday)), 'выручка сегодня'],
    [paid3 + ' из ' + started.length, 'начали оплату и оплатили', 'за 3 дня · ' + pct(paid3, started.length)],
    [n('open'), 'открыли страницу', 'за 7 дней · ввели дату ' + n('date')],
    [free, 'подарки и открытые вручную', 'без денег'],
    [n('pay', 1) + ' из ' + n('pay'), 'нажали оплату с VPN', 'за 7 дней' + (payNet ? ' · ' + payNet : ''), 1],
    [n('vpngo'), 'с VPN перешли к оплате', 'после подсказки · уже без VPN ' + n('vpngo', 0)]
  ];
  $('cards').innerHTML = cells.map(c => '<div class="card' + (c[3] ? ' hot' : '') + '"><b>' + esc(c[0]) + '</b><span>' + c[1] + '</span>' + (c[2] ? '<em>' + esc(c[2]) + '</em>' : '') + '</div>').join('');
}

function badge(o) {
  const vpn = o.net === 1 ? '<span class="badge b-vpn">VPN</span>' : '';
  if (!o.paid) return '<span>' + vpn + '<span class="badge b-wait">ждёт оплаты</span></span>';
  return '<span>' + vpn + '<span class="badge b-' + esc(o.paid.via) + '">' + (o.paid.via === 'kassa' ? rub(o.paid.sum) : esc(VIA[o.paid.via] || o.paid.via)) + '</span></span>';
}
// страна адреса при заказе: у заказов до 26.10 её нет
const where = o => !o.cc ? '' : o.net === 0 ? 'из России' : (o.net === 1 ? 'с VPN, адрес: ' : 'адрес: ') + land(o.cc);

function rowHtml(S, o, mode) {
  const p = o.paid, meta = [o.signName + ' · ' + o.animal + ' · число ' + o.num, 'дата рождения ' + bday(o)];
  if (o.cuspName) meta.push('стык с ' + withSign(o.cuspName));
  if (mode === 'orders' && !(p && p.via === 'gift')) meta.push('заказ ' + dt(o.at));
  if (where(o)) meta.push(where(o));
  if (p && p.via === 'kassa') meta.push('оплата ' + dt(p.at) + (p.at > o.at ? ', через ' + dur(p.at - o.at) + ' после заказа' : ''));
  else if (p) meta.push('выдан ' + dt(p.at));
  if (o.note) meta.push(o.note);
  if (o.links) meta.push('ссылок из админки: ' + o.links);
  const who = p && p.email ? esc(p.email) + (o.own ? ' <span class="own">свой</span>' : '')
    : p ? (p.via === 'gift' ? 'Подарок' : 'Без почты') : 'Заказ ' + esc(o.id.slice(-6));
  const acts = p ? '<button class="btn sm" data-a="link">Ссылка на разбор</button>'
    : '<input type="text" maxlength="80" data-note placeholder="заметка: почему открываю без оплаты" aria-label="Заметка">'
      + '<button class="btn sm" data-a="open">Открыть вручную</button>';
  return '<div class="row' + (S.opened.has(o.id) ? ' open' : '') + '" data-o="' + esc(o.id) + '"><button class="h" aria-expanded="' + S.opened.has(o.id) + '">'
    + '<div class="l1"><span class="em">' + who + '</span>' + badge(o) + '</div>'
    + '<div class="meta">' + meta.map(m => '<span>' + esc(m) + '</span>').join('') + '</div></button>'
    + '<div class="more"><div class="acts">' + acts + '</div><div class="lout">' + (S.links[o.id] ? linkBox(S.links[o.id]) : '') + '</div></div></div>';
}

export function renderBuyers(S) {
  const q = S.q.trim().toLowerCase();
  const list = orders(S).filter(o => o.paid && (!q || (o.paid.email + ' ' + o.note).toLowerCase().includes(q)))
    .sort((a, b) => b.paid.at - a.paid.at);
  $('buyers').innerHTML = list.map(o => rowHtml(S, o, 'buyers')).join('')
    || '<div class="hint" style="margin-bottom:8px">' + (q ? 'Никого не нашлось' : 'Покупателей пока нет') + '</div>';
}

export function renderOrders(S) {
  const O = orders(S), f = { all: () => true, wait: o => !o.paid, paid: o => !!o.paid, vpn: o => o.net === 1 };
  $('ofilters').innerHTML = [['all', 'все'], ['wait', 'ждут оплаты'], ['paid', 'открыты'], ['vpn', 'с VPN']]
    .map(x => '<button class="chip' + (S.ofilter === x[0] ? ' on' : '') + '" data-f="' + x[0] + '">' + x[1] + ' ' + O.filter(f[x[0]]).length + '</button>').join('');
  $('orders').innerHTML = O.filter(f[S.ofilter]).map(o => rowHtml(S, o, 'orders')).join('') || '<div class="hint" style="margin-bottom:8px">Заказов нет</div>';
  const c = S.data.counters;
  $('ohint').textContent = 'Неоплаченный заказ хранится 3 дня. «Открыть вручную» нужен, если человек оплатил, а разбор не открылся: касса не прислала подтверждение или сумма меньше 490. Деньги сначала проверь в кабинете кассы. '
    + 'Всего с запуска: заказов ' + c.orders + ', оплат кассы ' + c.paid + ' (вместе со своими). Новая оплата появляется в списке в течение минуты';
}

export function renderFunnel(S) {
  show('funerr', S.data.evErr);
  const from = fromDay(S), ev = (S.data.ev || []).filter(r => r.day >= from);
  const sum = (k, f = () => true) => ev.filter(r => r.ev === k && f(r)).reduce((a, r) => a + r.n, 0);
  const P = sold(S).filter(o => mskDay(o.paid.at) >= from);
  // открыли и нажали оплату - с разбивкой по сети: из России, с VPN, из СНГ (учёт страны с 26.10)
  const split = k => NETS.map(([z, l]) => [l, sum(k, r => r.z === z)]).filter(x => x[1]).map(x => x[0] + ' ' + x[1]).join(' · ');
  const steps = [
    ['Открыли страницу', sum('open'), '', split('open')],
    ['Ввели дату и увидели бесплатную часть', sum('date')],
    ['Нажали «Открыть полный разбор»', sum('pay'), '', split('pay')],
    ['Оплатили', P.length, 'pay']
  ];
  const top = steps[0][1] || 1;
  $('steps').innerHTML = steps.map((s, i) => '<div class="step' + (s[2] ? ' ' + s[2] : '') + '"><div class="t"><span>' + s[0] + '</span><b>' + s[1] + '</b></div>'
    + '<div class="bar"><i style="width:' + Math.min(100, s[1] / top * 100).toFixed(1) + '%"></i></div>'
    + '<div class="c">' + (i ? pct(s[1], steps[i - 1][1]) + ' от прошлого шага · ' + pct(s[1], steps[0][1]) + ' от открывших' : 'все, кто открыл') + '</div>'
    + (s[3] ? '<div class="c net">' + esc(s[3]) + '</div>' : '') + '</div>').join('');
  const gifts = orders(S).filter(o => o.paid && o.paid.via !== 'kassa' && mskDay(o.paid.at) >= from).length;
  $('side').innerHTML = '<span>С VPN после подсказки перешли к оплате: <b>' + sum('vpngo') + '</b>, из них уже без VPN <b>' + sum('vpngo', r => r.z === 0) + '</b></span>'
    + '<span>Открыли купленный разбор: <b>' + sum('full') + '</b></span><span>Выручка за срок: <b>' + rub(P.reduce((a, o) => a + o.paid.sum, 0)) + '</b></span>'
    + (gifts ? '<span>Подарки и вручную: <b>' + gifts + '</b></span>' : '');

  const by = (key, f) => { const m = {}; ev.forEach(r => { const k = key(r); if (f && !f(r)) return; (m[k] = m[k] || {})[r.ev] = (m[k][r.ev] || 0) + r.n; }); return m; };
  const g = (o, k) => (o && o[k]) || 0;
  const S1 = by(r => r.src), srcs = Object.keys(S1).sort((a, b) => g(S1[b], 'open') - g(S1[a], 'open'));
  $('bysrc').innerHTML = '<tr><th>Площадка</th><th class="n">Открыли</th><th class="n">Ввели дату</th><th class="n">Нажали оплату</th></tr>'
    + (srcs.map(s => '<tr><td>' + esc(SRC[s] || s) + '</td><td class="n">' + g(S1[s], 'open') + '</td><td class="n">' + g(S1[s], 'date') + '<small>' + pct(g(S1[s], 'date'), g(S1[s], 'open')) + '</small></td><td class="n">' + g(S1[s], 'pay') + '</td></tr>').join('')
      || '<tr><td colspan="4" class="hint">За этот срок шагов нет</td></tr>');

  const Z = by(r => r.z, r => r.ev === 'date' && r.z >= 0), bought = {};
  P.forEach(o => { bought[o.sign] = (bought[o.sign] || 0) + 1; });
  const zs = SIGNS.map((n, i) => i).filter(i => g(Z[i], 'date') || bought[i]).sort((a, b) => g(Z[b], 'date') - g(Z[a], 'date') || (bought[b] || 0) - (bought[a] || 0));
  $('bysign').innerHTML = '<tr><th>Знак</th><th class="n">Ввели дату</th><th class="n">Купили</th></tr>'
    + (zs.map(i => '<tr><td>' + SIGNS[i] + '</td><td class="n">' + g(Z[i], 'date') + '</td><td class="n">' + (bought[i] || 0) + '<small>' + pct(bought[i] || 0, g(Z[i], 'date')) + '</small></td></tr>').join('')
      || '<tr><td colspan="3" class="hint">За этот срок дат нет</td></tr>');

  const D = by(r => r.day);
  P.forEach(o => { const k = mskDay(o.paid.at); (D[k] = D[k] || {}).paid = (D[k].paid || 0) + 1; });
  $('byday').innerHTML = '<tr><th>День</th><th class="n">Открыли</th><th class="n">Дата</th><th class="n">Оплата</th><th class="n">Купили</th></tr>'
    + (Object.keys(D).sort().reverse().map(k => '<tr><td class="day">' + dDay(k) + '</td><td class="n">' + g(D[k], 'open') + '</td><td class="n">' + g(D[k], 'date') + '</td><td class="n">' + g(D[k], 'pay') + '</td><td class="n">' + g(D[k], 'paid') + '</td></tr>').join('')
      || '<tr><td colspan="5" class="hint">За этот срок шагов нет</td></tr>');
}

export const renderAll = S => { renderKassa(S); renderCards(S); renderBuyers(S); renderOrders(S); renderFunnel(S); };
