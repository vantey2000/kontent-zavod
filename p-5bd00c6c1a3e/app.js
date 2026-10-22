// Планер: расшифровка данных, тема Telegram, действия через бота. Отрисовка ниже
'use strict';
const BOT = 'aivanpro_bot';
const $ = (s) => document.querySelector(s);
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WDS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('planer.' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('planer.' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
};

let TG = null;
let DATA = null;
let VIEW = store.get('view') || 'today';
let SEL = null;              // выбранный день недели
let scrollNow = true;        // прокрутить «Сегодня» к текущему часу при открытии

// ── Telegram ────────────────────────────────────────────────
function waitTG() {
  return new Promise((res) => {
    let n = 0;
    const t = setInterval(() => {
      const w = window.Telegram && window.Telegram.WebApp;
      if ((w && w.platform && w.platform !== 'unknown') || ++n > 15) { clearInterval(t); res(w && w.platform !== 'unknown' ? w : null); }
    }, 100);
  });
}
function applyTheme() {
  const dark = TG ? TG.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name=theme-color]').content = bg;
  if (TG) { try { TG.setHeaderColor(bg); TG.setBackgroundColor(bg); } catch (e) { /* старый клиент */ } }
}
const canSendData = () => !!(TG && TG.sendData && !(TG.initDataUnsafe && TG.initDataUnsafe.query_id));
function haptic(kind) { try { TG && TG.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { /* нет */ } }

// ── ключ и данные ───────────────────────────────────────────
// Данные лежат в двух местах одним шифротекстом: ящик planer-relay (бот кладёт через секунду после
// правки) и data.json на сайте (выкладка до минуты). Берём оба и показываем более свежий
const RELAY = 'https://planer-relay.aivan-loginov.workers.dev';
function password() {
  const k = new URLSearchParams(location.search).get('k');
  if (k) store.set('k', k);
  return k || store.get('k');
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let KEY = null, KEY_FOR = '', RKEY = '';
async function aesKey(pass, salt) {
  if (KEY && KEY_FOR === pass + '|' + salt) return KEY;            // PBKDF2 тяжёлый: считаем один раз
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  KEY = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(salt), iterations: 310000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  KEY_FOR = pass + '|' + salt;
  return KEY;
}
async function relayKey(pass) {                                     // ключ ящика: пароль туда не уходит
  if (!RKEY) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('planer-relay|' + pass));
    RKEY = Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return RKEY;
}
async function decrypt(blob, pass) {
  const key = await aesKey(pass, blob.salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function fetchBlob(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function lock(text) { $('#lockTxt').textContent = text; $('#lock').classList.add('on'); }
let loading = null;
function load(quiet) { if (!loading) loading = doLoad(quiet).finally(() => { loading = null; }); return loading; }
async function doLoad(quiet) {
  const pass = password();
  if (!pass) return lock('Открой планер кнопкой «📱 Планер» в чате с ботом @' + BOT);
  const tries = await Promise.allSettled([
    fetchBlob(RELAY + '/data?t=' + Date.now(), 6000).then((b) => decrypt(b, pass)),
    fetchBlob('data.json?t=' + Date.now(), 15000).then((b) => decrypt(b, pass)),
  ]);
  const got = tries.filter((x) => x.status === 'fulfilled' && x.value && x.value.updated).map((x) => x.value);
  if (got.length) {
    got.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
    if (!DATA || Date.parse(got[0].updated) >= Date.parse(DATA.updated)) DATA = got[0];
    store.set('cache', DATA);
  } else {
    const site = tries[1].reason;
    if (site && site.name === 'OperationError') return lock('Ключ не подошёл. Открой планер заново кнопкой в чате с ботом');
    DATA = DATA || store.get('cache');
    if (!DATA) return lock('Нет связи с сайтом. Проверь интернет и открой ещё раз');
    if (!quiet) toast('Нет связи, показываю сохранённое');
  }
  render();
}

// ── действия: фоном через ящик, ответ бота станет правдой, а до тех пор отметка живёт здесь ──
// Касание получает номер cid и уходит в очередь outbox. Очередь отправляется в ящик planer-relay
// (Telegram не открывается), нет сети - ждёт и уходит сама. Отметка снимается, когда в данных
// появился cid (бот выполнил). Запасной путь без ящика - прежний: sendData или ссылка на бота
const newCid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const outbox = () => store.get('outbox') || [];
function pending() {
  const list = store.get('pending') || [];
  const acked = new Set((DATA && DATA.acked) || []);
  const upd = DATA ? Date.parse(DATA.updated) : 0;
  const waiting = new Set(outbox().map((x) => x.cid));
  const fresh = list.filter((p) => {
    if (waiting.has(p.cid)) return true;                                    // ещё не ушло в ящик
    if (p.cid && acked.has(p.cid)) return false;                            // бот выполнил
    if (!p.relay && DATA && upd > p.ts) return false;                       // старый путь через Telegram
    return Date.now() - p.ts < 15 * 60e3;                                   // не висеть вечно
  });
  if (fresh.length !== list.length) store.set('pending', fresh);
  return fresh;
}
function send(action) {
  haptic('medium');
  const a = Object.assign({ cid: newCid(), ts: Date.now(), relay: true }, action);
  if (a.op !== 'say') {
    const list = store.get('pending') || [];
    list.push(a);
    store.set('pending', list);
  }
  const box = outbox();
  box.push(a);
  store.set('outbox', box);
  render();
  flush();
}
const actOf = (a) => { const x = Object.assign({}, a); delete x.cid; delete x.ts; delete x.relay; return x; };
let flushing = false, failSince = 0;
async function flush() {
  if (flushing || !outbox().length) return;
  flushing = true;
  try {
    const key = await relayKey(password() || '');
    for (const a of outbox()) {
      let r;
      try {
        r = await fetch(RELAY + '/act', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, keepalive: true,
          body: JSON.stringify({ key, cid: a.cid, act: actOf(a) }) });
      } catch (e) { r = null; }
      if (!r || r.status >= 500) { failSince = failSince || Date.now(); break; }   // нет сети: попробуем позже
      failSince = 0;
      store.set('outbox', outbox().filter((x) => x.cid !== a.cid));
      if (r.status !== 200) {                                                       // ящик не принял: отметку снять
        store.set('pending', (store.get('pending') || []).filter((x) => x.cid !== a.cid));
        toast(r.status === 401 ? 'Ключ ящика не подошёл, открой планер кнопкой в чате' : 'Бот не понял команду');
      }
    }
  } finally { flushing = false; }
  if (DATA) renderHead();
  burst();
}
let burstT = [];
function burst() {                         // бот забирает команду за ~5 секунд: подтянуть свежие данные пару раз
  burstT.forEach(clearTimeout);
  burstT = [3000, 6500, 11000, 20000, 40000].map((ms) => setTimeout(() => { if (pending().length) load(true); }, ms));
}
function legacy(action) {                  // запасной путь: окно закроется или откроется чат с ботом
  if (canSendData()) { TG.sendData(JSON.stringify(action)); return; }
  const p = deepParam(action);
  const url = 'https://t.me/' + BOT + (p ? '?start=' + p : '');
  if (TG) TG.openTelegramLink(url); else location.href = url;
}
function deepParam(a) {
  const op = { done: 'done', cancel: 'del', tmrw: 'tmrw', reopen: 'open', idea_del: 'idel', idea_task: 'itask', remind: 'rem', unremind: 'unrem' }[a.op];
  if (!op) return '';
  let w = '';
  if (a.before) w = '-b' + a.before;
  if (a.at) w = '-a' + a.at.slice(2, 4) + a.at.slice(5, 7) + a.at.slice(8, 10) + a.at.slice(11, 13) + a.at.slice(14, 16);
  if (a.op === 'tmrw' && a.date) w = '-d' + a.date.slice(2, 4) + a.date.slice(5, 7) + a.date.slice(8, 10);
  return op + '-' + a.id + w;
}
const GONE = ['done', 'cancel', 'tmrw', 'idea_del', 'idea_task'];
function alertsOf(e) {
  let list = (e.alerts || []).slice();
  pending().filter((p) => p.id === e.id && (p.op === 'remind' || p.op === 'unremind')).forEach((p) => {
    const al = p.before ? { before: p.before } : { at: p.at };
    const same = (x) => (x.before && x.before === al.before) || (x.at && x.at === al.at);
    list = list.filter((x) => !same(x));
    if (p.op === 'remind') list.push(al);
  });
  return list;
}
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const movedEdit = (p) => p.op === 'edit' && p.start;                       // правка со своим временем: место известно
function overlay(e) {
  let out = e;
  pending().filter((x) => x.id === e.id && x.op === 'edit').forEach((p) => {
    out = Object.assign({}, out, p.title ? { title: p.title } : {}, p.dur ? { dur: p.dur } : {}, { pend: true });
  });
  const p = pending().filter((x) => x.id === e.id && (GONE.includes(x.op) || x.op === 'reopen')).pop();
  if (!p) return out;
  if (p.op === 'done') return Object.assign({}, out, { done: true });
  if (p.op === 'reopen') return Object.assign({}, out, { done: false });
  return null;                                                           // удалено или уехало на завтра
}

// ── мелочи интерфейса ──────────────────────────────────────
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2400); }
function openSheet(html) {
  $('#sheetIn').innerHTML = html; $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
  if (TG) { try { TG.BackButton.show(); } catch (e) { /* нет */ } }
}
function closeSheet() {
  $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on');
  if (TG) { try { TG.BackButton.hide(); } catch (e) { /* нет */ } }
}
function setView(v) {
  VIEW = v; store.set('view', v);
  if (v === 'week') stripAnchor = true;
  if (v === 'today') scrollNow = true;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  window.scrollTo(0, 0);
  if (DATA) render();
}

// ── отрисовка ───────────────────────────────────────────────
const CTX = { focus: 'фокус', admin: 'рутина', call: 'звонок', errand: 'в городе', creative: 'творчество' };
const KIND = { hard: 'точное время', flex: 'гибкое', small: 'мелочь', now: 'на 2 минуты', buy: 'покупка', inbox: 'без даты' };
function localToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayObj(date) { return DATA.days.find((d) => d.date === date); }
function findRaw(id) {
  for (const d of DATA.days) { const e = d.entries.find((x) => x.id === id); if (e) return Object.assign({ date: d.date }, e); }
  for (const n of ['now', 'buy', 'inbox', 'stuck']) { const e = (DATA[n] || []).find((x) => x.id === id); if (e) return Object.assign({ kind: n === 'stuck' ? 'flex' : n }, e); }
  return null;
}
function entries(day) {
  if (!day) return [];
  const moved = new Map();                                     // последняя правка со временем по каждому делу
  pending().filter(movedEdit).forEach((p) => moved.set(p.id, p));
  const list = day.entries.filter((e) => !moved.has(e.id)).map(overlay).filter(Boolean);
  moved.forEach((p) => {
    if (p.date !== day.date) return;
    const src = findRaw(p.id) || { title: '' };
    const s = toMin(p.start);
    const e = overlay(Object.assign({}, src, { id: p.id, kind: 'hard', s, e: s + (p.dur || src.dur || 30), part: '', star: false, travel: 0 }));
    if (e) list.push(e);
  });
  return list.sort((a, b) => (!!a.done - !!b.done) || a.s - b.s);   // сделанное в конце дня
}
function listItems(name) {
  const gone = new Set(pending().filter((p) => GONE.includes(p.op) || (p.op === 'edit' && p.date)).map((p) => p.id));
  return (DATA[name] || []).map((x) => Object.assign({}, overlay(x) || x, { gone: gone.has(x.id) }));
}
function dayLabel(date) {
  const t = localToday();
  const d = new Date(date + 'T12:00');
  const diff = Math.round((d - new Date(t + 'T12:00')) / 864e5);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return WDS[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
}

function renderHead() {
  const now = new Date();
  $('#dnum').textContent = now.getDate();
  $('#dwk').textContent = WD[now.getDay()];
  $('#dmon').textContent = MON[now.getMonth()];
  const today = entries(dayObj(localToday()));
  const done = today.filter((e) => e.done).length;
  const total = today.length;
  $('#ringTxt').textContent = done + '/' + total;
  $('#ringArc').style.strokeDashoffset = String(150.8 * (1 - (total ? done / total : 0)));
  const up = new Date(DATA.updated);
  const p = pending().length;
  const ob = outbox().length;
  const off = ob && failSince && Date.now() - failSince > 15000;
  $('#syncTxt').textContent = off ? 'нет связи, отправлю сам, как появится сеть'
    : ob ? 'отправляю…' : p ? 'бот выполняет…'
      : 'обновлено ' + hm(up.getHours() * 60 + up.getMinutes()) + (dayLabel(DATA.today) !== 'сегодня' ? ', ' + dayLabel(DATA.today) : '');
  $('#sync').classList.toggle('stale', !!p || !!ob);
  $('#syncTg').hidden = !off;
}

function nextCard(list, nowM, isToday) {
  const open = list.filter((e) => !e.done);
  const star = open.find((e) => e.star);
  const nxt = isToday ? open.find((e) => e.e > nowM) : open[0];
  const pick = star && (!isToday || star.e > nowM) ? star : nxt;
  if (!pick) return '';
  const lbl = pick === star ? 'главное дня' : (isToday && pick.s <= nowM ? 'сейчас' : 'дальше');
  const when = pick.kind === 'hard' ? 'в ' + hm(pick.s) + (pick.travel ? ' · выйти в ' + hm(pick.s - pick.travel) : '') : hm(pick.s) + '-' + hm(pick.e);
  return '<button class="next ' + pick.kind + '" data-id="' + pick.id + '" style="width:100%;text-align:left"><span class="dot"></span><span><div class="lbl">' + lbl +
    '</div><div class="ttl">' + esc(pick.title) + '</div><div class="when">' + when + '</div></span></button>';
}

function renderToday() {
  const date = localToday();
  const all = entries(dayObj(date));
  const list = all.filter((e) => !e.done);       // на шкале только несделанное
  const done = all.filter((e) => e.done);        // сделанное зачёркнуто внизу дня
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  const prof = DATA.profile;
  const toM = (s) => +s.slice(0, 2) * 60 + +s.slice(3);
  let a = toM(prof.day_start);
  let b = toM(prof.day_end);
  list.forEach((e) => { a = Math.min(a, e.s - (e.travel || 0)); b = Math.max(b, e.e); });
  a = Math.min(a, nowM); b = Math.max(b, nowM + 30);
  a = Math.max(0, Math.floor(a / 60) * 60); b = Math.min(24 * 60, Math.ceil(b / 60) * 60);
  const ppm = 1.3;
  const y = (m) => (m - a) * ppm;
  let html = ydayLink() + nextCard(list, nowM, true);
  if (!all.length) html += '<div class="empty"><b>Сегодня свободно</b>Скажи боту, что надо сделать, и дело встанет сюда</div>';
  else if (!list.length) html += '<div class="empty"><b>На сегодня всё сделано</b>Сделанное зачёркнуто ниже</div>' + doneList(done);
  html += '<div class="tl" style="height:' + Math.round(y(b) + 10) + 'px">';
  for (let m = a; m <= b; m += 60) html += '<div class="hr" style="top:' + y(m) + 'px"><span>' + hm(m) + '</span></div>';
  const groups = [];
  list.forEach((e) => {
    const last = groups[groups.length - 1];
    if (e.kind === 'small' && last && last.kind === 'small' && e.s <= last.e + 1) { last.items.push(e); last.e = e.e; } else groups.push(Object.assign({ items: [e] }, e));
  });
  groups.forEach((g) => {
    const top = y(g.s);
    const h = Math.max(30, (g.e - g.s) * ppm - 2);
    if (g.travel) html += '<div class="travel" style="top:' + y(g.s - g.travel) + 'px;height:' + (g.travel * ppm) + 'px">дорога ' + g.travel + ' мин</div>';
    const cls = ['blk', g.kind, g.star ? 'star' : '', g.items.every((x) => x.done) ? 'done' : '', h < 46 ? 'short' : ''].join(' ');
    const tags = [];
    if (g.star) tags.push('★ главное');
    if (g.part) tags.push('часть ' + g.part);
    if (g.ctx && CTX[g.ctx]) tags.push(CTX[g.ctx]);
    if (g.kind === 'hard' && g.travel) tags.push('выйти в ' + hm(g.s - g.travel));
    const name = g.kind === 'small' ? 'Мелочи: ' + g.items.map((x) => (x.done ? '✓ ' : '') + esc(x.title)).join(', ') : esc(g.title);
    const time = g.kind === 'hard' ? hm(g.s) : hm(g.s) + '-' + hm(g.e);
    html += '<button class="' + cls + '" data-id="' + g.id + '" data-group="' + (g.kind === 'small' ? g.items.map((x) => x.id).join(',') : '') +
      '" style="top:' + top + 'px;height:' + h + 'px"><span class="t">' + time + '</span><span class="n">' + name + '</span>' +
      (tags.length && h > 52 ? '<span class="tags">' + tags.map((t) => '<span class="tag">' + t + '</span>').join('') + '</span>' : '') + '</button>';
  });
  if (nowM >= a && nowM <= b) html += '<div class="now" id="nowLine" style="top:' + y(nowM) + 'px"><b>' + hm(nowM) + '</b></div>';
  html += '</div>';
  if (list.length) html += doneList(done);
  $('#v-today').innerHTML = html;
  if (scrollNow) {
    scrollNow = false;
    const n = $('#nowLine') || document.querySelector('#v-today .blk');
    if (n) window.scrollTo({ top: Math.max(0, n.getBoundingClientRect().top + window.scrollY - 230) });
  }
}

function doneList(done) {                 // касание открывает карточку с «Вернуть в работу»
  if (!done.length) return '';
  return '<div class="h2">✓ Сделано<span>' + done.length + '</span></div><div class="agenda">' + done.map(rowHtml).join('') + '</div>';
}
function ydayLink() {                     // «Сегодня» сверху: как прошёл вчерашний день, касание открывает его
  const y = new Date(localToday() + 'T12:00'); y.setDate(y.getDate() - 1);
  const h = (DATA.history || []).find((d) => d.date === localISO(y).slice(0, 10));
  if (!h) return '';
  return '<button class="yday" data-day="' + h.date + '" data-goweek="1"><span>Вчера</span><b>сделано ' + h.done + ' из ' + h.total + '</b><i>→</i></button>';
}
let stripAnchor = true;                     // открыли «Неделю»: сегодня первым слева, прошлые спрятаны левее
function renderWeek() {
  const old = document.querySelector('.strip');
  const keep = old && !stripAnchor ? old.scrollLeft : null;  // обновление данных и касание дня не сбивают прокрутку
  const today = localToday();
  const past = (DATA.history || []).filter((d) => d.date < today).slice(-14);
  const days = DATA.days.filter((d) => d.date >= today).slice(0, 14);
  if (!SEL || !(days.find((d) => d.date === SEL) || past.find((d) => d.date === SEL))) SEL = days.length ? days[0].date : null;
  let html = '<div class="strip">';
  past.forEach((d) => {
    const dt = new Date(d.date + 'T12:00');
    const pct = d.total ? Math.round(100 * d.done / d.total) : 0;
    html += '<button class="day past' + (d.date === SEL ? ' sel' : '') + '" data-day="' + d.date + '"><span class="w">' + WDS[dt.getDay()] +
      '</span><span class="d">' + dt.getDate() + '</span><span class="bar"><i class="dn" style="width:' + pct + '%"></i></span><span class="cnt">' + d.done + '/' + d.total + '</span></button>';
  });
  if (past.length) html += '<span class="sep" aria-hidden="true"></span>';
  days.forEach((d, i) => {
    const dt = new Date(d.date + 'T12:00');
    const pct = Math.min(100, Math.round(100 * d.load / Math.max(1, d.cap)));
    html += '<button class="day' + (d.date === SEL ? ' sel' : '') + (i === 0 ? ' today' : '') + '" data-day="' + d.date + '"><span class="w">' + WDS[dt.getDay()] +
      '</span><span class="d">' + dt.getDate() + '</span><span class="bar"><i class="' + (pct >= 100 ? 'full' : '') + '" style="width:' + pct + '%"></i></span></button>';
  });
  html += '</div>';
  const h = past.find((d) => d.date === SEL);
  if (h) {
    const wk = past.slice(-7);
    const dn = wk.reduce((n, d) => n + d.done, 0), tt = wk.reduce((n, d) => n + d.total, 0);
    html += '<div class="h2">' + dayLabel(h.date) + '<span>сделано ' + h.done + ' из ' + h.total + '</span></div>';
    if (!h.entries.length) html += '<div class="empty"><b>Пустой день</b>В плане ничего не стояло и ничего не отмечено</div>';
    html += '<div class="agenda">' + h.entries.map((e) => histRow(e, h.date)).join('') + '</div>';
    html += '<div class="dyn">' + (wk.length > 1 ? 'Последние ' + wk.length + ' дн.' : 'За этот день') + ': сделано <b>' + dn + '</b> из ' + tt +
      (tt ? ' · ' + Math.round(100 * dn / tt) + '%' : '') + '</div>';
  } else {
    const sel = dayObj(SEL);
    const list = entries(sel);
    html += '<div class="h2">' + (SEL ? dayLabel(SEL) : '') + '<span>' + list.length + ' дел' + (sel ? ' · занято ' + String(Math.round(sel.load / 60 * 10) / 10).replace('.', ',') + ' ч' : '') + '</span></div>';
    if (!list.length) html += '<div class="empty"><b>Свободный день</b>Гибкие дела бот поставит сюда сам, если будет место</div>';
    html += '<div class="agenda">' + list.map(rowHtml).join('') + '</div>';
    if (SEL === today && past.length) html += '<div class="dyn">Прошлые дни спрятаны левее сегодняшнего: потяни полоску дней вправо</div>';
  }
  $('#v-week').innerHTML = html;
  const strip = document.querySelector('.strip');
  if (!strip) return;
  if (keep !== null) { strip.scrollLeft = keep; return; }
  const first = (h && document.querySelector('.day.sel')) || document.querySelector('.day.today') || document.querySelector('.day.sel');
  if (first) strip.scrollLeft += first.getBoundingClientRect().left - strip.getBoundingClientRect().left - 16;
  stripAnchor = false;
}
const HSTATE = { done: 'сделано', missed: 'не сделано', cancelled: 'удалено', gone: 'убрано' };
function histRow(e, date) {
  const when = e.extra ? 'отмечено в ' + hm(e.s) + ', вне плана дня' : (e.kind === 'hard' ? 'точное время' : hm(e.s) + '-' + hm(e.e)) + (e.part ? ' · часть ' + e.part : '');
  const note = e.note && e.state !== 'cancelled' ? ' · ' + esc(e.note) : '';
  return '<button class="row hist st-' + e.state + '" data-hid="' + e.id + '" data-hdate="' + date + '"><span class="tm">' + hm(e.s) +
    '</span><span class="hk" aria-label="' + HSTATE[e.state] + '"></span><span class="ttl">' + esc(e.title) + '<div class="sub">' + when + note + '</div></span></button>';
}
function rowHtml(e) {
  const tm = e.kind === 'hard' ? hm(e.s) : hm(e.s);
  const sub = e.kind === 'hard' ? 'точное время' + (e.travel ? ', выйти в ' + hm(e.s - e.travel) : '') : hm(e.s) + '-' + hm(e.e) + (e.part ? ' · часть ' + e.part : '') + (e.star ? ' · главное' : '') + (e.ctx && CTX[e.ctx] ? ' · ' + CTX[e.ctx] : '');
  return '<button class="row ' + e.kind + (e.done ? ' done' : '') + '" data-id="' + e.id + '"><span class="tm">' + tm + '</span><span class="k"></span><span class="ttl">' +
    esc(e.title) + '<div class="sub">' + sub + '</div></span></button>';
}

function renderLists() {
  const sec = (title, name, sub) => {
    const items = listItems(name);
    if (!items.length) return '';
    return '<div class="h2">' + title + '<span>' + items.filter((x) => !x.gone).length + '</span></div><div class="list">' + items.map((x) =>
      '<div class="row' + (x.gone ? ' gone' : '') + '"><button class="chk' + (x.gone ? ' on' : '') + '" data-done="' + x.id + '" aria-label="Готово"></button>' +
      '<button class="ttl" data-id="' + x.id + '" style="text-align:left">' + esc(x.title) + (sub ? '<div class="sub">' + sub(x) + '</div>' : '') + '</button></div>').join('') + '</div>';
  };
  let html = sec('⚡ Сделать сразу', 'now') + sec('🛒 Покупки', 'buy') + sec('📥 Без даты', 'inbox') +
    sec('⚠️ Не влезло', 'stuck', (x) => 'не хватило места на ' + (x.left >= 60 ? String(Math.round(x.left / 6) / 10).replace('.', ',') + ' ч' : x.left + ' мин'));
  const ahead = DATA.days.filter((d) => d.date >= localToday() && entries(d).length);
  if (ahead.length) {
    html += '<div class="h2">📋 Все по датам<span>' + ahead.reduce((n, d) => n + entries(d).length, 0) + '</span></div>';
    ahead.forEach((d) => { html += '<div class="sub" style="margin:12px 2px 6px;font-family:var(--f-mono);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">' + dayLabel(d.date) + '</div><div class="agenda">' + entries(d).map(rowHtml).join('') + '</div>'; });
  }
  if (!html) html = '<div class="empty"><b>Списки пусты</b>Покупки, дела без даты и мелочи на 2 минуты появятся здесь</div>';
  $('#v-lists').innerHTML = html;
}

function render() {
  $('#lock').classList.remove('on');
  renderHead();
  if (VIEW === 'today') renderToday();
  if (VIEW === 'week') renderWeek();
  if (VIEW === 'lists') renderLists();
  if (VIEW === 'ideas') renderIdeas();
}

// ── шторки ──────────────────────────────────────────────────
function findItem(id) {
  const mv = pending().filter((p) => movedEdit(p) && p.id === id).pop();   // правка со временем ещё едет к боту
  if (mv) { const e = entries(dayObj(mv.date)).find((x) => x.id === id); if (e) return Object.assign({ date: mv.date }, e); }
  for (const d of DATA.days) { const e = d.entries.find((x) => x.id === id); if (e) return Object.assign({ date: d.date }, overlay(e) || e); }
  for (const n of ['now', 'buy', 'inbox', 'stuck']) { const e = (DATA[n] || []).find((x) => x.id === id); if (e) return Object.assign({ kind: n === 'stuck' ? 'flex' : n }, overlay(e) || e); }
  return null;
}
function pad(n) { return String(n).padStart(2, '0'); }
function localISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function remBlock(e) {
  const al = alertsOf(e);
  const has = (n) => al.some((x) => x.before === n);
  const timed = e.s !== undefined;
  let html = '<div class="rsec"><div class="rl">🔔 Напомнить</div><div class="chips">';
  if (timed) [[5, 'за 5 мин'], [15, 'за 15 мин'], [60, 'за 1 час']].forEach(([n, t]) => { html += '<button class="chip' + (has(n) ? ' on' : '') + '" data-rem="' + n + '">' + t + '</button>'; });
  html += '<button class="chip" data-remopen="1">Своё время</button></div>';
  const custom = al.filter((x) => x.at);
  if (custom.length) html += '<div class="chips">' + custom.map((x) => '<button class="chip on" data-unat="' + x.at + '">' + dayLabel(x.at.slice(0, 10)) + ' ' + x.at.slice(11) + ' ✕</button>').join('') + '</div>';
  let def = new Date(Date.now() + 3600e3);
  if (timed && e.date) { const st = new Date(e.date + 'T' + hm(e.s)); st.setMinutes(st.getMinutes() - 30); if (st > new Date()) def = st; }
  html += '<div class="rbox" id="remBox" hidden><input type="datetime-local" id="remAt" value="' + localISO(def) + '"><button class="btn" data-remat="1">Поставить</button></div>';
  if (e.rem && e.rem.length) html += '<div class="rnow">Уже стоят: ' + e.rem.map(esc).join(', ') + '</div>';
  return html + '</div>';
}
function taskSheet(id) {
  const e = findItem(id);
  if (!e) return;
  let meta = KIND[e.kind] || '';
  if (e.date) meta = dayLabel(e.date) + ', ' + (e.kind === 'hard' ? 'в ' + hm(e.s) : hm(e.s) + '-' + hm(e.e)) + ' · ' + meta;
  const acts = e.done
    ? '<button class="btn pri" data-act="reopen">↩ Вернуть в работу</button>'
    : '<button class="btn pri" data-act="done">✓ Сделано</button><button class="btn" data-act="tmrw">→ ' +
      (e.date && e.date > localToday() ? 'На день позже' : 'На завтра') + '</button><button class="btn" data-act="pick">📅 Выбрать день</button>' +
      '<button class="btn" data-act="edit">✏️ Изменить</button><button class="btn warn" data-act="cancel">✕ Удалить</button>';
  openSheet('<h3>' + esc(e.title) + '</h3><div class="meta">' + meta + '</div><div class="acts" data-task="' + e.id + '">' + acts + '</div>' +
    (e.done ? '' : '<div data-task="' + e.id + '">' + remBlock(e) + '</div>'));
}
// ── перенос на выбранный день: ближайшая неделя кнопками, дальше календарём ──
function addDays(date, n) { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pickSheet(id) {
  const e = findItem(id);
  if (!e) return;
  const today = localToday();
  const days = [];
  for (let i = 0; i <= 7; i++) { const d = addDays(today, i); if (d !== e.date) days.push(d); }
  const keep = e.kind === 'hard' ? 'Время ' + hm(e.s) + ' сохранится, поменяется только день'
    : 'Бот сам поставит дело в свободное окно этого дня';
  openSheet('<h3>Перенести на день</h3><div class="meta">' + esc(e.title) + (e.date ? ' · сейчас ' + dayLabel(e.date) : '') + '</div>' +
    '<div data-task="' + e.id + '"><div class="chips">' +
    days.map((d) => '<button class="chip" data-mv="' + d + '">' + dayLabel(d) + '</button>').join('') + '</div>' +
    '<label class="fl" for="mvDate">Другая дата</label><div class="rbox"><input type="date" id="mvDate" min="' + today + '" value="' + addDays(today, 8) + '">' +
    '<button class="btn" data-mvgo="1">Перенести</button></div></div>' +
    '<div class="hint">' + keep + '</div>');
}
function moveTo(id, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return toast('Выбери дату');
  if (date < localToday()) return toast('Выбери сегодня или позже');
  closeSheet();
  send({ op: 'tmrw', id, date });
  toast('Переношу на ' + dayLabel(date));
}
// ── правка дела: текст, день, своё время, длительность ──
let EDIT = null;
const durTxt = (n) => (n < 60 ? n + ' мин' : n % 60 ? String(Math.round(n / 6) / 10).replace('.', ',') + ' ч' : n / 60 + ' ч');
function editSheet(id) {
  const e = findItem(id);
  if (!e) return;
  const hard = e.kind === 'hard';
  const timed = e.s !== undefined && e.date;
  const dur = e.dur || (timed ? e.e - e.s : 0) || 30;
  EDIT = { id: e.id, title: e.title, date: timed ? e.date : '', time: hard ? hm(e.s) : '', dur };
  const durs = [5, 15, 30, 45, 60, 90, 120, 180, 240];
  if (!durs.includes(dur)) { durs.push(dur); durs.sort((x, y) => x - y); }
  const now = hard ? 'Очистишь время (✕) - бот сам подберёт окно в этот день'
    : (timed ? 'Сейчас бот поставил на ' + hm(e.s) + '-' + hm(e.e) + '. ' : '') + 'Поставишь время - дело встанет ровно на него, бот его больше не двигает';
  openSheet('<h3>Изменить дело</h3>' +
    '<label class="fl" for="edTitle">Текст</label><textarea id="edTitle" class="ed" maxlength="200">' + esc(e.title) + '</textarea>' +
    '<div class="frow"><div><label class="fl" for="edDate">День</label><input type="date" id="edDate" class="inp" min="' + localToday() + '" value="' + EDIT.date + '"></div>' +
    '<div><label class="fl" for="edTime">Время</label><div class="tbox"><input type="time" id="edTime" class="inp" value="' + EDIT.time + '">' +
    '<button class="clr" data-clr="1" aria-label="Без точного времени">✕</button></div></div></div>' +
    '<div class="hint">' + now + '</div>' +
    '<label class="fl">Сколько займёт</label><div class="chips" id="edDur">' +
    durs.map((n) => '<button class="chip' + (n === dur ? ' on' : '') + '" data-dur="' + n + '">' + durTxt(n) + '</button>').join('') + '</div>' +
    '<div class="acts" data-task="' + e.id + '"><button class="btn pri" data-act="save">Сохранить</button></div>');
  grow($('#edTitle'));
}
function grow(el) { el.style.height = 'auto'; el.style.height = Math.min(220, el.scrollHeight + 2) + 'px'; }   // текст виден целиком
document.addEventListener('input', (ev) => { if (ev.target.classList && ev.target.classList.contains('ed')) grow(ev.target); });
function saveEdit() {
  if (!EDIT) return;
  const title = ($('#edTitle').value || '').replace(/\s+/g, ' ').trim();
  let date = $('#edDate').value || '';
  const time = ($('#edTime').value || '').slice(0, 5);
  const on = document.querySelector('#edDur .chip.on');
  const dur = on ? +on.dataset.dur : EDIT.dur;
  if (!title) return toast('Напиши, что за дело');
  if (time && !date) date = localToday();
  if (date && date < localToday()) return toast('Выбери сегодня или позже');
  const act = { op: 'edit', id: EDIT.id };
  if (title !== EDIT.title) act.title = title;
  if (dur !== EDIT.dur) act.dur = dur;
  if (date !== EDIT.date || time !== EDIT.time) { act.date = date; act.start = time; }
  if (Object.keys(act).length === 2) { closeSheet(); return toast('Ничего не поменялось'); }
  closeSheet();
  send(act);
  toast('Сохраняю' + (act.start ? ': ' + dayLabel(act.date) + ' в ' + act.start : ''));
}
function histSheet(id, date) {
  const h = (DATA.history || []).find((d) => d.date === date);
  const e = h && h.entries.find((x) => x.id === id);
  if (!e) return;
  const cur = findItem(id);
  if (cur && !cur.done && e.state === 'missed') return taskSheet(id);   // ещё открыто: можно отметить или поправить
  const when = e.extra ? 'отмечено в ' + hm(e.s) : (e.kind === 'hard' ? 'в ' + hm(e.s) : hm(e.s) + '-' + hm(e.e));
  openSheet('<h3>' + esc(e.title) + '</h3><div class="meta">' + dayLabel(date) + ', ' + when + ' · ' + HSTATE[e.state] + (e.note ? ' · ' + esc(e.note) : '') + '</div>' +
    '<div class="hint">Прошлый день: здесь видно, как он прошёл. Дело, которое ещё в работе, открывается в плане</div>');
}
function addSheet() {
  openSheet('<h3>Новое дело</h3><textarea id="addTxt" placeholder="Например: завтра в 15 стоматолог, ехать 40 минут. Купить лампочки"></textarea>' +
    '<div class="acts"><button class="btn pri" data-act="say">Добавить</button></div><div class="hint">Пиши как говоришь боту: можно несколько дел сразу. Голосом удобнее прямо в чате</div>');
  setTimeout(() => { const t = $('#addTxt'); if (t) t.focus(); }, 250);
}
function addIdeaSheet() {
  openSheet('<h3>Новая идея</h3><textarea id="ideaTxt" placeholder="Что пришло в голову"></textarea>' +
    '<div class="acts"><button class="btn pri" data-act="idea">Записать</button></div><div class="hint">Голосом тоже можно: скажи боту «идея: …»</div>');
  setTimeout(() => { const t = $('#ideaTxt'); if (t) t.focus(); }, 250);
}
function ideaSheet(id) {
  const x = (DATA.ideas || []).find((i) => i.id === id);
  if (!x) return;
  openSheet('<div class="meta">💡 идея от ' + esc(x.date) + '</div><h3 style="margin-top:8px;white-space:pre-wrap">' + esc(x.text) + '</h3>' +
    '<div class="acts" data-task="' + x.id + '"><button class="btn pri" data-act="idea_task">📥 Сделать делом</button><button class="btn warn" data-act="idea_del" style="grid-column:1/-1">🗑 Удалить</button></div>');
}
function renderIdeas() {
  const gone = new Set(pending().filter((p) => p.op === 'idea_del' || p.op === 'idea_task').map((p) => p.id));
  const list = (DATA.ideas || []).filter((x) => !gone.has(x.id));
  let html = '<div class="h2">💡 Идеи<span>' + list.length + '</span></div>';
  if (!list.length) html += '<div class="empty"><b>Идей пока нет</b>Нажми «+» или скажи боту «идея: …», и она появится здесь</div>';
  html += '<div class="ideas">' + list.map((x) => '<button class="idea" data-idea="' + x.id + '"><span class="it">' + esc(x.text) + '</span><span class="id">' + esc(x.date) + '</span></button>').join('') + '</div>';
  $('#v-ideas').innerHTML = html;
}

// ── события ─────────────────────────────────────────────────
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.classList.contains('tab')) { if (t.dataset.v === 'week') SEL = null; return setView(t.dataset.v); }   // «Неделя» открывается на сегодня
  if (t.id === 'fab') return VIEW === 'ideas' ? addIdeaSheet() : addSheet();
  if (t.id === 'syncTg') return viaTelegram();
  if (t.dataset.goweek) { SEL = t.dataset.day; return setView('week'); }
  if (t.dataset.day) { SEL = t.dataset.day; return renderWeek(); }
  if (t.dataset.hid) return histSheet(t.dataset.hid, t.dataset.hdate);
  if (t.dataset.dur) { document.querySelectorAll('#edDur .chip').forEach((c) => c.classList.toggle('on', c === t)); return; }
  if (t.dataset.clr) { $('#edTime').value = ''; return; }
  if (t.dataset.idea) return ideaSheet(t.dataset.idea);
  if (t.dataset.done) { send({ op: 'done', id: t.dataset.done }); return toast('Отмечено'); }
  const box = t.closest('[data-task]');
  const tid = box ? box.dataset.task : null;
  if (t.dataset.mv) return moveTo(tid, t.dataset.mv);
  if (t.dataset.mvgo) return moveTo(tid, $('#mvDate').value);
  if (t.dataset.remopen) { const r = $('#remBox'); if (r) r.hidden = !r.hidden; return; }
  if (t.dataset.rem) {
    const n = +t.dataset.rem;
    const on = t.classList.contains('on');
    closeSheet();
    send({ op: on ? 'unremind' : 'remind', id: tid, before: n });
    return toast(on ? 'Снимаю напоминание' : 'Ставлю напоминание ' + t.textContent);
  }
  if (t.dataset.unat) { closeSheet(); send({ op: 'unremind', id: tid, at: t.dataset.unat }); return toast('Снимаю напоминание'); }
  if (t.dataset.remat) {
    const v = ($('#remAt').value || '').slice(0, 16);
    if (!v || new Date(v) <= new Date()) return toast('Выбери время в будущем');
    closeSheet();
    send({ op: 'remind', id: tid, at: v });
    return toast('Напомню ' + dayLabel(v.slice(0, 10)) + ' в ' + v.slice(11));
  }
  if (t.dataset.act) {
    const act = t.dataset.act;
    if (act === 'say' || act === 'idea') {
      const field = act === 'say' ? '#addTxt' : '#ideaTxt';
      const text = ($(field).value || '').trim();
      if (!text) return toast(act === 'say' ? 'Напиши, что сделать' : 'Напиши идею');
      closeSheet();
      send({ op: act, text });
      return toast(act === 'say' ? 'Отправил боту, дело встанет в план через минуту' : 'Записываю идею');
    }
    if (act === 'edit') return editSheet(tid);
    if (act === 'pick') return pickSheet(tid);
    if (act === 'save') return saveEdit();
    if (act === 'cancel' && !t.classList.contains('arm')) { t.classList.add('arm'); t.textContent = 'Точно удалить?'; return; }
    if (act === 'idea_del' && !t.classList.contains('arm')) { t.classList.add('arm'); t.textContent = 'Точно удалить идею?'; return; }
    closeSheet();
    send({ op: act, id: tid });
    return toast({ done: 'Сделано, ушло вниз дня', tmrw: 'Переношу', cancel: 'Удаляю', reopen: 'Возвращаю', idea_del: 'Удаляю идею', idea_task: 'Переношу в дела' }[act]);
  }
  if (t.dataset.group) {
    const ids = t.dataset.group.split(',');
    if (ids.length > 1) {
      return openSheet('<h3>Мелочи</h3><div class="meta">одним блоком, ' + ids.length + ' дела</div><div class="list" style="margin-top:14px">' + ids.map((id) => {
        const e = findItem(id);
        return '<div class="row' + (e.done ? ' gone' : '') + '"><button class="chk' + (e.done ? ' on' : '') + '" data-done="' + id + '"></button><button class="ttl" data-id="' + id + '" style="text-align:left">' + esc(e.title) + '</button></div>';
      }).join('') + '</div>');
    }
  }
  if (t.dataset.id) return taskSheet(t.dataset.id);
});
function viaTelegram() {                   // нет связи с ящиком: первую команду из очереди можно отдать через чат
  const a = outbox()[0];
  if (!a) return;
  if (!canSendData() && !deepParam(a)) return toast('Эта правка уйдёт, когда появится связь');
  store.set('outbox', outbox().slice(1));
  store.set('pending', (store.get('pending') || []).map((x) => (x.cid === a.cid ? Object.assign({}, x, { relay: false, ts: Date.now() }) : x)));
  legacy(actOf(a));
}
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); load(true); } });
setInterval(() => { if (!document.hidden) load(true); }, 60000);
setInterval(() => { if (outbox().length) flush(); if (DATA) renderHead(); }, 10000);

(async () => {
  TG = await waitTG();
  if (TG) {
    TG.ready(); TG.expand();
    try { TG.onEvent('themeChanged', applyTheme); TG.BackButton.onClick(closeSheet); } catch (e) { /* старый клиент */ }
  } else {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }
  applyTheme();
  setView(VIEW);
  load();
  flush();
})();
