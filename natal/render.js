// Отрисовка карты на странице (26.10.2026): шапка, колесо, таблица положений, бесплатная часть, полный разбор.
// Расчёт (chart.js + astronomy.js, ~400 КБ) грузится отдельно, после первого экрана: main.js передаёт сюда готовую карту
import { md } from './md.js';
import { FREE } from './free.js';
import { wheelSvg } from './wheel.js';
import { teaser } from './teaser.js';
import { PLANETS, SIGNS, PLANET, PLANET_GLYPH, signIn, degLabel } from './labels.js';

const $ = id => document.getElementById(id);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad = n => String(n).padStart(2, '0');

export const birthLine = b => `${b.d} ${MONTHS[b.m - 1]} ${b.y}, ${b.hh === null ? 'время неизвестно' : `${pad(b.hh)}:${pad(b.mi)}`}${b.city ? ' · ' + b.city : ''}`;

function table(c) {
  const rows = PLANETS.map(p => {
    const x = c.planets[p];
    return `<tr><td><span class="g">${PLANET_GLYPH[p]}︎</span> ${PLANET[p]}${x.retro && p !== 'sun' && p !== 'moon' ? ' <i title="ретроградная">R</i>' : ''}</td>`
      + `<td>${SIGNS[x.sign]} ${degLabel(x.lon)}</td><td>${x.house ? x.house + ' дом' : ''}</td></tr>`;
  });
  if (c.known) {
    rows.unshift(`<tr><td><span class="g">ASC</span> Асцендент</td><td>${SIGNS[c.ascSign]} ${degLabel(c.asc)}</td><td>1 дом</td></tr>`);
    rows.push(`<tr><td><span class="g">MC</span> Вершина карты</td><td>${SIGNS[c.mcSign]} ${degLabel(c.mc)}</td><td>10 дом</td></tr>`);
  }
  return `<table class="pos">${rows.join('')}</table>`;
}

function head(prefix, c, b) {
  $(prefix + '-sub').textContent = birthLine(b);
  $(prefix + '-wheel').innerHTML = wheelSvg(c);
  $(prefix + '-table').innerHTML = table(c);
}

/** бесплатная часть: Солнце, Луна и Асцендент из библиотеки + один факт из карты */
export function renderFree(c, b) {
  head('r', c, b);
  const P = c.planets, out = [];
  out.push(`#### Солнце ${signIn(P.sun.sign)}`, FREE[`free.sun.${P.sun.sign}`]);
  if (c.moonSigns) {
    out.push(`#### Луна ${signIn(c.moonSigns[0])} или ${signIn(c.moonSigns[1])}`,
      'В день твоего рождения Луна перешла из знака в знак. Какой из двух твой, точно скажет время рождения',
      FREE[`free.moon.${c.moonSigns[0]}`], FREE[`free.moon.${c.moonSigns[1]}`]);
  } else out.push(`#### Луна ${signIn(P.moon.sign)}`, FREE[`free.moon.${P.moon.sign}`]);
  if (c.known) out.push(`#### Асцендент ${signIn(c.ascSign)}: как тебя видят другие`, FREE[`free.asc.${c.ascSign}`]);
  else out.push('#### Асцендент: как тебя видят другие',
    'Асцендент считается по точному времени рождения. Время есть в свидетельстве о рождении, у мамы или в роддомовской бирке. Добавь его, и карта станет полной: с Асцендентом, домами и главной планетой');
  $('r-free').innerHTML = md(out.filter(Boolean).join('\n\n'));
  $('r-hook').innerHTML = md(teaser(c));
  $('r-notime').hidden = c.known;
}

/** полный разбор с сервера */
export function renderFull(c, b, text) {
  head('full', c, b);
  $('full-md').innerHTML = md(text);
}

