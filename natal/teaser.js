// Один конкретный недосказанный факт из карты человека для бесплатной части (26.10.2026).
// Урок «Твоего 2027»: люди уходят перед кнопкой оплаты, если бесплатная часть обрывается на общих словах.
// Поэтому факт берётся из самой карты и обрывается на «что это значит для тебя»
import { PLANET, HOUSE_THEME, ELEMENT_GEN, ASPECT, ELEMENTS, signIn, inHouse } from './labels.js';

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const NUM = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'];
const names = list => list.map(p => PLANET[p]).join(', ');
const PERSONAL = ['sun', 'moon', 'mercury', 'venus', 'mars'];

export function teaser(c) {
  const sh = c.known && [...c.stelliums.houses].sort((a, b) => b.planets.length - a.planets.length)[0];
  if (sh) {
    const n = sh.planets.length;
    return `**${NUM[n][0].toUpperCase() + NUM[n].slice(1)} ${plural(n, 'планета', 'планеты', 'планет')} ${inHouse(sh.house)}: ${names(sh.planets)}.** `
      + `Сюда уходит больше всего твоих сил: ${HOUSE_THEME[sh.house]}. Что это значит для тебя и как этим пользоваться, а не выгорать - в полном разборе`;
  }
  const ss = [...c.stelliums.signs].sort((a, b) => b.planets.length - a.planets.length)[0];
  if (ss) {
    const n = ss.planets.length;
    return `**${NUM[n][0].toUpperCase() + NUM[n].slice(1)} ${plural(n, 'планета', 'планеты', 'планет')} ${signIn(ss.sign)}: ${names(ss.planets)}.** `
      + 'Качество этого знака звучит в тебе громче всего остального. Где это твоя сила, а где перекос - в полном разборе';
  }
  if (c.balance.lackEl.length) {
    const e = ELEMENTS[c.balance.lackEl[0]];
    return `**В твоей карте нет ни одной главной планеты в стихии ${ELEMENT_GEN[e]}.** `
      + 'Это не недостаток, но эту стихию ты добираешь снаружи: через людей, места и привычки. Через что именно - в полном разборе';
  }
  const hard = c.aspects.find(a => a.kind === 'hard' && PERSONAL.includes(a.a) && PERSONAL.includes(a.b) && a.orb < 3);
  if (hard) {
    return `**${PLANET[hard.a]} и ${PLANET[hard.b]} в твоей карте в точном напряжении: ${ASPECT[hard.type]}.** `
      + 'Это внутренний спор, который мешает, пока его не замечаешь, и даёт силу, когда понимаешь, как он устроен. Как именно - в полном разборе';
  }
  const retro = ['venus', 'mars', 'mercury'].find(p => c.planets[p].retro);
  if (retro) {
    return `**${PLANET[retro]} в момент твоего рождения ${retro === 'venus' ? 'шла' : 'шёл'} назад.** `
      + 'Такое бывает не у всех, и эта планета работает у тебя иначе, чем описано в гороскопах по знаку. Как именно - в полном разборе';
  }
  if (c.known) {
    return `**Главная планета твоей карты - ${PLANET[c.ruler]}, и она стоит ${inHouse(c.planets[c.ruler].house)}.** `
      + `Это сфера, куда смотрит вся твоя жизнь: ${HOUSE_THEME[c.planets[c.ruler].house]}. Что это значит для тебя - в полном разборе`;
  }
  return `**Твоя ведущая стихия - ${['огонь', 'земля', 'воздух', 'вода'][c.balance.topEl]}.** `
    + 'От неё зависит, как ты восстанавливаешь силы и что тебя выматывает. Подробно - в полном разборе';
}

