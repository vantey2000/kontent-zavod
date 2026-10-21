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
function password() {
  const k = new URLSearchParams(location.search).get('k');
  if (k) store.set('k', k);
  return k || store.get('k');
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(blob, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(blob.salt), iterations: 310000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
function lock(text) { $('#lockTxt').textContent = text; $('#lock').classList.add('on'); }
async function load(quiet) {
  const pass = password();
  if (!pass) return lock('Открой планер кнопкой «📱 Планер» в чате с ботом @' + BOT);
  try {
    const r = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.json();
    DATA = await decrypt(blob, pass);
    store.set('cache', DATA);
  } catch (e) {
    if (e && e.name === 'OperationError') return lock('Ключ не подошёл. Открой планер заново кнопкой в чате с ботом');
    DATA = DATA || store.get('cache');
    if (!DATA) return lock('Нет связи с сайтом. Проверь интернет и открой ещё раз');
    if (!quiet) toast('Нет связи, показываю сохранённое');
  }
  render();
}

// ── действия: ответ бота станет правдой, а до тех пор отметка живёт здесь ──
function pending() {
  const list = store.get('pending') || [];
  const fresh = list.filter((p) => !DATA || p.at > Date.parse(DATA.updated));
  if (fresh.length !== list.length) store.set('pending', fresh);
  return fresh;
}
function send(action) {
  haptic('medium');
  if (action.op !== 'say') {
    const list = store.get('pending') || [];
    list.push(Object.assign({ at: Date.now() }, action));
    store.set('pending', list);
    render();
  }
  if (canSendData()) { TG.sendData(JSON.stringify(action)); return; }       // окно закроется, бот ответит в чате
  const p = { done: 'done', cancel: 'del', tmrw: 'tmrw', reopen: 'open' }[action.op];
  const url = 'https://t.me/' + BOT + (p ? '?start=' + p + '-' + action.id : '');
  if (TG) TG.openTelegramLink(url); else location.href = url;
}
function overlay(e) {
  const p = pending().filter((x) => x.id === e.id).pop();
  if (!p) return e;
  if (p.op === 'done') return Object.assign({}, e, { done: true });
  if (p.op === 'reopen') return Object.assign({}, e, { done: false });
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
  if (v === 'today') scrollNow = true;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  window.scrollTo(0, 0);
  if (DATA) render();
}

// ── отрисовка ───────────────────────────────────────────────
const KIND = { hard: 'точное время', flex: 'гибкое', small: 'мелочь', now: 'на 2 минуты', buy: 'покупка', inbox: 'без даты' };
function localToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayObj(date) { return DATA.days.find((d) => d.date === date); }
function entries(day) { return (day ? day.entries : []).map(overlay).filter(Boolean); }
function listItems(name) {
  const gone = new Set(pending().filter((p) => p.op !== 'reopen').map((p) => p.id));
  return (DATA[name] || []).map((x) => Object.assign({}, x, { gone: gone.has(x.id) }));
}
function dayLabel(date) {
  const t = localToday();
  const d = new Date(date + 'T12:00');
  const diff = Math.round((d - new Date(t + 'T12:00')) / 864e5);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
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
  $('#syncTxt').textContent = p ? 'отправлено боту, жду подтверждения' : 'обновлено ' + hm(up.getHours() * 60 + up.getMinutes()) + (dayLabel(DATA.today) !== 'сегодня' ? ', ' + dayLabel(DATA.today) : '');
  $('#sync').classList.toggle('stale', !!p);
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
  const list = entries(dayObj(date));
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
  let html = nextCard(list, nowM, true);
  if (!list.length) html += '<div class="empty"><b>Сегодня свободно</b>Скажи боту, что надо сделать, и дело встанет сюда</div>';
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
    if (g.kind === 'hard' && g.travel) tags.push('выйти в ' + hm(g.s - g.travel));
    const name = g.kind === 'small' ? 'Мелочи: ' + g.items.map((x) => (x.done ? '✓ ' : '') + esc(x.title)).join(', ') : esc(g.title);
    const time = g.kind === 'hard' ? hm(g.s) : hm(g.s) + '-' + hm(g.e);
    html += '<button class="' + cls + '" data-id="' + g.id + '" data-group="' + (g.kind === 'small' ? g.items.map((x) => x.id).join(',') : '') +
      '" style="top:' + top + 'px;height:' + h + 'px"><span class="t">' + time + '</span><span class="n">' + name + '</span>' +
      (tags.length && h > 52 ? '<span class="tags">' + tags.map((t) => '<span class="tag">' + t + '</span>').join('') + '</span>' : '') + '</button>';
  });
  if (nowM >= a && nowM <= b) html += '<div class="now" id="nowLine" style="top:' + y(nowM) + 'px"><b>' + hm(nowM) + '</b></div>';
  html += '</div>';
  $('#v-today').innerHTML = html;
  if (scrollNow) {
    scrollNow = false;
    const n = $('#nowLine') || document.querySelector('#v-today .blk');
    if (n) window.scrollTo({ top: Math.max(0, n.getBoundingClientRect().top + window.scrollY - 230) });
  }
}

function renderWeek() {
  const days = DATA.days.filter((d) => d.date >= localToday()).slice(0, 14);
  if (!SEL || !days.find((d) => d.date === SEL)) SEL = days.length ? days[0].date : null;
  let html = '<div class="strip">';
  days.forEach((d, i) => {
    const dt = new Date(d.date + 'T12:00');
    const pct = Math.min(100, Math.round(100 * d.load / Math.max(1, d.cap)));
    html += '<button class="day' + (d.date === SEL ? ' sel' : '') + (i === 0 ? ' today' : '') + '" data-day="' + d.date + '"><span class="w">' + WDS[dt.getDay()] +
      '</span><span class="d">' + dt.getDate() + '</span><span class="bar"><i class="' + (pct >= 100 ? 'full' : '') + '" style="width:' + pct + '%"></i></span></button>';
  });
  html += '</div>';
  const sel = dayObj(SEL);
  const list = entries(sel);
  html += '<div class="h2">' + (SEL ? dayLabel(SEL) : '') + '<span>' + list.length + ' дел' + (sel ? ' · занято ' + String(Math.round(sel.load / 60 * 10) / 10).replace('.', ',') + ' ч' : '') + '</span></div>';
  if (!list.length) html += '<div class="empty"><b>Свободный день</b>Гибкие дела бот поставит сюда сам, если будет место</div>';
  html += '<div class="agenda">' + list.map(rowHtml).join('') + '</div>';
  $('#v-week').innerHTML = html;
  const selEl = document.querySelector('.day.sel');
  const strip = document.querySelector('.strip');
  if (selEl && strip) strip.scrollLeft = Math.max(0, selEl.offsetLeft - strip.offsetLeft - (strip.clientWidth - selEl.clientWidth) / 2);
}
function rowHtml(e) {
  const tm = e.kind === 'hard' ? hm(e.s) : hm(e.s);
  const sub = e.kind === 'hard' ? 'точное время' + (e.travel ? ', выйти в ' + hm(e.s - e.travel) : '') : hm(e.s) + '-' + hm(e.e) + (e.part ? ' · часть ' + e.part : '') + (e.star ? ' · главное' : '');
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
}

// ── шторки ──────────────────────────────────────────────────
function findItem(id) {
  for (const d of DATA.days) { const e = d.entries.find((x) => x.id === id); if (e) return Object.assign({ date: d.date }, overlay(e) || e); }
  for (const n of ['now', 'buy', 'inbox', 'stuck']) { const e = (DATA[n] || []).find((x) => x.id === id); if (e) return Object.assign({ kind: n === 'stuck' ? 'flex' : n }, e); }
  return null;
}
function taskSheet(id) {
  const e = findItem(id);
  if (!e) return;
  let meta = KIND[e.kind] || '';
  if (e.date) meta = dayLabel(e.date) + ', ' + (e.kind === 'hard' ? 'в ' + hm(e.s) : hm(e.s) + '-' + hm(e.e)) + ' · ' + meta;
  const acts = e.done
    ? '<button class="btn pri" data-act="reopen">↩ Вернуть в работу</button>'
    : '<button class="btn pri" data-act="done">✓ Сделано</button><button class="btn" data-act="tmrw">→ ' + (e.date && e.date > localToday() ? 'На день позже' : 'На завтра') + '</button><button class="btn warn" data-act="cancel">✕ Удалить</button>';
  openSheet('<h3>' + esc(e.title) + '</h3><div class="meta">' + meta + '</div><div class="acts" data-task="' + e.id + '">' + acts + '</div>' +
    (canSendData() ? '' : '<div class="hint">Действие уйдёт боту через Telegram, он подтвердит в чате</div>'));
}
function addSheet() {
  openSheet('<h3>Новое дело</h3><textarea id="addTxt" placeholder="Например: завтра в 15 стоматолог, ехать 40 минут. Купить лампочки"></textarea>' +
    '<div class="acts"><button class="btn pri" data-act="say">Добавить</button></div><div class="hint">Пиши как говоришь боту: можно несколько дел сразу. Голосом удобнее прямо в чате</div>');
  setTimeout(() => { const t = $('#addTxt'); if (t) t.focus(); }, 250);
}

// ── события ─────────────────────────────────────────────────
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.classList.contains('tab')) return setView(t.dataset.v);
  if (t.id === 'fab') return addSheet();
  if (t.dataset.day) { SEL = t.dataset.day; return renderWeek(); }
  if (t.dataset.done) { send({ op: 'done', id: t.dataset.done }); return toast('Отмечено'); }
  if (t.dataset.act) {
    const act = t.dataset.act;
    if (act === 'say') {
      const text = ($('#addTxt').value || '').trim();
      if (!text) return toast('Напиши, что сделать');
      closeSheet();
      if (canSendData()) return send({ op: 'say', text });
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
      toast('Текст скопирован, вставь его в чат с ботом');
      return setTimeout(() => send({ op: 'say', text }), 900);
    }
    if (act === 'cancel' && !t.classList.contains('arm')) { t.classList.add('arm'); t.textContent = 'Точно удалить?'; return; }
    const id = t.closest('[data-task]').dataset.task;
    closeSheet();
    send({ op: act, id });
    return toast({ done: 'Отмечено', tmrw: 'Переношу на завтра', cancel: 'Удаляю', reopen: 'Возвращаю' }[act]);
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
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
setInterval(() => { if (!document.hidden) load(true); }, 60000);

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
})();
