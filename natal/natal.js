// Натальная карта по моменту и месту рождения (26.10.2026): планеты, лунный узел, Асцендент, MC, дома, аспекты.
// Общий модуль для страницы и сервера, как engine.js у «Твоего 2027». Считает astronomy-engine (MIT),
// долготы в истинной эклиптике даты, как в астрологических программах. Сверка с Swiss Ephemeris: tests/natal.test.js
import * as A from './astronomy.js';
import { PLANETS, YEAR_MIN } from './labels.js';

export const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
export { PLANETS, YEAR_MIN };
const BODY = { sun: A.Body.Sun, mercury: A.Body.Mercury, venus: A.Body.Venus, mars: A.Body.Mars, jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn, uranus: A.Body.Uranus, neptune: A.Body.Neptune, pluto: A.Body.Pluto };
const OUTER = ['uranus', 'neptune', 'pluto'];
// управитель знака по классической схеме: у Скорпиона Марс, у Водолея Сатурн, у Рыб Юпитер
export const RULER = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];
export const ASPECTS = [{ type: 'conj', angle: 0 }, { type: 'sextile', angle: 60 }, { type: 'square', angle: 90 },
  { type: 'trine', angle: 120 }, { type: 'opposition', angle: 180 }];

const R = Math.PI / 180;
export const norm = x => ((x % 360) + 360) % 360;
const diff = (a, b) => { const d = norm(a - b); return d > 180 ? d - 360 : d; };   // a - b в пределах -180..180
export const signOf = lon => Math.floor(norm(lon) / 30);

/* ---------- время ---------- */

const fmtCache = {};
function zoneOffsetMin(ts, tz) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000) / 6e4;
}

/** местное время по часовому поясу IANA -> миллисекунды UTC. Летнее время и декретное время СССР берутся из базы поясов */
export function localToUtc(y, m, d, hh, mi, tz) {
  const local = Date.UTC(y, m - 1, d, hh, mi);
  const first = local - zoneOffsetMin(local, tz) * 6e4;
  return local - zoneOffsetMin(first, tz) * 6e4;
}

export function isValidDate(y, m, d, now = Date.now()) {
  if (![y, m, d].every(Number.isInteger) || y < YEAR_MIN || m < 1 || m > 12 || d < 1) return false;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return false;
  return Date.UTC(y, m - 1, d) <= now;
}

/* ---------- положения ---------- */

function eclLon(body, t) {
  const v = body === 'moon' ? A.GeoMoon(t) : A.GeoVector(BODY[body], t, true);
  const e = A.RotateVector(A.Rotation_EQJ_ECT(t), v);
  return norm(Math.atan2(e.y, e.x) / R);
}

/** долготы и скорости (градусов в сутки) всех 10 планет на момент t (AstroTime). Скорость < 0 = ретроградная */
export function positionsAt(t) {
  const before = t.AddDays(-0.5), after = t.AddDays(0.5);
  const out = {};
  for (const p of PLANETS) out[p] = { lon: eclLon(p, t), speed: diff(eclLon(p, after), eclLon(p, before)) };
  return out;
}

/** истинный (оскулирующий) лунный узел: направление пересечения орбиты Луны с эклиптикой даты */
export function trueNodeAt(t) {
  const s = A.RotateState(A.Rotation_EQJ_ECT(t), A.GeoMoonState(t));
  const hx = s.y * s.vz - s.z * s.vy, hy = s.z * s.vx - s.x * s.vz;
  return norm(Math.atan2(hx, -hy) / R);
}

/* ---------- углы и дома ---------- */

function angles(t, lat, lon) {
  const eps = A.e_tilt(t).tobl * R;
  const ramc = norm(A.SiderealTime(t) * 15 + lon) * R;
  const phi = lat * R;
  const mc = norm(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) / R);
  let asc = norm(Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / R);
  // за полярным кругом формула может дать западную точку: Асцендент всегда впереди MC (правило Swiss Ephemeris)
  if (Math.abs(lat) >= 90 - eps / R && diff(asc, mc) < 0) asc = norm(asc + 180);
  return { eps, ramc, phi, mc, asc };
}

// куспид Плацидуса: точка эклиптики, прошедшая долю f полудуги. above - над горизонтом (11, 12), иначе под ним (2, 3)
function placidusCusp(ramc, phi, eps, f, above) {
  let ra = ramc + (above ? f * 90 : 180 - f * 90) * R;
  for (let i = 0; i < 60; i++) {
    const lam = Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(eps));
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const x = Math.tan(phi) * Math.tan(dec);
    if (Math.abs(x) >= 1) return null;
    const ad = Math.asin(x) / R;
    const next = ramc + (above ? f * (90 + ad) : 180 - f * (90 - ad)) * R;
    if (Math.abs(next - ra) < 1e-10) { ra = next; break; }
    ra = next;
  }
  return norm(Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(eps)) / R);
}

export function houses(t, lat, lon) {
  const { eps, ramc, phi, mc, asc } = angles(t, lat, lon);
  const c11 = placidusCusp(ramc, phi, eps, 1 / 3, true), c12 = placidusCusp(ramc, phi, eps, 2 / 3, true);
  const c2 = placidusCusp(ramc, phi, eps, 2 / 3, false), c3 = placidusCusp(ramc, phi, eps, 1 / 3, false);
  let hsys = 'P', q = [c11, c12, c2, c3];
  if (q.includes(null)) {   // за полярным кругом Плацидус не строится: Порфирий, деление четвертей на три
    hsys = 'O';
    const a1 = norm(asc - mc), a2 = norm(mc + 180 - asc);
    q = [mc + a1 / 3, mc + 2 * a1 / 3, asc + a2 / 3, asc + 2 * a2 / 3].map(norm);
  }
  const [h11, h12, h2, h3] = q;
  const cusps = [asc, h2, h3, mc + 180, h11 + 180, h12 + 180, asc + 180, h2 + 180, h3 + 180, mc, h11, h12].map(norm);
  return { asc, mc, cusps, hsys };
}

export function houseOf(lon, cusps) {
  for (let i = 0; i < 12; i++) {
    const a = cusps[i], b = cusps[(i + 1) % 12];
    if (norm(lon - a) < norm(b - a)) return i + 1;
  }
  return 12;
}

/* ---------- аспекты ---------- */

const orbFor = (a, b, type) => {
  const lum = ['sun', 'moon'].includes(a) || ['sun', 'moon'].includes(b);
  return type === 'sextile' ? (lum ? 5 : 4) : (lum ? 8 : 6);
};
export const aspectKind = type => (type === 'conj' ? 'conj' : ['sextile', 'trine'].includes(type) ? 'soft' : 'hard');

export function aspects(lons) {
  const out = [];
  for (let i = 0; i < PLANETS.length; i++) for (let j = i + 1; j < PLANETS.length; j++) {
    const a = PLANETS[i], b = PLANETS[j];
    if (OUTER.includes(a) && OUTER.includes(b)) continue;   // аспекты поколения, у всех ровесников одинаковые
    const sep = Math.abs(diff(lons[a], lons[b]));
    for (const { type, angle } of ASPECTS) {
      const orb = Math.abs(sep - angle);
      if (orb <= orbFor(a, b, type)) out.push({ a, b, type, kind: aspectKind(type), orb: Math.round(orb * 100) / 100 });
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}
