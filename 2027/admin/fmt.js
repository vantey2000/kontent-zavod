// Форматы админки «Твой 2027»: даты по Москве, рубли, проценты, экранирование, поле ссылки
export const MSK = 3 * 3600e3, DAY = 864e5;
export const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
const WITH = ['Овном', 'Тельцом', 'Близнецами', 'Раком', 'Львом', 'Девой', 'Весами', 'Скорпионом', 'Стрельцом', 'Козерогом', 'Водолеем', 'Рыбами'];
export const withSign = name => WITH[SIGNS.indexOf(name)] || name;   // «стык с Раком»
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const SRC = { ig: 'Instagram', direct: 'без метки', other: 'другое', yt: 'YouTube', vk: 'VK', tg: 'Telegram' };
export const VIA = { kassa: 'оплачено', gift: 'подарок', manual: 'открыт вручную' };
// сеть по стране адреса (api/orders.js netZ): у шагов кроме даты z = сеть, у заказа net. -1 = шаг или заказ до учёта страны (26.10)
export const NETS = [[0, 'из России'], [1, 'с VPN'], [2, 'из СНГ'], [-1, 'до учёта страны']];

let regions = null;
export function land(cc) {
  try { regions = regions || new Intl.DisplayNames(['ru'], { type: 'region' }); return regions.of(cc) || cc; } catch { return cc; }
}

export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rub = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
export const mskDay = ms => new Date(ms + MSK).toISOString().slice(0, 10);
export const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '-');
export const bday = o => String(o.d).padStart(2, '0') + '.' + String(o.m).padStart(2, '0') + '.' + o.y;

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
