// Форматы админки «Вы с ним»: даты по Москве, рубли, проценты, пара знаков, экранирование, поле ссылки
// Знаки и номер пары берутся из движка страницы (engine.js, pair.js), чтобы админка и страница считали пару одинаково
import { SIGNS, zodiac, isValidDate, YEAR_MIN, YEAR_MAX } from '../engine.js';
import { pairIndex } from '../pair.js';

export { SIGNS, zodiac, isValidDate, YEAR_MIN, YEAR_MAX };
export const MSK = 3 * 3600e3, DAY = 864e5;
const WITH = ['Овном', 'Тельцом', 'Близнецами', 'Раком', 'Львом', 'Девой', 'Весами', 'Скорпионом', 'Стрельцом', 'Козерогом', 'Водолеем', 'Рыбами'];
export const withSign = i => WITH[i] || SIGNS[i];   // «стык с Раком»
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const SRC = { ig: 'Instagram', direct: 'без метки', other: 'другое', yt: 'YouTube', vk: 'VK', tg: 'Telegram' };
export const VIA = { kassa: 'оплачено', gift: 'подарок', manual: 'открыт вручную' };
// сеть по стране адреса (api/orders.js netZ): у шагов кроме даты z = сеть, у заказа net. -1 = сервер страну не увидел
export const NETS = [[0, 'из России'], [1, 'с VPN'], [2, 'из СНГ'], [-1, 'страна не видна']];

// у шага date z - номер пары знаков 0-77 (pair.js pairIndex): обратная таблица номер -> [знак, знак] по порядку зодиака
const PAIRS = [];
for (let a = 0; a < 12; a++) for (let b = a; b < 12; b++) PAIRS[pairIndex(a, b)] = [a, b];
export const pairName = z => (PAIRS[z] ? SIGNS[PAIRS[z][0]] + ' + ' + SIGNS[PAIRS[z][1]] : 'пара ' + z);
// номер пары заказа по её и его знаку: у заказа знаки словами (api/admin.js orderRow)
export const orderPair = o => { const a = SIGNS.indexOf(o.her), b = SIGNS.indexOf(o.him); return a < 0 || b < 0 ? -1 : pairIndex(a, b); };
// «Телец + Скорпион · 76%»: сначала её знак, потом его
export const pairTitle = o => o.her + ' + ' + o.him + ' · ' + o.score + '%';

let regions = null;
export function land(cc) {
  try { regions = regions || new Intl.DisplayNames(['ru'], { type: 'region' }); return regions.of(cc) || cc; } catch { return cc; }
}

export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rub = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
export const mskDay = ms => new Date(ms + MSK).toISOString().slice(0, 10);
export const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '-');
const two = n => String(n).padStart(2, '0');
// дата рождения из заказа: [y, m, d] (так хранит сервер) или {y, m, d}
export const bday = v => { const [y, m, d] = Array.isArray(v) ? v : [v && v.y, v && v.m, v && v.d]; return y ? two(d) + '.' + two(m) + '.' + y : '-'; };

export function d(ms) {
  if (!ms) return '-';
  const o = { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' };
  if (mskDay(ms).slice(0, 4) !== mskDay(Date.now()).slice(0, 4)) o.year = 'numeric';
  return new Date(ms).toLocaleDateString('ru-RU', o);
}
export const dt = ms => d(ms) + ', ' + new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
export const dDay = s => d(Date.parse(s + 'T12:00:00+03:00'));
export const dur = ms => { const m = Math.max(1, Math.round(ms / 60e3)); return m < 60 ? m + ' мин' : m < 48 * 60 ? Math.round(m / 60) + ' ч' : Math.round(m / 1440) + ' дн.'; };

export function show(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

/* поле со ссылкой на разбор: «Скопировать» и «Открыть» (копирование - делегированным кликом в admin.js) */
export const linkBox = url => '<div class="linkout"><input type="text" readonly value="' + esc(url) + '" aria-label="Ссылка на разбор">'
  + '<button class="btn sm" data-copy>Скопировать</button><a class="btn ghost sm" href="' + esc(url) + '" target="_blank" rel="noopener">Открыть</a></div>'
  + '<div class="okmsg" data-said></div>';
