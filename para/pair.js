// Пара по двум датам рождения: процент совместимости и «ваш 2027 вдвоём».
// Знак и животное считает движок 2027 (engine.js). Процент - одно правило для всех, без случайностей:
// аспект знаков (расстояние по кругу зодиака) + отношения восточных животных + стихии года рождения
import { SIGNS, ANIMALS, profile, isValidDate } from './engine.js';

// по расстоянию между знаками 0-6: один знак, соседи, секстиль (огонь-воздух, земля-вода), квадрат,
// трин (одна стихия), квинконс, оппозиция (притяжение противоположностей)
export const ASPECTS = [
  { key: 'same', base: 78 },
  { key: 'next', base: 64 },
  { key: 'sextile', base: 84 },
  { key: 'square', base: 61 },
  { key: 'trine', base: 91 },
  { key: 'quincunx', base: 57 },
  { key: 'opposite', base: 73 },
];

// китайская традиция: шесть гармоний, тройной союз (через 4 года), свой знак, столкновение (через 6), вред
const HARMONY = [[0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7]];
const HARM = [[0, 7], [1, 6], [2, 5], [3, 4], [8, 11], [9, 10]];
export const ANIMAL_BONUS = { harmony: 7, triad: 5, same: 2, neutral: 0, harm: -4, clash: -7 };
// стихии года по кругу Дерево, Огонь, Земля, Металл, Вода: соседняя питает (+1 по кругу), через одну - подавляет
export const ELEMENT_BONUS = { feed: 2, same: 1, control: -2 };
export const SCORE_MIN = 45;
export const SCORE_MAX = 98;

const inPairs = (list, a, b) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export function aspect(a, b) {
  const d = Math.abs(a - b) % 12;
  return ASPECTS[Math.min(d, 12 - d)].key;
}

export function animalRel(a, b) {
  if (a === b) return 'same';
  if (inPairs(HARMONY, a, b)) return 'harmony';
  const d = Math.abs(a - b);
  if (d === 4 || d === 8) return 'triad';
  if (d === 6) return 'clash';
  if (inPairs(HARM, a, b)) return 'harm';
  return 'neutral';
}

export function elementRel(a, b) {
  if (a === b) return 'same';
  const d = (b - a + 5) % 5;
  return d === 1 || d === 4 ? 'feed' : 'control';
}

export const TIERS = [
  [85, 'Редкое совпадение'],
  [75, 'Сильная пара'],
  [65, 'Пара с искрой'],
  [55, 'Притяжение и споры'],
  [0, 'Пара, которая многому учит'],
];
export const tier = score => TIERS.find(([min]) => score >= min)[1];

// her и him - profile() из engine.js, sh и sm - выбранные знаки (основной или второй при стыке)
export function pairScore(her, him, sh = her.zodiac.sign, sm = him.zodiac.sign) {
  const asp = aspect(sh, sm);
  const ani = animalRel(her.chinese.animal, him.chinese.animal);
  const el = elementRel(her.chinese.element, him.chinese.element);
  const raw = ASPECTS.find(a => a.key === asp).base + ANIMAL_BONUS[ani] + ELEMENT_BONUS[el];
  const score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, raw));
  return { score, tier: tier(score), aspect: asp, animals: ani, elements: el };
}

// ключ пары текстов: знаки по порядку зодиака, «oven-lev» и «lev-oven» - один текст
export const SLUG = ['oven', 'telec', 'bliznecy', 'rak', 'lev', 'deva', 'vesy', 'skorpion', 'strelec', 'kozerog', 'vodoley', 'ryby'];
export const pairKey = (a, b) => (a <= b ? [a, b] : [b, a]).map(i => SLUG[i]).join('-');
export const pairIndex = (a, b) => { // 0..77 в порядке (0,0), (0,1) ... (11,11)
  const [x, y] = a <= b ? [a, b] : [b, a];
  return x * 12 - (x * (x - 1)) / 2 + (y - x);
};

/* ---------- 2027 вдвоём: только даты из гороскоп-2027/astro/facts-2027.md ---------- */

// окна Венеры 2027: знак и даты (вход в знак по МСК)
export const VENUS = [
  { sign: 8, from: '07.01', to: '03.02' }, { sign: 9, from: '03.02', to: '01.03' },
  { sign: 10, from: '01.03', to: '26.03' }, { sign: 11, from: '26.03', to: '20.04' },
  { sign: 0, from: '20.04', to: '15.05' }, { sign: 1, from: '15.05', to: '08.06' },
  { sign: 2, from: '08.06', to: '03.07' }, { sign: 3, from: '03.07', to: '27.07' },
  { sign: 4, from: '27.07', to: '20.08' }, { sign: 5, from: '20.08', to: '14.09' },
  { sign: 6, from: '14.09', to: '08.10' }, { sign: 7, from: '08.10', to: '01.11' },
  { sign: 8, from: '01.11', to: '25.11' }, { sign: 9, from: '25.11', to: '19.12' },
];
// напряжённые месяцы 2027: ретро-Меркурий и коридоры затмений. signs - знаки, по которым идёт событие
export const DANGER = [
  { key: 'feb', month: 'февраль', base: 1, events: [
    { kind: 'mercury', from: '9 февраля', to: '3 марта', signs: [11, 10] },
    { kind: 'eclipse', dates: '6 и 21 февраля', signs: [10, 5] }] },
  { key: 'jun', month: 'июнь', base: 1, events: [
    { kind: 'mercury', from: '10 июня', to: '4 июля', signs: [3, 2] }] },
  { key: 'aug', month: 'август', base: 0, events: [
    { kind: 'eclipse', dates: '18 июля, 2 и 17 августа', signs: [9, 4, 10] }] },
  { key: 'oct', month: 'октябрь', base: 1, events: [
    { kind: 'mercury', from: '7 октября', to: '28 октября', signs: [7, 6] }] },
];

export const house = (planetSign, sign) => ((planetSign - sign + 12) % 12) + 1;
const LOVE = { 5: 3, 7: 3, 1: 2 };       // дом романа, дом партнёрства, свой знак
const HURT = { 7: 3, 1: 3, 5: 2, 8: 2, 4: 1 };

// лучшее окно пары: где Венера сильнее всего для обоих. Ничья - где досталось обоим,
// если и тут ничья, берётся среднее из равных окон по году (иначе почти у всех выходил бы январь)
export function bestWindow(sh, sm) {
  const all = VENUS.map(w => {
    const her = LOVE[house(w.sign, sh)] || 0, him = LOVE[house(w.sign, sm)] || 0;
    return { ...w, pts: her + him, both: Math.min(her, him), her: her ? house(w.sign, sh) : 0, him: him ? house(w.sign, sm) : 0 };
  });
  const top = Math.max(...all.map(w => w.pts));
  const tied = all.filter(w => w.pts === top);
  const both = Math.max(...tied.map(w => w.both));
  const best = tied.filter(w => w.both === both);
  return best[Math.floor((best.length - 1) / 2)];
}

// опасный месяц пары: самый тяжёлый по домам обоих (ничья - позже по году: свежие события ближе к концу года)
export function dangerMonth(sh, sm) {
  let worst = null;
  for (const m of DANGER) {
    let pts = m.base;
    const hits = [];
    // у каждого из двоих в зачёт идёт одно самое тяжёлое событие месяца, иначе февраль с двумя событиями побеждает всегда
    for (const [who, s] of [['her', sh], ['him', sm]]) {
      let top = null;
      for (const e of m.events) for (const x of e.signs) {
        const w = HURT[house(x, s)] || 0;
        if (w && (!top || w > top.w)) top = { w, who, kind: e.kind, sign: x, h: house(x, s) };
      }
      if (top) { pts += top.w; hits.push(top); }
    }
    if (!worst || pts >= worst.pts) worst = { key: m.key, month: m.month, pts, hits, events: m.events };
  }
  return worst;
}

const okSign = (want, z) => (Number.isInteger(want) && (want === z.sign || want === z.cusp) ? want : z.sign);

/** её и его профили по датам [y, m, d] и выбранные знаки (основной или второй при стыке); null, если дата не настоящая */
export function pairOf(h, b, wantSh, wantSm) {
  if (!isValidDate(...h) || !isValidDate(...b)) return null;
  const hp = profile(...h), mp = profile(...b);
  return { hp, mp, sh: okSign(wantSh, hp.zodiac), sm: okSign(wantSm, mp.zodiac) };
}

export { SIGNS, ANIMALS };
