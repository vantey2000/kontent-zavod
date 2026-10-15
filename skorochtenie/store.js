// Прогресс в браузере телефона. Хранилище бывает запрещено (приватный режим, превью):
// тогда работаем из памяти до перезагрузки и не падаем

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
    plan: null,          // { tier, demo, at, until }
    bookmark: { t: 0, w: 0 },
    schulteBest: null,   // лучшее время таблицы 5x5 до v2, переносится в best.schulte
    readerLog: {},       // { ключ дня: скорость читалки }
    testSeq: 0,          // сколько тестов начато, для ротации текстов
    src: null,           // метка площадки первого прихода (из адреса после «#»), для таблицы воронки
    sent: [],            // события воронки, уже отправленные с этого телефона (каждое один раз)
    best: {},            // лучшие результаты по упражнениям: { schulte: с, sight: уровень, flash: мс, memory: цифр, search: с, flipped: с на 100 слов }
  };
}

// Хранилище могли испортить (другая версия, ручная правка): каждое поле проверяем по типу, битое заменяем пустым
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const dayKey = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normalize(s) {
  const f = fresh();
  if (!s || typeof s !== 'object' || s.v !== 1) return f;
  const plan = obj(s.plan);
  const bookmark = obj(s.bookmark);
  return {
    ...f,
    startKey: dayKey(s.startKey),
    baseWpm: num(s.baseWpm),
    tests: Array.isArray(s.tests) ? s.tests.filter(t => obj(t) && dayKey(t.key) && num(t.wpm) !== null) : [],
    done: Array.isArray(s.done) ? s.done.filter(dayKey) : [],
    freeReads: obj(s.freeReads) || {},
    plan: plan && num(plan.until) !== null ? plan : null,
    bookmark: bookmark && num(bookmark.t) !== null && num(bookmark.w) !== null ? bookmark : f.bookmark,
    schulteBest: num(s.schulteBest),
    readerLog: obj(s.readerLog) || {},
    testSeq: num(s.testSeq) || 0,
    best: bestOf(s),
    src: typeof s.src === 'string' && /^[a-z0-9-]{1,16}$/.test(s.src) ? s.src : null,
    sent: Array.isArray(s.sent) ? s.sent.filter(x => typeof x === 'string').slice(0, 20) : [],
  };
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
