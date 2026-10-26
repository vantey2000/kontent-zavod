// Дата рождения → знак зодиака, животное года рождения, число личного года 2027.
// Знак берётся по точному моменту входа Солнца в знак в год рождения (расчёт astro/calc.py),
// а не по усреднённой таблице «21 марта - 20 апреля»: на стыке знаков таблица ошибается
import { SUN, CNY } from './data.js';

export const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева',
  'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
export const ELEMENTS = ['огонь', 'земля', 'воздух', 'вода']; // Овен огонь, Телец земля, Близнецы воздух, Рак вода...
export const ANIMALS = ['Крыса', 'Бык', 'Тигр', 'Кролик', 'Дракон', 'Змея',
  'Лошадь', 'Коза', 'Обезьяна', 'Петух', 'Собака', 'Свинья'];
export const CN_ELEMENTS = ['Дерево', 'Огонь', 'Земля', 'Металл', 'Вода'];

// порядок входов в SUN: январь - Водолей (10), февраль - Рыбы (11), март - Овен (0) ...
const ORDER_START = 10;
export const YEAR_MIN = 1930;
export const YEAR_MAX = 2027;

const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;

function ingresses(y) {
  return SUN[y].split(',').map((s, i) => ({
    sign: (ORDER_START + i) % 12,
    m: +s.slice(0, 2), d: +s.slice(2, 4), hh: +s.slice(4, 6), mm: +s.slice(6, 8),
  }));
}

export function isValidDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < YEAR_MIN || y > YEAR_MAX || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Знак по МСК на полдень дня рождения. cusp - второй знак, если человек родился в день перехода
// или рядом с ним и без времени рождения знак не определить однозначно (восток России, Европа)
export function zodiac(y, m, d) {
  const day = dayNum(y, m, d);
  const list = ingresses(y);
  let sign = (ORDER_START + 11) % 12; // до январского входа - Козерог
  for (const ing of list) {
    const iDay = dayNum(y, ing.m, ing.d);
    const minutes = ing.hh * 60 + ing.mm;
    if (iDay < day || (iDay === day && minutes < 12 * 60)) sign = ing.sign;
  }
  let cusp = null;
  for (const ing of list) {
    const iDay = dayNum(y, ing.m, ing.d);
    const minutes = ing.hh * 60 + ing.mm;
    const prev = (ing.sign + 11) % 12;
    const near = iDay === day
      || (day === iDay + 1 && minutes >= 15 * 60) // на Камчатке и в Приморье переход уже на следующий день
      || (day === iDay - 1 && minutes < 3 * 60); // в Европе переход ещё накануне
    if (near) cusp = sign === ing.sign ? prev : ing.sign;
  }
  return { sign, name: SIGNS[sign], element: ELEMENTS[sign % 4], cusp, cuspName: cusp === null ? null : SIGNS[cusp] };
}

// Китайский год меняется не 1 января, а в китайский Новый год (с конца января до 20 февраля)
export function chinese(y, m, d) {
  const c = CNY[y];
  const before = dayNum(y, m, d) < dayNum(y, +c.slice(0, 2), +c.slice(2, 4));
  const cy = before ? y - 1 : y;
  const animal = (((cy - 4) % 12) + 12) % 12;
  const element = Math.floor(((((cy - 4) % 10) + 10) % 10) / 2);
  const cDay = dayNum(y, +c.slice(0, 2), +c.slice(2, 4));
  const edge = Math.abs(dayNum(y, m, d) - cDay) <= 1;
  return { year: cy, animal, name: ANIMALS[animal], element, elementName: CN_ELEMENTS[element], edge };
}

const digitSum = (n) => String(n).split('').reduce((s, c) => s + +c, 0);
function reduce(n) {
  while (n > 9) n = digitSum(n);
  return n;
}

// Число личного года: день + месяц рождения + год прогноза, сводится к 1-9
export function personalYear(m, d, year = 2027) {
  return reduce(reduce(digitSum(d)) + reduce(digitSum(m)) + reduce(digitSum(year)));
}

export function profile(y, m, d) {
  if (!isValidDate(y, m, d)) return null;
  return { zodiac: zodiac(y, m, d), chinese: chinese(y, m, d), personalYear: personalYear(m, d) };
}

// «Земляная Лошадь», «Огненный Бык»: прилагательное стихии согласуется с родом животного
const MASC = new Set([1, 2, 3, 4, 9]); // Бык, Тигр, Кролик, Дракон, Петух
const ADJ = [['Деревянный', 'Деревянная'], ['Огненный', 'Огненная'], ['Земляной', 'Земляная'],
  ['Металлический', 'Металлическая'], ['Водяной', 'Водяная']];
export const animalTitle = (animal, element) => `${ADJ[element][MASC.has(animal) ? 0 : 1]} ${ANIMALS[animal]}`;
