/* Анти-Кортизол, страница протокола (ivan-loginov.ru/kortizol/), 25.10.2026
   Всплывашки, «открыли страницу» и «осталось мест» берутся только из настоящих событий сервера (/api/feed).
   Пока событий нет, их просто не видно */
(function () {
  var API = 'https://kortizol-api.aivan-loginov.workers.dev';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var sid = store.get('ak-sid');
  if (!sid) { sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); store.set('ak-sid', sid); }
  function send(ev, val) {
    try {
      fetch(API + '/api/ev', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ev: ev, val: val == null ? '' : String(val), sid: sid }), keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  // учёт после показа страницы, человек его не ждёт
  window.addEventListener('load', function () { setTimeout(function () { send('visit', ''); }, 300); });

  /* полоса чтения и липкая кнопка */
  var bar = $('#progress'), sticky = $('#sticky'), hero = $('.hero');
  function onScroll() {
    var h = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (h > 0 ? scrollY / h * 100 : 0) + '%';
    var pr = $('#pricing').getBoundingClientRect();
    var inPricing = pr.top < innerHeight && pr.bottom > 0;
    sticky.classList.toggle('on', scrollY > hero.offsetHeight * 0.8 && !inPricing);
  }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* таймер: цена закреплена за человеком на 48 часов с первого захода */
  var end = +store.get('ak-timer');
  if (!end) { end = Date.now() + 48 * 3600e3; store.set('ak-timer', String(end)); }
  var tm = $('[data-timer]');
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var ms = end - Date.now();
    if (ms <= 0) { tm.hidden = true; return; }
    var s = Math.floor(ms / 1000);
    $('[data-h]', tm).textContent = pad(Math.floor(s / 3600));
    $('[data-m]', tm).textContent = pad(Math.floor(s / 60) % 60);
    $('[data-s]', tm).textContent = pad(s % 60);
  }
  tick(); setInterval(tick, 1000);

  /* живая лента: тесты, оплаты, кто открыл страницу, места */
  var items = [], shown = 0, toast = $('#toast');
  var LEVEL = { 0: 'Стресс пока под контролем', 1: 'Стресс пока под контролем', 2: 'Стресс уже бьёт по сну и энергии',
    3: 'Стресс уже бьёт по сну и энергии', 4: 'Похоже на хронический стресс', 5: 'Похоже на хронический стресс', 6: 'Похоже на хронический стресс' };
  var TIER = { start: 'СТАРТ', opt: 'ОПТИМУМ', prem: 'ПРЕМИУМ' };
  function ago(m) { return m < 60 ? m + ' мин назад' : Math.round(m / 60) + ' ч назад'; }
  function loadFeed() {
    fetch(API + '/api/feed').then(function (r) { return r.json(); }).then(function (f) {
      items = f.items || [];
      var v = $('#viewers');
      if (f.viewers >= 5) { v.textContent = '👁 ' + f.viewers + ' человек открыли страницу за 10 минут'; v.style.display = 'block'; }
      else v.style.display = 'none';
      var sold = f.places - f.left;
      var line = sold > 0 ? '⏰ Цена тестового потока · осталось ' + f.left + ' мест из ' + f.places : '⏰ Цена тестового потока для первых ' + f.places + ' участниц';
      $$('[data-left-line],[data-left-line2]').forEach(function (n) { n.textContent = line; });
      var l = $('[data-left]');
      if (sold > 0) { l.textContent = 'Осталось ' + f.left + ' мест из ' + f.places; l.hidden = false; }
    }).catch(function () {});
  }
  function showToast() {
    if (!items.length) return;
    var it = items[shown++ % items.length];
    var who = it.city ? 'из ' + it.city : '';
    if (it.t === 'paid') toast.innerHTML = '🟢 Покупка ' + who + ' · ' + (TIER[it.val] || '') + '<small>' + ago(it.ago) + '</small>';
    else toast.innerHTML = '🧪 Кто-то ' + who + ' прошёл тест<small>«' + (LEVEL[it.val] || '') + '» · ' + ago(it.ago) + '</small>';
    toast.classList.add('on');
    setTimeout(function () { toast.classList.remove('on'); }, 6000);
  }
  loadFeed(); setInterval(loadFeed, 60000);
  setTimeout(function () { showToast(); setInterval(showToast, 40000); }, 10000);

  /* покупка */
  var err = $('[data-err]');
  function buy(tier, btn) {
    send('tier', tier);
    var q = store.get('ak-quiz');
    var all = $$('[data-buy],[data-rbuy]');
    all.forEach(function (b) { b.disabled = true; });
    var old = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Готовим оплату…';
    err.style.display = 'none';
    fetch(API + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: tier, sid: sid, quiz: q === null ? null : +q }) })
      .then(function (r) { return r.json().then(function (b) { return { s: r.status, b: b }; }); })
      .then(function (x) {
        if (x.s === 200 && x.b.url) { location.href = x.b.url; return; }
        throw new Error(x.b && x.b.error || 'Касса не ответила');
      })
      .catch(function (e) {
        all.forEach(function (b) { b.disabled = false; });
        if (btn) btn.textContent = old;
        closeQuiz();
        err.textContent = (e && e.message) || 'Касса не ответила. Попробуй ещё раз через минуту';
        err.style.display = 'block';
        err.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
  }
  $$('[data-buy]').forEach(function (b) { b.addEventListener('click', function () { buy(b.getAttribute('data-buy'), b); }); });

  /* тест */
  var Q = ['Просыпаешься уставшей, даже если спала 7-8 часов?', 'Тянет на сладкое или солёное вечером?',
    'Без кофе после обеда не протянуть до вечера?', 'Раздражаешься по мелочам, срываешься на близких?',
    'Долго не можешь уснуть, мысли крутятся в голове?', 'Чувствуешь тревогу без явной причины?'];
  var R = [
    { min: 0, max: 1, title: 'Стресс пока под контролем', tier: 'start', btn: 'СТАРТ за 990 ₽ →',
      text: 'Сигналов почти нет. Протокол поможет закрепить ритм и знать, что делать, когда станет тяжело. Тебе подойдёт тариф СТАРТ' },
    { min: 2, max: 3, title: 'Стресс уже бьёт по сну и энергии', tier: 'opt', btn: 'ОПТИМУМ за 2 990 ₽ →',
      text: 'Тело уже сигналит. Начать стоит со сна, кофе и дыхания. ОПТИМУМ закрывает это целиком: уроки, SOS-протокол, аудио-практики и рецепты' },
    { min: 4, max: 6, title: 'Похоже на хронический стресс', tier: 'prem', btn: 'ПРЕМИУМ за 7 990 ₽ →',
      text: 'Стресс давно живёт с тобой. Здесь важна поддержка каждый день: в ПРЕМИУМ ИИ-куратор отвечает 24/7 и есть личный план по твоему результату' }
  ];
  var modal = $('#quiz'), step = 0, score = 0, quizShown = false;
  function render() {
    $('[data-qbar]').style.width = (step / Q.length * 100) + '%';
    if (step < Q.length) { $('[data-qtext]').textContent = (step + 1) + ' из ' + Q.length + '. ' + Q[step]; return; }
    var r = R.filter(function (x) { return score >= x.min && score <= x.max; })[0];
    store.set('ak-quiz', String(score)); send('quiz', score);
    $('[data-step="q"]').hidden = true; $('[data-step="r"]').hidden = false;
    $('[data-rtitle]').textContent = r.title; $('[data-rtext]').textContent = r.text;
    var b = $('[data-rbuy]'); b.textContent = r.btn; b.onclick = function () { buy(r.tier, b); };
  }
  function openQuiz() {
    quizShown = true; step = 0; score = 0;
    $('[data-step="q"]').hidden = false; $('[data-step="r"]').hidden = true;
    render(); modal.classList.add('on');
  }
  function closeQuiz() { modal.classList.remove('on'); }
  $$('[data-quiz]').forEach(function (b) { b.addEventListener('click', openQuiz); });
  $$('[data-ans]').forEach(function (b) {
    b.addEventListener('click', function () { score += +b.getAttribute('data-ans'); step++; render(); });
  });
  $('[data-close]').addEventListener('click', closeQuiz);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeQuiz(); });
  // на компьютере тест предлагается, когда мышь уходит за верх окна (один раз)
  document.addEventListener('mouseleave', function (e) {
    if (e.clientY < 10 && !quizShown && store.get('ak-quiz') === null && matchMedia('(pointer:fine)').matches) openQuiz();
  });
})();
