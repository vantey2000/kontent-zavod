// Движение: счётчик, кольцо, конфетти, переход экранов. Только transform и opacity (плюс штрих SVG),
// при prefers-reduced-motion всё показывается сразу. Без внешних библиотек
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduced = () => !!(mq && mq.matches);
export const DUR = { press: 120, enter: 220, screen: 280, count: 1000, ring: 800, check: 500, confetti: 1500 };
const easeOut = t => 1 - Math.pow(1 - t, 3);

// Число «набегает» от from до to за ms; при reduced сразу to. Новый счёт на том же элементе гасит старый,
// поэтому на экране всегда остаётся последнее значение
const runs = new WeakMap();
export function countUp(el, to, { from = 0, ms = DUR.count, format = v => String(Math.round(v)) } = {}) {
  const id = (runs.get(el) || 0) + 1;
  runs.set(el, id);
  if (reduced() || ms <= 0 || from === to) { el.textContent = format(to); return Promise.resolve(); }
  el.textContent = format(from);
  return new Promise(resolve => {
    let t0 = null;
    const step = now => {
      if (runs.get(el) !== id) return resolve();
      if (t0 === null) t0 = now;
      const t = Math.min(1, (now - t0) / ms);
      el.textContent = format(t < 1 ? from + (to - from) * easeOut(t) : to);
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

// Кольцо: окружность .ring-v заполняется на долю fraction (0..1) штрихом
export function ring(svg, fraction, { delay = 0 } = {}) {
  const c = svg.querySelector('.ring-v');
  if (!c) return;
  const r = Number(c.getAttribute('r'));
  const len = 2 * Math.PI * r;
  const target = len * (1 - Math.max(0, Math.min(1, fraction)));
  c.style.strokeDasharray = String(len);
  if (reduced()) { c.style.transition = 'none'; c.style.strokeDashoffset = String(target); return; }
  c.style.transition = 'none';
  c.style.strokeDashoffset = String(len);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    c.style.transition = `stroke-dashoffset ${DUR.ring}ms cubic-bezier(0.23, 1, 0.32, 1) ${delay}ms`;
    c.style.strokeDashoffset = String(target);
  }));
}

// Штрих рисуется от начала к концу: галочка, линия графика. Длину можно передать (на скрытом экране
// getTotalLength не везде считает), иначе берётся pathLength или длина из браузера
export function drawPath(path, { ms = DUR.check, delay = 0, len = null } = {}) {
  if (!path) return;
  if (len == null) len = Number(path.getAttribute('pathLength')) || (path.getTotalLength ? path.getTotalLength() : 100);
  path.style.strokeDasharray = String(len);
  if (reduced()) { path.style.transition = 'none'; path.style.strokeDashoffset = '0'; return; }
  path.style.transition = 'none';
  path.style.strokeDashoffset = String(len);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    path.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(0.23, 1, 0.32, 1) ${delay}ms`;
    path.style.strokeDashoffset = '0';
  }));
}

// Конфетти на canvas поверх окна: 80 частиц, полторы секунды, один раз. Только на вехах.
// Холст fixed и без нажатий, поэтому не мешает кнопкам и не зависит от того, виден ли уже экран
export function confetti({ count = 80, ms = DUR.confetti } = {}) {
  if (reduced()) return false;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  cv.setAttribute('aria-hidden', 'true');
  const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  if (!ctx) return false;
  ctx.scale(dpr, dpr);
  document.body.append(cv);
  const css = getComputedStyle(document.documentElement);   // цвета из токенов темы: в дневной ночные пропали бы на светлом
  const colors = ['--red', '--fg', '--red-soft', '--muted'].map(v => css.getPropertyValue(v).trim() || '#ed4345');
  const parts = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.3,
    vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 4,
    w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const step = now => {
    const t = (now - t0) / ms;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 1) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
  return true;
}

// Переход экранов: View Transitions, где есть (Safari iOS 18+, Chrome 111+), иначе просто смена.
// Обещание выполняется, когда новый экран уже в DOM: после него можно ставить фокус и мерить размеры.
// kind = имя перехода в html[data-vt] на время анимации (смена темы растворяется, а не сдвигается)
export function transition(update, kind = null) {
  if (reduced() || typeof document.startViewTransition !== 'function') { update(); return Promise.resolve(); }
  const root = document.documentElement;
  try {
    if (kind) root.dataset.vt = kind;
    const vt = document.startViewTransition(update);
    vt.ready.catch(() => {});   // переход, перебитый следующим, отменяется: без ошибки в консоли
    vt.finished.catch(() => {}).then(() => { if (kind && root.dataset.vt === kind) delete root.dataset.vt; });
    return vt.updateCallbackDone.catch(() => {});
  } catch (e) { delete root.dataset.vt; update(); return Promise.resolve(); }
}
