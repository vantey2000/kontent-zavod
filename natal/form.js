// Форма страницы (26.10.2026): дата, время или «Не знаю время», город с подсказками.
// Справочник городов cities.json (~200 КБ) грузится при первом касании поля города, первый экран его не ждёт
import { makeIndex, searchCities, normName } from './cities.js';
import { YEAR_MIN } from './labels.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let index = null, loading = null, picked = null, hits = [];

export function loadCities() {
  if (!loading) loading = fetch('cities.json').then(r => r.json()).then(d => (index = makeIndex(d))).catch(() => { loading = null; });
  return loading;
}
export const cityLabel = c => (c.region && c.region !== c.name ? `${c.name}, ${c.region}` : c.name);

function showList() {
  const ul = $('f-city-list');
  ul.innerHTML = hits.map((c, i) => `<li><button type="button" data-i="${i}"><b>${esc(c.name)}</b>`
    + `${c.region && c.region !== c.name ? `<span>${esc(c.region)}</span>` : ''}${c.via ? `<span>было: ${esc(c.via)}</span>` : ''}</button></li>`).join('');
  ul.hidden = !hits.length;
}
export function setCity(c) {
  picked = c;
  $('f-city').value = c ? cityLabel(c) : '';
  hits = [];
  showList();
}
async function onInput() {
  picked = null;
  const q = $('f-city').value;
  if (!index) await loadCities();
  if (!index || q !== $('f-city').value) return;   // пока грузилось, человек дописал: искать по новому тексту
  hits = searchCities(index, q, 7);
  showList();
}

export function initForm() {
  const city = $('f-city');
  city.addEventListener('focus', loadCities, { once: true });
  city.addEventListener('input', onInput);
  $('f-city-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) setCity(hits[+b.dataset.i]);
  });
  city.addEventListener('keydown', e => { if (e.key === 'Enter' && hits.length && !picked) { e.preventDefault(); setCity(hits[0]); } });
  const nt = $('f-notime');
  nt.addEventListener('change', () => { $('f-time').disabled = nt.checked; if (nt.checked) $('f-time').value = ''; });
}

/** данные формы {y, m, d, hh, mi, lat, lon, tz, city} или null; err(текст) показывает ошибку */
export async function readForm(err) {
  const d = +$('f-d').value.trim(), m = +$('f-m').value, y = +$('f-y').value.trim();
  const maxY = new Date().getFullYear();
  if (!Number.isInteger(d) || d < 1 || d > 31) return err('Укажи день рождения: число от 1 до 31');
  if (!m) return err('Выбери месяц рождения');
  if (!/^\d{4}$/.test($('f-y').value.trim()) || y < YEAR_MIN || y > maxY) return err(`Укажи год рождения четырьмя цифрами, с ${YEAR_MIN} по ${maxY}`);
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return err('Такой даты нет в календаре. Проверь день и месяц');
  let hh = null, mi = null;
  if (!$('f-notime').checked) {
    const t = /^(\d{1,2}):(\d{2})/.exec($('f-time').value);
    if (!t) return err('Укажи время рождения или отметь «Не знаю время»');
    hh = +t[1]; mi = +t[2];
  }
  if (!picked && $('f-city').value.trim()) {
    // город вписан руками без выбора из подсказки: берём, только если название совпало точно
    if (!index) await loadCities();
    const typed = normName($('f-city').value.split(',')[0]);
    const exact = index ? searchCities(index, typed, 1).filter(c => normName(c.name) === typed || normName(c.via || '') === typed) : [];
    if (exact.length) setCity(exact[0]);
  }
  if (!picked) return err('Начни вводить город рождения и выбери его в подсказке под полем');
  err('');
  return { y, m, d, hh, mi, lat: picked.lat, lon: picked.lon, tz: picked.tz, city: picked.name };
}

export function fillForm(s) {
  $('f-d').value = s.d; $('f-m').value = String(s.m); $('f-y').value = s.y;
  $('f-notime').checked = s.hh === null;
  $('f-time').disabled = s.hh === null;
  $('f-time').value = s.hh === null ? '' : `${String(s.hh).padStart(2, '0')}:${String(s.mi).padStart(2, '0')}`;
  if (s.city) setCity({ name: s.city, region: s.region || '', lat: s.lat, lon: s.lon, tz: s.tz });
}
export const pickedRegion = () => (picked ? picked.region : '');
