// Подсказки для поля «Город рождения» по справочнику cities.json (GeoNames, astro/cities.py), 26.10.2026.
// Города в справочнике по убыванию числа жителей, поэтому при равном совпадении первым идёт крупный.
// Старые названия ищутся наравне с новыми: «Ленинград» находит Санкт-Петербург

// как город называют в разговоре, а в справочнике этого нет
const ALIAS = { 'питер': 'Санкт-Петербург', 'спб': 'Санкт-Петербург', 'мск': 'Москва', 'екб': 'Екатеринбург',
  'нск': 'Новосибирск', 'ростов': 'Ростов-на-Дону', 'алма ата': 'Алматы', 'нур султан': 'Астана' };

export const normName = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[-‐-―]/g, ' ').replace(/\s+/g, ' ').trim();

/** {r, z, c} из cities.json -> список для поиска */
export function makeIndex(data) {
  return data.c.map((row, i) => {
    const [name, r, lat, lon, z, old] = row;
    return { i, name, region: data.r[r], lat, lon, tz: data.z[z], old: old || [], keys: [name, ...(old || [])].map(normName) };
  });
}

// 0 - полное совпадение, 1 - начало названия, 2 - начало слова внутри названия, -1 - мимо
function score(key, q) {
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  return key.includes(' ' + q) ? 2 : -1;
}

/** до limit городов: {name, region, lat, lon, tz, via} - via = старое название, по которому нашёлся город */
export function searchCities(index, query, limit = 8) {
  let q = normName(query);
  if (q.length < 2) return [];
  if (ALIAS[q]) q = normName(ALIAS[q]);
  const hits = [];
  for (const c of index) {
    let best = -1, via = null;
    c.keys.forEach((k, j) => {
      const s = score(k, q);
      if (s >= 0 && (best < 0 || s < best)) { best = s; via = j === 0 ? null : c.old[j - 1]; }
    });
    if (best >= 0) hits.push({ c, best, via });
  }
  hits.sort((a, b) => a.best - b.best || a.c.i - b.c.i);
  return hits.slice(0, limit).map(({ c, via }) => ({ name: c.name, region: c.region, lat: c.lat, lon: c.lon, tz: c.tz, via }));
}
