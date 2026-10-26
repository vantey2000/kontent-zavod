// Подписи карты по-русски для страницы и сервера (26.10.2026): знаки и дома в нужных падежах, планеты, аспекты, даты.
// Здесь же общие константы: страница берёт их отсюда, не загружая расчёт (astronomy.js ~400 КБ)
export const PLANETS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
export const YEAR_MIN = 1930;
export const ELEMENTS = ['fire', 'earth', 'air', 'water'];     // знак % 4
export const MODES = ['cardinal', 'fixed', 'mutable'];         // знак % 3
export const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
export const SIGNS_IN = ['Овне', 'Тельце', 'Близнецах', 'Раке', 'Льве', 'Деве', 'Весах', 'Скорпионе', 'Стрельце', 'Козероге', 'Водолее', 'Рыбах'];
export const SIGNS_GEN = ['Овна', 'Тельца', 'Близнецов', 'Рака', 'Льва', 'Девы', 'Весов', 'Скорпиона', 'Стрельца', 'Козерога', 'Водолея', 'Рыб'];
export const GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'].map(g => g + '︎');
export const PLANET = { sun: 'Солнце', moon: 'Луна', mercury: 'Меркурий', venus: 'Венера', mars: 'Марс', jupiter: 'Юпитер',
  saturn: 'Сатурн', uranus: 'Уран', neptune: 'Нептун', pluto: 'Плутон' };
export const PLANET_GLYPH = { sun: '☉', moon: '☽', mercury: '☿', venus: '♀', mars: '♂', jupiter: '♃', saturn: '♄', uranus: '♅', neptune: '♆', pluto: '♇' };
export const HOUSE_IN = ['', 'первом', 'втором', 'третьем', 'четвёртом', 'пятом', 'шестом', 'седьмом', 'восьмом', 'девятом', 'десятом', 'одиннадцатом', 'двенадцатом'];
export const HOUSE_DAT = ['', 'первому', 'второму', 'третьему', 'четвёртому', 'пятому', 'шестому', 'седьмому', 'восьмому', 'девятому', 'десятому', 'одиннадцатому', 'двенадцатому'];
export const HOUSE_THEME = ['', 'ты сама и твой образ', 'деньги и самооценка', 'общение и учёба', 'дом, семья и корни', 'любовь, дети и радость',
  'работа и ритм дня', 'партнёр и брак', 'общие деньги и перемены', 'смыслы и дальние дороги', 'карьера и призвание',
  'друзья и планы', 'внутренний мир и отдых'];
export const ELEMENT = { fire: 'огонь', earth: 'земля', air: 'воздух', water: 'вода' };
export const ELEMENT_GEN = { fire: 'огня', earth: 'земли', air: 'воздуха', water: 'воды' };
export const ASPECT = { conj: 'соединение', sextile: 'секстиль', square: 'квадрат', trine: 'трин', opposition: 'оппозиция' };
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const vo = w => (/^(Льве|втором)/.test(w) ? 'во ' : 'в ') + w;
/** «в Раке», «во Льве» */
export const signIn = s => vo(SIGNS_IN[s]);
/** «Венера в Раке» */
export const inSign = (p, s) => `${PLANET[p]} ${signIn(s)}`;
/** «в пятом доме», «во втором доме» */
export const inHouse = h => `${vo(HOUSE_IN[h])} доме`;
/** «Солнце и Луна: квадрат» */
export const aspectTitle = a => `${PLANET[a.a]} и ${PLANET[a.b]}: ${ASPECT[a.type]}`;
/** день года 2027 (0 = 1 января) -> «14 мая» */
export function dayLabel(doy, year = 2027) {
  const d = new Date(Date.UTC(year, 0, 1 + doy));
  return `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
}
/** градус в знаке: «17°36′» */
export function degLabel(lon) {
  const x = ((lon % 30) + 30) % 30;
  let d = Math.floor(x), m = Math.round((x - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return `${d}°${String(m).padStart(2, '0')}′`;
}
