// Карта человека целиком из того, что он ввёл на странице (26.10.2026). Расчёт - natal.js, тут сборка:
// режим «не знаю время», баланс стихий и крестов, скопления планет, управитель Асцендента
import * as A from './astronomy.js';
import { PLANETS, RULER, signOf, localToUtc, isValidDate, houses, houseOf, aspects, positionsAt, trueNodeAt } from './natal.js';

import { ELEMENTS, MODES } from './labels.js';
export { ELEMENTS, MODES };
// вес в балансе: светила и Асцендент громче всех, высшие планеты общие для поколения и не считаются
const WEIGHT = { sun: 3, moon: 3, asc: 2, mercury: 2, venus: 2, mars: 2, jupiter: 1, saturn: 1 };

const timeAt = (y, m, d, hh, mi, tz) => A.MakeTime(new Date(localToUtc(y, m, d, hh, mi, tz)));
const sameAsp = (x, y) => x.a === y.a && x.b === y.b && x.type === y.type;

export function balance(signs) {
  const el = [0, 0, 0, 0], mode = [0, 0, 0];
  for (const [k, s] of Object.entries(signs)) {
    const w = WEIGHT[k] || 0;
    el[s % 4] += w;
    mode[s % 3] += w;
  }
  const top = arr => arr.indexOf(Math.max(...arr));
  return { el, mode, topEl: top(el), topMode: top(mode), lackEl: el.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0) };
}

/** скопления: 3 и больше планет в одном знаке или доме */
export function stelliums(planets) {
  const by = key => {
    const m = {};
    for (const p of PLANETS) { const v = planets[p][key]; if (v !== null && v !== undefined) (m[v] = m[v] || []).push(p); }
    return Object.entries(m).filter(([, l]) => l.length >= 3).map(([v, list]) => ({ [key]: +v, planets: list }));
  };
  // в знаке скопление только с личной планетой: Сатурн, Уран и Нептун вместе - это всё поколение, а не человек
  const personal = ['sun', 'moon', 'mercury', 'venus', 'mars'];
  return { signs: by('sign').filter(s => s.planets.some(p => personal.includes(p))), houses: by('house') };
}

/** in = {y, m, d, hh, mi, tz, lat, lon}; hh = null - время неизвестно. Возвращает null для невозможной даты */
export function chart(inp, now = Date.now()) {
  const { y, m, d, tz, lat, lon } = inp;
  if (!isValidDate(y, m, d, now) || !tz || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const known = Number.isInteger(inp.hh) && Number.isInteger(inp.mi) && inp.hh >= 0 && inp.hh < 24 && inp.mi >= 0 && inp.mi < 60;
  const t = known ? timeAt(y, m, d, inp.hh, inp.mi, tz) : timeAt(y, m, d, 12, 0, tz);
  const pos = positionsAt(t);
  const h = known ? houses(t, lat, lon) : null;
  const planets = {};
  for (const p of PLANETS) {
    const { lon: l, speed } = pos[p];
    planets[p] = { lon: l, sign: signOf(l), deg: l % 30, retro: speed < 0, house: h ? houseOf(l, h.cusps) : null };
  }
  const nodeLon = trueNodeAt(t);
  const node = { lon: nodeLon, sign: signOf(nodeLon), house: h ? houseOf(nodeLon, h.cusps) : null };
  const lons = Object.fromEntries(PLANETS.map(p => [p, planets[p].lon]));
  let asp = aspects(lons);
  let moonSigns = null;
  if (!known) {
    // без времени Луна за день проходит 12-15°: знак и аспекты Луны берём только те, что держатся весь день
    const a = positionsAt(timeAt(y, m, d, 0, 0, tz)), b = positionsAt(timeAt(y, m, d, 23, 59, tz));
    const s0 = signOf(a.moon.lon), s1 = signOf(b.moon.lon);
    if (s0 !== s1) moonSigns = [s0, s1];
    const ends = [a, b].map(x => aspects(Object.fromEntries(PLANETS.map(p => [p, x[p].lon]))));
    asp = asp.filter(x => (x.a !== 'moon' && x.b !== 'moon') || ends.every(list => list.some(e => sameAsp(e, x))));
  }
  const signs = Object.fromEntries(['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'].map(p => [p, planets[p].sign]));
  if (h) signs.asc = signOf(h.asc);
  const ascSign = h ? signOf(h.asc) : null;
  return {
    known, utc: new Date(t.date).toISOString(), planets, node, aspects: asp, moonSigns,
    asc: h ? h.asc : null, mc: h ? h.mc : null, cusps: h ? h.cusps : null, hsys: h ? h.hsys : null,
    ascSign, mcSign: h ? signOf(h.mc) : null,
    cuspSigns: h ? h.cusps.map(signOf) : null,
    ruler: ascSign === null ? null : RULER[ascSign],
    balance: balance(signs), stelliums: stelliums(planets),
  };
}

/** где транзитная точка с долготой lon стоит в карте: дом при известном времени, иначе дом от знака Солнца */
export function transitHouse(c, lon) {
  if (c.cusps) return houseOf(lon, c.cusps);
  return (signOf(lon) - c.planets.sun.sign + 12) % 12 + 1;
}
