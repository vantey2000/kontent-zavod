// Движок «надутых» букв: маска текста -> карта высот -> нормали -> свет и фактура
const ENGINE = (() => {
  const INF = 1e20;

  // одномерное преобразование расстояний (Felzenszwalb)
  function dt1d(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }

  // расстояние от каждой точки внутри буквы до края
  function edt(alpha, w, h) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const g = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = alpha[i] > 127 ? INF : 0;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = g[y * w + x];
      dt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = g[y * w + x];
      dt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
    }
    return g;
  }

  // быстрое размытие: три прохода коробочного фильтра
  function blur(src, w, h, r) {
    if (r < 1) return src;
    let a = Float32Array.from(src), b = new Float32Array(w * h);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        let acc = 0; const row = y * w;
        for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
          b[row + x] = acc / (2 * r + 1);
          acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
          a[y * w + x] = acc / (2 * r + 1);
          acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
        }
      }
    }
    return a;
  }

  // детерминированный шум, чтобы кадр не «кипел» от рендера к рендеру
  function hash(x, y) {
    let n = (x * 374761393 + y * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function hex(c) {
    const s = c.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  // маска строки: буквы с ручным трекингом и «раздутием» обводкой
  function mask(o) {
    const size = o.size, pad = Math.round(size * 0.35);
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const font = `${o.weight || 400} ${size}px "${o.font}", sans-serif`;
    x.font = font;
    const chars = [...o.text];
    const tr = (o.tracking || 0) * size;
    const adv = chars.map(ch => x.measureText(ch).width);
    const tw = adv.reduce((s, a) => s + a, 0) + tr * (chars.length - 1);
    c.width = Math.ceil(tw + pad * 2); c.height = Math.ceil(size * 1.25 + pad * 2);
    x.font = font; x.textBaseline = 'alphabetic';
    x.fillStyle = '#fff'; x.strokeStyle = '#fff';
    x.lineJoin = 'round'; x.lineWidth = (o.fatten || 0) * size;
    let cx = pad; const by = pad + size * 0.95;
    chars.forEach((ch, i) => {
      x.fillText(ch, cx, by);
      if (x.lineWidth > 0) x.strokeText(ch, cx, by);
      cx += adv[i] + tr;
    });
    return { c, x, w: c.width, h: c.height, pad };
  }

  const V = (a, b, c) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l]; };
  const LIGHT = V(-0.3, -0.62, 0.75);
  const HALF = V(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
  const mix = (a, b, t) => a + (b - a) * t;

  // как красится одна точка поверхности в каждом материале
  const SHADE = {
    velvet(n, base, hi, px, py) {
      const dif = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const rim = Math.pow(1 - n[2], 1.4);
      const fib = 0.9 + 0.2 * (0.55 * hash(px >> 1, py >> 1) + 0.45 * hash(px, py));
      const k = (0.3 + 0.9 * dif) * fib;
      return [0, 1, 2].map(i => base[i] * k + hi[i] * rim * 0.42 * (0.25 + 0.75 * dif));
    },
    gloss(n, base, hi) {
      const dif = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const sp = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), 60);
      const rim = Math.pow(1 - n[2], 2.2);
      return [0, 1, 2].map(i => base[i] * (0.38 + 0.72 * dif) + hi[i] * rim * 0.35 + 255 * sp * 0.95);
    },
    chrome(n, base) {
      const ry = 2 * n[2] * n[1];
      let e;
      if (ry < -0.05) e = mix(235, 255, Math.min(1, -ry));
      else if (ry < 0.12) e = mix(70, 30, (ry + 0.05) / 0.17);
      else e = mix(120, 215, Math.min(1, (ry - 0.12) / 0.6));
      const sp = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), 90);
      return [0, 1, 2].map(i => e * (0.75 + 0.25 * base[i] / 255) + 255 * sp);
    }
  };

  // надутая строка в выбранном материале
  function puffy(o) {
    const m = o.shape === 'heart' ? heartMask(o) : mask(o), w = m.w, h = m.h;
    const src = m.x.getImageData(0, 0, w, h).data;
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) a[i] = src[i * 4 + 3];
    const R = (o.puff || 0.12) * o.size;
    const d = edt(a, w, h), hm = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const t = Math.min(1, d[i] / R);
      hm[i] = R * Math.sqrt(1 - (1 - t) * (1 - t));
    }
    const H = blur(hm, w, h, Math.max(1, Math.round(o.size * (o.style === 'chrome' ? 0.035 : 0.025))));
    const out = m.x.createImageData(w, h), px = out.data;
    const base = hex(o.color), hi = hex(o.sheen || '#ffffff');
    const shade = SHADE[o.style] || SHADE.velvet;
    const fuzz = o.style === 'velvet' ? Math.max(1, Math.round(o.size * 0.012)) : 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let al = a[i];
      if (fuzz && d[i] < fuzz * 2 + 1) {
        const jx = Math.round((hash(x, y) - 0.5) * 2 * fuzz), jy = Math.round((hash(y, x) - 0.5) * 2 * fuzz);
        const xx = Math.min(w - 1, Math.max(0, x + jx)), yy = Math.min(h - 1, Math.max(0, y + jy));
        al = Math.min(al, a[yy * w + xx] + 40);
      }
      if (!al) continue;
      const n = V(-(H[i + 1] - H[i - 1]) * 0.5, -(H[i + w] - H[i - w]) * 0.5, 1);
      const c = shade(n, base, hi, x, y);
      px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = al;
    }
    m.x.clearRect(0, 0, w, h); m.x.putImageData(out, 0, 0);
    return m;
  }

  // БАРХАТ v2 (по образцу Ивана 22.10): каждая буква надута отдельно, как плюшевая подушка
  const VL = V(-0.35, -0.78, 0.9);

  // внешняя область, связанная с краем картинки; всё пустое, что не связано, - дырки букв
  function exterior(a, w, h) {
    const ext = new Uint8Array(w * h), q = new Int32Array(w * h);
    let head = 0, tail = 0;
    const push = (i) => { if (!ext[i] && a[i] < 128) { ext[i] = 1; q[tail++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      const i = q[head++], x = i % w;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w);
    }
    return ext;
  }

  function vnoise(x, y, s, seed) {
    const gx = Math.floor(x / s), gy = Math.floor(y / s), fx = x / s - gx, fy = y / s - gy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(gx + seed, gy), b = hash(gx + 1 + seed, gy), c = hash(gx + seed, gy + 1), d = hash(gx + 1 + seed, gy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // сердечко вместо галочки над «Й», как в образце
  function heartPath(x, cx, cy, s) {
    x.save(); x.translate(cx - s / 2, cy - s / 2); x.scale(s / 100, s / 100);
    x.beginPath(); x.moveTo(50, 90);
    x.bezierCurveTo(12, 64, 0, 44, 6, 26); x.bezierCurveTo(12, 6, 40, 2, 50, 24);
    x.bezierCurveTo(60, 2, 88, 6, 94, 26); x.bezierCurveTo(100, 44, 88, 64, 50, 90);
    x.fill(); x.restore();
  }

  // одна буква: маска -> подушка -> свет, ворс, тёмные щели вместо дырок
  function velvetGlyph(ch, o, S) {
    const size = o.size * S, fat = (o.fatten || 0.11) * size, gp = Math.ceil(fat + size * 0.12);
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const font = `${o.weight || 400} ${size}px "${o.font}", sans-serif`;
    x.font = font;
    const heart = ch === 'Й' || ch === 'й';
    if (heart) ch = ch === 'Й' ? 'И' : 'и';
    const sq = o.squeeze || 1;
    const adv = x.measureText(ch).width * sq;
    c.width = Math.ceil(adv + gp * 2); c.height = Math.ceil(size * 1.45 + gp * 2);
    x.font = font; x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineJoin = 'round'; x.lineWidth = fat;
    const by = gp + size * 1.12;
    x.save(); x.translate(gp, by); x.scale(sq, 1);
    x.fillText(ch, 0, 0); x.lineWidth = fat / sq; x.strokeText(ch, 0, 0); x.restore();
    if (heart) heartPath(x, gp + adv / 2, by - size * (ch === 'И' ? 0.97 : 0.75), size * 0.34);
    const w = c.width, h = c.height, src = x.getImageData(0, 0, w, h).data;
    // дутые углы: размыть форму буквы и обрезать обратно, как воздушный шар
    const raw = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) raw[i] = src[i * 4 + 3];
    const rb = blur(raw, w, h, Math.max(1, Math.round(size * (o.round || 0.05))));
    const a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = Math.max(0, Math.min(255, (rb[i] - 128) * 4 + 128));
    const d = edt(a, w, h);
    let maxD = 1;
    for (let i = 0; i < w * h; i++) if (d[i] > maxD) maxD = d[i];
    const hm = new Float32Array(w * h);
    const R = Math.min(maxD, (0.075 + (o.fatten || 0.05) * 0.5) * size);
    for (let i = 0; i < w * h; i++) { const t = Math.min(1, d[i] / R); hm[i] = R * Math.sqrt(1 - (1 - t) * (1 - t)); }
    const H = blur(hm, w, h, Math.max(1, Math.round(R * 0.3)));
    const ext = exterior(a, w, h);
    const base = hex(o.color), hi = hex(o.sheen || '#ffffff');
    const out = x.createImageData(w, h), px = out.data;
    const hole = [base[0] * 0.3, base[1] * 0.3, base[2] * 0.3];
    const fz = 1.6 * S;
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx, j = i * 4;
      if (!ext[i] && a[i] < 128) { px[j] = hole[0]; px[j + 1] = hole[1]; px[j + 2] = hole[2]; px[j + 3] = 255; continue; }
      let al = a[i];
      if (!al) continue;
      if (d[i] < fz) al = al * (0.45 + 0.55 * hash(xx * 7, y * 3));
      let nx = -(H[i + 1] - H[i - 1]) * 0.5, ny = -(H[i + w] - H[i - w]) * 0.5, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + 1); nx /= l; ny /= l; nz /= l;
      const dif = Math.max(0, Math.min(1, (nx * VL[0] + ny * VL[1] + nz * VL[2] + 0.35) / 1.35));
      const top = Math.pow(nz, 1.3);
      const k = 0.12 + 0.56 * dif + 0.42 * top;
      const rim = Math.pow(1 - nz, 4) * 0.22 * (0.3 + 0.7 * dif);
      const fib = 1 + 0.07 * (hash(xx, y) - 0.5) + 0.06 * (vnoise(xx, y, 3 * S, 11) - 0.5) + 0.035 * (vnoise(xx, y, 14 * S, 37) - 0.5);
      px[j] = base[0] * k * fib + hi[0] * rim;
      px[j + 1] = base[1] * k * fib + hi[1] * rim;
      px[j + 2] = base[2] * k * fib + hi[2] * rim;
      px[j + 3] = al;
    }
    x.putImageData(out, 0, 0);
    return { c, adv, gp, by };
  }

  // строка бархата: буквы-подушки внахлёст со складкой-тенью, светлая обводка-наклейка, рендер в 2x
  function velvetLine(o) {
    const S = 2, size = o.size * S, tr = (o.tracking || 0) * size;
    const glyphs = [...o.text].map(ch => ch === ' ' ? null : velvetGlyph(ch, o, S));
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `${o.weight || 400} ${size}px "${o.font}", sans-serif`;
    const space = probe.measureText(' ').width;
    const gp = glyphs.reduce((m, g) => g ? Math.max(m, g.gp) : m, 0) || Math.ceil(size * 0.2);
    const pad = gp + Math.ceil(size * 0.06);
    let tw = 0;
    glyphs.forEach((g, i) => { tw += (g ? g.adv : space) + (i < glyphs.length - 1 ? tr : 0); });
    const W = Math.ceil(tw + pad * 2), Hh = Math.ceil(size * 1.45 + pad * 2);
    const by = pad + size * 1.12;
    // буквы на отдельном слое: каждая отбрасывает мягкую тень на соседку слева
    const L = document.createElement('canvas'); L.width = W; L.height = Hh;
    const lx = L.getContext('2d');
    let cx = pad;
    glyphs.forEach((g, i) => {
      if (g) {
        lx.save();
        lx.shadowColor = 'rgba(15,0,6,.75)'; lx.shadowBlur = size * 0.022;
        lx.shadowOffsetX = -size * 0.01; lx.shadowOffsetY = size * 0.008;
        lx.drawImage(g.c, Math.round(cx - g.gp), Math.round(by - g.by));
        lx.restore();
      }
      cx += (g ? g.adv : space) + tr;
    });
    // светлая обводка: силуэт строки, раздутый во все стороны
    const sil = document.createElement('canvas'); sil.width = W; sil.height = Hh;
    const sx = sil.getContext('2d');
    sx.drawImage(L, 0, 0); sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = o.outline || 'rgba(255,255,255,.75)'; sx.fillRect(0, 0, W, Hh);
    const out = document.createElement('canvas'); out.width = W; out.height = Hh;
    const ox = out.getContext('2d'), r = size * 0.016;
    for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; ox.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r); }
    ox.globalCompositeOperation = 'destination-out'; ox.drawImage(L, 0, 0);
    // итог в 1x с качественным сглаживанием
    const c = document.createElement('canvas'); c.width = Math.ceil(W / S); c.height = Math.ceil(Hh / S);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.globalAlpha = 0.85; x.drawImage(out, 0, 0, W, Hh, 0, 0, W / S, Hh / S); x.globalAlpha = 1;
    x.drawImage(L, 0, 0, W, Hh, 0, 0, W / S, Hh / S);
    return { c, x, w: c.width, h: c.height, pad: pad / S, yoff: o.size * 0.17 };
  }

  // БАРХАТ v3 (22.10): шрифт из готовых букв, нарисованных по образцу Ивана. Буквы лежат в atlas/<набор>/
  const ATLAS = { meta: null, img: new Map() };

  const dir = (set) => set.startsWith('f:') ? 'atlas/fonts/' + set.slice(2) + '/' : 'atlas/' + set + '/';

  // GitHub Pages изредка отвечает 503 на всплеск запросов (23.10, и на meta.json): одна повторная попытка
  const getJson = (url, empty) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(r.status))
    .catch(() => new Promise(r => setTimeout(r, 600)).then(() => fetch(url + '?r=1')).then(r => r.ok ? r.json() : empty))
    .catch(() => empty);

  // какие шрифты уже надуты в бархат (список из atlas/fonts/index.json)
  async function atlasIndex() {
    if (!ATLAS.index) ATLAS.index = await getJson('atlas/fonts/index.json', {});
    return ATLAS.index;
  }
  function fontSet(name) { const e = ATLAS.index && ATLAS.index[name]; return e ? 'f:' + e.slug : null; }

  async function atlasLoad(chars, sets) {
    if (!ATLAS.meta) ATLAS.meta = await getJson('atlas/atlas.json', {});
    await Promise.all(sets.filter(s => !ATLAS.meta[s]).map(async s => {
      ATLAS.meta[s] = await getJson(dir(s) + 'meta.json', {});
    }));
    const jobs = [];
    sets.forEach(set => [...new Set([...chars, '♥'])].forEach(ch => {
      const m = ATLAS.meta[set] && ATLAS.meta[set][ch];
      const key = set + ch;
      if (!m || ATLAS.img.has(key)) return;
      const im = new Image(); im.decoding = 'async'; im.src = dir(set) + m.f;
      ATLAS.img.set(key, im);
      // GitHub Pages изредка отвечает 503 на всплеск запросов (2 из 2417 в проверке 23.10): одна повторная попытка
      const retry = () => new Promise(r => setTimeout(r, 600)).then(() => { im.src = dir(set) + m.f + '?r=1'; return im.decode(); });
      jobs.push(im.decode().catch(retry).catch(() => null));
    }));
    await Promise.all(jobs);
  }

  // каких знаков текста нет в наборе (латиница, редкие символы)
  function atlasMissing(text, set) {
    if (!ATLAS.meta) return '';
    const have = ATLAS.meta.dark || {};
    const fs = set && ATLAS.meta[set] || {};
    return [...new Set([...text.toUpperCase()].filter(ch => ch.trim() && !have[ch] && !fs[ch]))].join(' ');
  }

  // перекраска под другую палитру: яркость ворса сохраняется, меняется только цвет
  function tint(im, meta, to) {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    const lo = meta._lo || 30, hi = meta._hi || 230;
    const light = 0.3 * to[0] + 0.59 * to[1] + 0.11 * to[2] > 150;
    const sh = to.map(v => v * (light ? 0.74 : 0.3)), hl = to.map(v => v + (255 - v) * (light ? 0.6 : 0.28));
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const t = Math.max(0, Math.min(1, (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2] - lo) / (hi - lo)));
      for (let j = 0; j < 3; j++) p[i + j] = t < 0.55 ? sh[j] + (to[j] - sh[j]) * (t / 0.55) : to[j] + (hl[j] - to[j]) * ((t - 0.55) / 0.45);
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  // сердечко в конце заголовка из того же набора
  function atlasHeart(size) {
    const im = ATLAS.img.get('light♥'), m = ATLAS.meta && ATLAS.meta.light && ATLAS.meta.light['♥'];
    if (!im || !m || !im.naturalWidth) return null;
    const k = size / m.h, c = document.createElement('canvas');
    c.width = Math.ceil(m.w * k); c.height = Math.ceil(size);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
    return { c, pad: 0 };
  }

  function atlasLine(o) {
    const set = o.set || 'dark', meta = ATLAS.meta && ATLAS.meta[set];
    const cap = o.size * 0.74, over = cap * (o.overlap == null ? 0.07 : o.overlap);
    const S = 2, chars = [...o.text.toUpperCase()];
    const parts = chars.map(ch => {
      // знака нет в наборе шрифта - берём его из родного розового набора
      let s = set, m = meta && meta[ch];
      if (!m && set.startsWith('f:') && ATLAS.meta.light && ATLAS.meta.light[ch]) { s = 'light'; m = ATLAS.meta.light[ch]; }
      const im = ATLAS.img.get(s + ch);
      if (!m || !im || !im.naturalWidth) return { space: true, w: cap * (ch === ' ' ? 0.16 : 0.5) };
      const k = cap / m.cap;
      return { im, m, ch, set: s, w: m.w * k * (o.squeeze || 1), h: m.h * k };
    });
    const tw = parts.reduce((s, p, i) => s + p.w - (i && !p.space && !parts[i - 1].space ? over : 0), 0);
    const pad = Math.ceil(o.size * 0.3);
    const W = Math.ceil((tw + pad * 2) * S), H = Math.ceil((o.size * 1.45 + pad * 2) * S);
    const base = (pad + o.size * 1.12) * S;
    const L = document.createElement('canvas'); L.width = W; L.height = H;
    const lx = L.getContext('2d');
    lx.imageSmoothingQuality = 'high';
    const target = (o.vcolor || o.color || '').toLowerCase();
    let cx = pad * S, inkTop = base - cap * S, inkBottom = base;
    parts.forEach((p, i) => {
      if (i && !p.space && !parts[i - 1].space) cx -= over * S;
      if (!p.space) {
        const pm = ATLAS.meta[p.set];
        const src = target && target !== pm._nominal ? (p.im['_t' + target] || (p.im['_t' + target] = tint(p.im, pm, hex(target)))) : p.im;
        const w = p.w * S, h = p.h * S, al = p.m.al;
        const y = al === 'desc' ? base - cap * S : al === 'mid' ? base - cap * 0.45 * S - h / 2 : al === 'comma' ? base - h * 0.6 : base - h;
        lx.save();
        lx.shadowColor = 'rgba(15,0,6,.55)'; lx.shadowBlur = cap * 0.05 * S;
        lx.shadowOffsetX = -cap * 0.015 * S; lx.shadowOffsetY = cap * 0.02 * S;
        lx.drawImage(src, cx, y, w, h);
        inkTop = Math.min(inkTop, y); inkBottom = Math.max(inkBottom, y + h);
        lx.restore();
      }
      cx += p.w * S;
    });
    // светлая обводка вокруг строки, как у наклейки в образце
    const sil = document.createElement('canvas'); sil.width = W; sil.height = H;
    const sx = sil.getContext('2d');
    sx.drawImage(L, 0, 0); sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = 'rgba(255,255,255,.7)'; sx.fillRect(0, 0, W, H);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ox = out.getContext('2d'), r = cap * 0.022 * S;
    for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; ox.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r); }
    ox.globalCompositeOperation = 'destination-out'; ox.drawImage(L, 0, 0);
    const c = document.createElement('canvas'); c.width = Math.ceil(W / S); c.height = Math.ceil(H / S);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.globalAlpha = 0.8; x.drawImage(out, 0, 0, W, H, 0, 0, W / S, H / S); x.globalAlpha = 1;
    x.drawImage(L, 0, 0, W, H, 0, 0, W / S, H / S);
    return { c, x, w: c.width, h: c.height, pad, yoff: o.size * 0.17, by: base / S, asc: (base - inkTop) / S, desc: (inkBottom - base) / S };
  }

  // сердечко-декор в том же материале, что и буквы
  function heartMask(o) {
    const s = o.size, pad = Math.round(s * 0.35);
    const c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = c.height = Math.ceil(s + pad * 2);
    x.fillStyle = '#fff';
    x.translate(pad, pad); x.scale(s / 100, s / 100);
    x.beginPath();
    x.moveTo(50, 88);
    x.bezierCurveTo(14, 64, 0, 44, 6, 26);
    x.bezierCurveTo(12, 8, 38, 4, 50, 24);
    x.bezierCurveTo(62, 4, 88, 8, 94, 26);
    x.bezierCurveTo(100, 44, 86, 64, 50, 88);
    x.fill();
    x.setTransform(1, 0, 0, 1, 0, 0);
    return { c, x, w: c.width, h: c.height, pad };
  }

  // плоские стили: стикер, 3D-блок, неон, простой
  function flat(o) {
    const m = mask(Object.assign({}, o, { fatten: 0 }));
    const { x, w, h, pad } = m, s = o.size;
    const chars = [...o.text], tr = (o.tracking || 0) * s;
    x.clearRect(0, 0, w, h);
    x.font = `${o.weight || 400} ${s}px "${o.font}", sans-serif`; x.lineJoin = 'round';
    const adv = chars.map(ch => x.measureText(ch).width);
    const each = (fn) => { let cx = pad; chars.forEach((ch, i) => { fn(ch, cx, pad + s * 0.95); cx += adv[i] + tr; }); };
    const edge = o.edge || '#111111';
    if (o.style === 'sticker') {
      x.strokeStyle = edge; x.lineWidth = s * 0.24;
      each((ch, cx, cy) => x.strokeText(ch, cx, cy));
      x.fillStyle = o.color; each((ch, cx, cy) => x.fillText(ch, cx, cy));
    } else if (o.style === 'extrude') {
      const depth = Math.round(s * 0.11);
      x.fillStyle = edge;
      for (let k = depth; k > 0; k--) each((ch, cx, cy) => x.fillText(ch, cx + k * 0.6, cy + k));
      x.fillStyle = o.color; each((ch, cx, cy) => x.fillText(ch, cx, cy));
      x.strokeStyle = edge; x.lineWidth = s * 0.03;
      each((ch, cx, cy) => x.strokeText(ch, cx, cy));
    } else if (o.style === 'neon') {
      x.strokeStyle = o.color; x.lineWidth = s * 0.07;
      for (const b of [s * 0.45, s * 0.22, s * 0.08]) {
        x.shadowColor = o.color; x.shadowBlur = b;
        each((ch, cx, cy) => x.strokeText(ch, cx, cy));
      }
      x.shadowBlur = 0; x.strokeStyle = '#ffffff'; x.lineWidth = s * 0.025;
      each((ch, cx, cy) => x.strokeText(ch, cx, cy));
    } else {
      x.fillStyle = o.color; each((ch, cx, cy) => x.fillText(ch, cx, cy));
    }
    return m;
  }

  const PUFFY = new Set(['velvet', 'gloss', 'chrome']);
  const draw1 = (o) => o.style === 'atlas' ? atlasLine(o) : o.style === 'velvet' ? velvetLine(o) : PUFFY.has(o.style) ? puffy(o) : flat(o);
  // готовые строки запоминаются: при наборе текста пересчитывается только изменённая строка
  const cache = new Map();
  function line(o) {
    const key = [o.style, o.set, ATLAS.meta ? 1 : 0, o.text, o.font, o.weight, o.size, o.color, o.sheen, o.edge, o.tracking, o.fatten, o.round, o.squeeze, o.puff, o.overlap, o.vcolor].join('|');
    if (cache.has(key)) { const m = cache.get(key); cache.delete(key); cache.set(key, m); return m; }
    const m = draw1(o);
    cache.set(key, m);
    if (cache.size > 14) cache.delete(cache.keys().next().value);
    return m;
  }

  // тень запекается в картинку строки один раз, чтобы кадры рисовались быстро
  function bake(m, o, shadow) {
    if (!shadow) return { c: m.c, w: m.w, h: m.h, pad: m.pad };
    const e = Math.ceil(o.size * 0.2);
    const c = document.createElement('canvas'); c.width = m.w + e * 2; c.height = m.h + e * 2;
    const x = c.getContext('2d');
    x.shadowColor = 'rgba(25,0,10,.5)'; x.shadowBlur = o.size * 0.09; x.shadowOffsetY = o.size * 0.05;
    x.drawImage(m.c, e, e);
    return { c, w: c.width, h: c.height, pad: m.pad + e };
  }

  // раскладка заголовка: картинки строк и их места относительно центра блока
  function layout(t) {
    const parts = [];
    let y = 0, base = null, prevDesc = 0;
    t.lines.forEach(l => {
      const o = Object.assign({ font: t.font, weight: t.weight, style: t.style, tracking: t.tracking, fatten: t.fatten, round: t.round, squeeze: t.squeeze, puff: t.puff }, l);
      let m = line(o);
      const maxW = (t.maxW || 960) - (o.heart ? o.size * 1.25 : 0), tw = m.w - m.pad * 2;
      if (tw > maxW) { o.size = Math.floor(o.size * maxW / tw); m = line(o); }
      const b = bake(m, o, t.shadow !== false && o.style !== 'neon');
      const part = { c: b.c, x: -b.w / 2, y: y - b.pad, w: b.w, h: b.h, tw: m.w - m.pad * 2, size: o.size, top: y + (m.yoff || 0) };
      if (m.by != null) {
        // строки по самим буквам: следующая начинается ниже самой низкой точки предыдущей, с зазором
        base = base == null ? m.asc : base + prevDesc + o.size * (t.gap == null ? 0.06 : t.gap) + m.asc;
        prevDesc = m.desc;
        part.y = base - m.by - (b.pad - m.pad);
        part.top = base - o.size * 0.74 - o.size * 0.14;
        part.bottom = base + m.desc;
      }
      if (o.heart) {
        const hm = (o.style === 'atlas' && atlasHeart(o.size * 0.62)) || puffy({ shape: 'heart', size: o.size * 0.62, color: o.heart, sheen: '#ffffff', style: 'gloss', puff: 0.22 });
        part.heart = { c: hm.c, x: part.tw / 2 - hm.pad + o.size * 0.08, y: part.top + o.size * 0.3 - hm.pad };
      }
      parts.push(part);
      y += o.size * (t.leading || 0.86);
    });
    const last = parts[parts.length - 1];
    const height = last ? (last.bottom != null ? last.bottom : last.top + last.size * 1.05) : 0;
    // длинный заголовок не вылезает из видимой части кадра: все строки уменьшаются в одной пропорции
    if (t.maxH && height > t.maxH) return layout(Object.assign({}, t, { maxH: 0, lines: t.lines.map((l, i) => Object.assign({}, l, { size: Math.floor(parts[i].size * t.maxH / height) })) }));
    parts.forEach(p => { p.y -= height / 2; p.top -= height / 2; if (p.heart) p.heart.y -= height / 2; });
    const width = parts.reduce((s, p) => Math.max(s, p.tw + (p.heart ? p.size * 0.9 : 0)), 0);
    return { parts, width, height };
  }

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const outCubic = (p) => 1 - Math.pow(1 - p, 3);
  const outBack = (p) => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const outBounce = (p) => {
    const n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  };

  // как строка i выглядит в момент t (секунды от появления заголовка)
  function motion(anim, i, t) {
    if (anim === 'pop' || anim === 'pulse') {
      const p = clamp((t - i * 0.09) / 0.5);
      return { k: p ? outBack(p) : 0, dx: 0, dy: 0, a: clamp(p * 3) };
    }
    if (anim === 'drop') {
      const p = clamp((t - i * 0.12) / 0.7);
      return { k: 1, dx: 0, dy: -(1 - outBounce(p)) * 900, a: p > 0 ? 1 : 0 };
    }
    if (anim === 'lines') {
      const p = clamp((t - i * 0.14) / 0.45);
      return { k: 1, dx: (i % 2 ? 1 : -1) * (1 - outCubic(p)) * 1200, dy: 0, a: p > 0 ? 1 : 0 };
    }
    return { k: 1, dx: 0, dy: 0, a: 1 };
  }

  // кадр заголовка: o = { cx, cy, scale, anim, t, left } (left = сколько секунд до исчезновения)
  function draw(ctx, L, o) {
    const S = o.scale || 1, t = o.t == null ? 99 : o.t;
    let fade = 1;
    if (o.left != null && o.left < 0.3) fade = clamp(o.left / 0.3);
    if (fade <= 0) return;
    const breathe = o.anim === 'pulse' && t > 0.6 ? 1 + 0.035 * Math.sin((t - 0.6) * Math.PI * 1.6) : 1;
    L.parts.forEach((p, i) => {
      const m = motion(o.anim, i, t);
      if (!m.a || !m.k) return;
      const pcy = p.y + p.h / 2;
      ctx.save();
      ctx.globalAlpha = m.a * fade;
      ctx.translate(o.cx, o.cy);
      ctx.scale(S * breathe, S * breathe);
      ctx.translate(m.dx, pcy + m.dy);
      ctx.scale(m.k, m.k);
      ctx.drawImage(p.c, -p.w / 2, -p.h / 2);
      if (p.heart) ctx.drawImage(p.heart.c, p.heart.x, p.heart.y - pcy);
      ctx.restore();
    });
  }

  // где буквы лежат в кадре: для проверки рамок и перетаскивания
  function box(L, cx, cy, S) {
    const rects = [];
    L.parts.forEach(p => {
      const y0 = cy + (p.top + p.size * 0.14) * S, y1 = cy + (p.top + p.size * 1.02) * S;
      rects.push({ x0: cx - p.tw / 2 * S, x1: cx + p.tw / 2 * S, y0, y1 });
      if (p.heart) rects.push({ x0: cx + (p.tw / 2) * S, x1: cx + (p.tw / 2 + p.size * 0.62) * S, y0: cy + (p.top + p.size * 0.3) * S, y1: cy + (p.top + p.size * 0.9) * S });
    });
    return rects.length ? rects : null;
  }

  // загрузка шрифтов с русскими буквами: без образца браузер тянет только латиницу
  async function ready(specs) {
    await Promise.all(specs.map(f => document.fonts.load(f, 'АБВГДЕЖЗИЙЯя AZ').catch(() => null)));
  }

  // сколько знаков в загруженном наборе (проверка, что карта букв шрифта пришла с сайта, а не пустая)
  const atlasCount = (set) => Object.keys((ATLAS.meta && ATLAS.meta[set]) || {}).filter(k => k[0] !== '_').length;
  return { layout, draw, box, ready, atlasLoad, atlasMissing, atlasIndex, fontSet, atlasCount };
})();

// шрифты с кириллицей (проверены по каталогу Google Fonts 22.10.2026) и самый жирный вес каждого
const FONT_GROUPS = [
  ['Пухлые и жирные', [['Rubik', 900], ['Nunito', 1000], ['M PLUS Rounded 1c', 900], ['Unbounded', 900], ['Dela Gothic One', 400], ['Rubik Mono One', 400], ['Oi', 400], ['Climate Crisis', 400], ['Russo One', 400], ['Days One', 400], ['Seymour One', 400]]],
  ['Игривые', [['Rubik Bubbles', 400], ['Comfortaa', 700], ['Balsamiq Sans', 700], ['Shantell Sans', 800], ['Kablammo', 400], ['Train One', 400], ['Rampart One', 400], ['Rubik Doodle Shadow', 400], ['Rubik Puddles', 400]]],
  ['Рукописные', [['Lobster', 400], ['Pacifico', 400], ['Caveat', 700], ['Marck Script', 400], ['Bad Script', 400], ['Great Vibes', 400], ['Amatic SC', 700], ['Comforter Brush', 400]]],
  ['Ретро и пиксель', [['Press Start 2P', 400], ['Pixelify Sans', 700], ['Tektur', 800], ['Handjet', 700], ['Rubik 80s Fade', 400], ['Stalinist One', 400], ['Rubik Iso', 400]]],
  ['Граффити и гранж', [['Rubik Spray Paint', 400], ['Rubik Wet Paint', 400], ['Rubik Glitch', 400], ['Rubik Burned', 400], ['Rubik Dirt', 400], ['Rubik Storm', 400], ['Rubik Marker Hatch', 400]]],
  ['Нежные и дорогие', [['Yeseva One', 400], ['Forum', 400], ['Poiret One', 400], ['Playfair Display', 900], ['Cormorant', 700], ['Ruslan Display', 400]]]
];
const FONT_W = {};
FONT_GROUPS.forEach(([, list]) => list.forEach(([f, w]) => { FONT_W[f] = w; }));

// палитры: светлая строка, тёмная строка, сердечко
const PALETTES = [
  { id: 'pink', name: 'Розовый', l: '#f7aec8', d: '#8f1440', h: '#ff7fb0', vd: '#b8123c' },
  { id: 'lilac', name: 'Конфета', l: '#ff3d9a', d: '#6c2bff', h: '#ff8cc6' },
  { id: 'mint', name: 'Мята', l: '#a8f0d4', d: '#0b6b50', h: '#5fe0b0' },
  { id: 'sky', name: 'Небо', l: '#a9d8ff', d: '#1c3fa0', h: '#7cc0ff' },
  { id: 'lemon', name: 'Лимон', l: '#ffd400', d: '#141414', h: '#ffd400' },
  { id: 'fire', name: 'Огонь', l: '#fff3e0', d: '#ff5a1f', h: '#ff8a5c' },
  { id: 'choco', name: 'Шоколад', l: '#f3d2b3', d: '#5b2a12', h: '#e8a77a' },
  { id: 'neon', name: 'Неон', l: '#ff4fd8', d: '#38f3ff', h: '#ff4fd8' },
  { id: 'red', name: 'Красный', l: '#ffffff', d: '#e3122d', h: '#ff4d6a' },
  { id: 'bw', name: 'Чёрно-белый', l: '#ffffff', d: '#141414', h: '#ffffff' }
];

// готовые оформления: материал + шрифт + размеры строк + какая строка светлая, какая тёмная
const STYLES = [
  { id: 'barhat', name: 'Бархат', style: 'atlas', font: 'Rubik', weight: 700, overlap: 0.11, tracking: -0.035, fatten: 0.1, round: 0.025, squeeze: 0.78, puff: 0.2, leading: 0.64, sizes: [150, 236, 236, 184], roles: 'lddl', pal: 'pink' },
  { id: 'sharik', name: 'Шарик', style: 'gloss', font: 'Nunito', tracking: -0.03, fatten: 0.06, puff: 0.14, leading: 0.86, sizes: [112, 176, 176, 140], roles: 'lddl', pal: 'lilac' },
  { id: 'zefir', name: 'Зефир', style: 'velvet', font: 'M PLUS Rounded 1c', tracking: -0.04, fatten: 0.075, round: 0.03, squeeze: 0.88, puff: 0.2, leading: 0.84, sizes: [112, 170, 170, 136], roles: 'lddl', pal: 'mint' },
  { id: 'karamel', name: 'Карамель', style: 'gloss', font: 'Unbounded', tracking: -0.04, fatten: 0.03, puff: 0.12, leading: 0.9, sizes: [84, 128, 136, 104], roles: 'lddl', pal: 'fire' },
  { id: 'sticker', name: 'Стикер', style: 'sticker', font: 'Rubik Mono One', tracking: -0.02, leading: 1.0, sizes: [82, 120, 140, 96], roles: 'dlld', pal: 'lemon' },
  { id: 'blok', name: '3D-блок', style: 'extrude', font: 'Dela Gothic One', tracking: 0, leading: 1.02, sizes: [96, 150, 168, 112], roles: 'lddl', pal: 'fire' },
  { id: 'neon', name: 'Неон', style: 'neon', font: 'Lobster', tracking: 0, leading: 0.98, shadow: false, sizes: [110, 170, 170, 130], roles: 'lddl', pal: 'neon' },
  { id: 'ruka', name: 'Рукописный', style: 'sticker', font: 'Pacifico', tracking: 0, leading: 1.05, sizes: [100, 150, 150, 120], roles: 'dldl', pal: 'red' },
  { id: 'piksel', name: 'Пиксель', style: 'extrude', font: 'Press Start 2P', tracking: 0, leading: 1.25, sizes: [58, 86, 96, 72], roles: 'lddl', pal: 'lemon' },
  { id: 'graffiti', name: 'Граффити', style: 'plain', font: 'Rubik Spray Paint', tracking: -0.02, leading: 0.95, sizes: [110, 165, 165, 130], roles: 'lddl', pal: 'red' }
];

function pal(id) { return PALETTES.find(p => p.id === id) || PALETTES[0]; }

function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// собрать заголовок: оформление + текст + выбор шрифта и цвета
function buildTitle(st, text, o) {
  const p = Object.assign({}, pal(o.pal || st.pal));
  if (o.colorL) p.l = o.colorL;
  if (o.colorD) p.d = o.colorD;
  const font = o.font || st.font;
  // бархат на выбранном шрифте: плюшевые буквы этого шрифта, если набор уже нарисован
  const velvetish = st.style === 'atlas' || st.style === 'velvet';
  const fset = velvetish && (o.font || st.style === 'velvet') ? ENGINE.fontSet(font) : null;
  const lines = text.map((s, i) => {
    const role = st.roles[i % st.roles.length];
    const color = role === 'l' ? p.l : p.d;
    const other = role === 'l' ? p.d : p.l;
    const edge = st.edge || (st.style === 'extrude' ? shadeHex(p.d, -0.7) : other);
    return { text: s, size: st.sizes[i % st.sizes.length], color, sheen: shadeHex(color, 0.55), edge, set: fset || (role === 'l' ? 'light' : 'dark'), overlap: fset ? 0.08 : st.overlap, vcolor: fset ? (role === 'l' ? (p.vl || p.l) : (p.vd || shadeHex(p.d, 0.1))) : undefined };
  });
  const weight = (!o.font && st.weight) || FONT_W[font] || 400;
  const style = fset ? 'atlas' : st.style === 'atlas' && o.font ? 'velvet' : st.style;
  return { font, weight, style, tracking: st.tracking, fatten: st.fatten, round: st.round, squeeze: fset ? 1 : st.squeeze, puff: st.puff, leading: fset && st.style === 'velvet' ? 0.72 : st.leading, shadow: st.shadow, lines, maxW: 800, maxH: 940 };
}

// безопасные рамки рилса 1080×1920. Верх и края по требованиям Meta (14% сверху, 6% с боков),
// кнопки справа и подпись снизу по раскладке ленты Reels, строгая рамка Meta для рекламы (35% снизу).
// Низ по скрину Ивана 23.10 (iPhone, подпись в одну строку): ник с 1721, подпись до 1862, рамка с 1690
const ZONES = [
  { id: 'top', name: 'шапку Reels', x: 0, y: 0, w: 1080, h: 269 },
  { id: 'rail', name: 'кнопки лайков', x: 940, y: 1000, w: 140, h: 690 },
  { id: 'bottom', name: 'ник и подпись', x: 0, y: 1690, w: 1080, h: 230 },
  { id: 'left', name: 'левый край', x: 0, y: 269, w: 65, h: 1421 },
  { id: 'right', name: 'правый край', x: 1015, y: 269, w: 65, h: 731 }
];
const AD_FRAME = { x: 65, y: 269, w: 950, h: 979 };
const GRID = { y0: 240, y1: 1680 };

const hit = (r, z) => r.x0 < z.x + z.w && r.x1 > z.x && r.y0 < z.y + z.h && r.y1 > z.y;

// rects = прямоугольники каждой строки и сердечка
function zoneCheck(rects) {
  const rs = rects || [];
  const bad = ZONES.filter(z => rs.some(r => hit(r, z)));
  const inAd = rs.every(r => r.x0 >= AD_FRAME.x && r.x1 <= AD_FRAME.x + AD_FRAME.w && r.y0 >= AD_FRAME.y && r.y1 <= AD_FRAME.y + AD_FRAME.h);
  const inGrid = rs.every(r => r.y0 >= GRID.y0 && r.y1 <= GRID.y1);
  return { bad, inAd, inGrid };
}

function pill(x, text, tx, ty, color) {
  x.font = '600 26px "Golos Text", system-ui, sans-serif';
  const w = x.measureText(text).width + 24;
  x.fillStyle = color; x.beginPath();
  if (x.roundRect) x.roundRect(tx, ty, w, 40, 20); else x.rect(tx, ty, w, 40);
  x.fill();
  x.fillStyle = '#1a1400'; x.fillText(text, tx + 12, ty + 29);
}

function drawZones(x, show, b) {
  if (!show.zones && !show.grid) return;
  const chk = zoneCheck(b);
  x.save();
  if (show.zones) {
    ZONES.forEach(z => {
      const bad = chk.bad.includes(z);
      x.fillStyle = bad ? 'rgba(255,40,60,.38)' : 'rgba(255,214,0,.26)';
      x.fillRect(z.x, z.y, z.w, z.h);
      x.strokeStyle = bad ? '#ff2a3c' : '#ffd600'; x.lineWidth = 3;
      x.strokeRect(z.x + 1.5, z.y + 1.5, z.w - 3, z.h - 3);
    });
    // схема интерфейса: кнопки справа, аватар и строки подписи снизу
    x.fillStyle = 'rgba(255,255,255,.55)';
    [1090, 1220, 1350, 1470].forEach(cy => { x.beginPath(); x.arc(1024, cy, 30, 0, Math.PI * 2); x.fill(); });
    x.beginPath(); x.arc(130, 1762, 40, 0, Math.PI * 2); x.fill();
    x.fillRect(190, 1724, 260, 30); x.fillRect(190, 1774, 300, 22); x.fillRect(96, 1840, 520, 24);
    pill(x, 'Шапка Reels', 24, 200, '#ffd600');
    pill(x, 'Ник, подпись, музыка', 520, 1702, '#ffd600');
    x.save(); x.translate(946, 1682); x.rotate(-Math.PI / 2); pill(x, 'Лайки, комменты', 0, 0, '#ffd600'); x.restore();
    x.setLineDash([18, 14]); x.strokeStyle = 'rgba(255,214,0,.9)'; x.lineWidth = 3;
    x.strokeRect(AD_FRAME.x, AD_FRAME.y, AD_FRAME.w, AD_FRAME.h);
    x.setLineDash([]);
    pill(x, 'Пунктир: строгая рамка для рекламы', AD_FRAME.x + 12, AD_FRAME.y + 14, 'rgba(255,214,0,.85)');
  }
  if (show.grid) {
    x.fillStyle = 'rgba(0,0,0,.45)';
    x.fillRect(0, 0, 1080, GRID.y0); x.fillRect(0, GRID.y1, 1080, 1920 - GRID.y1);
    x.setLineDash([10, 10]); x.strokeStyle = '#7fe3ff'; x.lineWidth = 3;
    x.strokeRect(1.5, GRID.y0, 1077, GRID.y1 - GRID.y0); x.setLineDash([]);
    pill(x, 'Видно в сетке профиля 3:4', 300, GRID.y0 + 12, '#7fe3ff');
  }
  x.restore();
  return chk;
}

// сборка MP4 1080×1920 без звука прямо в браузере
const EXPORT = (() => {
  const W = 1080, H = 1920, FPS = 30;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // перемотка на кадр: ждём, пока браузер реально покажет новый кадр
  function seek(v, t) {
    return new Promise(res => {
      let done = false, seeked = false;
      const fin = () => { if (!done) { done = true; res(); } };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { if (seeked) fin(); else setTimeout(fin, 0); });
      v.addEventListener('seeked', () => { seeked = true; setTimeout(fin, 40); }, { once: true });
      setTimeout(fin, 2000);
      v.currentTime = t;
    });
  }

  // Safari не сообщает цветовое пространство и длительность кадра, а упаковщику они нужны
  const CS = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
  function sink(muxer) {
    return (chunk, meta) => {
      if (meta && meta.decoderConfig && !meta.decoderConfig.colorSpace) meta = Object.assign({}, meta, { decoderConfig: Object.assign({}, meta.decoderConfig, { colorSpace: CS }) });
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, chunk.duration > 0 ? chunk.duration : Math.round(1e6 / FPS), meta);
    };
  }

  async function pickCodec() {
    if (!('VideoEncoder' in window)) return null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032', 'avc1.4d0032']) {
      const cfg = { codec, width: W, height: H, bitrate: 10000000, framerate: FPS, avc: { format: 'avc' } };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return cfg; } catch (e) {}
    }
    return null;
  }

  // основной путь: WebCodecs покадрово, ровно 30 кадров в секунду
  async function webcodecs(cfg, v, paint, onProgress) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    let fail = null;
    const enc = new VideoEncoder({ output: sink(muxer), error: (e) => { fail = e; } });
    enc.configure(cfg);
    const n = Math.max(1, Math.floor(v.duration * FPS));
    v.pause();
    for (let i = 0; i < n; i++) {
      if (fail) throw fail;
      const t = i / FPS;
      await seek(v, Math.min((i + 0.5) / FPS, v.duration - 0.001));
      paint(x, t);
      const frame = new VideoFrame(cv, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
      enc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 6) await sleep(4);
      onProgress((i + 1) / n);
    }
    await enc.flush();
    if (fail) throw fail;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  }

  // быстрый путь: ролик проигрывается один раз, каждый показанный кадр сразу кодируется
  async function playthrough(cfg, v, paint, onProgress) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    let fail = null, last = -1, count = 0;
    const enc = new VideoEncoder({ output: sink(muxer), error: (e) => { fail = e; } });
    enc.configure(cfg);
    v.pause(); v.loop = false; await seek(v, 0);
    const finished = new Promise((res, rej) => {
      const onFrame = (now, meta) => {
        if (fail) return rej(fail);
        const t = meta.mediaTime;
        if (t > last + 0.001) {
          last = t;
          paint(x, t);
          const frame = new VideoFrame(cv, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
          enc.encode(frame, { keyFrame: count % 60 === 0 });
          frame.close(); count++;
          onProgress(Math.min(1, t / v.duration));
        }
        if (!v.ended) v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
      v.addEventListener('ended', () => setTimeout(res, 80), { once: true });
    });
    v.playbackRate = 0.5; // вдвое медленнее: телефон успевает нарисовать каждый кадр
    await v.play();
    try { await finished; } finally { v.playbackRate = 1; v.loop = true; }
    await enc.flush();
    if (fail) throw fail;
    if (count < 2) throw new Error('браузер не отдал кадры видео');
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  }

  // запасной путь: запись холста в реальном времени (если браузер не умеет WebCodecs)
  async function recorder(v, paint, onProgress) {
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('Этот браузер не умеет собирать видео. Открой страницу в Safari или Chrome');
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const rec = new MediaRecorder(cv.captureStream(FPS), { mimeType: type, videoBitsPerSecond: 10000000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    v.loop = false; v.currentTime = 0; await seek(v, 0);
    rec.start(250);
    await v.play();
    await new Promise(res => {
      const tick = () => {
        paint(x, v.currentTime); onProgress(v.currentTime / v.duration);
        if (v.ended || v.currentTime >= v.duration - 0.02) return res();
        requestAnimationFrame(tick);
      };
      tick();
    });
    rec.stop(); await stopped; v.loop = true;
    return new Blob(parts, { type: type.split(';')[0] });
  }

  async function run(v, paint, onProgress) {
    const cfg = await pickCodec();
    const fast = cfg && v.requestVideoFrameCallback;
    const blob = fast ? await playthrough(cfg, v, paint, onProgress) : cfg ? await webcodecs(cfg, v, paint, onProgress) : await recorder(v, paint, onProgress);
    return { blob, ext: blob.type.includes('webm') ? 'webm' : 'mp4', way: (fast ? 'play ' : cfg ? 'seek ' : 'recorder ') + (cfg ? cfg.codec : '') };
  }

  return { run, W, H };
})();

// шрифты: полный файл грузится только для выбранного, превью в списке идут урезанными копиями под своим именем
const FONTS = (() => {
  const GF = 'https://fonts.googleapis.com/css2?';
  const fam = (f, w) => 'family=' + f.replace(/ /g, '+') + (w && w !== 400 ? ':wght@' + w : '');
  const loaded = new Map();

  function loadFont(f, weight) {
    const w = weight || FONT_W[f] || 400, key = f + ':' + w;
    if (loaded.has(key)) return loaded.get(key);
    const p = new Promise(res => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = GF + fam(f, w) + '&display=block';
      l.onload = () => res(); l.onerror = () => res();
      document.head.appendChild(l);
    }).then(() => ENGINE.ready([`${w} 100px "${f}"`]));
    loaded.set(key, p);
    return p;
  }

  // урезанные копии под именем «П-<шрифт>»: не мешают полному файлу того же шрифта
  async function previews(list, text) {
    const chars = Array.from(new Set(text.split(''))).join('');
    const chunks = [];
    for (let i = 0; i < list.length; i += 12) chunks.push(list.slice(i, i + 12));
    await Promise.all(chunks.map(async ch => {
      try {
        const url = GF + ch.map(f => fam(f, FONT_W[f])).join('&') + '&text=' + encodeURIComponent(chars) + '&display=swap';
        const css = await (await fetch(url)).text();
        const st = document.createElement('style');
        st.textContent = css.replace(/font-family:\s*'([^']+)'/g, (m, n) => "font-family: 'П-" + n + "'");
        document.head.appendChild(st);
      } catch (e) { /* без превью список всё равно работает */ }
    }));
  }

  return { loadFont, previews };
})();

// состояние экрана, превью и общий рисовальщик кадра (превью и экспорт рисуют одно и то же)
const $ = (id) => document.getElementById(id);
const DEF = { look: 'barhat', font: null, pal: null, cL: null, cD: null, anim: 'pop', text: 'САМЫЙ ТОПОВЫЙ\nДОМАШНИЙ\nДЕВАЙС\nДЛЯ ЛИЦА', scale: 1, cx: 540, cy: 1180, tIn: 0, tOut: null, zones: true, grid: false };
let S = Object.assign({}, DEF);
try { const saved = JSON.parse(localStorage.getItem('zag-state') || 'null'); if (saved) S = Object.assign(S, saved, { tIn: 0, tOut: null }); } catch (e) {}
const persist = () => { try { localStorage.setItem('zag-state', JSON.stringify(S)); } catch (e) {} };

const cv = $('cv'), ctx = cv.getContext('2d');
const video = document.createElement('video');
video.muted = true; video.playsInline = true; video.loop = true; video.preload = 'auto';
video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-hidden', 'true');
// айфон не грузит и не играет видео вне страницы и невидимое, поэтому оно лежит на сцене под холстом
video.className = 'vsrc'; $('stage').prepend(video);
const demo = new Image(); demo.src = 'demo.jpg';
let hasVideo = false, exporting = false, paused = false, L = null, snapGuide = false, vidWait = '';
let lastStatus = '', fakeStart = performance.now(), atlasWarn = '';

const look = () => STYLES.find(s => s.id === S.look) || STYLES[0];
const lines = () => S.text.split('\n').map(s => s.trim()).filter(Boolean);
const dur = () => (hasVideo && isFinite(video.duration) ? video.duration : 4);
const tOut = () => (S.tOut == null ? dur() : Math.min(S.tOut, dur()));

function cover(x, src, sw, sh) {
  if (!sw || !sh) { x.fillStyle = '#000'; x.fillRect(0, 0, 1080, 1920); return; }
  const k = Math.max(1080 / sw, 1920 / sh), dw = sw * k, dh = sh * k;
  x.drawImage(src, (1080 - dw) / 2, (1920 - dh) / 2, dw, dh);
}

// один кадр: фон + заголовок в момент time (секунды ролика)
function paint(x, time) {
  if (hasVideo) cover(x, video, video.videoWidth, video.videoHeight);
  else cover(x, demo, demo.naturalWidth, demo.naturalHeight);
  if (!L || time < S.tIn || time > tOut()) return;
  const left = tOut() < dur() - 0.05 ? tOut() - time : null;
  ENGINE.draw(x, L, { cx: S.cx, cy: S.cy, scale: S.scale, anim: S.anim, t: time - S.tIn, left });
}

let rebuildTimer = 0, rebuildN = 0;
function rebuild(delay) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    const n = ++rebuildN, st = look(), font = S.font || st.font;
    const fset = (st.style === 'atlas' || st.style === 'velvet') && (S.font || st.style === 'velvet') ? ENGINE.fontSet(font) : null;
    if ((st.style === 'atlas' && !S.font) || fset) { await ENGINE.atlasLoad(lines().join('').toUpperCase(), fset ? ['light', fset] : ['light', 'dark']); atlasWarn = ENGINE.atlasMissing(lines().join(''), fset); }
    else { atlasWarn = ''; await FONTS.loadFont(font, (!S.font && st.weight) || FONT_W[font]); }
    if (n !== rebuildN) return;
    const opts = { font: S.font, pal: S.pal, colorL: S.cL, colorD: S.cD };
    L = lines().length ? ENGINE.layout(buildTitle(st, lines(), opts)) : null;
    hideDone();
  }, delay == null ? 120 : delay);
}

function setStatus(text, cls) {
  if (text === lastStatus) return;
  lastStatus = text; const el = $('status'); el.textContent = text; el.className = 'status' + (cls ? ' ' + cls : '');
}

function previewTime() {
  if (hasVideo) return video.currentTime;
  return ((performance.now() - fakeStart) / 1000) % dur();
}

function loop() {
  requestAnimationFrame(loop);
  if (exporting) return;
  const time = paused && !hasVideo ? tOut() - 0.001 : previewTime();
  paint(ctx, time);
  const b = L ? ENGINE.box(L, S.cx, S.cy, S.scale) : null;
  const chk = drawZones(ctx, { zones: S.zones, grid: S.grid }, b);
  if (snapGuide) { ctx.fillStyle = '#7fe3ff'; ctx.fillRect(539, 0, 2, 1920); }
  if (vidWait) setStatus(vidWait);
  else if (atlasWarn) setStatus('В «Бархате» нет знаков: ' + atlasWarn + '. Они пропущены', 'bad');
  else if (!S.zones || !chk) setStatus('Двигай заголовок пальцем, двумя пальцами меняй размер');
  else if (chk.bad.length) setStatus('Заголовок заходит под ' + chk.bad.map(z => z.name).join(', '), 'bad');
  else setStatus('В рилсе всё видно', 'good');
}

// вкладки, ленты выбора и перетаскивание заголовка
const ANIMS = [['none', 'Без анимации'], ['pop', 'Выпрыгивает'], ['drop', 'Падает сверху'], ['lines', 'По строкам'], ['pulse', 'Пульсирует']];
const press = (root, attr, val) => root.querySelectorAll('[' + attr + ']').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === val)));

function restartAnim() {
  if (hasVideo) { try { video.currentTime = S.tIn; } catch (e) {} } else fakeStart = performance.now();
}

function buildTabs() {
  document.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
}

// карточки оформлений: каждое написано своим же материалом
async function buildLooks() {
  const box = $('looks');
  STYLES.forEach(st => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card'; b.setAttribute('data-look', st.id);
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const n = document.createElement('span'); n.textContent = st.name;
    b.append(c, n); box.appendChild(b);
    b.addEventListener('click', () => {
      S.look = st.id; S.font = null; S.pal = null; S.cL = null; S.cD = null;
      press(box, 'data-look', st.id); press($('fonts'), 'data-font', '');
      press($('pals'), 'data-pal', st.pal); syncColors(); persist(); rebuild(0); restartAnim();
    });
  });
  press(box, 'data-look', S.look);
  const fonts = Array.from(new Set(STYLES.map(s => s.font)));
  await FONTS.previews(fonts, STYLES.map(s => s.name).join(''));
  await ENGINE.ready(fonts.map(f => `${FONT_W[f] || 400} 100px "П-${f}"`));
  for (const st of STYLES) {
    const fs = st.style === 'velvet' ? ENGINE.fontSet(st.font) : null;
    if (st.style === 'atlas' || fs) await ENGINE.atlasLoad(st.name.toUpperCase(), fs ? ['light', fs] : ['dark']);
  }
  STYLES.forEach(st => {
    const c = box.querySelector('[data-look="' + st.id + '"] canvas'), x = c.getContext('2d');
    const t = buildTitle(Object.assign({}, st, { heart: false, roles: 'd' }), [st.name], {});
    t.font = 'П-' + st.font; t.lines[0].size = 110; t.maxW = 2000;
    const lay = ENGINE.layout(t);
    const k = Math.min(270 / Math.max(1, lay.width), 150 / Math.max(1, lay.height));
    x.clearRect(0, 0, 300, 200);
    ENGINE.draw(x, lay, { cx: 150, cy: 100, scale: k });
  });
}

function buildFonts() {
  const box = $('fonts');
  FONT_GROUPS.forEach(([title, list]) => {
    const g = document.createElement('div'); g.className = 'fgroup';
    const h = document.createElement('h3'); h.textContent = title; g.appendChild(h);
    const l = document.createElement('div'); l.className = 'flist';
    list.forEach(([f, w]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fbtn'; b.setAttribute('data-font', f);
      const s = document.createElement('span'); s.className = 's'; s.textContent = 'Заголовок';
      s.style.fontFamily = `"П-${f}", "Golos Text", sans-serif`; s.style.fontWeight = w;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = f;
      b.append(s, n); l.appendChild(b);
      b.addEventListener('click', () => { S.font = f; press(box, 'data-font', f); persist(); rebuild(0); });
    });
    g.appendChild(l); box.appendChild(g);
  });
  press(box, 'data-font', S.font || '');
  FONTS.previews(FONT_GROUPS.flatMap(([, list]) => list.map(([f]) => f)), 'Заголовок');
}

function syncColors() {
  const p = pal(S.pal || look().pal);
  $('cL').value = S.cL || p.l; $('cD').value = S.cD || p.d;
}

function buildColors() {
  const box = $('pals');
  PALETTES.forEach(p => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pal'; b.setAttribute('data-pal', p.id);
    const i = document.createElement('i'); i.style.background = `linear-gradient(90deg, ${p.l} 0 50%, ${p.d} 50% 100%)`;
    const n = document.createElement('span'); n.textContent = p.name;
    b.append(i, n); box.appendChild(b);
    b.addEventListener('click', () => { S.pal = p.id; S.cL = null; S.cD = null; press(box, 'data-pal', p.id); syncColors(); persist(); rebuild(0); });
  });
  press(box, 'data-pal', S.pal || look().pal);
  $('cL').addEventListener('input', e => { S.cL = e.target.value; persist(); rebuild(); });
  $('cD').addEventListener('input', e => { S.cD = e.target.value; persist(); rebuild(); });
  syncColors();
}

function buildAnims() {
  const box = $('anims');
  ANIMS.forEach(([id, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('data-anim', id); b.textContent = name;
    b.addEventListener('click', () => { S.anim = id; press(box, 'data-anim', id); persist(); hideDone(); restartAnim(); });
    box.appendChild(b);
  });
  press(box, 'data-anim', S.anim);
}

const sec = (v) => v.toFixed(1).replace('.', ',') + ' с';
function syncTime() {
  const d = dur();
  $('tIn').value = Math.round(S.tIn / d * 100); $('tOut').value = Math.round(tOut() / d * 100);
  $('tInV').textContent = sec(S.tIn); $('tOutV').textContent = sec(tOut());
}
function buildTime() {
  $('tIn').addEventListener('input', e => { S.tIn = Math.min(e.target.value / 100 * dur(), tOut() - 0.5); if (S.tIn < 0) S.tIn = 0; syncTime(); hideDone(); restartAnim(); });
  $('tOut').addEventListener('input', e => { S.tOut = Math.max(e.target.value / 100 * dur(), S.tIn + 0.5); syncTime(); hideDone(); });
  syncTime();
}

// пальцы: один двигает заголовок, два меняют размер
function buildDrag() {
  const st = $('stage'), pts = new Map();
  let start = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * 1080 / r.width, y: (e.clientY - r.top) * 1920 / r.height }; };
  const snapshot = () => {
    const a = [...pts.values()];
    const mid = a.length > 1 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 } : a[0];
    const dist = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
    start = { mid, dist, cx: S.cx, cy: S.cy, scale: S.scale };
  };
  st.addEventListener('pointerdown', e => { if (e.target.closest('.vtap')) return; st.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); snapshot(); });
  st.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, pos(e));
    const a = [...pts.values()];
    const mid = a.length > 1 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 } : a[0];
    let cx = start.cx + mid.x - start.mid.x;
    snapGuide = Math.abs(cx - 540) < 22; if (snapGuide) cx = 540;
    S.cx = Math.round(cx); S.cy = Math.round(start.cy + mid.y - start.mid.y);
    if (a.length > 1 && start.dist > 20) {
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      S.scale = Math.max(0.4, Math.min(1.6, start.scale * d / start.dist)); syncSize();
    }
  });
  const up = (e) => { pts.delete(e.pointerId); snapGuide = false; if (pts.size) snapshot(); else { start = null; persist(); hideDone(); } };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
}

function syncSize() { $('size').value = Math.round(S.scale * 100); $('sizeV').textContent = Math.round(S.scale * 100) + '%'; }

function buildText() {
  $('txt').value = S.text;
  $('txt').addEventListener('input', e => { S.text = e.target.value; persist(); rebuild(220); });
  $('size').addEventListener('input', e => { S.scale = e.target.value / 100; syncSize(); persist(); hideDone(); });
  syncSize();
  const tog = (id, key) => { const b = $(id); b.setAttribute('aria-pressed', String(!!S[key])); b.addEventListener('click', () => { S[key] = !S[key]; b.setAttribute('aria-pressed', String(S[key])); persist(); }); };
  tog('tZones', 'zones'); tog('tGrid', 'grid');
  $('tPlay').addEventListener('click', () => {
    paused = !paused; $('tPlay').setAttribute('aria-pressed', String(paused));
    if (hasVideo) { if (paused) video.pause(); else video.play().catch(() => {}); }
  });
  $('tCenter').addEventListener('click', () => { S.cx = 540; S.cy = DEF.cy; S.scale = 1; syncSize(); persist(); hideDone(); });
}

const BAD_VIDEO = 'Это видео браузер не открыл. Попробуй другой файл или в камере айфона включи формат «Наиболее совместимый»';
let tapTimer = 0;
function buildFile() {
  // айфон не грузит видео, пока его не включили: нажатие на кнопку заранее разрешает включать его без нового нажатия
  document.querySelector('.upl').addEventListener('click', () => { if (!hasVideo) { video.load(); video.play().catch(() => {}); } });
  $('file').addEventListener('change', () => {
    const f = $('file').files[0]; if (!f) return;
    $('file').value = '';                                    // тот же файл можно выбрать ещё раз
    showErr(''); hideDone(); hasVideo = false; vidWait = 'Открываю видео…';
    const old = video.src;
    video.src = URL.createObjectURL(f);
    if (old.startsWith('blob:')) URL.revokeObjectURL(old);
    video.load(); video.play().catch(() => {});              // без play айфон не начнёт грузить и не даст loadeddata
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { if (!hasVideo && !video.error) { vidWait = 'Нажми «Показать видео» на картинке'; $('vTap').hidden = false; } }, 2500);
  });
  const ready = () => {
    if (hasVideo || !video.src) return;
    clearTimeout(tapTimer); vidWait = ''; $('vTap').hidden = true;
    if (!video.videoWidth) { video.pause(); return showErr(BAD_VIDEO); }   // звук открылся, картинка нет (HEVC в Chrome)
    hasVideo = true; S.tIn = 0; S.tOut = null; syncTime(); hideDone();
    if (paused) video.pause(); else video.play().catch(() => {});
  };
  video.addEventListener('loadeddata', ready); video.addEventListener('canplay', ready);
  video.addEventListener('error', () => {
    if (!video.src) return;
    clearTimeout(tapTimer); hasVideo = false; vidWait = ''; $('vTap').hidden = true; showErr(BAD_VIDEO);
  });
  $('vTap').addEventListener('click', () => {
    $('vTap').hidden = true; vidWait = 'Открываю видео…';
    video.play().catch(e => { vidWait = ''; showErr('Видео не включилось (' + (e && e.name || e) + '). Открой ссылку в Safari и загрузи ещё раз'); });
  });
}

// сборка и отдача файла
let outFile = null;
function hideDone() { outFile = null; $('done').hidden = true; $('make').hidden = false; }
function showErr(t) { const e = $('outErr'); e.textContent = t; e.hidden = !t; }

async function make() {
  if (!hasVideo) return showErr('Сначала загрузи своё видео кнопкой «Загрузить видео» сверху');
  if (!L) return showErr('Напиши текст заголовка во вкладке «Текст»');
  showErr(''); exporting = true; $('make').disabled = true; $('bar').hidden = false;
  const t0 = performance.now();
  try {
    const r = await EXPORT.run(video, paint, p => { $('barI').style.width = Math.round(p * 100) + '%'; $('make').textContent = 'Собираю… ' + Math.round(p * 100) + '%'; });
    outFile = new File([r.blob], 'zagolovok.' + r.ext, { type: r.blob.type }); window.__way = r.way;
    $('make').hidden = true; $('done').hidden = false;
    $('outHint').textContent = 'Готово за ' + Math.round((performance.now() - t0) / 1000) + ' с, ' + (r.blob.size / 1048576).toFixed(1).replace('.', ',') + ' МБ. «Поделиться» открывает меню телефона: там Instagram и «Сохранить видео»';
  } catch (e) {
    showErr('Не получилось собрать видео: ' + (e && e.message ? e.message : e));
  } finally {
    exporting = false; $('make').disabled = false; $('make').textContent = 'Собрать видео'; $('bar').hidden = true;
    video.loop = true; try { video.currentTime = 0; } catch (e) {} if (!paused) video.play().catch(() => {});
  }
}

async function share() {
  if (!outFile) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: [outFile] })) await navigator.share({ files: [outFile], title: 'Рилсовая' });
    else showErr('На этом устройстве «Поделиться» недоступно. Нажми «Скачать» или открой страницу с телефона');
  } catch (e) {
    if (e && e.name === 'NotAllowedError') showErr('Видео готово, нажми «Поделиться» ещё раз');
  }
}

function save() {
  if (!outFile) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(outFile); a.download = outFile.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

(async function init() {
  buildTabs(); buildText(); buildColors(); buildAnims(); buildTime(); buildDrag(); buildFile(); buildFonts();
  $('make').addEventListener('click', make); $('share').addEventListener('click', share); $('save').addEventListener('click', save);
  // шрифт догрузился позже сборки заголовка: перерисовать
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', (e) => {
    const cur = S.font || look().font;
    if ((e.fontfaces || []).some(f => f.family.replace(/["']/g, '') === cur)) rebuild(60);
  });
  await demo.decode().catch(() => null);
  await ENGINE.atlasIndex();
  rebuild(0);
  requestAnimationFrame(loop);
  buildLooks();
})();

// уникализатор: чистые функции без экрана (проверяются в node: tests/uniq_core.test.mjs)
// модель отдаёт список правок «кусок → замена», здесь они находятся в тексте, проходят фильтры
// и набираются под плашку N% равномерно по тексту; доля слов считается как difflib в text_diff.py
const UNIQ = (() => {
  const WORD = /[\p{L}\p{N}]+/gu;
  const words = (t) => (String(t).toLowerCase().match(WORD) || []);

  // сумма совпавших кусков, как SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks()
  function matched(a, b) {
    const b2j = new Map();
    b.forEach((x, j) => { const l = b2j.get(x); if (l) l.push(j); else b2j.set(x, [j]); });
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      let bi = alo, bj = blo, size = 0, j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const next = new Map();
        for (const j of (b2j.get(a[i]) || [])) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          next.set(j, k);
          if (k > size) { bi = i - k + 1; bj = j - k + 1; size = k; }
        }
        j2len = next;
      }
      if (!size) continue;
      total += size;
      if (alo < bi && blo < bj) queue.push([alo, bi, blo, bj]);
      if (bi + size < ahi && bj + size < bhi) queue.push([bi + size, ahi, bj + size, bhi]);
    }
    return total;
  }

  // доля изменённых слов, проценты
  function pct(a, b) {
    const wa = words(a), wb = words(b), n = Math.max(wa.length, wb.length);
    return n ? 100 * (1 - matched(wa, wb) / n) : 0;
  }

  // куски до max знаков по границам предложений (модель лучше правит короткое)
  function chunks(text, max = 700) {
    const ends = [];
    const re = /[.!?…]+["»)]*\s+|\n+/g;
    let m;
    while ((m = re.exec(text))) ends.push(m.index + m[0].length);
    if (!ends.length || ends[ends.length - 1] < text.length) ends.push(text.length);
    const out = [];
    let s = 0, cur = 0;
    for (const e of ends) {
      if (e - s > max && cur > s) { out.push([s, cur]); s = cur; }
      while (e - s > max * 2) {                       // сверхдлинное предложение режем по пробелу
        const cut = text.lastIndexOf(' ', s + max * 2) > s ? text.lastIndexOf(' ', s + max * 2) + 1 : s + max * 2;
        out.push([s, cut]); s = cut;
      }
      cur = e;
    }
    if (cur > s) out.push([s, cur]);
    return out.filter(([a, b]) => text.slice(a, b).trim()).map(([a, b]) => ({ s: a, e: b, text: text.slice(a, b) }));
  }

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // знаки на краях замены, которых нет на краях куска («приборы» → «приборы.» дало бы «приборы..»)
  const LEAD = /^[\s.,:;!?…-]+/, TRAIL = /[\s.,:;!?…-]+$/;
  function edges(f, t) {
    const core = t.replace(LEAD, '').replace(TRAIL, '');
    return core ? (f.match(LEAD) || [''])[0] + core + (f.match(TRAIL) || [''])[0] : '';
  }

  // правки куска → места в тексте; кусок должен найтись в своём отрезке ровно один раз, пересечения выкидываются
  function locate(text, chunk, list) {
    const body = text.slice(chunk.s, chunk.e), out = [];
    for (const x of list || []) {
      if (!x || typeof x.f !== 'string' || typeof x.t !== 'string') continue;
      const f = x.f.trim(), t = edges(f, x.t.replace(/\s+/g, ' ').trim());
      if (!f || !t) continue;
      const re = new RegExp(esc(f).replace(/\s+/g, '\\s+'), 'g');
      const hits = [...body.matchAll(re)];
      if (hits.length !== 1) continue;
      const s = chunk.s + hits[0].index, e = s + hits[0][0].length;
      if (text.slice(s, e) === t) continue;
      if (out.some((o) => s < o.e && o.s < e)) continue;
      out.push({ s, e, t, ok: x.ok !== false });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  const TY = new Set(['ты', 'тебя', 'тебе', 'тобой', 'твой', 'твоя', 'твоё', 'твое', 'твои', 'твоих', 'твоим', 'твою', 'твоего']);
  const VY = new Set(['вы', 'вас', 'вам', 'вами', 'ваш', 'ваша', 'ваше', 'ваши', 'вашего', 'вашей', 'вашим', 'ваших', 'вашу']);
  const BAN = ['данн', 'дабы', 'осуществл', 'башк', 'являющ', 'вышеуказ', 'нижеслед'];
  const hasLatin = (s) => /[a-z]/i.test(s);

  // слова с заглавной не в начале предложения = имена и названия
  function names(src, s, e) {
    const out = [];
    for (const m of src.slice(s, e).matchAll(/[\p{Lu}][\p{Ll}]+/gu)) {
      const prev = src.slice(0, s + m.index).replace(/\s+$/, '');
      if (prev && !/[.!?…:«"„(\n-]$/.test(prev)) out.push(m[0]);
    }
    return out;
  }

  // спорная правка = причина, годная = ''
  function guard(text, ed) {
    const f = text.slice(ed.s, ed.e), t = ed.t, wf = words(f), wt = words(t);
    if (!wt.length) return 'пусто';
    if (wf.join(' ') === wt.join(' ')) return 'без слов';
    if ((f.match(/\d+/g) || []).join() !== (t.match(/\d+/g) || []).join()) return 'числа';
    if (names(text, ed.s, ed.e).some((n) => !t.includes(n))) return 'имя';
    const after = words(text.slice(ed.e, ed.e + 80)), before = words(text.slice(Math.max(0, ed.s - 80), ed.s));
    for (const n of [1, 2, 3]) {
      if (n > wt.length) break;
      const tailT = wt.slice(-n).join(' '), headT = wt.slice(0, n).join(' ');
      if (n > 1 || wt.length > wf.length) {
        if (after.length >= n && tailT === after.slice(0, n).join(' ') && tailT !== wf.slice(-n).join(' ')) return 'повтор';
        if (before.length >= n && headT === before.slice(-n).join(' ') && headT !== wf.slice(0, n).join(' ')) return 'повтор';
      }
    }
    const fresh = names(t, 0, t.length).filter((n) => !f.includes(n));
    if (fresh.some((n) => text.slice(ed.e, ed.e + 80).includes(n) || text.slice(Math.max(0, ed.s - 80), ed.s).includes(n))) return 'повтор';
    const vy = (ws) => ws.some((w) => VY.has(w) || /(йте|ите)$/.test(w));
    if (words(text).some((w) => TY.has(w)) && vy(wt) && !vy(wf)) return 'вы';
    if (wt.some((w) => BAN.some((b) => w.startsWith(b))) && !wf.some((w) => BAN.some((b) => w.startsWith(b)))) return 'канцелярит';
    if (/[—–]/.test(t) && !/[—–]/.test(f)) return 'тире';
    if (hasLatin(t) && !hasLatin(f)) return 'латиница';
    if (wt.length > 2 * Math.max(1, wf.length) + 1) return 'длина';
    return '';
  }

  // порядок обхода, при котором любое начало списка разбросано по тексту (обратный порядок битов)
  function spread(k, shift = 0) {
    let p = 1;
    while (p < k) p <<= 1;
    const bits = Math.log2(p), out = [];
    for (let i = 0; i < p; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      if (r < k) out.push((r + shift) % k);
    }
    return out;
  }

  // пул правок для текста: найденные, годные, не забракованные судьёй, с весом в словах
  function pool(text, located) {
    return located.filter((ed) => ed.ok && !guard(text, ed)).map((ed) => {
      const wf = words(text.slice(ed.s, ed.e)), wt = words(ed.t);
      return Object.assign({}, ed, { lost: wf.length - matched(wf, wt), grow: wt.length - wf.length });
    });
  }

  // какие правки взять под плашку target%: начало порядка spread с оценкой ближе всего к цели
  function pick(text, list, target, shift = 0) {
    const n = words(text).length;
    if (!n || !list.length || target <= 0) return new Set();
    const order = spread(list.length, shift);
    let lost = 0, grow = 0, best = 0, bestErr = Math.abs(target);
    order.forEach((idx, i) => {
      lost += list[idx].lost; grow += list[idx].grow;
      const est = 100 * (1 - (n - lost) / Math.max(n, n + grow));
      const err = Math.abs(est - target);
      if (err < bestErr - 1e-9) { bestErr = err; best = i + 1; }
    });
    if (!best) {                                      // короткий текст: одна самая маленькая правка лучше, чем ни одной
      let min = 0;
      list.forEach((ed, i) => { if (ed.lost < list[min].lost) min = i; });
      return new Set([min]);
    }
    return new Set(order.slice(0, best));
  }

  // итоговый текст и куски для подсветки; off = правки, которые человек вернул касанием
  function build(text, list, chosen, off = new Set()) {
    const parts = [];
    let pos = 0, out = '';
    list.forEach((ed, i) => {
      if (!chosen.has(i)) return;
      if (ed.s > pos) parts.push({ text: text.slice(pos, ed.s) });
      const back = off.has(i);
      parts.push({ text: back ? text.slice(ed.s, ed.e) : ed.t, i, changed: !back, orig: text.slice(ed.s, ed.e) });
      pos = ed.e;
    });
    if (pos < text.length) parts.push({ text: text.slice(pos) });
    out = parts.map((p) => p.text).join('');
    return { text: out, parts, pct: pct(text, out) };
  }

  // перевод куска в другое лицо годен: числа те же и изменено не больше половины слов
  const voiceOk = (a, b) => !!String(b || '').trim() && (a.match(/\d+/g) || []).join() === (b.match(/\d+/g) || []).join() && pct(a, b) <= 50;

  // текст из переведённых кусков: всё между кусками и пробелы по краям куска остаются как были
  function splice(text, list, outs) {
    let out = '', pos = 0;
    list.forEach((c, i) => {
      const lead = c.text.match(/^\s*/)[0], tail = c.text.match(/\s*$/)[0];
      out += text.slice(pos, c.s) + (voiceOk(c.text, outs[i]) ? lead + outs[i].trim() + tail : c.text);
      pos = c.e;
    });
    return out + text.slice(pos);
  }

  // длинное и среднее тире → дефис (просьба Ивана 23.10): между числами слитно, в начале реплики «- », в остальных местах с пробелами
  const dashes = (t) => String(t || '')
    .replace(/(\d)[ \t]*[—–][ \t]*(?=\d)/g, '$1-')
    .replace(/(^|\n)[ \t]*[—–][ \t]*/g, '$1- ')
    .replace(/[ \t]*[—–][ \t]*/g, ' - ');

  // текст слайда: переносы строк картинки внутри абзаца → пробел; абзацы, пункты списка и концы фраз остаются
  function unwrap(t) {
    return String(t || '').replace(/\r/g, '').split(/\n{2,}/).map((par) => par.split('\n').map((l) => l.trim()).filter(Boolean)
      .reduce((acc, line) => (!acc ? line : acc + (/[.!?…:;»"]$/.test(acc) || /^(\d+[.)]|[-•—–*])\s/.test(line) ? '\n' : ' ') + line), ''))
      .filter(Boolean).join('\n\n');
  }

  // хэштеги и упоминания в конце подписи
  function trimTags(caption) {
    const lines = String(caption || '').replace(/\r/g, '').split('\n');
    while (lines.length && /^\s*([#@][\p{L}\p{N}_.]+\s*)*$/u.test(lines[lines.length - 1])) lines.pop();
    if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/(\s+[#][\p{L}\p{N}_]+)+\s*$/u, '');
    return lines.join('\n').trim();
  }

  return { words, matched, pct, chunks, locate, guard, spread, pool, pick, build, voiceOk, splice, dashes, unwrap, trimTags };
})();

// экран уникализатора: ссылка → текст донора → в каждом окошке (заголовок, текст) плашка N% → результат с подсветкой
// на месте поля, полоса процента поверх окошка, пока работает нейросеть (воркер uniq-api, см. его шапку)
// подмена воркера только для тестов на этом компьютере: чужой адрес из ссылки не принимается
const UQ_API = (/^http:\/\/127\.0\.0\.1:\d+$/.exec(new URLSearchParams(location.search).get('uniqapi') || '') || ['https://uniq-api.aivan-loginov.workers.dev'])[0];
const UQ_PCTS = [5, 10, 15, 20, 30];
const UQ_ERR = {
  quota: 'Нейросеть на сегодня выдохлась: дневной лимит кончился. Попробуй завтра',
  busy: 'Нейросеть сейчас не отвечает. Попробуй ещё раз через минуту',
  rate: 'Слишком много запросов подряд. Подожди минуту',
  unavailable: 'Пост не открылся: закрытый аккаунт, удалён или ссылка неверная',
  url: 'Это не ссылка на пост Instagram. Нужна ссылка вида instagram.com/reel/… или /p/…',
  image: 'Картинку не получилось прочитать',
  network: 'Нет связи с сервером. Проверь интернет и попробуй ещё раз',
};
const UQ_VOICES = [['o', 'Как в оригинале'], ['m', 'От мужчины'], ['f', 'От женщины'], ['n', 'Со стороны']];
const UQ_VOICE_NAME = { m: 'от мужского лица', f: 'от женского лица', n: 'со стороны' };
const UQ = { voice: 'o', dash: true, B: {} };          // B.title, B.text = окошки (uqBox)
try {
  const w = localStorage.getItem('uq-voice'); if (UQ_VOICES.some(([id]) => id === w)) UQ.voice = w;
  if (localStorage.getItem('uq-dash') === '0') UQ.dash = false;
} catch (e) {}

// запрос к воркеру: обрыв сети или занятая модель = ещё одна попытка через 1,5 с
async function uqCall(path, obj, retry = 1) {
  let r, j;
  try {
    r = await fetch(UQ_API + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(obj) });
    j = await r.json();
  } catch (e) { j = { ok: false, error: 'network' }; }
  if (!j.ok && retry && ['network', 'busy', 'server'].includes(j.error)) {
    await new Promise((ok) => setTimeout(ok, 1500));
    return uqCall(path, obj, retry - 1);
  }
  if (!j.ok) throw new Error(j.error || 'network');
  return j;
}
const uqMsg = (e) => UQ_ERR[e && e.message] || UQ_ERR.network;

// не больше n запросов одновременно (слайды, куски текста)
async function uqMap(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const uqSt = (id, text, cls) => { const el = $(id); el.textContent = text; el.className = 'hint' + (cls ? ' ' + cls : ''); };
const uqBoxSt = (B, text, cls) => { B.st.textContent = text; B.st.className = 'hint uqst' + (cls ? ' ' + cls : ''); };
const uqDraft = () => { try { localStorage.setItem('uq-draft', JSON.stringify({ url: $('uqUrl').value, title: $('uqTitle').value, text: $('uqText').value })); } catch (e) {} };

// полоса процента: у этапа своя доля полосы, внутри неё доля растёт по времени (оценка по длине кусков) и по готовым кускам
const uqEta = (t) => 1500 + 18 * t.length;           // мс на запрос, замер 24.10: заголовок 1,5 с, абзац 270 знаков 6,4 с
function uqStage(B, label, lo, hi, texts) {
  const eta = texts.map(uqEta), sum = eta.reduce((a, b) => a + b, 0) || 1;
  B.P = { label, lo, hi, t0: Date.now(), E: Math.max(sum / 4, ...eta, 1), sum, done: 0 };
}
function uqShow(B) {
  const P = B.P;
  if (P) {
    const f = Math.min(0.97, Math.max(P.done / P.sum, 1 - Math.exp(-(Date.now() - P.t0) / P.E)));
    B.shown = Math.max(B.shown, Math.round(P.lo + (P.hi - P.lo) * f));
  }
  B.load.querySelector('b').textContent = B.shown + '%';
  B.load.querySelector('i').style.width = B.shown + '%';
  B.load.querySelector('span').textContent = P ? P.label + '…' : 'Уникализирую…';
}
function uqBusy(B, on) {
  B.busy = on; B.area.readOnly = on; B.again.disabled = on;
  clearInterval(B.timer); clearTimeout(B.hide);
  if (on) { B.shown = 0; B.P = null; B.load.hidden = false; uqShow(B); B.timer = setInterval(() => uqShow(B), 150); }
  else B.load.hidden = true;
}

// правки текста окошка: куски параллельно, найденные места в тексте; повторный вызов с другим v добирает правки
async function uqEdits(B, text, v, label, lo, hi) {
  const ch = UNIQ.chunks(text);
  uqStage(B, label, lo, hi, ch.map((c) => c.text));
  const got = await uqMap(ch, 4, (c) => uqCall('/uniq', { text: c.text, v }).then((r) => { B.P.done += uqEta(c.text); return r; }));
  return ch.flatMap((c, i) => UNIQ.locate(text, c, got[i].edits));
}
const uqMax = (F) => UNIQ.build(F.src, F.pool, new Set(F.pool.map((_, i) => i))).pct;
// плашка считается от оригинала: то, что уже изменил перевод в другое лицо, из цели правок вычитается
const uqTarget = (B, F) => Math.max(0, B.pct - F.basePct);

// весь текст в нужное лицо по кускам; негодный перевод куска (потерял число, переписал больше половины) = оригинал куска
async function uqVoice(B, text, who) {
  const ch = UNIQ.chunks(text);
  uqStage(B, 'Перевожу ' + UQ_VOICE_NAME[who], 0, 35, ch.map((c) => c.text));
  const outs = await uqMap(ch, 4, (c) => uqCall('/voice', { text: c.text, voice: who }).then((r) => { B.P.done += uqEta(c.text); return r.text; }));
  return UNIQ.splice(text, ch, outs);
}

// длинному тексту правок одного варианта может не хватить на плашку: второй заход моделью с другим v
async function uqTopUp(B, F, lo, stale) {
  if (F.topped || UNIQ.words(F.src).length < 60 || uqMax(F) >= uqTarget(B, F) + 0.5) return;
  F.topped = true;
  try {
    const more = (await uqEdits(B, F.src, F.v + 25, 'Добираю правки', lo, 99)).filter((e) => !F.located.some((o) => e.s < o.e && o.s < e.e));
    if (stale()) return;
    F.located = F.located.concat(more).sort((a, b) => a.s - b.s);
    F.pool = UNIQ.pool(F.src, F.located); F.off = new Set();
  } catch (e) { F.err = uqMsg(e); }
}
const uqShort = (B, F) => !F.topped && UNIQ.words(F.src).length >= 60 && uqMax(F) < uqTarget(B, F) + 0.5;

// одна обработка окошка за раз; «Очистить» во время работы отменяет её результат (номер gen), нажатие голоса, тире
// или «Другой вариант» во время работы выполняется сразу после
async function uqWork(B, job) {
  const gen = ++B.gen, stale = () => gen !== B.gen;
  uqBusy(B, true); uqBoxSt(B, '');
  let err = '';
  try { await job(stale); } catch (e) { err = uqMsg(e); }
  if (stale()) return;
  uqBusy(B, false);
  if (!err) { B.load.hidden = false; B.P = null; B.shown = 100; uqShow(B); B.load.querySelector('span').textContent = 'Готово'; B.hide = setTimeout(() => { B.load.hidden = true; }, 350); }
  uqRender(B);
  if (err) uqBoxSt(B, err, 'err');
  const p = B.pending; B.pending = null;
  if (p) uqRun(B, p === 'next');
  else if (B.F && uqShort(B, B.F)) uqWork(B, (s) => uqTopUp(B, B.F, 0, s));   // плашку подняли во время обработки
}

function uqRun(B, nextVariant) {
  if (B.busy) { B.pending = nextVariant || B.pending === 'next' ? 'next' : 'same'; uqBoxSt(B, 'Пересоберу сразу после текущей обработки…'); return; }
  const raw = B.area.value.trim();
  if (!raw) return uqBoxSt(B, B.key === 'title' ? 'Сначала впиши заголовок или забери его по ссылке' : 'Сначала вставь текст или забери его по ссылке', 'err');
  if (nextVariant) B.v = (B.v + 1) % 25;
  return uqWork(B, async (stale) => {
    const orig = UQ.dash ? UNIQ.dashes(raw) : raw;   // тире меняются до правок: доля слов от них не растёт
    const voice = UQ.voice, src = voice !== 'o' ? await uqVoice(B, orig, voice) : orig;
    if (stale()) return;
    const located = await uqEdits(B, src, B.v, 'Подбираю правки', voice !== 'o' ? 35 : 0, 88);
    if (stale()) return;
    const F = { raw, orig, src, basePct: UNIQ.pct(orig, src), voice, located, pool: UNIQ.pool(src, located), off: new Set(), v: B.v };
    await uqTopUp(B, F, 88, stale);
    if (!stale()) B.F = F;
  });
}

// плашка: первый раз запускает уникализацию окошка, дальше переключает готовые правки мгновенно
function uqPick(B, p) {
  B.pct = p; press(B.pcts, 'data-pct', String(p));
  if (B.busy) return;                                // во время обработки результат соберётся сразу под новую плашку
  if (!B.F) return uqRun(B, false);
  uqRender(B);
  if (uqShort(B, B.F)) uqWork(B, (s) => uqTopUp(B, B.F, 0, s));
}

const uqFmt = (x) => x.toFixed(1).replace('.', ',');
function uqRender(B) {
  const F = B.F;
  B.area.hidden = !!F; B.res.hidden = !F; B.again.hidden = !F;
  if (!F) return;
  F.res = UNIQ.build(F.src, F.pool, UNIQ.pick(F.src, F.pool, uqTarget(B, F)), F.off);
  F.res.pct = UNIQ.pct(F.orig, F.res.text);
  const el = B.res; el.textContent = '';
  for (const p of F.res.parts) {
    if (p.i === undefined) { el.append(p.text); continue; }
    const m = document.createElement('mark');
    m.textContent = p.text; m.className = p.changed ? '' : 'back'; m.tabIndex = 0; m.setAttribute('role', 'button');
    m.title = p.changed ? 'Было: ' + p.orig + '. Нажми, чтобы вернуть' : 'Нажми, чтобы снова изменить';
    const flip = () => { if (F.off.has(p.i)) F.off.delete(p.i); else F.off.add(p.i); uqRender(B); };
    m.addEventListener('click', flip);
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    el.append(m);
  }
  const long = UNIQ.words(F.src).length >= 60;       // в коротком заголовке каждое слово = большой шаг доли, подсказка там шум
  const say = [`Изменено ${uqFmt(F.res.pct)}% слов`];
  if (F.voice !== 'o') say.push(F.basePct > 0.05 ? `Из них ${uqFmt(F.basePct)}% - перевод ${UQ_VOICE_NAME[F.voice]}, он не подсвечен` : 'Рассказчика «я» в тексте нет, лицо менять не пришлось');
  if (!F.pool.length) say.push('Правок для этого текста не нашлось, нажми «Другой вариант»');
  else if (long && F.res.pct + 2 < B.pct) say.push('Больше правок в этом варианте нет, нажми «Другой вариант»');
  if (F.res.parts.some((p) => p.i !== undefined)) say.push('Подсвечено изменённое: нажми на кусок, чтобы вернуть оригинал');
  if (F.err) say.push(F.err);
  uqBoxSt(B, say.join('. '));
}

// окошко снова пустое поле без результата: новый текст по ссылке, скрин, «Очистить»
function uqReset(B) {
  B.gen++; B.pending = null; uqBusy(B, false); B.F = null; B.pct = 0;
  press(B.pcts, 'data-pct', ''); uqRender(B); uqBoxSt(B, B.hint0);
}

async function uqCopy(B, btn) {
  const t = B.F && B.F.res ? B.F.res.text : B.area.value.trim();
  if (!t) return uqBoxSt(B, 'Копировать пока нечего', 'err');
  // буфер обмена бывает недоступен или висит (встроенные браузеры): через секунду запасной способ
  const ok = await Promise.race([navigator.clipboard ? navigator.clipboard.writeText(t).then(() => true, () => false) : false, new Promise((r) => setTimeout(() => r(false), 1000))]);
  if (!ok) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  btn.textContent = 'Скопировано'; clearTimeout(btn.back); btn.back = setTimeout(() => { btn.textContent = 'Скопировать'; }, 1500);
}

async function uqFetch() {
  const url = $('uqUrl').value.trim();
  if (!url) return uqSt('uqFetchSt', 'Вставь ссылку на рилс или карусель', 'err');
  $('uqFetch').disabled = true;
  try {
    uqSt('uqFetchSt', 'Забираю пост…');
    const p = await uqCall('/fetch', { url });
    uqReset(UQ.B.title); uqReset(UQ.B.text);
    if (p.kind === 'reel') {
      $('uqTitleBox').hidden = false; $('uqTextLabel').textContent = 'Текст под рилсом';
      $('uqText').value = UNIQ.trimTags(p.caption); $('uqTitle').value = '';
      uqSt('uqFetchSt', 'Читаю заголовок с обложки…');
      const o = p.cover ? await uqCall('/ocr', { src: p.cover, mode: 'title' }).catch(() => ({ text: '' })) : { text: '' };
      $('uqTitle').value = o.text;
      uqSt('uqFetchSt', o.text ? 'Готово: заголовок и текст под рилсом' : 'Текст забран. На обложке заголовок не нашёлся: загрузи скрин кадра с заголовком', o.text ? 'good' : '');
    } else {
      $('uqTitleBox').hidden = true; $('uqTextLabel').textContent = 'Текст со слайдов'; $('uqTitle').value = '';
      let done = 0, lost = 0;
      uqSt('uqFetchSt', `Читаю слайды: 0 из ${p.slides.length}`);
      const texts = await uqMap(p.slides, 6, (src) => uqCall('/ocr', { src, mode: 'slide' })
        .then((o) => o.text, (e) => { if (e.message === 'quota') throw e; lost++; return ''; })
        .finally(() => uqSt('uqFetchSt', `Читаю слайды: ${++done} из ${p.slides.length}`)));
      $('uqText').value = texts.filter(Boolean).map(UNIQ.unwrap).join('\n\n');
      uqSt('uqFetchSt', lost ? `Готово, но ${lost} из ${p.slides.length} слайдов не прочитались: допиши их текст руками` : `Готово: текст ${p.slides.length} слайдов`, lost ? 'err' : 'good');
    }
    uqDraft();
  } catch (e) { uqSt('uqFetchSt', uqMsg(e), 'err'); }
  $('uqFetch').disabled = false;
}

// скрин кадра: уменьшаем на телефоне до 1280 по длинной стороне, читает тот же движок
async function uqShot() {
  const f = $('uqShot').files[0]; $('uqShot').value = '';
  if (!f) return;
  const B = UQ.B.title;
  uqBoxSt(B, 'Читаю заголовок со скрина…');
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const o = await uqCall('/ocr', { img: c.toDataURL('image/jpeg', 0.85), mode: 'title' });
    if (o.text) { uqReset(B); $('uqTitle').value = o.text; uqDraft(); }
    uqBoxSt(B, o.text ? 'Заголовок со скрина прочитан. Нажми процент, чтобы уникализировать' : 'На скрине заголовок не нашёлся', o.text ? 'good' : 'err');
  } catch (e) { uqBoxSt(B, uqMsg(e), 'err'); }
}

function uqMode(on) {
  document.querySelector('.app').classList.toggle('uqmode', on);
  $('uqOpen').setAttribute('aria-pressed', String(on)); $('uqOpen').textContent = on ? '← К ролику' : 'Уникализатор';
  window.scrollTo(0, 0);
}

// окошко: поле, полоса, результат, свои плашки и кнопки (разметка в index-body, data-box)
function uqBox(key) {
  const root = document.querySelector(`[data-box="${key}"]`), q = (s) => root.querySelector(s);
  const B = { key, area: q('textarea'), res: q('.res'), load: q('.uqload'), st: q('.uqst'), pcts: q('.pcts'), again: q('.uqagain'),
    pct: 0, v: 0, F: null, busy: false, pending: null, gen: 0, shown: 0 };
  B.hint0 = B.st.textContent;
  UQ_PCTS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = p + '%'; b.setAttribute('data-pct', String(p)); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => uqPick(B, p));
    B.pcts.appendChild(b);
  });
  q('.uqcopy').addEventListener('click', (e) => uqCopy(B, e.currentTarget));
  q('.uqclear').addEventListener('click', () => { B.area.value = ''; uqReset(B); uqDraft(); });
  B.again.addEventListener('click', () => uqRun(B, true));
  return B;
}

(function buildUniq() {
  try { const d = JSON.parse(localStorage.getItem('uq-draft') || 'null'); if (d) { $('uqUrl').value = d.url || ''; $('uqTitle').value = d.title || ''; $('uqText').value = d.text || ''; } } catch (e) {}
  UQ.B.title = uqBox('title'); UQ.B.text = uqBox('text');
  const rerun = () => { for (const B of Object.values(UQ.B)) if (B.F || B.busy) uqRun(B, false); };   // лицо и тире меняют весь текст
  const vbox = $('uqVoices');
  UQ_VOICES.forEach(([id, name]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = name; b.setAttribute('data-voice', id);
    b.addEventListener('click', () => {
      if (UQ.voice === id) return;
      UQ.voice = id; press(vbox, 'data-voice', id); try { localStorage.setItem('uq-voice', id); } catch (e) {}
      rerun();
    });
    vbox.appendChild(b);
  });
  press(vbox, 'data-voice', UQ.voice);
  $('uqDash').setAttribute('aria-pressed', String(UQ.dash));
  $('uqDash').addEventListener('click', () => {
    UQ.dash = !UQ.dash; $('uqDash').setAttribute('aria-pressed', String(UQ.dash)); try { localStorage.setItem('uq-dash', UQ.dash ? '1' : '0'); } catch (e) {}
    rerun();
  });
  $('uqOpen').addEventListener('click', () => uqMode(!document.querySelector('.app').classList.contains('uqmode')));
  $('uqFetch').addEventListener('click', uqFetch);
  $('uqUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') uqFetch(); });
  $('uqShot').addEventListener('change', uqShot);
  ['uqUrl', 'uqTitle', 'uqText'].forEach((id) => $(id).addEventListener('input', uqDraft));
  $('uqToVideo').addEventListener('click', () => {
    const B = UQ.B.title, t = B.F && B.F.res ? B.F.res.text : B.area.value.trim();
    if (!t) return uqBoxSt(B, 'Сначала впиши заголовок или забери его по ссылке', 'err');
    S.text = t.split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
    $('txt').value = S.text; persist(); rebuild(0); hideDone();
    uqMode(false);                                    // строку статуса редактора каждый кадр пишут рамки: подтверждение = заголовок в превью
  });
})();
