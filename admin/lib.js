// Общее для админок ivan-loginov.ru/admin/ (26.10.2026): продукты и их ключи, форматы, запросы с ключом
// Ключ каждого продукта лежит в хранилище телефона под именем, которое читает админка самого продукта,
// поэтому общая страница и встроенные в неё админки входят одним и тем же ключом
export const PRODUCTS = [
  { id: 'g27', tab: 'Гороскоп', name: 'Твой 2027', what: 'разбор года по дате рождения', admin: '/2027/admin/', store: 'g27_admin', api: 'https://goroskop-api.aivan-loginov.workers.dev' },
  { id: 'kb', tab: 'Карусели', name: 'Конструктор каруселей', what: 'подписка 1 500 ₽ в месяц', admin: '/karusel/admin/', store: 'kb_admin', api: 'https://karusel-api.aivan-loginov.workers.dev' },
  { id: 'sk', tab: 'Скорочтение', name: 'Скорочтение', what: 'тренажёр, месяц и навсегда', admin: '/skorochtenie/admin/', store: 'sk_admin', api: 'https://skorochtenie-api.aivan-loginov.workers.dev' },
  { id: 'uq', tab: 'Рилсовая', name: 'Рилсовая', what: 'заголовки и уникализатор рилсов', admin: '/admin/rilsovaya/', store: 'uq_admin', api: 'https://uniq-api.aivan-loginov.workers.dev' },
  { id: 'kz', tab: 'Кортизол', name: 'Анти-Кортизол', what: 'протокол на 21 день', admin: '/admin/kortizol/', store: 'kz_admin', api: 'https://kortizol-api.aivan-loginov.workers.dev' },
  { id: 'vsn', tab: 'Вы с ним', name: 'Вы с ним', what: 'совместимость по двум датам', admin: '/para/admin/', store: 'vsn_admin', api: 'https://para-api.aivan-loginov.workers.dev' },
  { id: 'nat', tab: 'Натальная карта', name: 'Твоя натальная карта', what: 'полный разбор карты, 990 ₽', admin: '/natal/admin/', store: 'nat_admin', api: 'https://natal-api.aivan-loginov.workers.dev' }
];
export const byId = id => PRODUCTS.find(p => p.id === id);

/* свои и тестовые почты: оплаты Ивана для проверки кассы не считаются выручкой (как в админках продуктов) */
const OWN = /^(vantey2000(\+[^@]*)?@gmail\.com|vanteyloginoff@gmail\.com)$|(^|[-.+])e2e|@test\.ru$/i;
export const isOwn = email => OWN.test(String(email || ''));

export const MSK = 3 * 3600e3, DAY = 864e5;
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rub = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
export const mskDay = ms => new Date(ms + MSK).toISOString().slice(0, 10);
export const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '-');
export function d(ms) {
  if (!ms) return '-';
  const o = { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' };
  if (mskDay(ms).slice(0, 4) !== mskDay(Date.now()).slice(0, 4)) o.year = 'numeric';
  return new Date(ms).toLocaleDateString('ru-RU', o);
}
export const time = ms => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
export const dt = ms => d(ms) + ', ' + time(ms);
export const dDay = s => d(Date.parse(s + 'T12:00:00+03:00'));
export function show(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

/* деньги за сегодня, этот месяц и всего по дням Москвы. pays: [{at, sum}] */
export function money(pays, now = Date.now()) {
  const today = mskDay(now), month = today.slice(0, 7);
  const sum = f => pays.filter(f).reduce((a, p) => a + (Number(p.sum) || 0), 0);
  return { today: sum(p => mskDay(p.at) === today), month: sum(p => mskDay(p.at).slice(0, 7) === month), total: sum(() => true), n: pays.length };
}

export const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* приватный режим */ } }
};

/* запрос к серверу продукта с его ключом. 403 = ключ не подошёл (e.auth) */
export async function api(p, path, opts = {}) {
  const headers = { 'X-Admin-Key': store.get(p.store), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(p.api + path, { cache: 'no-store', method: opts.body ? 'POST' : 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* не JSON */ }
  if (r.status === 403) throw Object.assign(new Error('ключ не подошёл'), { auth: true });
  if (r.status !== 200 || !j) throw new Error((j && j.error) || 'сервер ответил ' + r.status);
  return j;
}

/* вход страницы продукта: ключ один раз ссылкой ...#k=ключ, дальше из хранилища */
export function keyFromHash(p) {
  const m = location.hash.match(/k=([A-Za-z0-9_-]{16,})/);
  if (!m) return false;
  store.set(p.store, m[1]);
  history.replaceState(null, '', location.pathname);
  return true;
}
