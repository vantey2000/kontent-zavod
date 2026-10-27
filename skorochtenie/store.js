// Прогресс в браузере телефона. Хранилище бывает запрещено (приватный режим, превью):
// тогда работаем из памяти до перезагрузки и не падаем

import { normalizeTrain } from './core.js';

const KEY = 'temp.state.v1';
let memory = null;
let persistent = true;

export function fresh() {
  return {
    v: 1,
    startKey: null,      // день старта программы (первый тест)
    baseWpm: null,       // скорость первого теста, от неё растёт читалка
    tests: [],           // [{ key, wpm, comprehension, effective, textId }]
    done: [],            // дни с завершённой тренировкой, ключи ГГГГ-ММ-ДД
    freeReads: {},       // { ключ дня: сколько бесплатных читалок }
    auth: null,          // { token, email, pw } - вход в оплаченный доступ (сервер skorochtenie-api), pw = пароль задан
    acc: null,           // последний ответ сервера о доступе: { paid, until, plan, renews, stopped, next, gift, forever }
    pending: null,       // заказ, ушедший в кассу: { order, k, plan, at } - по нему телефон забирает доступ после оплаты
    trial: null,         // момент начала пробы (мс), одна на телефон. Без trun - старые пробные сутки
    trun: null,          // пробная тренировка: { i - следующий шаг, done - момент окончания (мс) или null, skip - пропущенные упражнения }
    tdsent: false,       // сервер узнал, что пробная тренировка пройдена
    tid: null,           // номер пробы для учёта в админке (случайный, без почты)
    tsent: null,         // что сервер знает о пробе: null - ничего, '-' - без почты, почта - с этой почтой
    train: null,         // своя тренировка: { mode: 'program' | 'custom', items: [{ kind, minutes }] } (core.normalizeTrain)
    bookmark: { t: 0, w: 0 },
    schulteBest: null,   // лучшее время таблицы 5x5 до v2, переносится в best.schulte
    readerLog: {},       // { ключ дня: скорость читалки }
    testSeq: 0,          // сколько тестов начато, для ротации текстов
    src: null,           // метка площадки первого прихода (из адреса после «#»), для таблицы воронки
    sent: [],            // события воронки, уже отправленные с этого телефона (каждое один раз)
    best: {},            // лучшие результаты по упражнениям: { schulte: с, sight: уровень, flash: мс, memory: цифр, search: с, flipped: с на 100 слов }
    scramble: null,      // «Кривые буквы»: последняя сложность и темп подсветки { level: 0-3, wpm }
  };
}

// Хранилище могли испортить (другая версия, ручная правка): каждое поле проверяем по типу, битое заменяем пустым
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const dayKey = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normalize(s) {
  const f = fresh();
  if (!s || typeof s !== 'object' || s.v !== 1) return f;
  const bookmark = obj(s.bookmark);
  const auth = obj(s.auth), acc = obj(s.acc), pending = obj(s.pending);
  return {
    ...f,
    startKey: dayKey(s.startKey),
    baseWpm: num(s.baseWpm),
    tests: Array.isArray(s.tests) ? s.tests.filter(t => obj(t) && dayKey(t.key) && num(t.wpm) !== null) : [],
    done: Array.isArray(s.done) ? s.done.filter(dayKey) : [],
    freeReads: obj(s.freeReads) || {},
    auth: auth && typeof auth.token === 'string' && typeof auth.email === 'string' ? { token: auth.token, email: auth.email, pw: !!auth.pw } : null,
    acc: acc && (acc.forever === true || num(acc.until) !== null) ? acc : null,
    trial: num(s.trial),
    trun: trunOf(s.trun),
    tdsent: s.tdsent === true,
    tid: typeof s.tid === 'string' && /^[A-Za-z0-9_-]{12,32}$/.test(s.tid) ? s.tid : null,
    tsent: typeof s.tsent === 'string' && s.tsent.length <= 120 ? s.tsent : null,
    train: normalizeTrain(s.train),
    pending: pending && typeof pending.order === 'string' && /^sk[\w-]{6,40}$/.test(pending.order) && typeof pending.k === 'string' && num(pending.at) !== null ? pending : null,
    bookmark: bookmark && num(bookmark.t) !== null && num(bookmark.w) !== null ? bookmark : f.bookmark,
    schulteBest: num(s.schulteBest),
    readerLog: obj(s.readerLog) || {},
    testSeq: num(s.testSeq) || 0,
    best: bestOf(s),
    scramble: obj(s.scramble) && num(s.scramble.level) !== null && num(s.scramble.wpm) !== null ? { level: s.scramble.level, wpm: s.scramble.wpm } : null,
    src: typeof s.src === 'string' && /^[a-z0-9-]{1,16}$/.test(s.src) ? s.src : null,
    sent: Array.isArray(s.sent) ? s.sent.filter(x => typeof x === 'string').slice(0, 20) : [],
  };
}

// прогресс пробной тренировки: шаг 0-13, окончание числом или null, пропущенные - только строки
function trunOf(t) {
  const o = obj(t);
  if (!o) return null;
  const i = num(o.i);
  return { i: i === null ? 0 : Math.min(13, Math.max(0, Math.floor(i))), done: num(o.done), skip: Array.isArray(o.skip) ? o.skip.filter(x => typeof x === 'string').slice(0, 13) : [] };
}

function bestOf(s) {
  const b = { ...(obj(s.best) || {}) };
  for (const k of Object.keys(b)) if (num(b[k]) === null) delete b[k];
  if (b.schulte == null && num(s.schulteBest) !== null) b.schulte = s.schulteBest;   // состояние v1
  return b;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : memory);
  } catch (e) {
    persistent = false;
    return normalize(memory);
  }
}

export function save(state) {
  memory = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    persistent = false;
  }
}

export const isPersistent = () => persistent;
