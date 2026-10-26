// Колесо натальной карты строкой SVG (26.10.2026): знаки, дома, планеты, аспекты, Асцендент и MC.
// Чистая функция без DOM: assemble.py рисует ей заставку первого экрана заранее, страница - карту человека.
// Как в астрологических программах: Асцендент слева, знаки идут против часовой стрелки, MC сверху
import { PLANETS, GLYPHS, PLANET_GLYPH } from './labels.js';

const R = { out: 196, sign: 166, ring: 128, in: 70 };
const f = x => Math.round(x * 10) / 10;
const DEG = Math.PI / 180;

/** c - карта chart() или {planets:{p:{lon}}, asc?, mc?, cusps?, aspects?} */
export function wheelSvg(c, { label = 'Натальная карта' } = {}) {
  const asc = c.asc ?? 0;
  const pt = (r, lon) => { const t = (180 + lon - asc) * DEG; return [f(200 + r * Math.cos(t)), f(200 - r * Math.sin(t))]; };
  const s = [`<svg class="nw" viewBox="0 0 400 400" role="img" aria-label="${label}">`];
  for (const [r, cl] of [[R.out, 'w1'], [R.sign, 'w2'], [R.in, 'w3']]) s.push(`<circle cx="200" cy="200" r="${r}" class="${cl}"/>`);
  for (let i = 0; i < 12; i++) {
    const [x1, y1] = pt(R.sign, i * 30), [x2, y2] = pt(R.out, i * 30);
    s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="tk"/>`);
    const [gx, gy] = pt((R.out + R.sign) / 2, i * 30 + 15);
    s.push(`<text x="${gx}" y="${gy}" class="gl ${['fire', 'earth', 'air', 'water'][i % 4]}">${GLYPHS[i]}</text>`);
  }
  if (c.cusps) {
    c.cusps.forEach((cu, i) => {
      const [x1, y1] = pt(R.in, cu), [x2, y2] = pt(R.sign, cu);
      s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${i % 3 === 0 ? 'ax' : 'hs'}"/>`);
      const next = c.cusps[(i + 1) % 12], mid = cu + (((next - cu) % 360 + 360) % 360) / 2;
      const [hx, hy] = pt(R.in + 11, mid);
      s.push(`<text x="${hx}" y="${hy}" class="hn">${i + 1}</text>`);
    });
  }
  // аспекты внутри круга: лёгкие золотом, напряжённые розовым, соединения не рисуем
  for (const a of c.aspects || []) {
    if (a.kind === 'conj') continue;
    const [x1, y1] = pt(R.in, c.planets[a.a].lon), [x2, y2] = pt(R.in, c.planets[a.b].lon);
    s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="as ${a.kind}"/>`);
  }
  // планеты: метка на кольце знаков в точном градусе, знак планеты чуть внутри, близкие разводим на 9°
  const list = PLANETS.filter(p => c.planets[p]).map(p => ({ p, lon: c.planets[p].lon, at: c.planets[p].lon }))
    .sort((a, b) => a.lon - b.lon);
  for (let k = 0; k < 3; k++) for (let i = 1; i <= list.length; i++) {
    const a = list[i - 1], b = list[i % list.length];
    const gap = ((b.at - a.at) % 360 + 360) % 360;
    if (gap < 9) { b.at = a.at + 9; }
  }
  for (const { p, lon, at } of list) {
    const [x1, y1] = pt(R.sign, lon), [x2, y2] = pt(R.sign - 7, lon);
    s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="pt"/>`);
    const [px, py] = pt(R.ring + 16, at);
    s.push(`<text x="${px}" y="${py}" class="pl">${PLANET_GLYPH[p]}︎</text>`);
  }
  if (c.cusps) {
    // подписи внутри кольца домов, у самой оси: снаружи колеса им не хватает места на узком экране
    const [ax, ay] = pt(R.in + 30, asc), [mx, my] = pt(R.in + 30, c.mc);
    s.push(`<text x="${ax}" y="${f(ay - 7)}" class="al" text-anchor="middle">ASC</text>`);
    s.push(`<text x="${f(mx + 14)}" y="${my}" class="al" text-anchor="middle">MC</text>`);
  }
  s.push('</svg>');
  return s.join('');
}
